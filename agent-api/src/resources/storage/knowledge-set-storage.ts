export type KnowledgeSetStorageItem = {
  kind: "file";
  relativePath: string;
  displayName: string;
  mimeType?: string;
  sizeBytes?: bigint;
  checksum?: string;
  sourceArchiveName?: string;
};

export type KnowledgeSetStorageResult = {
  mountPath: string;
  items: KnowledgeSetStorageItem[];
};

export interface KnowledgeSetStorage {
  saveFiles(input: {
    knowledgeSetId: string;
    files: Array<{ name: string; buffer: Buffer; mimeType?: string }>;
  }): Promise<KnowledgeSetStorageResult>;
  extractArchive(input: {
    knowledgeSetId: string;
    archiveName: string;
    buffer: Buffer;
  }): Promise<KnowledgeSetStorageResult>;
  resolveReadableMountPath(knowledgeSetId: string): string;
}
