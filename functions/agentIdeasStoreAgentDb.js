// Netlify imports this wrapper before the MCP tool contract. It guarantees that
// the shared Agent Idea Store resolves to the dedicated named database instead
// of accidentally falling back to the user's main `(default)` portal database.
if (!process.env.AGENT_IDEAS_DATABASE_ID) {
  process.env.AGENT_IDEAS_DATABASE_ID = 'agent-ideas';
}

module.exports = require('./agentIdeasStore');
