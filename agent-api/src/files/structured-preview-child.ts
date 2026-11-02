// Child process entry for structured file previews; started by structured-preview-service.ts
// with a capped heap, handles exactly one job, then exits.
import { buildStructuredPreview, type StructuredPreviewJob } from "./structured-preview-core.js";

process.once("message", (message: StructuredPreviewJob) => {
  const input = message.input.content
    ? { ...message.input, content: Buffer.from(message.input.content) }
    : message.input;
  buildStructuredPreview({ ...message, input })
    .then((result) => ({ ok: true as const, result }))
    .catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }))
    .then((reply) => process.send?.(reply, () => process.exit(0)));
});
