import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connectHttpMcp } from '../lib/http-proxy.mjs';

const schema = { type: 'object', properties: { text: { type: 'string' } } };
const tool = name => ({ name, description: `Tool ${name}`, inputSchema: schema });
function reply(res, id, result, status = 200, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify({ jsonrpc: '2.0', id, result })); }
async function mock(t, handler = () => false) {
  const requests = [], connections = [];
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString('utf8'); const body = text ? JSON.parse(text) : undefined;
      requests.push({ method: req.method, headers: req.headers, body });
      if (await handler(req, res, body, requests)) return;
      if (req.method === 'DELETE') { res.writeHead(204); res.end(); return; }
      if (body.method === 'initialize') reply(res, body.id, { protocolVersion: '2025-03-26', serverInfo: { name: 'mock', version: '1' }, capabilities: { tools: {} } }, 200, { 'Mcp-Session-Id': 'session-test' });
      else if (body.method.startsWith('notifications/')) { res.writeHead(202); res.end(); }
      else if (body.method === 'tools/list') reply(res, body.id, { tools: [tool('echo')] });
      else if (body.method === 'tools/call') reply(res, body.id, { content: [{ type: 'text', text: body.params.arguments.text ?? 'ok' }] });
      else { res.writeHead(400); res.end(); }
    } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { try { for (const connection of connections) await connection.dispose(); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, requests, track(connection) { connections.push(connection); } };
}

test('JSON HTTP lifecycle preserves fixed headers and does not send missing/blank optional keys', async t => {
  const key = 'DSH_HTTP_PROXY_TEST_OPTIONAL'; const before = process.env[key]; delete process.env[key];
  t.after(() => before === undefined ? delete process.env[key] : process.env[key] = before);
  for (const value of [undefined, '   ']) {
    if (value !== undefined) process.env[key] = value;
    const m = await mock(t); const b = await connectHttpMcp({ url: m.url, httpHeaders: { 'X-Fixed': 'fixed-value' }, optionalEnvHeaders: { 'X-Optional': key } });
    assert.equal(b.tools.length, 1); assert.equal(b.tools[0].name, 'echo');
    assert.equal((await b.tools[0].execute({ text: '繁體中文' })).content[0].text, '繁體中文');
    await b.dispose(); await b.dispose();
    assert.equal(m.requests[0].body.params.protocolVersion, '2025-03-26');
    assert.equal(m.requests[0].headers['mcp-session-id'], undefined);
    for (const request of m.requests) {
      assert.equal(request.headers['x-fixed'], 'fixed-value'); assert.equal(request.headers['x-optional'], undefined);
      assert.match(request.headers.accept, /application\/json/); assert.match(request.headers.accept, /text\/event-stream/);
    }
    for (const request of m.requests.slice(1)) { assert.equal(request.headers['mcp-session-id'], 'session-test'); assert.equal(request.headers['mcp-protocol-version'], '2025-03-26'); }
    assert.equal(m.requests.at(-1).method, 'DELETE');
    await assert.rejects(b.tools[0].execute(), { code: 'DISPOSED' });
  }
});

test('nonempty environment headers are resolved only in memory and fixed values are preserved', async t => {
  const key = 'DSH_HTTP_PROXY_TEST_SECRET'; const before = process.env[key]; process.env[key] = 'fixture-secret';
  t.after(() => before === undefined ? delete process.env[key] : process.env[key] = before);
  const config = { 'X-API-Key': key, Authorization: { env: key, prefix: 'Bearer ' } };
  const m = await mock(t); const b = await connectHttpMcp({ url: m.url, httpHeaders: { 'X-Fixed': 'constant' }, optionalEnvHeaders: config });
  await b.dispose();
  for (const req of m.requests) { assert.equal(req.headers['x-api-key'], 'fixture-secret'); assert.equal(req.headers.authorization, 'Bearer fixture-secret'); assert.equal(req.headers['x-fixed'], 'constant'); }
  assert.equal(JSON.stringify(config).includes('fixture-secret'), false);
  await assert.rejects(connectHttpMcp({ url: m.url, httpHeaders: { 'X-API-Key': 'fixed' }, optionalEnvHeaders: { 'x-api-key': key } }), { code: 'INVALID_CONFIGURATION' });
});

test('tools/list pagination keeps cursor order and remote tool-call errors remain tool results', async t => {
  const m = await mock(t, (req, res, body) => {
    if (body?.method === 'tools/list') { reply(res, body.id, body.params.cursor === 'page-2' ? { tools: [tool('second')] } : { tools: [tool('first')], nextCursor: 'page-2' }); return true; }
    if (body?.method === 'tools/call') { reply(res, body.id, { content: [{ type: 'text', text: 'domain error' }], isError: true }); return true; }
  });
  const b = await connectHttpMcp(m); m.track(b);
  assert.deepEqual(b.tools.map(t => t.name), ['first', 'second']);
  assert.deepEqual(m.requests.filter(r => r.body?.method === 'tools/list').map(r => r.body.params), [{}, { cursor: 'page-2' }]);
  assert.equal((await b.tools[1].execute()).isError, true);
});

test('SSE handles comments, progress notifications, split CRLF, multiline data and UTF-8 chunks', async t => {
  const m = await mock(t, async (req, res, body) => {
    if (body?.method !== 'tools/call') return false;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
    const wire = Buffer.from(`: keepalive\r\nevent: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}\r\n\r\ndata: {"jsonrpc":"2.0","id":${body.id},\r\ndata: "result":{"content":[{"type":"text","text":"繁體中文"}]}}\r\n\r\n`);
    for (let start = 0; start < wire.length; start += 7) { res.write(wire.subarray(start, start + 7)); await new Promise(resolve => setTimeout(resolve, 1)); }
    // A matching result must resolve without waiting for the server to close SSE.
    return true;
  });
  const b = await connectHttpMcp({ url: m.url, timeout: 1000 }); m.track(b);
  assert.equal((await b.tools[0].execute()).content[0].text, '繁體中文');
});

test('stateless server works and negotiated protocol version is used after initialization', async t => {
  const m = await mock(t, (req, res, body) => {
    if (body?.method === 'initialize') { reply(res, body.id, { protocolVersion: '2025-06-18', serverInfo: { name: 'stateless', version: '1' }, capabilities: { tools: {} } }); return true; }
  });
  const b = await connectHttpMcp(m); await b.tools[0].execute(); await b.dispose();
  for (const req of m.requests.slice(1)) { assert.equal(req.headers['mcp-session-id'], undefined); assert.equal(req.headers['mcp-protocol-version'], '2025-06-18'); }
  assert.equal(m.requests.some(r => r.method === 'DELETE'), false);
});

test('timeouts abort waiting, send MCP cancellation, and never replay the tool call', async t => {
  const m = await mock(t, (req, res, body) => body?.method === 'tools/call');
  const b = await connectHttpMcp({ url: m.url, timeout: 60 }); m.track(b);
  await assert.rejects(b.tools[0].execute(), { code: 'REQUEST_CANCELED' });
  const calls = m.requests.filter(r => r.body?.method === 'tools/call');
  const canceled = m.requests.find(r => r.body?.method === 'notifications/cancelled');
  assert.equal(calls.length, 1); assert.equal(canceled.body.params.requestId, calls[0].body.id);
});

test('caller cancellation and dispose abort in-flight work', async t => {
  const m = await mock(t, (req, res, body) => body?.method === 'tools/call');
  const b = await connectHttpMcp({ url: m.url, timeout: 1000 });
  const controller = new AbortController(); const call = b.tools[0].execute({}, { signal: controller.signal });
  const rejected = assert.rejects(call, { code: 'REQUEST_CANCELED' });
  setTimeout(() => controller.abort(), 20); await rejected;
  const inflight = b.tools[0].execute(); const disposedCall = assert.rejects(inflight, { code: 'REQUEST_CANCELED' });
  await new Promise(resolve => setTimeout(resolve, 20)); await b.dispose(); await disposedCall;
});

test('transport and RPC failures have explicit errors without echoing server body secrets', async t => {
  for (const [handler, code] of [
    [(req, res, body) => { if (body?.method === 'tools/call') { res.writeHead(401); res.end('fixture-secret'); return true; } }, 'HTTP_ERROR'],
    [(req, res, body) => { if (body?.method === 'tools/call') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'fixture-secret' } })); return true; } }, 'REMOTE_RPC_ERROR'],
    [(req, res, body) => { if (body?.method === 'tools/call') { reply(res, body.id + 999, { content: [] }); return true; } }, 'INVALID_RESPONSE'],
    [(req, res, body) => { if (body?.method === 'tools/call') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('fixture-secret'); return true; } }, 'UNSUPPORTED_TRANSPORT'],
  ]) {
    const m = await mock(t, handler); const b = await connectHttpMcp(m); m.track(b);
    await assert.rejects(b.tools[0].execute(), error => error.code === code && !error.message.includes('fixture-secret'));
  }
});

test('server requests, incomplete SSE, legacy endpoint events and invalid JSON fail clearly', async t => {
  for (const [payload, code] of [
    ['data: {"jsonrpc":"2.0","id":50,"method":"sampling/createMessage","params":{}}\n\n', 'SERVER_REQUEST_UNSUPPORTED'],
    ['data: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n', 'INCOMPLETE_RESPONSE'],
    ['event: endpoint\ndata: /old-sse\n\n', 'UNSUPPORTED_TRANSPORT'],
    ['data: not-json\n\n', 'INVALID_RESPONSE'],
  ]) {
    const m = await mock(t, (req, res, body) => { if (body?.method === 'tools/call') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(payload); return true; } });
    const b = await connectHttpMcp(m); m.track(b);
    await assert.rejects(b.tools[0].execute(), { code });
  }
});

test('pagination loops, duplicate tools and unsupported negotiated versions are rejected', async t => {
  for (const [handler, code] of [
    [(req, res, body) => { if (body?.method === 'tools/list') { reply(res, body.id, { tools: [], nextCursor: 'same' }); return true; } }, 'INVALID_PAGINATION'],
    [(req, res, body) => { if (body?.method === 'tools/list') { reply(res, body.id, { tools: [tool('duplicate'), tool('duplicate')] }); return true; } }, 'INVALID_TOOL'],
    [(req, res, body) => { if (body?.method === 'initialize') { reply(res, body.id, { protocolVersion: '2099-01-01', serverInfo: { name: 'mock' }, capabilities: { tools: {} } }); return true; } }, 'UNSUPPORTED_PROTOCOL'],
  ]) { const m = await mock(t, handler); await assert.rejects(connectHttpMcp(m), { code }); }
});

test('server requests and tool-list changes invalidate the connection until explicit reconnect', async t => {
  for (const [message, code] of [
    [{ jsonrpc: '2.0', id: 500, method: 'elicitation/create', params: {} }, 'SERVER_REQUEST_UNSUPPORTED'],
    [{ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }, 'TOOL_LIST_CHANGED'],
  ]) {
    const m = await mock(t, (req, res, body) => { if (body?.method === 'tools/call') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(`data: ${JSON.stringify(message)}\n\n`); return true; } });
    const b = await connectHttpMcp(m); m.track(b);
    await assert.rejects(b.tools[0].execute(), { code });
    await assert.rejects(b.tools[0].execute(), { code });
    assert.equal(m.requests.filter(r => r.body?.method === 'tools/call').length, 1);
  }
});

test('expired sessions are not retried and later calls require reconnecting', async t => {
  const m = await mock(t, (req, res, body) => { if (body?.method === 'tools/call') { res.writeHead(404); res.end(); return true; } });
  const b = await connectHttpMcp(m); m.track(b);
  await assert.rejects(b.tools[0].execute(), { code: 'SESSION_EXPIRED' });
  await assert.rejects(b.tools[0].execute(), { code: 'SESSION_EXPIRED' });
  assert.equal(m.requests.filter(r => r.body?.method === 'tools/call').length, 1);
});

test('invalid result blocks and lossless argument violations cannot report success', async t => {
  const m = await mock(t, (req, res, body) => { if (body?.method === 'tools/call') { reply(res, body.id, { content: [{ type: 'text', text: 123 }] }); return true; } });
  const b = await connectHttpMcp(m); m.track(b);
  await assert.rejects(b.tools[0].execute(), { code: 'INVALID_RESPONSE' });
  const before = m.requests.length;
  for (const value of [NaN, undefined, new Date(), () => {}]) await assert.rejects(b.tools[0].execute({ value }), { code: 'INVALID_ARGUMENTS' });
  assert.equal(m.requests.length, before, 'invalid local arguments must not reach the server');
});

test('configuration rejects unsafe URLs, reserved header overrides and redirects', async t => {
  for (const url of ['file:///tmp/x', 'https://user:password@example.invalid/mcp', 'http://localhost/mcp#fragment']) await assert.rejects(connectHttpMcp({ url }), { code: 'INVALID_CONFIGURATION' });
  const m = await mock(t, (req, res) => { res.writeHead(302, { Location: 'http://127.0.0.1:1/redirect' }); res.end(); return true; });
  await assert.rejects(connectHttpMcp({ url: m.url, httpHeaders: { Accept: 'anything' } }), { code: 'INVALID_CONFIGURATION' });
  await assert.rejects(connectHttpMcp(m), { code: 'NETWORK_ERROR' });
});
