# Common OMC Operations

These are stable, high-frequency fast paths. Call them directly when they match the user intent. Use the live catalog for every other operation.

## Device status totals

Use one of these endpoints, not both, unless their different response shapes are needed:

```bash
node "$CLI" request GET /api/v1/devices/stats '{"operationId":"get.devices.stats","reason":"Read total devices by status"}'
```

Response data contains `counts`. An empty `counts` object means the current user can see no device rows.

```bash
node "$CLI" request GET /api/v1/dashboard/device-status '{"operationId":"get.dashboard.device_status","reason":"Read dashboard device status totals"}'
```

The response is a status-to-count map. An empty map means no visible status totals were recorded.

## Network overview

```bash
node "$CLI" request GET /api/v1/dashboard/summary '{"operationId":"get.dashboard.summary","reason":"Read the network overview"}'
```

Use this for a broad current-state overview. Do not add device, alarm, or topology calls unless the user asks for detail or the summary lacks a required value.

## Device records

```bash
node "$CLI" request GET /api/v1/devices '{"operationId":"get.devices","query":{"page":1,"page_size":20},"reason":"List visible devices"}'
```

Use only when the user needs actual devices, identifiers, names, or filters. Use `/api/v1/devices/stats` for counts.

## Active alarms

```bash
node "$CLI" request GET /api/v1/alarms/active '{"operationId":"get.alarms.active","query":{"page":1,"page_size":20},"reason":"List current active alarms"}'
```

Use for current alarm records. An empty item list means no active alarms are visible under the current filters and permissions.

## Alarm statistics

```bash
node "$CLI" request GET /api/v1/alarms/statistics '{"operationId":"get.alarms.statistics","reason":"Read active alarm totals and severity distribution"}'
```

Use when the user asks for totals, severity distribution, acknowledged state, or a concise alarm summary. Do not also list active alarms unless examples or affected devices are requested.

## Operations tasks

```bash
node "$CLI" request GET /api/v1/ops/tasks '{"operationId":"get.ops.tasks","query":{"page":1,"page_size":20},"reason":"List current operations tasks"}'
```

Optional filters include `status`, `keyword`, `creator`, and `templateId`. Describe the operation before creating or changing a task.

## System runtime information

```bash
node "$CLI" request GET /api/v1/system/info '{"operationId":"get.system.info","reason":"Read OMC runtime information"}'
```

Use for runtime version and system information, not for business health. Use the direct system-license operation below for license questions.

## System license

```bash
node "$CLI" request GET /api/v1/system-license '{"operationId":"get.system_license","reason":"Read the current system license"}'
```

Use this directly for current license status. A `404` response whose message is `no system license configured` means no license is configured; it is not a reason to search for another endpoint.

## Combining independent reads

When a question explicitly needs multiple independent facts, start all reads in the same shell command and wait for all of them. Keep each output labeled and do not chain dependent calls this way.

```bash
node "$CLI" request GET /api/v1/devices/stats '{"operationId":"get.devices.stats","reason":"Read device totals"}' &
p1=$!
node "$CLI" request GET /api/v1/alarms/statistics '{"operationId":"get.alarms.statistics","reason":"Read alarm totals"}' &
p2=$!
wait "$p1" "$p2"
```
