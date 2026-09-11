import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const bridgeHash = (value: string) => createHash('sha256').update(value).digest('hex');
export const bridgeOnline = (device: any) => device?.status === 'active' && device.lastSeenAt && Date.now() - new Date(device.lastSeenAt).getTime() < 15000;
const include = { root: { include: { device: true } }, thread: true };
export const localBridgeBinding = (db: any, threadId: string) => db.localBridgeBinding.findUnique({ where: { threadId }, include });
export async function localBindingForWorkspace(db: any, userId?: string, workspace?: string) {
  if (!userId || !workspace) return null;
  return db.localBridgeBinding.findFirst({ where: { thread: { userId, workspace, channel: 'portal' } }, include });
}
export function bindingOut(binding: any) {
  if (!binding) return null;
  const d = binding.root.device;
  return { id: binding.id, thread_id: binding.threadId, root_id: binding.rootId, path: binding.root.path, label: binding.root.label || path.basename(binding.root.path), device_id: d.id, device_name: d.name, status: bridgeOnline(d) ? 'online' : 'offline' };
}
export function bindingToken(binding: any) { return `${binding.id}.${bridgeHash(`local-workspace-v1:${binding.root.device.tokenHash}:${binding.id}`)}`; }
export async function authenticateBinding(db: any, token: string) {
  const id = token.split('.')[0];
  const binding = await db.localBridgeBinding.findUnique({ where: { id }, include });
  if (!binding || binding.root.device.status !== 'active' || binding.thread.userId !== binding.root.device.userId) return null;
  const expected = Buffer.from(bindingToken(binding)); const provided = Buffer.from(token);
  return expected.length === provided.length && timingSafeEqual(expected, provided) ? binding : null;
}
export async function bindLocalRoot(db: any, userId: string, threadId: string, rootId: string | null) {
  const thread = await db.thread.findFirst({ where: { id: threadId, userId, channel: 'portal' } });
  if (!thread) throw new Error('Task not found');
  if (rootId) {
    const root = await db.localBridgeRoot.findFirst({ where: { id: rootId, device: { userId, status: 'active' } } });
    if (!root) throw new Error('Folder not found');
    const old = await localBridgeBinding(db, threadId);
    if (old?.rootId === rootId) return old;
  }
  await cancelLocalTask(db, threadId);
  await db.$transaction(async (tx: any) => {
    await tx.localBridgeBinding.deleteMany({ where: { threadId } });
    if (rootId) await tx.localBridgeBinding.create({ data: { threadId, rootId } });
  });
  return localBridgeBinding(db, threadId);
}
export async function enqueueLocalCommand(db: any, binding: any, op: string, args: any, requestId: string = randomUUID()) {
  if (!bridgeOnline(binding.root.device)) throw new Error('LOCAL_COMPUTER_OFFLINE: Open the desktop client, then continue on the same computer. Do not substitute cloud files or repeat an uncertain command.');
  return db.localBridgeCommand.upsert({ where: { id: requestId }, update: {}, create: { id: requestId, deviceId: binding.root.deviceId, threadId: binding.threadId, bindingId: binding.id, rootId: binding.rootId, op, args, deadline: new Date(Date.now() + 10 * 60000) } });
}
export async function waitLocalCommand(db: any, id: string, waitMs = 20000) {
  const until = Date.now() + waitMs;
  do {
    const command = await db.localBridgeCommand.findUnique({ where: { id } });
    if (!command) return { ok: false, error: 'REQUEST_NOT_FOUND' };
    if (command.status === 'completed') return command.result;
    if (command.status === 'cancelled') return { ok: false, error: 'TASK_CANCELLED' };
    if (new Date(command.deadline).getTime() < Date.now()) return { ok: false, error: 'REQUEST_EXPIRED_OUTCOME_UNKNOWN', request_id: id };
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < until);
  return { ok: false, pending: true, request_id: id, message: 'Result pending. Use local_request_result with this request_id before retrying any operation.' };
}
export async function cancelLocalTask(db: any, threadId: string) {
  const binding = await localBridgeBinding(db, threadId);
  if (!binding) return;
  await db.localBridgeCommand.updateMany({ where: { threadId, status: { in: ['pending', 'leased'] } }, data: { status: 'cancelled' } });
  await db.localBridgeCommand.create({ data: { id: randomUUID(), deviceId: binding.root.deviceId, threadId, rootId: binding.rootId, op: 'cancel_task', args: {}, deadline: new Date(Date.now() + 86400000) } });
}
export async function buildLocalRuntime(db: any, baseUrl: string, userId?: string, workspace?: string) {
  const binding = await localBindingForWorkspace(db, userId, workspace);
  if (!binding) return undefined;
  return {
    bindingId: binding.id,
    hint: `This task is bound to the user's computer ${JSON.stringify(binding.root.device.name)} and local directory ${JSON.stringify(binding.root.path)}. Use local_computer MCP tools for ALL operations on these local files, commands, dependencies, git, builds and tests. Native shell/file tools run in the CLOUD and cannot access this computer. Begin with local_workspace_info and read applicable local AGENTS.md before edits. Shell runs as the signed-in local OS user; the selected folder is its default cwd, not an OS sandbox. No per-action approval is needed. Web research and cloud integrations remain cloud tools. If offline, keep this binding, tell the user to reopen the desktop client or rerun ~/.local/bin/bailey-connect on a Linux command-line device and do not silently fall back to cloud execution. Pending requests must be checked with local_request_result before retries. Local result files remain on the computer. Report actual local paths; do not create cloud copies or cloud download links unless the user requests an export. Portal provides open-file actions. Do not promise rollback or a file history.`,
    server: { command: process.execPath, args: [path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/local-bridge-mcp-proxy.mjs')], default_tools_approval_mode: 'approve', env: { AGENT_STUDIO_BASE_URL: baseUrl, AGENT_STUDIO_LOCAL_BRIDGE_TOKEN: bindingToken(binding) } }
  };
}
