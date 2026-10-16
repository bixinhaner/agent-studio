import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cancelLocalOperations, completeLocalOperation, recordBindingEvent, recordLocalOperation } from './local-bridge-audit.js';
import { LOCAL_META_KEY, decodeStoredJson, encodeStoredJson, planLocalEdit, prepareLocalCommand } from './local-bridge-result.js';
export const bridgeHash = (value: string) => createHash('sha256').update(value).digest('hex');
/** Clients below this version are refused work until they update; empty disables the gate. */
export const MIN_LOCAL_CLIENT_VERSION = process.env.LOCAL_BRIDGE_MIN_CLIENT_VERSION ?? '0.3.0';
export function compareClientVersions(a: string, b: string) {
  const pa = a.split(/[.-]/).map(n => parseInt(n, 10) || 0); const pb = b.split(/[.-]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return Math.sign(d); }
  return 0;
}
/** Clients before 0.3.0 never report a version, so a missing version also means "too old". */
export const clientVersionOutdated = (version?: string | null) => Boolean(MIN_LOCAL_CLIENT_VERSION) && (!version || compareClientVersions(version, MIN_LOCAL_CLIENT_VERSION) < 0);
export const clientUpdateRequired = (device: any) => clientVersionOutdated(device?.clientVersion);
export function clientUpdateMessage(platform?: string | null) {
  return platform === 'linux-cli'
    ? `Bailey 命令行连接版本过旧，已停止接收任务。请按 Ctrl+C 结束，然后在 Bailey 网页「使用电脑文件夹 → Linux 命令行」重新复制连接命令运行，即可更新到 ${MIN_LOCAL_CLIENT_VERSION}。`
    : `Bailey 客户端版本过旧，已停止接收任务。请在 Bailey 网页「使用电脑文件夹」中下载 ${MIN_LOCAL_CLIENT_VERSION} 新版并安装，之后会自动更新。`;
}
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
  return { id: binding.id, thread_id: binding.threadId, root_id: binding.rootId, path: binding.root.path, label: binding.root.label || path.basename(binding.root.path), device_id: d.id, device_name: d.name, status: bridgeOnline(d) ? 'online' : 'offline', update_required: clientUpdateRequired(d) };
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
  }
  const old = await localBridgeBinding(db, threadId);
  if (rootId && old?.rootId === rootId) return old;
  await cancelLocalTask(db, threadId);
  await db.$transaction(async (tx: any) => {
    await tx.localBridgeBinding.deleteMany({ where: { threadId } });
    if (rootId) await tx.localBridgeBinding.create({ data: { threadId, rootId } });
  });
  const next = await localBridgeBinding(db, threadId);
  await recordBindingEvent(db, { threadId, userId, from: old, to: next });
  return next;
}
export async function enqueueLocalCommand(db: any, binding: any, op: string, args: any, requestId: string = randomUUID(), source: 'agent' | 'portal' = 'agent', options: { auditArgs?: any; audit?: boolean } = {}) {
  if (clientUpdateRequired(binding.root.device)) throw new Error(`LOCAL_CLIENT_UPDATE_REQUIRED: The Bailey client on the user's computer is outdated and no longer accepts work. Tell the user, in their language: ${clientUpdateMessage(binding.root.device.platform)} Do not substitute cloud files or retry until the user has updated.`);
  if (!bridgeOnline(binding.root.device)) throw new Error('LOCAL_COMPUTER_OFFLINE: Open the desktop client, then continue on the same computer. Do not substitute cloud files or repeat an uncertain command.');
  const command = await db.localBridgeCommand.upsert({ where: { id: requestId }, update: {}, create: { id: requestId, deviceId: binding.root.deviceId, threadId: binding.threadId, bindingId: binding.id, rootId: binding.rootId, op, args: encodeStoredJson(args), deadline: new Date(Date.now() + 10 * 60000) } });
  // Full args are kept in the audit log; the delivery row clears them once completed.
  if (options.audit !== false) await recordLocalOperation(db, { ...command, args: encodeStoredJson(options.auditArgs ?? args) }, binding, source);
  return command;
}
/**
 * Agent tool calls: reads travel as bytes and are decoded on the server, Windows commands
 * print UTF-8, and edits keep the file's encoding (read bytes, replace, write bytes).
 */
export async function runLocalTool(db: any, binding: any, op: string, args: any, requestId: string) {
  if (op === 'edit') return editLocalFile(db, binding, args, requestId);
  const prepared = prepareLocalCommand(op, args, binding.root?.device?.platform);
  const command = await enqueueLocalCommand(db, binding, op, prepared.args, requestId, 'agent', { auditArgs: prepared.auditArgs });
  if (command.bindingId !== binding.id) throw Object.assign(new Error('Request does not belong to this task'), { status: 403 });
  return waitLocalCommand(db, command.id);
}
const editReadId = (requestId: string) => `${requestId}-read`;
async function editLocalFile(db: any, binding: any, args: any, requestId: string) {
  const existing = await db.localBridgeCommand.findUnique({ where: { id: requestId } });
  if (existing) {
    if (existing.bindingId !== binding.id) throw Object.assign(new Error('Request does not belong to this task'), { status: 403 });
    return waitLocalCommand(db, requestId);
  }
  const read = await enqueueLocalCommand(db, binding, 'read', { path: args?.path, encoding: 'base64' }, editReadId(requestId), 'agent', { audit: false });
  if (read.bindingId !== binding.id) throw Object.assign(new Error('Request does not belong to this task'), { status: 403 });
  await recordLocalOperation(db, { ...read, id: requestId, op: 'edit', args: encodeStoredJson(args) }, binding, 'agent');
  const source = await waitLocalCommand(db, read.id);
  if (source?.pending) return { ...source, request_id: requestId };
  const plan = planLocalEdit(source, args);
  if (!plan.ok) { await completeLocalOperation(db, requestId, encodeStoredJson(plan)); return plan; }
  await enqueueLocalCommand(db, binding, 'write', { path: args.path, content: plan.content, encoding: 'base64', expected_sha256: plan.expectedSha256, [LOCAL_META_KEY]: { edit: { replacements: plan.replacements, encoding: plan.encoding } } }, requestId, 'agent', { audit: false });
  return waitLocalCommand(db, requestId);
}
/** local_request_result for an edit whose write was never queued reports why instead of REQUEST_NOT_FOUND. */
export async function recoverLocalRequest(db: any, binding: any, requestId: string) {
  const command = await db.localBridgeCommand.findFirst({ where: { id: requestId, bindingId: binding.id } });
  if (command) return waitLocalCommand(db, command.id);
  const read = await db.localBridgeCommand.findFirst({ where: { id: editReadId(requestId), bindingId: binding.id } });
  if (!read) return { ok: false, error: 'REQUEST_NOT_FOUND' };
  const source = await waitLocalCommand(db, read.id);
  if (source?.pending || source?.ok === false) return { ...source, request_id: requestId };
  return { ok: false, error: 'EDIT_NOT_APPLIED', request_id: requestId, message: 'This edit did not write the file. It is safe to retry it.' };
}
export async function waitLocalCommand(db: any, id: string, waitMs = 20000) {
  const until = Date.now() + waitMs;
  do {
    const command = await db.localBridgeCommand.findUnique({ where: { id } });
    if (!command) return { ok: false, error: 'REQUEST_NOT_FOUND' };
    if (command.status === 'completed') return decodeStoredJson(command.result);
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
  await cancelLocalOperations(db, { threadId });
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
