import path from 'node:path';

/**
 * Admin audit trail for local-computer work. local_bridge_commands is delivery state
 * (args cleared on completion, pruned after 24h) and local_bridge_bindings only keeps the
 * current folder, so administrators could not see what ran on a user's computer or where
 * a task was running. These writes are best-effort: auditing never blocks local work.
 */
export type LocalWorkspaceSnapshot = {
  mode: 'local';
  bindingId: string | null;
  deviceId: string;
  deviceName: string | null;
  platform: string | null;
  rootId: string;
  path: string;
  label: string;
};

export type ExecutionLocationSnapshot = LocalWorkspaceSnapshot | { mode: 'cloud' };

export const EXECUTION_LOCATION_RUN_CONFIG_KEY = '_agentStudioExecutionLocation';

export function localWorkspaceSnapshot(binding: any): LocalWorkspaceSnapshot | null {
  const root = binding?.root;
  const device = root?.device;
  if (!root || !device) return null;
  return {
    mode: 'local',
    bindingId: binding.id ?? null,
    deviceId: device.id,
    deviceName: device.name ?? null,
    platform: device.platform ?? null,
    rootId: root.id,
    path: root.path,
    label: root.label || path.basename(root.path)
  };
}

function warn(action: string, error: unknown) {
  console.warn('local bridge audit write failed', { action, detail: error instanceof Error ? error.message : String(error) });
}

export async function recordLocalOperation(db: any, command: any, binding: any, source: 'agent' | 'portal') {
  if (!db.localBridgeOperationLog?.upsert || !command?.id) return;
  const snapshot = localWorkspaceSnapshot(binding);
  try {
    await db.localBridgeOperationLog.upsert({
      where: { id: command.id },
      update: {},
      create: {
        id: command.id,
        threadId: command.threadId ?? binding?.threadId ?? null,
        userId: binding?.thread?.userId ?? binding?.root?.device?.userId ?? null,
        deviceId: command.deviceId,
        deviceName: snapshot?.deviceName ?? null,
        platform: snapshot?.platform ?? null,
        bindingId: command.bindingId ?? null,
        rootId: command.rootId ?? null,
        rootPath: snapshot?.path ?? null,
        rootLabel: snapshot?.label ?? null,
        source,
        op: command.op,
        args: command.args ?? {},
        createdAt: command.createdAt ?? new Date()
      }
    });
  } catch (error) { warn('record', error); }
}

export async function completeLocalOperation(db: any, id: string, result: unknown) {
  if (!db.localBridgeOperationLog?.updateMany) return;
  try {
    await db.localBridgeOperationLog.updateMany({ where: { id }, data: { status: 'completed', result, completedAt: new Date() } });
  } catch (error) { warn('complete', error); }
}

export async function cancelLocalOperations(db: any, where: { id?: string; threadId?: string }) {
  if (!db.localBridgeOperationLog?.updateMany) return;
  try {
    await db.localBridgeOperationLog.updateMany({ where: { ...where, status: 'pending' }, data: { status: 'cancelled', completedAt: new Date() } });
  } catch (error) { warn('cancel', error); }
}

export async function recordBindingEvent(db: any, input: { threadId: string; userId: string; from: any; to: any }) {
  if (!db.localBridgeBindingEvent?.create) return;
  const from = localWorkspaceSnapshot(input.from);
  const to = localWorkspaceSnapshot(input.to);
  if (!from && !to) return;
  if (from && to && from.rootId === to.rootId) return;
  try {
    await db.localBridgeBindingEvent.create({
      data: {
        threadId: input.threadId,
        userId: input.userId,
        kind: from && to ? 'switched' : to ? 'bound' : 'unbound',
        fromRootId: from?.rootId ?? null,
        fromPath: from?.path ?? null,
        fromLabel: from?.label ?? null,
        fromDeviceId: from?.deviceId ?? null,
        fromDeviceName: from?.deviceName ?? null,
        fromPlatform: from?.platform ?? null,
        toRootId: to?.rootId ?? null,
        toPath: to?.path ?? null,
        toLabel: to?.label ?? null,
        toDeviceId: to?.deviceId ?? null,
        toDeviceName: to?.deviceName ?? null,
        toPlatform: to?.platform ?? null
      }
    });
  } catch (error) { warn('binding', error); }
}
