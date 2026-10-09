import type { FC } from "react";

import { USER_INPUT_REQUEST_PART_NAME } from "./user-input-request";

export type ProcessDataPartProps = { name?: string; data?: unknown };

export type ProcessDataPartComponents = {
  memoryContext: FC<{ data: unknown }>;
  userInputRequest: FC<{ data: unknown }>;
  connectionRecovery: FC;
  recoveryFailure: FC;
  /** Every other data part; remounted whenever the part name at a position changes. */
  generic: FC<ProcessDataPartProps>;
};

export const MEMORY_CONTEXT_PART_NAME = "agent_studio_memory_context";

/**
 * assistant-ui keys message parts by index, and a streaming answer can change which part sits
 * at an index (the memory chip is ordered first after commentary has already rendered there).
 * The returned dispatcher calls no hooks and gives every part kind its own component instance,
 * so a kind change remounts instead of rendering a different number of hooks (React #300/#310).
 */
export function createProcessDataFallback(components: ProcessDataPartComponents): FC<ProcessDataPartProps> {
  const {
    memoryContext: MemoryContext,
    userInputRequest: UserInputRequest,
    connectionRecovery: ConnectionRecovery,
    recoveryFailure: RecoveryFailure,
    generic: Generic
  } = components;
  const ProcessDataFallback: FC<ProcessDataPartProps> = ({ name, data }) => {
    const partName = typeof name === "string" ? name : "";
    if (partName === MEMORY_CONTEXT_PART_NAME) return <MemoryContext data={data} />;
    if (partName === USER_INPUT_REQUEST_PART_NAME) return <UserInputRequest data={data} />;
    if (partName === "codex_connection_recovery") return <ConnectionRecovery />;
    if (partName === "codex_recovery_failure") return <RecoveryFailure />;
    return <Generic key={partName} name={name} data={data} />;
  };
  return ProcessDataFallback;
}
