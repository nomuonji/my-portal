const { getFirestore } = require('firebase-admin/firestore');

const AGENT_COLLECTIONS = ['relations', 'runs', 'sources', 'evaluations', 'artifacts'];

function isAgentIdea(data = {}) {
  return Boolean(
    data?.createdBy?.type === 'agent' ||
    data?.createdBy?.agent ||
    data?.createdInRunId ||
    data?.maturity
  );
}

async function commitCopies(target, entries) {
  let copied = 0;
  for (let i = 0; i < entries.length; i += 400) {
    const batch = target.batch();
    entries.slice(i, i + 400).forEach(({ collection, id, data }) => {
      batch.set(target.collection(collection).doc(id), data, { merge: true });
    });
    await batch.commit();
    copied += Math.min(400, entries.length - i);
  }
  return copied;
}

async function bootstrapLegacyAgentData(targetDatabaseId = '(default)') {
  if (!targetDatabaseId || targetDatabaseId === '(default)') {
    return { migrated: false, reason: 'target-is-default', targetDatabaseId: '(default)' };
  }

  const source = getFirestore();
  const target = getFirestore(targetDatabaseId);
  const targetIdeaSample = await target.collection('ideas').limit(1).get();
  const targetRunSample = await target.collection('runs').limit(1).get();
  if (!targetIdeaSample.empty || !targetRunSample.empty) {
    return { migrated: false, reason: 'target-not-empty', targetDatabaseId };
  }

  const entries = [];
  const sourceIdeas = await source.collection('ideas').get();
  sourceIdeas.docs.forEach((snapshot) => {
    const data = snapshot.data();
    if (snapshot.id !== '__agent' && isAgentIdea(data)) {
      entries.push({ collection: 'ideas', id: snapshot.id, data });
    }
  });

  for (const collection of AGENT_COLLECTIONS) {
    const snapshot = await source.collection(collection).get();
    snapshot.docs.forEach((doc) => entries.push({ collection, id: doc.id, data: doc.data() }));
  }

  // Earlier integrated UI stored continuation sessions below /ideas/__agent/runs.
  // Copy them into the dedicated run collection so the new UI and MCP see them.
  const legacySessions = await source.collection('ideas').doc('__agent').collection('runs').get();
  legacySessions.docs.forEach((doc) => {
    entries.push({
      collection: 'runs',
      id: doc.id,
      data: {
        ...doc.data(),
        metadata: {
          ...(doc.data().metadata || {}),
          migratedFrom: 'default/ideas/__agent/runs',
        },
      },
    });
  });

  const copied = await commitCopies(target, entries);
  return {
    migrated: copied > 0,
    copied,
    agentIdeas: entries.filter((entry) => entry.collection === 'ideas').length,
    targetDatabaseId,
    sourceDatabaseId: '(default)',
    sourceDocumentsKept: true,
  };
}

module.exports = { bootstrapLegacyAgentData, isAgentIdea };
