const functions = require('firebase-functions');
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

admin.initializeApp();

const { handleAgentIdeasMcp } = require('./agentIdeasMcp');

exports.getFeatureRequests = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    res.status(204).send('');
    return;
  }

  try {
    const db = admin.firestore();
    const snapshot = await db.collection('featureRequests')
      .where('status', 'in', ['todo', 'in_progress'])
      .orderBy('priority', 'desc')
      .orderBy('createdAt', 'asc')
      .get();

    const requests = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(requests);
  } catch (error) {
    console.error('Error fetching feature requests:', error);
    res.status(500).send('Error fetching feature requests.');
  }
});

exports.agentIdeasMcp = onRequest({
  region: 'asia-northeast1',
  timeoutSeconds: 60,
  memory: '256MiB',
  invoker: 'public',
  cors: false,
}, handleAgentIdeasMcp);
