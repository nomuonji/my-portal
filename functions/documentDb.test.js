const test = require('node:test');
const assert = require('node:assert/strict');
const { Query, transactionGet } = require('./documentDb');

test('transaction get routes a query through runQuery with the transaction executor', async () => {
  const executor = { transaction: true };
  const expectedSnapshot = { docs: [{ id: 'run-1' }] };
  const calls = [];
  const database = {
    runQuery: async (query, transactionExecutor) => {
      calls.push({ query, transactionExecutor });
      return expectedSnapshot;
    },
    getDoc: async () => { throw new Error('query reads must not use getDoc'); },
  };
  const query = new Query(database, 'managerRuns').where('managerJobId', '==', 'seo-job').limit(200);

  const snapshot = await transactionGet(database, query, executor);

  assert.equal(snapshot, expectedSnapshot);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].query, query);
  assert.equal(calls[0].transactionExecutor, executor);
});

test('transaction get keeps document reads on getDoc', async () => {
  const executor = { transaction: true };
  const reference = { id: 'job-1' };
  const expectedSnapshot = { id: 'job-1', exists: true };
  const database = {
    runQuery: async () => { throw new Error('document reads must not use runQuery'); },
    getDoc: async (ref, transactionExecutor) => {
      assert.equal(ref, reference);
      assert.equal(transactionExecutor, executor);
      return expectedSnapshot;
    },
  };

  assert.equal(await transactionGet(database, reference, executor), expectedSnapshot);
});
