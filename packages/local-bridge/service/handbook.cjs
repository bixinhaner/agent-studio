'use strict';
const { createHash } = require('node:crypto');
const { gzipSync } = require('node:zlib');

/**
 * Turns a business system's capability manifest (its one registry of operations the agent may
 * call) into everything Agent Studio's Action Connector expects: the digest-verified handbook
 * package, its chunked download, and the compatibility catalog. The business system only keeps
 * the registry; it never hand-writes a handbook.
 *
 * Manifest: { sourceName, commonOperations (markdown), categories: [{ id, title }],
 *             operations: [{ operationId, method, path, category, title, summary, risk, ... }] }
 */
const SCHEMA_VERSION = '1.0';
const CHUNK_BYTES = 128 * 1024;
const PROFILE = {
  pathPrefix: '/api/v1/',
  catalog: { searchPath: '/api/v1/agent/catalog', categoriesPath: '/api/v1/agent/catalog/categories', describePath: '/api/v1/agent/catalog/describe' },
  handbook: { manifestPath: '/api/v1/agent/handbook/manifest', chunkPathTemplate: '/api/v1/agent/handbook/chunks/{index}' }
};

function tarHeader(name, size) {
  if (Buffer.byteLength(name) > 100) throw new Error(`handbook path too long: ${name}`);
  const header = Buffer.alloc(512);
  header.write(name, 0, 'utf8');
  header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
  header.write(size.toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136);
  header.write('        ', 148);
  header.write('0', 156);
  header.write('ustar\0' + '00', 257);
  let sum = 0; for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return header;
}
function tar(files) {
  const parts = [];
  for (const [name, content] of files) {
    const data = Buffer.from(content, 'utf8');
    parts.push(tarHeader(name, data.length), data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

function normalizeOperation(op) {
  for (const key of ['operationId', 'method', 'path', 'category', 'title']) if (typeof op[key] !== 'string' || !op[key].trim()) throw new Error(`operation ${op.operationId || '?'}: ${key} is required`);
  if (!/^[A-Za-z0-9._:-]{1,90}$/.test(op.operationId)) throw new Error(`operation id is invalid: ${op.operationId}`);
  if (!op.path.startsWith(PROFILE.pathPrefix) || op.path.startsWith('/api/v1/agent/')) throw new Error(`operation ${op.operationId}: path must be under ${PROFILE.pathPrefix} and outside /api/v1/agent/`);
  const risk = ['read', 'low', 'high'].includes(op.risk) ? op.risk : 'read';
  return {
    schemaVersion: SCHEMA_VERSION, operationId: op.operationId, method: op.method.toUpperCase(), path: op.path, category: op.category,
    title: op.title, summary: op.summary || op.title, description: op.description || '', intents: op.intents || [], tags: op.tags || [],
    risk, confirmationRequired: op.confirmationRequired ?? risk !== 'read', idempotent: op.idempotent ?? risk === 'read', sideEffects: op.sideEffects || (risk === 'read' ? 'none' : 'changes application state'),
    pathParams: op.pathParams || [], queryParams: op.queryParams || [], formParams: [], requestBody: op.requestBody ?? null,
    responses: op.responses || { 200: { description: 'OK' } }, referencedSchemas: {}, contractCoverage: { parameters: 'complete', responses: op.responses ? 'complete' : 'partial' },
    emptyResult: op.emptyResult || '', relatedOperations: op.relatedOperations || [], sources: ['runtime-capability-registry']
  };
}
const summaryOf = op => ({ operationId: op.operationId, method: op.method, path: op.path, title: op.title, summary: op.summary, description: op.description, group: op.category, risk: op.risk, tags: op.tags });

function buildHandbook(manifest) {
  const operations = (manifest.operations || []).map(normalizeOperation).sort((a, b) => a.operationId.localeCompare(b.operationId));
  if (!operations.length) throw new Error('capability manifest has no operations');
  if (new Set(operations.map(op => op.operationId)).size !== operations.length) throw new Error('capability manifest has duplicate operation ids');
  const titles = new Map((manifest.categories || []).map(item => [item.id, item.title]));
  const categories = [...new Set(operations.map(op => op.category))].sort().map(id => ({ id, title: titles.get(id) || id, count: operations.filter(op => op.category === id).length, file: `api-categories/${id}.json` }));
  const common = String(manifest.commonOperations || '# Common operations\n');
  const catalogVersion = createHash('sha256').update(JSON.stringify([operations, common])).digest('hex').slice(0, 16);
  const files = [
    ['references/manifest.json', JSON.stringify({ schemaVersion: SCHEMA_VERSION, catalogVersion, sourceName: manifest.sourceName || '', totalOperations: operations.length, searchIndex: 'api-index.jsonl', categories }, null, 2)],
    ['references/common-operations.md', common],
    ['references/api-index.jsonl', operations.map(op => JSON.stringify({ ...summaryOf(op), intents: op.intents, doc: `api-docs/${op.operationId}.json` })).join('\n') + '\n'],
    ...categories.map(category => [`references/${category.file}`, JSON.stringify({ ...category, operations: operations.filter(op => op.category === category.id).map(summaryOf) }, null, 2)]),
    ...operations.map(op => [`references/api-docs/${op.operationId}.json`, JSON.stringify(op, null, 2)])
  ];
  const archive = gzipSync(tar(files), { level: 9 });
  const handbookDigest = 'sha256:' + createHash('sha256').update(archive).digest('hex');
  const totalChunks = Math.ceil(archive.length / CHUNK_BYTES);
  const meta = {
    schemaVersion: SCHEMA_VERSION, catalogVersion, handbookDigest, totalOperations: operations.length,
    manifestPath: PROFILE.handbook.manifestPath, chunkPathTemplate: PROFILE.handbook.chunkPathTemplate,
    archiveFormat: 'tar+gzip', archiveBytes: archive.length, chunkBytes: CHUNK_BYTES, totalChunks, contentRoot: 'references'
  };
  const patterns = operations.map(op => ({ op, names: [...op.path.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(m => m[1]), regex: new RegExp('^' + op.path.split(/\{[A-Za-z0-9_]+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('([^/]+)') + '$') }));

  /** Finds the registered operation for a request, or null. Path parameters are returned decoded. */
  function match(method, requestPath) {
    for (const { op, names, regex } of patterns) {
      if (op.method !== String(method).toUpperCase()) continue;
      const found = regex.exec(requestPath);
      if (found) return { operation: op, pathParams: Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(found[i + 1])])) };
    }
    return null;
  }

  /** Answers the connector's own discovery paths; returns undefined for business paths. */
  function discovery(method, requestPath, query = {}) {
    if (!requestPath.startsWith('/api/v1/agent/')) return undefined;
    if (String(method).toUpperCase() !== 'GET') throw Object.assign(new Error('Discovery paths are read-only'), { code: 'METHOD_NOT_ALLOWED' });
    if (requestPath === PROFILE.handbook.manifestPath) return meta;
    const chunk = /^\/api\/v1\/agent\/handbook\/chunks\/(\d+)$/.exec(requestPath);
    if (chunk) {
      const index = Number(chunk[1]);
      if (index >= totalChunks) throw Object.assign(new Error(`chunk index out of range (0..${totalChunks - 1})`), { code: 'CHUNK_OUT_OF_RANGE' });
      const data = archive.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
      return { handbookDigest, index, totalChunks, bytes: data.length, encoding: 'base64', data: data.toString('base64') };
    }
    if (requestPath === PROFILE.catalog.categoriesPath) return { categories, totalRoutes: operations.length, catalogVersion };
    if (requestPath === PROFILE.catalog.describePath) {
      const op = operations.find(item => item.operationId === query.operationId);
      if (!op) throw Object.assign(new Error(`unknown operationId ${query.operationId || ''}`), { code: 'OPERATION_NOT_FOUND' });
      return op;
    }
    if (requestPath === PROFILE.catalog.searchPath) {
      const terms = String(query.q || '').toLowerCase().split(/\s+/).filter(Boolean);
      const text = op => [op.operationId, op.title, op.summary, op.description, op.path, ...op.tags, ...op.intents].join(' ').toLowerCase();
      const all = operations.filter(op => (!query.category || op.category === query.category) && terms.every(term => text(op).includes(term)));
      const offset = Math.max(0, Number(query.offset) || 0); const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
      const items = all.slice(offset, offset + limit).map(summaryOf);
      return { items, total: all.length, returned: items.length, offset, nextOffset: offset + items.length, hasMore: offset + items.length < all.length, category: query.category || null, totalRoutes: operations.length, catalogVersion };
    }
    throw Object.assign(new Error('Unknown discovery path'), { code: 'NOT_FOUND' });
  }

  return { meta: { ...meta, packageAvailable: true }, archive, operations, match, discovery };
}

module.exports = { buildHandbook, PROFILE, SCHEMA_VERSION };
