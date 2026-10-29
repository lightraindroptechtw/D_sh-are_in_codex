// A deliberately bounded Streamable HTTP MCP client. No OAuth, legacy SSE endpoint
// discovery, stream resumption, server-initiated requests, or automatic call retry.
const SUPPORTED_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);
const RESERVED_HEADERS = new Set(['accept', 'content-type', 'mcp-session-id', 'mcp-protocol-version', 'content-length', 'host']);
const MAX_BYTES = 16 * 1024 * 1024;

export class HttpMcpError extends Error {
  constructor(message, code = 'HTTP_MCP_ERROR') { super(message); this.name = 'HttpMcpError'; this.code = code; }
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function lossless(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return;
  if (!value || typeof value !== 'object' || seen.has(value) || !Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new HttpMcpError('MCP arguments must be lossless JSON', 'INVALID_ARGUMENTS');
  if (Object.getOwnPropertySymbols(value).length) throw new HttpMcpError('MCP arguments cannot contain symbol properties', 'INVALID_ARGUMENTS');
  seen.add(value);
  if (Array.isArray(value) && Object.keys(value).length !== value.length) throw new HttpMcpError('MCP arrays must be dense', 'INVALID_ARGUMENTS');
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable && Array.isArray(value)) continue; // array length
    if (!descriptor.enumerable || !('value' in descriptor)) throw new HttpMcpError('MCP arguments cannot contain getters or hidden properties', 'INVALID_ARGUMENTS');
    lossless(descriptor.value, seen);
  }
  seen.delete(value);
}
function configuredHeaders(fixed, optional) {
  if (!object(fixed) || !object(optional)) throw new HttpMcpError('HTTP header configuration must be an object', 'INVALID_CONFIGURATION');
  const headers = new Headers();
  const add = (name, value) => {
    if (RESERVED_HEADERS.has(name.toLowerCase())) throw new HttpMcpError('MCP transport headers cannot be overridden', 'INVALID_CONFIGURATION');
    if (typeof value !== 'string') throw new HttpMcpError('HTTP header values must be strings', 'INVALID_CONFIGURATION');
    try { headers.set(name, value); } catch { throw new HttpMcpError('Invalid HTTP header configuration', 'INVALID_CONFIGURATION'); }
  };
  for (const [name, value] of Object.entries(fixed)) add(name, value);
  for (const [name, spec] of Object.entries(optional)) {
    if (RESERVED_HEADERS.has(name.toLowerCase())) throw new HttpMcpError('MCP transport headers cannot be overridden', 'INVALID_CONFIGURATION');
    try { headers.has(name); } catch { throw new HttpMcpError('Invalid HTTP header configuration', 'INVALID_CONFIGURATION'); }
    const env = typeof spec === 'string' ? spec : spec?.env;
    const prefix = typeof spec === 'string' ? '' : spec?.prefix ?? '';
    const suffix = typeof spec === 'string' ? '' : spec?.suffix ?? '';
    if (typeof env !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(env) || typeof prefix !== 'string' || typeof suffix !== 'string') throw new HttpMcpError('Invalid optional environment header configuration', 'INVALID_CONFIGURATION');
    const value = process.env[env];
    if (value === undefined || value.trim() === '') continue;
    if (headers.has(name)) throw new HttpMcpError('Optional environment header conflicts with a fixed header', 'INVALID_CONFIGURATION');
    add(name, prefix + value + suffix);
  }
  return headers;
}
function validContent(block) {
  if (!object(block)) return false;
  if (block.type === 'text') return typeof block.text === 'string';
  if (block.type === 'image' || block.type === 'audio') return typeof block.data === 'string' && typeof block.mimeType === 'string';
  if (block.type === 'resource_link') return typeof block.uri === 'string' && typeof block.name === 'string';
  if (block.type === 'resource') return object(block.resource) && typeof block.resource.uri === 'string' && (typeof block.resource.text === 'string' || typeof block.resource.blob === 'string');
  return false;
}

/** Resolve optional secrets in memory only, then expose remote tools to a stdio server. */
export async function connectHttpMcp({ url, httpHeaders = {}, optionalEnvHeaders = {}, timeout = 30000 }) {
  let endpoint;
  try { endpoint = new URL(url); } catch { throw new HttpMcpError('A valid HTTP MCP URL is required', 'INVALID_CONFIGURATION'); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash) throw new HttpMcpError('MCP URL must use HTTP(S), without embedded authentication or a fragment', 'INVALID_CONFIGURATION');
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 2 ** 31 - 1) throw new HttpMcpError('timeout must be a positive bounded number of milliseconds', 'INVALID_CONFIGURATION');
  const baseHeaders = configuredHeaders(httpHeaders, optionalEnvHeaders);
  const active = new Set();
  let nextId = 0, session, protocol, disposed = false, expired = false, fatalConnection;
  function headers() {
    const h = new Headers(baseHeaders);
    h.set('Accept', 'application/json, text/event-stream'); h.set('Content-Type', 'application/json');
    if (session) h.set('Mcp-Session-Id', session);
    if (protocol) h.set('MCP-Protocol-Version', protocol);
    return h;
  }
  function rpcMessage(message, id) {
    if (!object(message) || message.jsonrpc !== '2.0') throw new HttpMcpError('Remote server returned invalid JSON-RPC', 'INVALID_RESPONSE');
    if (typeof message.method === 'string') {
      if (Object.hasOwn(message, 'id')) { fatalConnection = new HttpMcpError('Server-initiated MCP requests are unsupported; sampling and elicitation require a capable client', 'SERVER_REQUEST_UNSUPPORTED'); throw fatalConnection; }
      if (message.method === 'notifications/tools/list_changed') { fatalConnection = new HttpMcpError('Remote tool list changed; reconnect the proxy to refresh tools', 'TOOL_LIST_CHANGED'); throw fatalConnection; }
      if (!message.method.startsWith('notifications/')) throw new HttpMcpError('Remote notification method is invalid', 'INVALID_RESPONSE');
      return { done: false };
    }
    if (message.id !== id || Object.hasOwn(message, 'result') === Object.hasOwn(message, 'error')) throw new HttpMcpError('Remote JSON-RPC response id or result is invalid', 'INVALID_RESPONSE');
    if (Object.hasOwn(message, 'error')) {
      const code = Number.isInteger(message.error?.code) ? message.error.code : 'unknown';
      // Server error messages may echo authorization headers. Do not include them.
      throw new HttpMcpError(`Remote MCP request failed (JSON-RPC code ${code})`, 'REMOTE_RPC_ERROR');
    }
    return { done: true, result: message.result };
  }
  async function responseResult(response, id) {
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!['application/json', 'text/event-stream'].includes(type) || !response.body) throw new HttpMcpError('Remote server must return JSON or an SSE response body', 'UNSUPPORTED_TRANSPORT');
    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0, text = '', event = '', data = [];
    const dispatch = () => {
      if (event === 'endpoint') throw new HttpMcpError('Legacy HTTP+SSE endpoint discovery is unsupported', 'UNSUPPORTED_TRANSPORT');
      const payload = data.join('\n'); data = []; event = '';
      if (payload === '') return { done: false };
      let message;
      try { message = JSON.parse(payload); } catch { throw new HttpMcpError('Remote server returned invalid SSE JSON', 'INVALID_RESPONSE'); }
      return rpcMessage(message, id);
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (value) { bytes += value.byteLength; if (bytes > MAX_BYTES) throw new HttpMcpError('Remote MCP response exceeded the size limit', 'RESPONSE_TOO_LARGE'); }
        try { text += decoder.decode(value, { stream: !done }); } catch { throw new HttpMcpError('Remote response is not valid UTF-8', 'INVALID_RESPONSE'); }
        if (type === 'application/json') {
          if (!done) continue;
          let message;
          try { message = JSON.parse(text); } catch { throw new HttpMcpError('Remote server returned invalid JSON', 'INVALID_RESPONSE'); }
          const parsed = rpcMessage(message, id);
          if (!parsed.done) throw new HttpMcpError('JSON response contained no matching result', 'INVALID_RESPONSE');
          return parsed.result;
        }
        // Normalize SSE CRLF, CR and LF while retaining a CR split across chunks.
        let lineEnd;
        while ((lineEnd = text.search(/[\r\n]/)) >= 0) {
          if (text[lineEnd] === '\r' && lineEnd === text.length - 1 && !done) break;
          const line = text.slice(0, lineEnd);
          const width = text[lineEnd] === '\r' && text[lineEnd + 1] === '\n' ? 2 : 1;
          text = text.slice(lineEnd + width);
          if (line === '') { const parsed = dispatch(); if (parsed.done) return parsed.result; }
          else if (!line.startsWith(':')) {
            const colon = line.indexOf(':'); const key = colon < 0 ? line : line.slice(0, colon);
            let valueText = colon < 0 ? '' : line.slice(colon + 1); if (valueText.startsWith(' ')) valueText = valueText.slice(1);
            if (key === 'data') data.push(valueText); else if (key === 'event') event = valueText;
          }
        }
        if (done) throw new HttpMcpError('Remote SSE stream ended before a matching JSON-RPC response', 'INCOMPLETE_RESPONSE');
      }
    } finally { try { await reader.cancel(); } catch {} reader.releaseLock(); }
  }
  async function post(message, { signal: callerSignal, initializing = false, bypassDisposed = false } = {}) {
    if (disposed && !bypassDisposed) throw new HttpMcpError('HTTP MCP connection has been disposed', 'DISPOSED');
    if (fatalConnection) throw fatalConnection;
    if (expired && !initializing) throw new HttpMcpError('Remote MCP session expired; reconnect before calling tools', 'SESSION_EXPIRED');
    const controller = new AbortController(); active.add(controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeout), ...(callerSignal ? [callerSignal] : [])]);
    try {
      let response;
      try { response = await fetch(endpoint, { method: 'POST', headers: headers(), body: JSON.stringify(message), signal, redirect: 'error' }); }
      catch { if (signal.aborted) throw new HttpMcpError('Remote MCP request was canceled or timed out', 'REQUEST_CANCELED'); throw new HttpMcpError('Cannot reach HTTP MCP endpoint; redirects are unsupported', 'NETWORK_ERROR'); }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 404 && session) { expired = true; throw new HttpMcpError('Remote MCP session expired; reconnect before calling tools', 'SESSION_EXPIRED'); }
        throw new HttpMcpError(`Remote MCP endpoint returned HTTP ${response.status}`, 'HTTP_ERROR');
      }
      const assigned = response.headers.get('mcp-session-id');
      if (assigned !== null) {
        if (!/^[\x21-\x7e]{1,4096}$/.test(assigned)) { await response.body?.cancel(); throw new HttpMcpError('Remote MCP session id is invalid', 'INVALID_RESPONSE'); }
        if (initializing) session = assigned;
        else if (assigned !== session) { await response.body?.cancel(); throw new HttpMcpError('Remote server unexpectedly changed its MCP session id', 'INVALID_RESPONSE'); }
      }
      if (!Object.hasOwn(message, 'id')) {
        await response.body?.cancel();
        if (response.status !== 202) throw new HttpMcpError('MCP notifications require HTTP 202 acknowledgment', 'INVALID_RESPONSE');
        return;
      }
      if (response.status === 202 || response.status === 204) { await response.body?.cancel(); throw new HttpMcpError('MCP request received no response body', 'INCOMPLETE_RESPONSE'); }
      try { return await responseResult(response, message.id); }
      catch (error) { if (signal.aborted) throw new HttpMcpError('Remote MCP request was canceled or timed out', 'REQUEST_CANCELED'); throw error; }
    } catch (error) {
      if (signal.aborted && message.method === 'tools/call') {
        // Abort ends local waiting; MCP cancellation also tells a cooperative remote
        // implementation to stop. Never replay the potentially mutating call.
        try {
          const canceled = await fetch(endpoint, { method: 'POST', headers: headers(), redirect: 'error', signal: AbortSignal.timeout(Math.min(timeout, 1000)), body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: message.id, reason: 'Client canceled or timed out' } }) });
          await canceled.body?.cancel();
        } catch {}
      }
      throw error;
    } finally { active.delete(controller); }
  }
  const request = (method, params, options) => post({ jsonrpc: '2.0', id: ++nextId, method, ...(params === undefined ? {} : { params }) }, options);
  async function dispose() {
    if (disposed) return;
    disposed = true;
    for (const controller of active) controller.abort();
    if (!session || expired) return;
    let response;
    try { response = await fetch(endpoint, { method: 'DELETE', headers: headers(), signal: AbortSignal.timeout(timeout), redirect: 'error' }); }
    catch { throw new HttpMcpError('Could not terminate remote MCP session', 'DISPOSE_ERROR'); }
    await response.body?.cancel();
    if (!response.ok && ![404, 405].includes(response.status)) throw new HttpMcpError(`Session termination returned HTTP ${response.status}`, 'DISPOSE_ERROR');
  }
  try {
    const initialized = await request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'dsh-to-codex-http-proxy', version: '0.1.0' } }, { initializing: true });
    if (!object(initialized) || !SUPPORTED_VERSIONS.has(initialized.protocolVersion) || !object(initialized.capabilities) || !object(initialized.serverInfo) || typeof initialized.serverInfo.name !== 'string' || typeof initialized.serverInfo.version !== 'string') throw new HttpMcpError('Remote server returned unsupported or invalid initialization', 'UNSUPPORTED_PROTOCOL');
    protocol = initialized.protocolVersion;
    if (!object(initialized.capabilities.tools)) throw new HttpMcpError('Remote MCP server does not advertise tools', 'TOOLS_UNAVAILABLE');
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const tools = [], names = new Set(), cursors = new Set();
    let cursor;
    do {
      if (cursors.size >= 1000) throw new HttpMcpError('Remote tool pagination exceeded the page limit', 'INVALID_PAGINATION');
      const page = await request('tools/list', cursor === undefined ? {} : { cursor });
      if (!object(page) || !Array.isArray(page.tools)) throw new HttpMcpError('Remote tools/list returned invalid tools', 'INVALID_RESPONSE');
      for (const tool of page.tools) {
        if (!object(tool) || typeof tool.name !== 'string' || !tool.name || names.has(tool.name) || !object(tool.inputSchema) || tool.inputSchema.type !== 'object' || tool.description !== undefined && typeof tool.description !== 'string') throw new HttpMcpError('Remote server returned an invalid or duplicate tool definition', 'INVALID_TOOL');
        names.add(tool.name);
        tools.push({
          name: tool.name, description: tool.description ?? '', inputSchema: tool.inputSchema,
          async execute(args = {}, options = {}) {
            if (!object(args)) throw new HttpMcpError('Tool arguments must be an object', 'INVALID_ARGUMENTS');
            lossless(args);
            const result = await request('tools/call', { name: tool.name, arguments: args }, { signal: options.signal });
            if (!object(result) || !Array.isArray(result.content) || !result.content.every(validContent) || result.isError !== undefined && typeof result.isError !== 'boolean' || result.structuredContent !== undefined && !object(result.structuredContent)) throw new HttpMcpError('Remote tools/call returned an invalid or unsupported result', 'INVALID_RESPONSE');
            return result;
          },
        });
        if (tools.length > 10000) throw new HttpMcpError('Remote server exceeded the tool count limit', 'INVALID_PAGINATION');
      }
      cursor = page.nextCursor;
      if (cursor !== undefined) {
        if (typeof cursor !== 'string' || !cursor || cursors.has(cursor)) throw new HttpMcpError('Remote server returned an invalid or repeated pagination cursor', 'INVALID_PAGINATION');
        cursors.add(cursor);
      }
    } while (cursor !== undefined);
    return { tools, dispose };
  } catch (error) { try { await dispose(); } catch {} throw error; }
}
