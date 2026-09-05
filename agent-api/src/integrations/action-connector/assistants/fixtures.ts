// Test fixtures only; not imported by production runtime.
import { definitionSchema, planningRequestSchema } from "./contracts.js";
export const definition = definitionSchema.parse({ name: "Fleet labels", goal: "Find devices with missing labels", scope: { kind: "visible" }, trigger: { kind: "manual" }, operations: ["get.devices"], notify: "findings", cooldownMinutes: 30 });
export const planningInput = planningRequestSchema.parse({ message: "Find devices without labels", externalUserId: "user-1", capabilities: [{ operationId: "get.devices", path: "/api/v1/devices", title: "Devices", description: "Current device inventory", deviceScoped: false }], events: [{ type: "device.event", title: "Device changed", fields: ["status"] }] });
