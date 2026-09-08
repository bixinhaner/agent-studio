import { execute } from './bridge.js';

export type LocalBridgeClientOptions = { relayUrl: string; token: string; intervalMs?: number; signal?: AbortSignal };

/** Outbound-only polling client. The user's machine never accepts a public connection. */
export async function runLocalBridgeClient(options: LocalBridgeClientOptions): Promise<void> {
  const base = options.relayUrl.replace(/\/$/, '');
  const headers = { authorization: `Bearer ${options.token}`, 'content-type': 'application/json' };
  const interval = options.intervalMs ?? 800;
  while (!options.signal?.aborted) {
    try {
      const response = await fetch(`${base}/api/local-bridge/agent/poll`, { method: 'POST', headers });
      if (!response.ok) throw new Error(`relay poll ${response.status}`);
      const payload = await response.json() as { command?: Record<string, unknown> | null };
      if (payload.command) {
        const command = payload.command as any;
        let result: unknown;
        try { result = await execute(command); } catch (error) { result = { ok: false, error: error instanceof Error ? error.message : 'BRIDGE_ERROR' }; }
        await fetch(`${base}/api/local-bridge/agent/result`, { method: 'POST', headers, body: JSON.stringify({ id: command.id, result }) });
      }
    } catch { /* transient network failure; retry without exposing a local port */ }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
