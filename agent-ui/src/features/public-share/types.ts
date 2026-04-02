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

export type PublicShareSnapshotMessage = {
  id: string;
  role: "user" | "assistant";
  parts: PublicShareSnapshotPart[];
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
  selected_turn_count: number;
  snapshot: PublicShareSnapshot;
  created_at: string;
  updated_at: string;
};
