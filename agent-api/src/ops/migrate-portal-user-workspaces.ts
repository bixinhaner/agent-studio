import fs from "node:fs/promises";
import path from "node:path";

import { appConfig } from "../config.js";
import { createDbClient } from "../db/client.js";
import { LocalFsWorkspaceStorage, workspaceObjectChecksum } from "../workspaces/storage.js";
import { PortalWorkspaceService, type WorkspaceActor } from "../workspaces/service.js";

// Historical ready artifacts may predate the current 512 MB upload boundary.
// Import them without changing the limit for new Portal uploads.
const MAX_MIGRATION_FILE_BYTES = 512 * 1024 * 1024;

type MigrationStats = {
  workspacesEnsured: number;
  threadsVisited: number;
  artifactsMigrated: number;
  attachmentsMigrated: number;
  skippedAlreadyMigrated: number;
  skippedUnsafeOrMissing: number;
  failed: number;
};

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function displayNameFromUpload(filePath: string): string {
  const fileName = path.basename(filePath);
  const modern = fileName.match(/^\d+-[a-f0-9]{12}-(.+)$/i);
  const crest = fileName.match(/^\d+-\d{2}-(.+)$/);
  return (modern?.[1] || crest?.[1] || fileName).normalize("NFKC").trim().slice(0, 255) || "upload.bin";
}

function mimeTypeForName(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  return {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  }[extension] ?? "application/octet-stream";
}

async function readSafeLegacyFile(workspacePath: string, candidatePath: string): Promise<Buffer | undefined> {
  const workspace = path.resolve(workspacePath);
  const candidate = path.resolve(candidatePath);
  if (!isPathInside(workspace, candidate)) return undefined;
  const linkStat = await fs.lstat(candidate).catch(() => undefined);
  if (!linkStat?.isFile() || linkStat.isSymbolicLink() || linkStat.nlink > 1) return undefined;
  if (linkStat.size > MAX_MIGRATION_FILE_BYTES) return undefined;
  const realPath = await fs.realpath(candidate).catch(() => "");
  if (!realPath || !isPathInside(workspace, realPath)) return undefined;
  return fs.readFile(realPath);
}

async function listRegularFiles(directoryPath: string): Promise<string[]> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .map((entry) => path.join(directoryPath, entry.name));
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const db = createDbClient();
  const service = new PortalWorkspaceService(
    db,
    new LocalFsWorkspaceStorage(appConfig.userWorkspaceStorageRoot)
  );
  const stats: MigrationStats = {
    workspacesEnsured: 0,
    threadsVisited: 0,
    artifactsMigrated: 0,
    attachmentsMigrated: 0,
    skippedAlreadyMigrated: 0,
    skippedUnsafeOrMissing: 0,
    failed: 0
  };

  try {
    const threads = await db.thread.findMany({
      where: {
        userId: { not: null },
        organizationId: { not: null }
      },
      select: {
        id: true,
        organizationId: true,
        userId: true,
        securityDomainId: true,
        userWorkspaceId: true,
        workspaceFolderId: true,
        workspace: true,
        artifacts: {
          select: {
            id: true,
            relativePath: true,
            displayName: true,
            mimeType: true,
            previewStatus: true,
            workspaceFileId: true
          }
        }
      },
      orderBy: { createdAt: "asc" }
    });

    const ensuredScopes = new Map<
      string,
      Awaited<ReturnType<PortalWorkspaceService["ensureWorkspace"]>> | null
    >();
    for (const thread of threads) {
      const organizationId = thread.organizationId;
      const userId = thread.userId;
      if (!organizationId || !userId) continue;
      stats.threadsVisited += 1;
      const actor: WorkspaceActor = {
        organizationId,
        userId,
        securityDomainId: thread.securityDomainId ?? undefined
      };
      const scopeKey = `${organizationId}:${thread.securityDomainId ?? "_"}:${userId}`;
      let workspaceId = thread.userWorkspaceId ?? undefined;
      let folderId = thread.workspaceFolderId ?? undefined;
      let canonicalWorkspace = ensuredScopes.get(scopeKey);
      if (canonicalWorkspace === undefined) {
        canonicalWorkspace = dryRun ? null : await service.ensureWorkspace(actor);
        ensuredScopes.set(scopeKey, canonicalWorkspace);
        stats.workspacesEnsured += 1;
      }
      if (!dryRun && canonicalWorkspace) {
        const workspaceChanged = workspaceId !== canonicalWorkspace.id;
        workspaceId = canonicalWorkspace.id;
        if (workspaceChanged || !folderId) folderId = canonicalWorkspace.historyFolderId;
        const storedFolder = await db.workspaceNode.findFirst({
          where: {
            id: folderId,
            workspaceId,
            kind: "folder",
            state: "active"
          },
          select: { id: true }
        });
        if (!storedFolder) {
          folderId = canonicalWorkspace.historyFolderId;
        }
        if (
          thread.userWorkspaceId !== workspaceId ||
          thread.workspaceFolderId !== folderId
        ) {
          await db.thread.update({
            where: { id: thread.id },
            data: { userWorkspaceId: workspaceId, workspaceFolderId: folderId }
          });
        }
      }

      const workspacePath = thread.workspace ? path.resolve(thread.workspace) : "";
      if (!workspacePath) {
        stats.skippedUnsafeOrMissing += thread.artifacts.filter((artifact) => !artifact.workspaceFileId).length;
        continue;
      }

      for (const artifact of thread.artifacts) {
        if (artifact.workspaceFileId) {
          stats.skippedAlreadyMigrated += 1;
          continue;
        }
        if (artifact.previewStatus !== "ready") {
          stats.skippedUnsafeOrMissing += 1;
          continue;
        }
        const content = await readSafeLegacyFile(
          workspacePath,
          path.resolve(workspacePath, artifact.relativePath)
        );
        if (!content) {
          stats.skippedUnsafeOrMissing += 1;
          continue;
        }
        if (dryRun) {
          stats.artifactsMigrated += 1;
          continue;
        }
        try {
          const saved = await service.saveFile({
            actor,
            parentId: folderId,
            name: artifact.displayName || path.basename(artifact.relativePath),
            content,
            mimeType: artifact.mimeType ?? mimeTypeForName(artifact.relativePath),
            conflict: "keep_both",
            createdByType: "migration",
            threadId: thread.id,
            role: "output"
          });
          await db.threadArtifact.update({
            where: { id: artifact.id },
            data: {
              workspaceFileId: saved.file.id,
              workspaceFileVersionId: saved.version.id
            }
          });
          stats.artifactsMigrated += 1;
        } catch (error) {
          stats.failed += 1;
          console.warn(
            `[workspace-migration] artifact ${artifact.id} failed:`,
            error instanceof Error ? error.message : error
          );
        }
      }

      const uploadDirectories = [
        path.join(workspacePath, ".agent-studio", "uploads", thread.id),
        ...(path.basename(workspacePath) === `thread-${thread.id}`
          ? [path.join(workspacePath, ".uploads")]
          : [])
      ];
      const existingBindings = await db.threadFileBinding.findMany({
        where: { threadId: thread.id, role: "input" },
        include: { file: { select: { checksum: true } } }
      });
      const existingChecksums = new Set(
        existingBindings.map((binding) => binding.file.checksum).filter((checksum): checksum is string => Boolean(checksum))
      );
      for (const uploadDirectory of uploadDirectories) {
        for (const uploadPath of await listRegularFiles(uploadDirectory)) {
          const content = await readSafeLegacyFile(workspacePath, uploadPath);
          if (!content) {
            stats.skippedUnsafeOrMissing += 1;
            continue;
          }
          const checksum = workspaceObjectChecksum(content);
          if (existingChecksums.has(checksum)) {
            stats.skippedAlreadyMigrated += 1;
            continue;
          }
          if (dryRun) {
            stats.attachmentsMigrated += 1;
            existingChecksums.add(checksum);
            continue;
          }
          try {
            await service.saveFile({
              actor,
              parentId: folderId,
              name: displayNameFromUpload(uploadPath),
              content,
              mimeType: mimeTypeForName(uploadPath),
              conflict: "keep_both",
              createdByType: "migration",
              threadId: thread.id,
              role: "input"
            });
            existingChecksums.add(checksum);
            stats.attachmentsMigrated += 1;
          } catch (error) {
            stats.failed += 1;
            console.warn(
              `[workspace-migration] attachment ${uploadPath} failed:`,
              error instanceof Error ? error.message : error
            );
          }
        }
      }
    }

    process.stdout.write(`${JSON.stringify({ dryRun, storageRoot: appConfig.userWorkspaceStorageRoot, ...stats }, null, 2)}\n`);
    if (stats.failed > 0) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
