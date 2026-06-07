export type PublicShareSnapshotPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "source";
      id: string;
      url: string;
      title?: string;
    };

export type PublicShareSnapshotProcessRow = {
  id: string;
  kind: "reasoning" | "tool" | "source" | "meta" | "process" | "done" | "error" | "debug";
  title: string;
  detail?: string;
  at?: string;
};

export type PublicShareSnapshotMessage = {
  id: string;
  role: "user" | "assistant";
  createdAt?: string;
  parts: PublicShareSnapshotPart[];
  processRows?: PublicShareSnapshotProcessRow[];
};

export type PublicShareSnapshotTurn = {
  id: string;
  leadMessageId: string;
  messages: PublicShareSnapshotMessage[];
};

export type PublicShareSnapshot = {
  version: 1;
  threadTitle?: string;
  turns: PublicShareSnapshotTurn[];
};

export type ThreadPublicShareView = {
  id: string;
  token: string;
  title: string;
  public_path: string;
  user_display_name?: string;
  selected_turn_count: number;
  snapshot: PublicShareSnapshot;
  created_at: string;
  updated_at: string;
};
