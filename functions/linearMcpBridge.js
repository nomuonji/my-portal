const DEFAULT_ENDPOINT = 'https://mcp.linear.app/mcp';
const PROTOCOL_VERSION = '2025-06-18';

let session = {
  id: null,
  initialized: false,
  tools: null,
  initializedAt: 0,
};

const DESTRUCTIVE_OR_SENSITIVE_TOOLS = new Set([
  'delete_attachment',
  'delete_comment',
  'delete_customer',
  'delete_customer_need',
  'delete_diff_comment',
  'delete_status_update',
  'merge_diff',
  'share_issue',
  'unshare_issue',
]);

function readEnv(name) {
  try {
    const value = globalThis?.Netlify?.env?.get?.(name);
    if (value) return String(value);
  } catch {}
  const value = process.env[name];
  return value ? String(value) : undefined;
}

function apiKey() {
  return (readEnv('LINEAR_API_KEY') || '').trim();
}

function endpoint() {
  return (readEnv('LINEAR_MCP_URL') || DEFAULT_ENDPOINT).trim();
}

function teamKey() {
  return (readEnv('LINEAR_TEAM_KEY') || 'MY').trim();
}

function isConfigured() {
  return Boolean(apiKey());
}

function configSummary() {
  return {
    configured: isConfigured(),
    endpoint: endpoint(),
    teamKey: teamKey(),
    auth: isConfigured() ? 'bearer-api-key' : 'missing',
  };
}

function resetSession() {
  session = {
    id: null,
    initialized: false,
    tools: null,
    initializedAt: 0,
  };
}

function parseEventStream(text) {
  const payloads = [];
  String(text || '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .forEach((line) => {
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') return;
      try {
        payloads.push(JSON.parse(raw));
      } catch {}
    });
  return payloads.length ? payloads[payloads.length - 1] : null;
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;
  const type = response.headers.get('content-type') || '';
  if (type.includes('text/event-stream')) {
    const parsed = parseEventStream(text);
    if (parsed) return parsed;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Linear MCP returned a non-JSON response (' + response.status + ')');
  }
}

async function postRpc(message, { sessionId = null } = {}) {
  const token = apiKey();
  if (!token) {
    throw new Error(
      'LINEAR_API_KEY is not configured. Create a Linear personal API key and store it in Netlify; do not paste the key into chat.'
    );
  }

  const headers = {
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': PROTOCOL_VERSION,
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  const response = await fetch(endpoint(), {
    method: 'POST',
    headers,
    body: JSON.stringify(message),
  });

  const responseSessionId = response.headers.get('mcp-session-id') || response.headers.get('Mcp-Session-Id');
  const payload = await parseResponse(response);

  if (!response.ok) {
    const detail = payload?.error?.message || payload?.message || ('HTTP ' + response.status);
    const error = new Error('Linear MCP request failed: ' + detail);
    error.status = response.status;
    throw error;
  }

  return { payload, sessionId: responseSessionId || sessionId || null };
}

async function initialize() {
  if (session.initialized) return session;

  const initialized = await postRpc({
    jsonrpc: '2.0',
    id: 'linear-init',
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'my-portal',
        version: '1.0.0',
      },
    },
  });

  const payload = initialized.payload;
  if (payload?.error) {
    throw new Error('Linear MCP initialize failed: ' + (payload.error.message || 'unknown error'));
  }

  session.id = initialized.sessionId || null;
  session.initialized = true;
  session.initializedAt = Date.now();

  try {
    await postRpc({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    }, { sessionId: session.id });
  } catch (error) {
    // Some stateless MCP servers do not require or acknowledge this notification.
    if (error?.status !== 400 && error?.status !== 404 && error?.status !== 405) throw error;
  }

  return session;
}

async function rpc(method, params = {}, retry = true) {
  await initialize();
  try {
    const response = await postRpc({
      jsonrpc: '2.0',
      id: 'linear-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      method,
      params,
    }, { sessionId: session.id });

    if (response.sessionId && response.sessionId !== session.id) session.id = response.sessionId;
    if (response.payload?.error) {
      throw new Error(response.payload.error.message || ('Linear MCP RPC error: ' + method));
    }
    return response.payload?.result ?? response.payload;
  } catch (error) {
    if (
      retry &&
      [400, 404, 409].includes(Number(error?.status || 0))
    ) {
      resetSession();
      return rpc(method, params, false);
    }
    throw error;
  }
}

function extractToolData(result) {
  if (!result) return null;
  if (result.structuredContent !== undefined) return result.structuredContent;
  const parts = Array.isArray(result.content) ? result.content : [];
  const textPart = parts.find((part) => part?.type === 'text' && typeof part.text === 'string');
  if (!textPart) return result;
  const text = textPart.text.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function listTools({ force = false } = {}) {
  if (!isConfigured()) return [];
  if (session.tools && !force) return session.tools;
  const result = await rpc('tools/list', {});
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  session.tools = tools;
  return tools;
}

async function toolCatalog(input = {}) {
  if (!isConfigured()) {
    return {
      ...configSummary(),
      tools: [],
      setupRequired: true,
    };
  }
  const query = String(input.query || '').trim().toLowerCase();
  const limit = Math.min(Math.max(Number(input.limit) || 100, 1), 250);
  const tools = (await listTools({ force: input.refresh === true }))
    .filter((tool) => {
      if (!query) return true;
      return [tool.name, tool.description]
        .filter(Boolean)
        .join('\n')
        .toLowerCase()
        .includes(query);
    })
    .slice(0, limit);
  return {
    ...configSummary(),
    count: tools.length,
    tools,
  };
}

async function callTool(input = {}) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Linear tool name is required');

  const tools = await listTools();
  const known = tools.find((tool) => tool.name === name);
  if (!known) {
    throw new Error('Unknown Linear MCP tool: ' + name + '. Call linear_tool_catalog first.');
  }

  const requiresConfirm =
    DESTRUCTIVE_OR_SENSITIVE_TOOLS.has(name) ||
    /^(delete_|merge_|share_|unshare_)/.test(name);
  if (requiresConfirm && input.confirm !== true) {
    throw new Error(name + ' requires confirm=true because it is destructive or changes sharing/merge state.');
  }

  const args = input.arguments && typeof input.arguments === 'object' && !Array.isArray(input.arguments)
    ? input.arguments
    : {};

  const result = await rpc('tools/call', {
    name,
    arguments: args,
  });

  if (result?.isError) {
    const message = Array.isArray(result.content)
      ? result.content.map((part) => part?.text).filter(Boolean).join('\n')
      : '';
    throw new Error(message || ('Linear tool failed: ' + name));
  }

  return {
    tool: name,
    data: extractToolData(result),
    result,
  };
}

async function status() {
  if (!isConfigured()) {
    return {
      ...configSummary(),
      ok: false,
      setupRequired: true,
      message: 'LINEAR_API_KEY is not configured.',
    };
  }

  const tools = await listTools({ force: true });
  let workspace = null;
  if (tools.some((tool) => tool.name === 'get_workspace')) {
    try {
      workspace = (await callTool({ name: 'get_workspace', arguments: {} })).data;
    } catch {}
  }

  return {
    ...configSummary(),
    ok: true,
    setupRequired: false,
    toolCount: tools.length,
    workspace,
  };
}

async function listOpenIssues(input = {}) {
  if (!isConfigured()) {
    return {
      configured: false,
      issues: [],
      setupRequired: true,
    };
  }

  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
  const result = await callTool({
    name: 'list_issues',
    arguments: {
      limit,
      orderBy: 'updatedAt',
      ...(input.team ? { team: input.team } : {}),
      ...(input.assignee ? { assignee: input.assignee } : {}),
      fields: [
        'id',
        'title',
        'description',
        'priority',
        'url',
        'status',
        'statusType',
        'labels',
        'assignee',
        'delegate',
        'project',
        'team',
        'dueDate',
        'updatedAt',
      ],
    },
  });

  const items = Array.isArray(result.data?.issues)
    ? result.data.issues
    : Array.isArray(result.data)
      ? result.data
      : [];

  return {
    configured: true,
    setupRequired: false,
    issues: items.filter((issue) => !['completed', 'canceled'].includes(String(issue.statusType || '').toLowerCase())),
  };
}

module.exports = {
  DEFAULT_ENDPOINT,
  DESTRUCTIVE_OR_SENSITIVE_TOOLS,
  readEnv,
  isConfigured,
  configSummary,
  teamKey,
  resetSession,
  listTools,
  toolCatalog,
  callTool,
  status,
  listOpenIssues,
  extractToolData,
};
