// Final Netlify verification: database counts, second archive integrity, and cursor pagination.
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const socialStore = require('../functions/socialArchiveStore.js');

const ACCOUNT_ID = '1372211341172244484';
const IMPORT_KEY = 'x-archive-1372211341172244484-2022-11-26';

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

  const database = getFirestore();
  const [status, secondAccount, runDoc] = await Promise.all([
    socialStore.status(),
    database.collection(socialStore.COLLECTIONS.posts).where('accountId', '==', ACCOUNT_ID).get(),
    database.collection(socialStore.COLLECTIONS.importRuns).doc(IMPORT_KEY).get(),
  ]);

  const posts = secondAccount.docs.map((doc) => doc.data());
  const replies = posts.filter((item) => item.type === 'reply').length;
  const reposts = posts.filter((item) => item.type === 'repost').length;
  const quotes = posts.filter((item) => item.type === 'quote').length;

  if (status.counts.posts !== 2050 || status.counts.accounts !== 2 || status.counts.importRuns !== 2) {
    throw new Error('Global archive counts are wrong: ' + JSON.stringify(status.counts));
  }
  if (posts.length !== 412 || replies !== 65 || reposts !== 0 || quotes !== 0) {
    throw new Error('Second archive counts are wrong: ' + JSON.stringify({ total: posts.length, replies, reposts, quotes }));
  }
  if (!runDoc.exists) throw new Error('Second import run is missing');
  const run = runDoc.data();
  if (run.status !== 'complete' || run.batches !== 3 || run.received !== 412 || run.created !== 412 || run.updated !== 0) {
    throw new Error('Second import run is not normalized: ' + JSON.stringify(run));
  }

  const firstPage = await socialStore.searchPosts({ limit: 50, scanLimit: 500 });
  if (firstPage.count !== 50 || !firstPage.hasMore || !firstPage.nextCursor) {
    throw new Error('First cursor page failed: ' + JSON.stringify({
      count: firstPage.count, hasMore: firstPage.hasMore, hasCursor: Boolean(firstPage.nextCursor)
    }));
  }
  const secondPage = await socialStore.searchPosts({ limit: 50, scanLimit: 500, cursor: firstPage.nextCursor });
  if (secondPage.count !== 50) {
    throw new Error('Second cursor page failed: ' + JSON.stringify({ count: secondPage.count }));
  }
  const firstIds = new Set(firstPage.items.map((item) => item.id));
  const overlap = secondPage.items.filter((item) => firstIds.has(item.id));
  if (overlap.length) {
    throw new Error('Cursor pages overlap: ' + overlap.map((item) => item.id).join(','));
  }

  console.log(JSON.stringify({
    socialArchiveFinalVerification: {
      globalCounts: status.counts,
      secondArchive: { total: posts.length, replies, reposts, quotes },
      importRun: {
        status: run.status,
        batches: run.batches,
        received: run.received,
        created: run.created,
        updated: run.updated,
      },
      pagination: {
        firstPage: firstPage.count,
        secondPage: secondPage.count,
        overlap: overlap.length,
        firstScanned: firstPage.scanned,
        secondScanned: secondPage.scanned,
      },
    },
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
