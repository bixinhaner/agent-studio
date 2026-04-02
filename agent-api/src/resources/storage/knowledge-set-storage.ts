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
  deleteKnowledgeSetData(knowledgeSetStorageKey: string): Promise<void>;
  saveFiles(input: {
    knowledgeSetStorageKey: string;
    files: Array<{ name: string; buffer: Buffer; mimeType?: string }>;
  }): Promise<KnowledgeSetStorageResult>;
  extractArchive(input: {
    knowledgeSetStorageKey: string;
    archiveName: string;
    buffer: Buffer;
  }): Promise<KnowledgeSetStorageResult>;
  resolveReadableMountPath(knowledgeSetStorageKey: string): string;
}
