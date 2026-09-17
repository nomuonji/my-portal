const SCOPES = ["agent-ideas", "offline_access"];

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function baseUrl(request: Request) {
  return new URL(request.url).origin;
}

export default async (request: Request) => {
  if (request.method !== "GET" && request.method !== "OPTIONS") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const base = baseUrl(request);

  if (path === "/.well-known/oauth-protected-resource/mcp") {
    return json({
      resource: `${base}/mcp`,
      authorization_servers: [base],
      bearer_methods_supported: ["header"],
      scopes_supported: SCOPES,
      resource_name: "My Portal Agent Idea Space",
    });
  }

  if (
    path === "/.well-known/oauth-authorization-server/mcp" ||
    path === "/mcp/.well-known/oauth-authorization-server" ||
    path === "/.well-known/openid-configuration" ||
    path === "/.well-known/openid-configuration/mcp" ||
    path === "/mcp/.well-known/openid-configuration"
  ) {
    return json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: SCOPES,
    });
  }

  return json({ error: "not_found" }, 404);
};

export const config = {
  path: [
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-authorization-server/mcp",
    "/mcp/.well-known/oauth-authorization-server",
    "/.well-known/openid-configuration",
    "/.well-known/openid-configuration/mcp",
    "/mcp/.well-known/openid-configuration",
  ],
};
