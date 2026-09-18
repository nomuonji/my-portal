const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const store = require('./agentIdeasStore');

const SERVER_NAME = 'my-portal-agent-ideas';
const SERVER_VERSION = '0.3.0';
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL = SUPPORTED_PROTOCOLS[0];
const DEFAULT_ACCESS_KEY_HASH = 'f174c5b44462f5b25b12902b20bca1cf24e1153c9a2baec7db89a9b436a07618';
const accessKeyHash = (process.env.AGENT_IDEAS_MCP_ACCESS_KEY_HASH || DEFAULT_ACCESS_KEY_HASH).trim();
const signingKey = (process.env.AGENT_IDEAS_MCP_SIGNING_KEY || accessKeyHash).trim();

const relationTypes = [
  'derived_from',
  'expanded_from',
  'combined_from',
  'combined_with',
  'contradicts',
  'supports',
  'alternative_to',
  'depends_on',
  'inspired_by',
  'supersedes',
  'related_to',
];

function objectSchema(properties, required = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}

const string = (description, maxLength) => ({ type: 'string', description, ...(maxLength ? { maxLength } : {}) });
const stringArray = (description, maxItems = 50) => ({ type: 'array', description, maxItems, items: { type: 'string' } });
const jsonObject = (description) => ({ type: 'object', description, additionalProperties: true });

const ideaCreateProperties = {
  title: string('Short name for the idea.', 300),
  summary: string('Compact summary for quick scanning.', 3000),
  content: string('Free-form Markdown body. Preserve hypotheses, reasoning, open questions, and rough notes.', 30000),
  type: string('Free-form idea type, for example idea, hypothesis, product, site, content, experiment.', 80),
  status: { type: 'string', enum: store.IDEA_STATUSES },
  maturity: { type: 'string', enum: store.IDEA_MATURITY },
  tags: stringArray('Loose tags.', 50),
  domains: stringArray('Broad domains such as business, web, english-learning.', 30),
  attributes: jsonObject('Agent-defined structured metadata. Keep this flexible rather than forcing every idea into one schema.'),
  categoryId: string('Owning Agent Ideas category ID.', 160),
  createdInRunId: string('Run that produced this idea.', 160),
};

const { TOOLS } = require('./agentIdeasToolSchemas');
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function sameAccessKey(value) {
  return Boolean(value) && safeEqual(sha256(String(value)), accessKeyHash);
}

function b64(value) {
  return Buffer.from(value).toString('base64url');
}

function unb64(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(kind, claims = {}) {
  const expSeconds = kind === 'refresh' ? 60 * 60 * 24 * 30 : kind === 'access' ? 60 * 60 : 5 * 60;
  const body = b64(JSON.stringify({
    kind,
    exp: Math.floor(Date.now() / 1000) + expSeconds,
    ...claims,
  }));
  const signature = createHmac('sha256', signingKey).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifySigned(value, expectedKind) {
  const [body, signature] = String(value || '').split('.');
  if (!body || !signature) return null;
  const expected = createHmac('sha256', signingKey).update(body).digest('base64url');
  if (!safeEqual(expected, signature)) return null;
  try {
    const payload = JSON.parse(unb64(body));
    if (payload.kind !== expectedKind) return null;
    if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (error) {
    return null;
  }
}

function authorization(req) {
  const raw = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (sameAccessKey(raw)) return { kind: 'access-key', clientId: 'direct' };
  return verifySigned(raw, 'access');
}

function origin(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const proto = forwardedProto || req.protocol || 'https';
  const host = forwardedHost || req.headers.host;
  return `${proto}://${host}`;
}

function safeRedirect(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol === 'https:') return url;
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) return url;
    return null;
  } catch (error) {
    return null;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function authorizeForm(req, params) {
  const action = `${origin(req)}/oauth/authorize`;
  const hidden = Object.entries(params)
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
    .join('');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent Idea Space</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#eef5f8;color:#18324a;margin:0}.card{max-width:34rem;margin:8vh auto;background:rgba(255,255,255,.94);padding:2rem;border:1px solid #d9e7ef;border-radius:16px;box-shadow:0 18px 60px rgba(39,76,99,.13)}h1{margin-top:0}input,button{box-sizing:border-box;width:100%;padding:.8rem;margin:.45rem 0;font:inherit;border-radius:10px}input{border:1px solid #b9cdd9}button{border:0;background:#5577e8;color:white;font-weight:700;cursor:pointer}small{color:#6e8294}</style></head><body><div class="card"><h1>Agent Idea Space を接続</h1><p>ChatGPT に、独立したアイデアDBの読み書きとグラフ展開を許可します。</p><form method="post" action="${action}">${hidden}<label>アクセスキー<input name="access_key" type="password" autocomplete="current-password" required autofocus></label><small>my-portal の Agent Idea Space 用アクセスキーです。</small><button type="submit">許可して接続</button></form></div></body></html>`;
}

function formBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const raw = typeof req.rawBody === 'object' && req.rawBody ? req.rawBody.toString('utf8') : String(req.body || '');
  return Object.fromEntries(new URLSearchParams(raw));
}

function sendJson(res, status, value, protocolVersion) {
  res.status(status);
  res.set('Content-Type', 'application/json; charset=utf-8');
  if (protocolVersion) res.set('Mcp-Protocol-Version', protocolVersion);
  res.send(JSON.stringify(value));
}

function structured(value) {
  const normalized = value === undefined ? null : value;
  return {
    content: [{ type: 'text', text: JSON.stringify(normalized, null, 2) }],
    structuredContent: Array.isArray(normalized)
      ? { items: normalized }
      : normalized && typeof normalized === 'object'
        ? normalized
        : { value: normalized },
  };
}

function invalidParams(message) {
  const error = new Error(message);
  error.code = -32602;
  return error;
}

async function invokeTool(name, args = {}) {
  const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  switch (name) {
    case 'agent_ideas_status':
      return structured({
        service: SERVER_NAME,
        serverVersion: SERVER_VERSION,
        databaseId: store.DATABASE_ID,
        collections: store.COLLECTIONS,
        toolCount: TOOLS.length,
        tools: TOOLS.map((tool) => tool.name),
        database: await store.healthCheck(),
      });
    case 'idea_category_list': return structured(await store.categoryList(input));
    case 'idea_category_upsert': return structured(await store.categoryUpsert(input));
    case 'idea_generation_work': return structured(await store.generationWork(input));
    case 'idea_replenish_request': return structured(await store.requestReplenishment(input));
    case 'idea_category_list': return structured(await store.categoryList(input));
    case 'idea_category_upsert': return structured(await store.categoryUpsert(input));
    case 'idea_generation_work': return structured(await store.generationWork(input));
    case 'idea_replenish_request': return structured(await store.requestReplenishment(input));
    case 'idea_promote_to_portal': return structured(await store.promoteToPortal(input));
    case 'idea_create': return structured(await store.ideaCreate(input));
    case 'idea_get': return structured(await store.ideaGet(input));
    case 'idea_search': return structured(await store.ideaSearch(input));
    case 'idea_update': return structured(await store.ideaUpdate(input));
    case 'idea_expand': return structured(await store.ideaExpand(input));
    case 'idea_link': return structured(await store.ideaLink(input));
    case 'idea_get_context': return structured(await store.ideaGetContext(input));
    case 'idea_merge': return structured(await store.ideaMerge(input));
    case 'idea_archive': return structured(await store.ideaArchive(input));
    case 'idea_run_start': return structured(await store.runStart(input));
    case 'idea_run_finish': return structured(await store.runFinish(input));
    case 'idea_add_source': return structured(await store.sourceAdd(input));
    case 'idea_evaluate': return structured(await store.evaluationAdd(input));
    case 'idea_add_artifact': return structured(await store.artifactAdd(input));
    default: throw invalidParams(`Unknown tool: ${name}`);
  }
}

async function handleRpc(message) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid Request' } };
  }
  const id = message.id;
  const isNotification = id === undefined || id === null;
  if (message.method.startsWith('notifications/')) return null;

  try {
    if (message.method === 'initialize') {
      const requested = message.params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : DEFAULT_PROTOCOL;
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          instructions: 'Agent Ideas mirrors Portal boards (ideas/hobbies/stocks) and their tag categories. Use idea_generation_work to find shortages and idea_create with the mirrored categoryId. Use idea_promote_to_portal only when the user adopts an Agent Idea; this creates the matching Portal memo and marks the Agent Idea promoted.',
        },
      };
    }
    if (message.method === 'ping') return { jsonrpc: '2.0', id, result: {} };
    if (message.method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    if (message.method === 'tools/call') {
      const name = message.params?.name;
      if (!name) throw invalidParams('tools/call requires params.name');
      try {
        const result = await invokeTool(name, message.params?.arguments || {});
        return { jsonrpc: '2.0', id, result };
      } catch (error) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          },
        };
      }
    }
    if (isNotification) return null;
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${message.method}` } };
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      error: {
        code: Number(error?.code) || -32603,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function handleMcp(req, res) {
  const auth = authorization(req);
  if (!auth) {
    res.set('WWW-Authenticate', `Bearer resource_metadata="${origin(req)}/.well-known/oauth-protected-resource"`);
    return sendJson(res, 401, { error: 'Unauthorized' });
  }
  if (req.method === 'GET') {
    res.set('Allow', 'POST, OPTIONS');
    return sendJson(res, 405, { error: 'Use POST for Streamable HTTP MCP requests.' });
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  const body = req.body;
  if (!body) return sendJson(res, 400, { error: 'JSON-RPC body required' });
  const messages = Array.isArray(body) ? body : [body];
  const responses = [];
  for (const message of messages) {
    const response = await handleRpc(message);
    if (response) responses.push(response);
  }
  if (!responses.length) return res.status(202).send('');
  const requestedProtocol = req.headers['mcp-protocol-version'];
  const protocol = SUPPORTED_PROTOCOLS.includes(requestedProtocol) ? requestedProtocol : DEFAULT_PROTOCOL;
  return sendJson(res, 200, Array.isArray(body) ? responses : responses[0], protocol);
}

async function handleAgentIdeasMcp(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Protocol-Version');
  res.set('Access-Control-Expose-Headers', 'Mcp-Protocol-Version, WWW-Authenticate');
  if (req.method === 'OPTIONS') return res.status(204).send('');

  const path = new URL(req.originalUrl || req.url || '/', origin(req)).pathname.replace(/\/+$/, '') || '/';

  if (path === '/health' || path === '/mcp/health') {
    try {
      return sendJson(res, 200, {
        ok: true,
        service: SERVER_NAME,
        serverVersion: SERVER_VERSION,
        databaseId: store.DATABASE_ID,
        toolCount: TOOLS.length,
        database: await store.healthCheck(),
      });
    } catch (error) {
      return sendJson(res, 503, {
        ok: false,
        service: SERVER_NAME,
        serverVersion: SERVER_VERSION,
        databaseId: store.DATABASE_ID,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (path === '/.well-known/oauth-protected-resource' && req.method === 'GET') {
    return sendJson(res, 200, {
      resource: `${origin(req)}/mcp`,
      authorization_servers: [origin(req)],
      scopes_supported: ['agent-ideas'],
    });
  }

  if (path === '/.well-known/oauth-authorization-server' && req.method === 'GET') {
    return sendJson(res, 200, {
      issuer: origin(req),
      authorization_endpoint: `${origin(req)}/oauth/authorize`,
      token_endpoint: `${origin(req)}/oauth/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['agent-ideas'],
    });
  }

  if (path === '/oauth/authorize' && req.method === 'GET') {
    const redirectUri = safeRedirect(req.query.redirect_uri);
    const clientId = String(req.query.client_id || '');
    const codeChallenge = String(req.query.code_challenge || '');
    if (req.query.response_type !== 'code' || !redirectUri || !clientId || !codeChallenge || req.query.code_challenge_method !== 'S256') {
      return res.status(400).send('Invalid OAuth authorization request');
    }
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(authorizeForm(req, {
      redirect_uri: redirectUri.toString(),
      client_id: clientId,
      state: String(req.query.state || ''),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }));
  }

  if (path === '/oauth/authorize' && req.method === 'POST') {
    const body = formBody(req);
    const redirectUri = safeRedirect(body.redirect_uri);
    const clientId = String(body.client_id || '');
    const challenge = String(body.code_challenge || '');
    if (!redirectUri || !clientId || !challenge || !sameAccessKey(String(body.access_key || ''))) {
      return res.status(401).send('Authorization denied');
    }
    const code = sign('code', { redirectUri: redirectUri.toString(), clientId, challenge });
    redirectUri.searchParams.set('code', code);
    if (body.state) redirectUri.searchParams.set('state', String(body.state));
    return res.redirect(302, redirectUri.toString());
  }

  if (path === '/oauth/token' && req.method === 'POST') {
    const body = formBody(req);
    const grant = String(body.grant_type || '');
    if (grant === 'refresh_token') {
      const refresh = verifySigned(body.refresh_token, 'refresh');
      if (!refresh) return sendJson(res, 400, { error: 'invalid_grant' });
      return sendJson(res, 200, {
        access_token: sign('access', { clientId: refresh.clientId }),
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'agent-ideas',
      });
    }

    const code = verifySigned(body.code, 'code');
    const verifier = String(body.code_verifier || '');
    const redirectUri = String(body.redirect_uri || '');
    const clientId = String(body.client_id || '');
    const actualChallenge = createHash('sha256').update(verifier).digest('base64url');
    if (grant !== 'authorization_code' || !code || code.redirectUri !== redirectUri || code.clientId !== clientId || code.challenge !== actualChallenge) {
      return sendJson(res, 400, { error: 'invalid_grant' });
    }
    return sendJson(res, 200, {
      access_token: sign('access', { clientId }),
      refresh_token: sign('refresh', { clientId }),
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'agent-ideas',
    });
  }

  if (path === '/mcp' || path === '/') return handleMcp(req, res);
  return sendJson(res, 404, { error: 'Not found' });
}

module.exports = {
  SERVER_NAME,
  SERVER_VERSION,
  TOOLS,
  handleAgentIdeasMcp,
};
