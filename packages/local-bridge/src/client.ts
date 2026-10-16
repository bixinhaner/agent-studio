import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createExecutor } = require('../runtime/executor.cjs');
const { runTransport } = require('../runtime/transport.cjs');
export type LocalBridgeClientOptions = {
  relayUrl: string; token: string; roots: Array<{ id: string; path: string; label?: string }>;
  journalDir: string; outboxDir?: string; signal: AbortSignal; onStatus?: (status: { connected: boolean; error: string; pendingDeliveries: number; deliveryError: string; running: number }) => void;
};
/** Headless and Electron use the same executor and outbound delivery loop. */
export async function runLocalBridgeClient(options: LocalBridgeClientOptions): Promise<void> {
  const executor = createExecutor({ getRoots: () => options.roots, journalDir: options.journalDir });
  const api = async (endpoint: string, init: RequestInit) => {
    const response = await fetch(options.relayUrl.replace(/\/$/, '') + endpoint, { ...init, headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000) });
    const result = await response.json().catch(() => ({})) as any;
    if (!response.ok) throw Object.assign(new Error(result.detail || `Relay ${response.status}`), { status: response.status });
    return result;
  };
  const stop = () => executor.stopAll();
  options.signal.addEventListener("abort", stop, { once: true });
  try { await runTransport({ api, executor, signal: options.signal, onStatus: options.onStatus, outboxDir: options.outboxDir }); }
  finally { options.signal.removeEventListener("abort", stop); executor.stopAll(); }
}
