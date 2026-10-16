import { createHash } from 'node:crypto';

/**
 * How local-computer results cross the server without losing or distorting data.
 *
 * - Storage: Postgres jsonb rejects U+0000 and unpaired surrogates, which real files and
 *   command output contain. Such values are stored in a reversible wrapper instead of being
 *   altered, and every reader decodes them, so delivery records and audit records agree.
 * - Files: the agent's reads always travel as raw bytes (base64) and are decoded here with
 *   an explicit, detected encoding; content that is not reliable text is reported as binary.
 * - Edits keep the file's original encoding and BOM instead of round-tripping through UTF-8.
 */
const ENCODED_TAG = '__agentStudioEncoded';
const UNSAFE = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
export const LOCAL_FILE_LIMIT = 2 * 1024 * 1024;
/** Command args key for server-side intent; the desktop executor ignores unknown args. */
export const LOCAL_META_KEY = '_agent_studio';

function unsafe(value: unknown): boolean {
  if (typeof value === 'string') return UNSAFE.test(value);
  if (Array.isArray(value)) return value.some(unsafe);
  if (value && typeof value === 'object') return Object.entries(value).some(([key, item]) => UNSAFE.test(key) || unsafe(item));
  return false;
}

/** A jsonb-storable form of any JSON value; values Postgres would reject are wrapped losslessly. */
export function encodeStoredJson<T>(value: T): T | { [ENCODED_TAG]: 'json-base64'; value: string } {
  const tagged = Boolean(value && typeof value === 'object' && ENCODED_TAG in (value as object));
  if (!tagged && !unsafe(value)) return value;
  // JSON.stringify escapes NUL and lone surrogates, so the UTF-8 bytes are exact.
  return { [ENCODED_TAG]: 'json-base64', value: Buffer.from(JSON.stringify(value), 'utf8').toString('base64') };
}

export function decodeStoredJson<T = any>(value: unknown): T {
  if (value && typeof value === 'object' && (value as any)[ENCODED_TAG] === 'json-base64' && typeof (value as any).value === 'string') {
    return JSON.parse(Buffer.from((value as any).value, 'base64').toString('utf8'));
  }
  return value as T;
}

export type LocalTextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030' | 'windows-1252';
export type DecodedLocalFile =
  | { binary: false; content: string; encoding: LocalTextEncoding; bom: boolean; size: number; note?: string }
  | { binary: true; encoding: 'binary'; size: number; message: string };

// Control characters other than tab, newlines, form feed and ESC; frequent ones mean "not text".
const CONTROL = /[\u0000-\u0008\u000B\u000E-\u001A\u001C-\u001F\u007F]/g;
const controlRatio = (text: string) => (text.length ? (text.match(CONTROL)?.length ?? 0) / text.length : 0);
// Valid UTF-8 is binary only when control characters are both frequent and more than a stray few.
const mostlyControl = (text: string) => (text.match(CONTROL)?.length ?? 0) > 4 && controlRatio(text) >= 0.1;
function strict(label: string, bytes: Uint8Array): string | null {
  try { return new TextDecoder(label, { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return null; }
}

function utf16WithoutBom(bytes: Buffer): 'utf-16le' | 'utf-16be' | null {
  if (bytes.length < 2 || bytes.length % 2) return null;
  let evenZero = 0; let oddZero = 0;
  for (let i = 0; i < bytes.length; i += 2) { if (bytes[i] === 0) evenZero++; if (bytes[i + 1] === 0) oddZero++; }
  const half = bytes.length / 2;
  if (oddZero / half >= 0.3 && evenZero / half < 0.05) return 'utf-16le';
  if (evenZero / half >= 0.3 && oddZero / half < 0.05) return 'utf-16be';
  return null;
}

function looksLikeChinese(text: string): boolean {
  const nonAscii = text.match(/[^\u0000-\u007F]/g)?.length ?? 0;
  const cjk = text.match(/[\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F\uFF00-\uFFEF\u2000-\u206F\u00B7\u00D7]/g)?.length ?? 0;
  return nonAscii > 0 && cjk / nonAscii >= 0.9 && controlRatio(text) < 0.02;
}

function text(content: string, encoding: LocalTextEncoding, size: number, bom = false, notes: string[] = []): DecodedLocalFile {
  const nul = content.match(/\u0000/g)?.length ?? 0;
  if (nul) notes.push(`The text contains ${nul} NUL character(s) (\\u0000), kept exactly as in the file.`);
  return { binary: false, content, encoding, bom, size, ...(notes.length ? { note: notes.join(' ') } : {}) };
}

/** Decode file bytes with a detected encoding, or report them as binary; never silently alter text. */
export function decodeLocalFile(bytes: Buffer): DecodedLocalFile {
  const size = bytes.length;
  const boms: Array<[number[], LocalTextEncoding]> = [[[0xef, 0xbb, 0xbf], 'utf-8'], [[0xff, 0xfe], 'utf-16le'], [[0xfe, 0xff], 'utf-16be']];
  for (const [mark, encoding] of boms) {
    if (mark.every((byte, i) => bytes[i] === byte)) {
      const decoded = strict(encoding, bytes.subarray(mark.length));
      if (decoded !== null && controlRatio(decoded) < 0.1) return text(decoded, encoding, size, true);
    }
  }
  const utf16 = utf16WithoutBom(bytes);
  if (utf16) {
    const decoded = strict(utf16, bytes);
    if (decoded !== null && controlRatio(decoded) < 0.05) return text(decoded, utf16, size, false, [`Decoded as ${utf16.toUpperCase()} (no byte order mark).`]);
  }
  const utf8 = strict('utf-8', bytes);
  if (utf8 !== null && !mostlyControl(utf8)) return text(utf8, 'utf-8', size);
  if (utf8 === null) {
    const gb = strict('gb18030', bytes);
    if (gb !== null && looksLikeChinese(gb)) return text(gb, 'gb18030', size, false, ['Decoded as GB18030 (GBK-compatible); the file is not UTF-8.']);
    const latin = strict('windows-1252', bytes);
    if (latin !== null && controlRatio(latin) < 0.02) return text(latin, 'windows-1252', size, false, ['The file is not UTF-8, UTF-16 or GB18030; decoded as Windows-1252, which may be a guess. Read with encoding "base64" for the exact bytes.']);
  }
  return { binary: true, encoding: 'binary', size, message: `Binary file (${size} bytes): it is not reliable UTF-8, UTF-16 or GB18030 text, so no text is shown. Read it with encoding "base64" for the exact bytes.` };
}

/**
 * Command output from clients that send raw bytes (0.3+). One command can mix encodings (git
 * prints UTF-8 while cmd prints GBK messages), so lines are decoded individually; whole-output
 * UTF-16 (wmic, some PowerShell redirects) is detected first.
 */
export function decodeCommandOutput(bytes: Buffer): { text: string; note?: string } {
  if (!bytes.length) return { text: '' };
  const whole = decodeLocalFile(bytes);
  if (!whole.binary && whole.encoding.startsWith('utf-16')) return { text: whole.content, note: `Output decoded as ${whole.encoding.toUpperCase()}.` };
  if (strict('utf-8', bytes) !== null) return { text: bytes.toString('utf8') };
  let legacy = false; let lossy = false; const parts: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    const end = bytes.indexOf(0x0a, start);
    const line = bytes.subarray(start, end < 0 ? bytes.length : end + 1);
    start = end < 0 ? bytes.length : end + 1;
    const utf8 = strict('utf-8', line);
    if (utf8 !== null) { parts.push(utf8); continue; }
    const gb = strict('gb18030', line);
    if (gb !== null && looksLikeChinese(gb)) { parts.push(gb); legacy = true; continue; }
    parts.push(line.toString('utf8')); lossy = true;
  }
  const notes = [legacy ? 'Some lines were printed in GBK and were decoded as GB18030.' : '', lossy ? LOSSY_OUTPUT_NOTE : ''].filter(Boolean);
  return { text: parts.join(''), ...(notes.length ? { note: notes.join(' ') } : {}) };
}

/** Encode edited text back into the file's own encoding; null when the encoding cannot be written exactly. */
export function encodeLocalText(content: string, encoding: LocalTextEncoding, bom: boolean): Buffer | null {
  if (encoding === 'utf-8') return Buffer.concat([Buffer.from(bom ? [0xef, 0xbb, 0xbf] : []), Buffer.from(content, 'utf8')]);
  if (encoding === 'utf-16le') return Buffer.concat([Buffer.from(bom ? [0xff, 0xfe] : []), Buffer.from(content, 'utf16le')]);
  if (encoding === 'utf-16be') return Buffer.concat([Buffer.from(bom ? [0xfe, 0xff] : []), Buffer.from(content, 'utf16le').swap16()]);
  return null;
}

export type LocalEditPlan = { ok: true; content: string; replacements: number; encoding: LocalTextEncoding; expectedSha256: string } | { ok: false; error: string; message?: string };

/** The edit the desktop executor would make, applied to decoded text and written back as base64. */
export function planLocalEdit(readResult: any, args: any): LocalEditPlan {
  if (typeof args?.old_text !== 'string' || !args.old_text || typeof args?.new_text !== 'string') return { ok: false, error: 'EXACT_EDIT_TEXT_REQUIRED' };
  if (!readResult?.ok) return { ok: false, error: readResult?.error || 'READ_FAILED', ...(readResult?.message ? { message: readResult.message } : {}) };
  const original = Buffer.from(String(readResult.content ?? ''), 'base64');
  const decoded = decodeLocalFile(original);
  if (decoded.binary) return { ok: false, error: 'EDIT_BINARY_FILE', message: decoded.message };
  const source = decoded.content;
  const first = source.indexOf(args.old_text);
  if (first < 0 || (!args.replace_all && first !== source.lastIndexOf(args.old_text))) return { ok: false, error: 'EDIT_MATCH_MUST_BE_UNIQUE' };
  const parts = source.split(args.old_text);
  const next = args.replace_all ? parts.join(args.new_text) : source.replace(args.old_text, () => args.new_text);
  const bytes = encodeLocalText(next, decoded.encoding, decoded.bom);
  if (!bytes) return { ok: false, error: 'EDIT_ENCODING_UNSUPPORTED', message: `The file is ${decoded.encoding.toUpperCase()}, which local_edit cannot write back exactly. Edit it with local_exec (for example Python with encoding="${decoded.encoding}") so the encoding is preserved.` };
  if (bytes.length > LOCAL_FILE_LIMIT) return { ok: false, error: 'CONTENT_TOO_LARGE' };
  return { ok: true, content: bytes.toString('base64'), replacements: args.replace_all ? parts.length - 1 : 1, encoding: decoded.encoding, expectedSha256: createHash('sha256').update(original).digest('hex') };
}

/**
 * Command args as sent to the desktop client, plus what the audit log should show.
 * Windows consoles default to a legacy code page (GBK on Chinese systems), which the
 * client decodes as UTF-8; switching the console to UTF-8 makes most tools print exact text.
 */
export function prepareLocalCommand(op: string, args: any, platform?: string | null): { args: any; auditArgs: any } {
  const input = args && typeof args === 'object' ? args : {};
  if (op === 'read' && input.encoding !== 'base64') return { args: { ...input, encoding: 'base64', [LOCAL_META_KEY]: { decode: true } }, auditArgs: input };
  if (op === 'exec' && platform === 'win32' && typeof input.command === 'string' && input.command.trim()) {
    return { args: { ...input, command: `chcp 65001>nul & ${input.command}`, env: { PYTHONIOENCODING: 'utf-8', ...(input.env || {}) } }, auditArgs: input };
  }
  return { args: input, auditArgs: input };
}

export const LOSSY_OUTPUT_NOTE = 'Some output bytes were not valid UTF-8 and appear as U+FFFD; the program likely printed in a legacy code page (such as GBK). For exact text, redirect the output to a file and read it with local_read, which detects the encoding.';

/** The result the agent, portal and admin all see, derived once from what the client returned. */
export function presentLocalResult(op: string, args: any, result: Record<string, unknown>): Record<string, unknown> {
  const meta = args?.[LOCAL_META_KEY] || {};
  if (op === 'read' && meta.decode && result.ok !== false && typeof result.content === 'string') {
    const decoded = decodeLocalFile(Buffer.from(result.content, 'base64'));
    const { binary, ...rest } = decoded;
    // Ranged reads (0.3+ clients) report the whole file's size and where this part sits.
    const range = typeof result.offset === 'number' ? { size: result.size, offset: result.offset, length: result.length, eof: result.eof } : typeof result.size === 'number' ? { size: result.size } : {};
    return binary ? { ok: true, path: result.path, binary: true, ...rest, ...range } : { ok: true, path: result.path, ...rest, ...range };
  }
  if (op === 'workspace_info' && typeof result.instructions_base64 === 'string') {
    const { instructions_base64: raw, ...rest } = result;
    const decoded = decodeLocalFile(Buffer.from(raw, 'base64'));
    return { ...rest, instructions: decoded.binary ? '' : decoded.content.slice(0, 24000), ...(decoded.binary ? { instructions_note: 'AGENTS.md is not readable text.' } : decoded.encoding !== 'utf-8' ? { instructions_encoding: decoded.encoding } : {}) };
  }
  if ((op === 'exec' || op === 'process') && typeof result.output_base64 === 'string') {
    const { output_base64: raw, ...rest } = result;
    const decoded = decodeCommandOutput(Buffer.from(raw, 'base64'));
    return { ...rest, output: decoded.text, ...(decoded.note ? { output_note: decoded.note } : {}) };
  }
  if (op === 'write' && meta.edit && result.ok !== false) {
    return { ok: true, path: result.path, edited: true, replacements: meta.edit.replacements, encoding: meta.edit.encoding };
  }
  if ((op === 'exec' || op === 'process') && typeof result.output === 'string' && result.output.includes('\uFFFD')) {
    return { ...result, output_note: LOSSY_OUTPUT_NOTE };
  }
  return result;
}

export const RESULT_DELIVERY_FAILED = 'RESULT_DELIVERY_FAILED';
export function deliveryFailedResult(id: string, reason: string) {
  return {
    ok: false,
    error: RESULT_DELIVERY_FAILED,
    request_id: id,
    reason: reason.slice(0, 300),
    message: 'The computer finished this step, but the server could not accept its result. The computer is still connected. If the step changes files or runs commands, check its effect before retrying.'
  };
}

/** Errors that will repeat for the same result (bad data), as opposed to transient outages. */
export function isDeterministicStorageError(error: unknown): boolean {
  const code = (error as any)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (typeof code === 'string' && /^P20(00|05|06|07|09|19|20|23|33)$/.test(code)) return true;
  return /unsupported Unicode|invalid input syntax|22P05|22021|value too long|out of range|invalid byte sequence|Invalid value|Argument .* is invalid|too large/i.test(message);
}
