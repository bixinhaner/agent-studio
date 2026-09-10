const str = { type: 'string' };
const num = { type: 'number' };
const bool = { type: 'boolean' };
function tool(name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []) {
  return { name: `local_${name}`, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } };
}
export const localBridgeTools = [
  tool('workspace_info', 'Inspect the bound computer environment and root AGENTS.md. Call first before local work.'),
  tool('list', 'List files on the user computer.', { path: str }),
  tool('read', 'Read a local text or base64 file, up to 2 MB.', { path: str, encoding: { enum: ['utf8', 'base64'] } }, ['path']),
  tool('write', 'Create or overwrite a local file. Parent must exist.', { path: str, content: str, encoding: { enum: ['utf8', 'base64'] } }, ['path', 'content']),
  tool('edit', 'Replace exact text in a local file. The match must be unique unless replace_all.', { path: str, old_text: str, new_text: str, replace_all: bool }, ['path', 'old_text', 'new_text']),
  tool('mkdir', 'Create a local directory.', { path: str }, ['path']),
  tool('move', 'Move or rename a local file/directory.', { path: str, destination: str }, ['path', 'destination']),
  tool('delete', 'Delete a local file/directory.', { path: str, recursive: bool }, ['path']),
  tool('exec', 'Execute Shell on the USER COMPUTER as its OS user. Default cwd is the selected folder, not a sandbox. Use for search, git, dependencies, builds, tests, document tools. Output includes process_id/cursor; use local_process to continue. Commands time out after 120 seconds by default (max 30 minutes).', { command: str, cwd: str, yield_ms: num, timeout_ms: num, env: { type: 'object', additionalProperties: str } }, ['command']),
  tool('process', 'Read incremental output, wait, send stdin, or cancel a local process from this task.', { process_id: str, cursor: num, wait_ms: num, input: str, close_stdin: bool, cancel: bool }, ['process_id']),
  tool('open', 'Open a local file or folder with the computer default application when the user wants to see it.', { path: str }, ['path']),
  tool('request_result', 'Recover a pending request by request_id, especially after connection loss. Check before retrying operations.', { request_id: str }, ['request_id'])
];
