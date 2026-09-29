const assert = require('node:assert/strict');
const Module = require('node:module');

const events = [];
let transactionCount = 0;

const transactionExecutor = {
  all: async function (sql) {
    events.push({ executor: 'transaction', method: 'all', sql: sql });
    return [];
  },
  get: async function (sql) {
    events.push({ executor: 'transaction', method: 'get', sql: sql });
    if (sql.startsWith('SELECT COUNT(*)')) return { count: 0 };
    return null;
  },
  run: async function (sql) {
    events.push({ executor: 'transaction', method: 'run', sql: sql });
    return { rowsAffected: 1 };
  },
};

const fakeConnection = {
  batch: async function (statements) {
    events.push({ executor: 'connection', method: 'batch', count: statements.length });
    return [];
  },
  transactionAsync: function (callback) {
    return {
      immediate: async function () {
        transactionCount += 1;
        return callback(transactionExecutor);
      },
    };
  },
};

process.env.PORTAL_DB_BACKEND = 'turso';
process.env.TURSO_DATABASE_URL = 'libsql://turso-transaction-smoke.invalid';
process.env.TURSO_AUTH_TOKEN = 'test-only-token';

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@tursodatabase/serverless') {
    return { connect: function () { return fakeConnection; } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

async function main() {
  try {
    const { getDocumentDb } = require('../functions/documentDb');
    const database = getDocumentDb('(default)');
    const runQuery = database.collection('memos/agent-control/managerRuns')
      .where('managerJobId', '==', 'site-seo-operations')
      .limit(200);
    const runRef = database.collection('memos/agent-control/managerRuns').doc('run-smoke');

    const result = await database.runTransaction(async (tx) => {
      const existingRuns = await tx.get(runQuery);
      assert.ok(Array.isArray(existingRuns.docs), 'tx.get(query) must return a QuerySnapshot');
      assert.equal(existingRuns.size, 0);
      const existingRun = await tx.get(runRef);
      assert.equal(existingRun.exists, false, 'tx.get(documentRef) must retain DocumentSnapshot behavior');
      tx.set(runRef, { managerJobId: 'site-seo-operations', status: 'ready' });
      return existingRuns.docs.map((item) => item.id);
    });

    assert.deepEqual(result, []);
    assert.equal(transactionCount, 1, 'query read and write must share one SQL transaction');
    assert.ok(events.some((event) => event.executor === 'transaction'
      && event.method === 'all'
      && event.sql.includes('SELECT document_id, data_json FROM portal_documents')),
    'the Manager Run query must execute through the transaction connection');
    assert.ok(events.some((event) => event.executor === 'transaction'
      && event.method === 'get'
      && event.sql.startsWith('SELECT data_json FROM portal_documents')),
    'document-reference reads must remain point reads through the transaction connection');
    assert.ok(events.some((event) => event.executor === 'transaction'
      && event.method === 'run'
      && event.sql.startsWith('INSERT INTO portal_documents')),
    'the queued write must commit through the same transaction connection');

    console.log('PASS Turso transaction query read returns docs and commits through the same transaction.');
  } finally {
    Module._load = originalLoad;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
