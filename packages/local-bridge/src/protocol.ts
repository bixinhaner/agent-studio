export type LocalRoot = { id: string; path: string; label?: string };
export type LocalOperation = 'workspace_info' | 'list' | 'read' | 'write' | 'edit' | 'mkdir' | 'move' | 'delete' | 'exec' | 'process' | 'open' | 'cancel_task';
export type LocalCommand = { id: string; rootId: string; threadId: string; op: LocalOperation; args: Record<string, unknown>; lease: string };
export type LocalResult = { ok: boolean; error?: string; [key: string]: unknown };
