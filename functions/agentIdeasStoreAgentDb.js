// Netlify imports this wrapper instead of agentIdeasStore directly. Force the
// shared store onto the dedicated named database so Agent Idea Space can never
// fall back to the user's main `(default)` My Portal database.
process.env.AGENT_IDEAS_DATABASE_ID = 'agent-ideas';

const { getApp } = require('firebase-admin/app');
const { initializeFirestore } = require('firebase-admin/firestore');
const store = require('./agentIdeasStore');

function ensureAgentDatabase() {
  // Bind the named database to the exact initialized Admin app and prefer the
  // REST transport. In serverless runtimes this avoids opaque gRPC status 5
  // NOT_FOUND failures while preserving strict separation from `(default)`.
  return initializeFirestore(getApp(), { preferRest: true }, 'agent-ideas');
}

const wrapped = {};
Object.entries(store).forEach(([key, value]) => {
  if (typeof value !== 'function') {
    wrapped[key] = value;
    return;
  }
  wrapped[key] = async (...args) => {
    ensureAgentDatabase();
    return value(...args);
  };
});

module.exports = wrapped;
