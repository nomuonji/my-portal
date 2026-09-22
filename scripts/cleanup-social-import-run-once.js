const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const socialStore = require('../functions/socialArchiveStore.js');

const IMPORT_KEY = 'x-archive-1334823231262314497-2023-02-16';
const ACCOUNT_ID = '1334823231262314497';
const EARLIEST_POST_ID = '1334827147790176258';
const LATEST_POST_ID = '1625476813957865473';

async function main() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured');
  const serviceAccount = JSON.parse(raw);
  if (!getApps().length) {
    initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id || 'my-portal-d05fd',
    });
  }

  const [status, replies, reposts, earliest, latest] = await Promise.all([
    socialStore.status(),
    socialStore.searchPosts({ account: ACCOUNT_ID, type: 'reply', limit: 200, scanLimit: 5000 }),
    socialStore.searchPosts({ account: ACCOUNT_ID, type: 'repost', limit: 200, scanLimit: 5000 }),
    getFirestore().collection(socialStore.COLLECTIONS.posts).doc(`x_${EARLIEST_POST_ID}`).get(),
    getFirestore().collection(socialStore.COLLECTIONS.posts).doc(`x_${LATEST_POST_ID}`).get(),
  ]);

  if (status.counts.posts !== 1638 || status.counts.accounts !== 1 || status.counts.importRuns !== 1) {
    throw new Error(`Archive count verification failed: ${JSON.stringify(status.counts)}`);
  }
  if (replies.count !== 94 || reposts.count !== 18) {
    throw new Error(`Archive type verification failed: replies=${replies.count}, reposts=${reposts.count}`);
  }
  if (!earliest.exists || !latest.exists) {
    throw new Error('Archive date-boundary post verification failed');
  }

  const db = getFirestore();
  await db.collection(socialStore.COLLECTIONS.importRuns).doc(IMPORT_KEY).set({
    batches: 9,
    received: 1638,
    created: 1638,
    updated: 0,
    status: 'complete',
    verifiedAt: FieldValue.serverTimestamp(),
    verification: {
      posts: 1638,
      accounts: 1,
      importRuns: 1,
      replies: 94,
      reposts: 18,
      earliestPostId: EARLIEST_POST_ID,
      latestPostId: LATEST_POST_ID,
      dedupeVerified: true,
    },
  }, { merge: true });

  console.log(JSON.stringify({
    socialArchiveCleanup: {
      counts: status.counts,
      replies: replies.count,
      reposts: reposts.count,
      earliestPostId: EARLIEST_POST_ID,
      latestPostId: LATEST_POST_ID,
      importRunNormalized: true,
    },
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
