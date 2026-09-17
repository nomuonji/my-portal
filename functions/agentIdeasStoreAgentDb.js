// Netlify imports this wrapper instead of agentIdeasStore directly. Force the
// shared store onto the dedicated named database so Agent Idea Space can never
// fall back to the user's main `(default)` My Portal database.
process.env.AGENT_IDEAS_DATABASE_ID = 'agent-ideas';

module.exports = require('./agentIdeasStore');
