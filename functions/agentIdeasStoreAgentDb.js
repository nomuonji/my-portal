// Netlify imports this wrapper instead of agentIdeasStore directly. Agent Idea
// Space uses its dedicated collections in the project's existing `(default)`
// Firestore database.
process.env.AGENT_IDEAS_DATABASE_ID = '(default)';

const { getApp } = require('firebase-admin/app');
const { initializeFirestore } = require('firebase-admin/firestore');
const store = require('./agentIdeasStore');

function ensureAgentDatabase() {
  // Bind the default database to the exact initialized Admin app and prefer
  // REST transport in the serverless runtime.
  return initializeFirestore(getApp(), { preferRest: true });
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
