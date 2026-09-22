// Netlify import trigger for third X archive.
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const encryptedPayload = require('../functions/_socialArchiveEncryptedPayload.js');
const socialStore = require('../functions/socialArchiveStore.js');

const IMPORT_KEY = 'x-archive-1378698034498859016-2022-11-26';
const ACCOUNT_ID = '1378698034498859016';

function decryptPayloads() {
  const existingSecret = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
  if (!existingSecret) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured');
  const key = crypto.createHash('sha256').update(existingSecret, 'utf8').digest();
  const blob = Buffer.from(String(encryptedPayload || ''), 'base64');
  if (blob.length < 29) throw new Error('Encrypted payload is invalid');
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ciphertext = blob.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const payloads = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
  if (!Array.isArray(payloads) || payloads.length !== 2) throw new Error('Expected 2 import batches');
  return payloads;
}

async function runPass(payloads) {
  const totals = { received: 0, created: 0, updated: 0 };
  for (const payload of payloads) {
    const result = await socialStore.importPosts({ ...payload, confirm: true });
    totals.received += Number(result.received || 0);
    totals.created += Number(result.created || 0);
    totals.updated += Number(result.updated || 0);
  }
  return totals;
}

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

  const payloads = decryptPayloads();
  const firstPass = await runPass(payloads);
  const secondPass = await runPass(payloads);

  if (firstPass.received !== 302) {
    throw new Error('First import received count failed: ' + JSON.stringify(firstPass));
  }
  if (secondPass.received !== 302 || secondPass.created !== 0 || secondPass.updated !== 302) {
    throw new Error('Duplicate import verification failed: ' + JSON.stringify(secondPass));
  }

  const database = getFirestore();
  const [status, accountSnapshot] = await Promise.all([
    socialStore.status(),
    database.collection(socialStore.COLLECTIONS.posts).where('accountId', '==', ACCOUNT_ID).get(),
  ]);

  const accountPosts = accountSnapshot.docs.map((doc) => doc.data());
  const replies = accountPosts.filter((item) => item.type === 'reply').length;
  const reposts = accountPosts.filter((item) => item.type === 'repost').length;
  const quotes = accountPosts.filter((item) => item.type === 'quote').length;

  if (status.counts.posts !== 2352 || status.counts.accounts !== 3 || status.counts.importRuns !== 3) {
    throw new Error('Archive count verification failed: ' + JSON.stringify(status.counts));
  }
  if (accountPosts.length !== 302 || replies !== 6 || reposts !== 0 || quotes !== 0) {
    throw new Error('Third archive verification failed: ' + JSON.stringify({
      total: accountPosts.length, replies, reposts, quotes
    }));
  }

  const firstPage = await socialStore.searchPosts({ limit: 50, scanLimit: 50 });
  if (firstPage.items.length !== 50 || !firstPage.hasMore || !firstPage.nextCursor) {
    throw new Error('Pagination first-page verification failed');
  }
  const secondPage = await socialStore.searchPosts({
    limit: 50,
    scanLimit: 50,
    cursor: firstPage.nextCursor,
  });
  const firstIds = new Set(firstPage.items.map((item) => item.id));
  const overlap = secondPage.items.filter((item) => firstIds.has(item.id));
  if (secondPage.items.length !== 50 || overlap.length !== 0) {
    throw new Error('Pagination second-page verification failed');
  }

  await database.collection(socialStore.COLLECTIONS.importRuns).doc(IMPORT_KEY).set({
    batches: 2,
    received: 302,
    created: 302,
    updated: 0,
    status: 'complete',
    verifiedAt: FieldValue.serverTimestamp(),
    verification: {
      posts: 302,
      replies: 6,
      reposts: 0,
      quotes: 0,
      dedupeVerified: true,
      paginationVerified: true,
      globalPostsAfterImport: 2352,
      globalAccountsAfterImport: 3,
    },
  }, { merge: true });

  console.log(JSON.stringify({
    socialArchiveVerification: {
      firstPass,
      secondPass,
      globalCounts: status.counts,
      accountPosts: accountPosts.length,
      replies,
      reposts,
      quotes,
      paginationOverlap: overlap.length,
    },
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
