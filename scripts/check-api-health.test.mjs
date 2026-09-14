import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { checkApiHealth } from "./check-api-health.mjs";

test("healthy admin cannot mask a stalled chat service", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/stalled") return;
    if (req.url === "/body-stalled") { res.writeHead(200); res.write('{"ok":'); return; }
    if (req.url === "/false") { res.end('{"ok":false}'); return; }
    if (req.url === "/error") { res.writeHead(503); res.end('{"ok":true}'); return; }
    if (req.url === "/html") { res.end('<html>frontend fallback</html>'); return; }
    res.end('{"ok":true}');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const targets = ["healthy", "stalled", "body-stalled", "false", "error", "html"].map(name => ({ name, url:`${base}/${name}` }));
    const results = await checkApiHealth(targets, { timeoutMs: 300 });
    assert.equal(results[0].ok, true);
    assert.ok(results.slice(1).every(result => result.ok === false));
  } finally { server.closeAllConnections(); server.close(); }
});
