import { createHash } from "node:crypto";

export type ImageOnlyBackfillMessage = {
  id: string;
  externalId: string | null;
  role: string;
  parentId: string | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
  content: unknown;
  runConfig: unknown;
};

export type ImageOnlyBackfillArtifact = {
  id: string;
  relativePath: string;
  previewStatus: string;
  downloadStatus: string;
  workspaceFileId: string | null;
  workspaceFileVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ImageOnlyBackfillTurn = {
  userMessage: ImageOnlyBackfillMessage;
  userParentId: string | null;
  assistantId: string;
  assistantPosition: number;
  userPosition: number;
  completedAt: Date;
  artifacts: ImageOnlyBackfillArtifact[];
};

export type ImageOnlyTailBackfillPlan = {
  affected: boolean;
  headBefore: string | null;
  headAfter: string | null;
  turns: ImageOnlyBackfillTurn[];
  prefixMessages: ImageOnlyBackfillMessage[];
};

function recoveredAssistantId(threadId: string, userMessageId: string): string {
  return `portal-image-recovery-${createHash("sha256")
    .update(`${threadId}:${userMessageId}`)
    .digest("hex")
    .slice(0, 24)}`;
}

export function planImageOnlyTailBackfill(input: {
  threadId: string;
  headId: string | null;
  messages: ImageOnlyBackfillMessage[];
  artifacts: ImageOnlyBackfillArtifact[];
  after: Date;
  before?: Date;
}): ImageOnlyTailBackfillPlan {
  const messages = [...input.messages].sort((left, right) =>
    left.position - right.position || left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id)
  );
  const assistantParentIds = new Set(messages
    .filter((message) => message.role === "assistant" && message.parentId)
    .map((message) => message.parentId!));
  const users = messages.filter((message) => message.role === "user");
  const selectedUsers = users.filter((message) =>
    Boolean(message.externalId) &&
    !assistantParentIds.has(message.externalId!) &&
    message.createdAt >= input.after &&
    (!input.before || message.createdAt < input.before)
  );
  if (selectedUsers.length === 0) {
    return {
      affected: false,
      headBefore: input.headId,
      headAfter: input.headId,
      turns: [],
      prefixMessages: messages
    };
  }

  const firstIndex = messages.findIndex((message) => message.id === selectedUsers[0]!.id);
  const tail = messages.slice(firstIndex);
  if (tail.length !== selectedUsers.length || tail.some((message, index) => message.id !== selectedUsers[index]?.id)) {
    throw new Error("Image-only backfill is restricted to a contiguous dangling user-message tail");
  }

  const artifacts = [...input.artifacts]
    .filter((artifact) => artifact.previewStatus === "ready" || artifact.downloadStatus === "ready")
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
  const turns: ImageOnlyBackfillTurn[] = [];
  let previousAssistantId: string | null = null;
  for (let index = 0; index < selectedUsers.length; index += 1) {
    const userMessage = selectedUsers[index]!;
    const nextUser = selectedUsers[index + 1];
    const turnArtifacts = artifacts.filter((artifact) =>
      artifact.createdAt >= userMessage.createdAt && (!nextUser || artifact.createdAt < nextUser.createdAt)
    );
    if (turnArtifacts.length === 0) {
      throw new Error(`No ready artifact was found for dangling user message ${userMessage.externalId}`);
    }
    const assistantId = recoveredAssistantId(input.threadId, userMessage.externalId!);
    turns.push({
      userMessage,
      userParentId: index === 0 ? userMessage.parentId : previousAssistantId,
      assistantId,
      userPosition: firstIndex + index * 2,
      assistantPosition: firstIndex + index * 2 + 1,
      completedAt: turnArtifacts.reduce(
        (latest, artifact) => artifact.createdAt > latest ? artifact.createdAt : latest,
        turnArtifacts[0]!.createdAt
      ),
      artifacts: turnArtifacts
    });
    previousAssistantId = assistantId;
  }

  return {
    affected: true,
    headBefore: input.headId,
    headAfter: previousAssistantId,
    turns,
    prefixMessages: messages.slice(0, firstIndex)
  };
}

export function recoveredImageAssistantMessage(turn: ImageOnlyBackfillTurn): Record<string, unknown> {
  return {
    id: turn.assistantId,
    role: "assistant",
    content: [
      {
        type: "text",
        text: "生成已完成，结果已附在本次回复中。"
      },
      {
        type: "data",
        name: "codex_file_change",
        data: {
          at: turn.completedAt.toISOString(),
          artifact_only: true,
          changes: turn.artifacts.map((artifact) => ({
            path: artifact.relativePath,
            kind: "ready",
            artifact_id: artifact.id,
            workspace_file_id: artifact.workspaceFileId,
            workspace_file_version_id: artifact.workspaceFileVersionId,
            preview_status: artifact.previewStatus,
            download_status: artifact.downloadStatus,
            can_preview: artifact.previewStatus === "ready",
            can_download: artifact.downloadStatus === "ready"
          }))
        }
      }
    ],
    status: { type: "complete", reason: "stop" },
    createdAt: turn.completedAt.toISOString(),
    metadata: {
      unstable_state: {},
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {
        channel: "portal",
        serverPersisted: true,
        recovered: true,
        recoverySource: "image_only_artifact_backfill"
      }
    }
  };
}
