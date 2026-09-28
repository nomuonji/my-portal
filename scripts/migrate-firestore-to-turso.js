#!/usr/bin/env node
'use strict';

const { applicationDefault, cert, getApps, initializeApp } = require('firebase-admin/app');
const { FieldPath, getFirestore } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const PAGE_SIZE = Math.min(Math.max(Number(process.env.MIGRATION_PAGE_SIZE) || 250, 25), 500);
const SOURCE_DATABASE_IDS = String(process.env.FIRESTORE_SOURCE_DATABASE_IDS || '(default)')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function ensureFirebase() {
  if (getApps().length) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    const serviceAccount = JSON.parse(raw);
    return initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id || process.env.GCLOUD_PROJECT,
    });
  }
  return initializeApp({ credential: applicationDefault() });
}

function targetDb() {
  process.env.PORTAL_DB_BACKEND = 'turso';
  const { getDocumentDb } = require('../functions/documentDb');
  return getDocumentDb('(default)');
}

async function targetCount(target, collectionPath) {
  const snapshot = await target.collection(collectionPath).count().get();
  return Number(snapshot.data().count || 0);
}

async function copyCollection(sourceCollection, target, collectionPath, stats) {
  let cursor = null;
  let sourceCount = 0;

  while (true) {
    let query = sourceCollection.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);

    const snapshot = await query.get();
    if (snapshot.empty) break;

    sourceCount += snapshot.size;
    if (APPLY) {
      const batch = target.batch();
      snapshot.docs.forEach((sourceDoc) => {
        batch.set(target.collection(collectionPath).doc(sourceDoc.id), sourceDoc.data());
      });
      await batch.commit();
    }

    for (const sourceDoc of snapshot.docs) {
      const subcollections = await sourceDoc.ref.listCollections();
      for (const child of subcollections) {
        await copyCollection(
          child,
          target,
          collectionPath + '/' + sourceDoc.id + '/' + child.id,
          stats,
        );
      }
    }

    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < PAGE_SIZE) break;
  }

  const targetDocuments = APPLY ? await targetCount(target, collectionPath) : null;
  stats.push({
    collectionPath,
    sourceDocuments: sourceCount,
    targetDocuments,
    verified: APPLY ? sourceCount === targetDocuments : null,
  });

  const marker = APPLY
    ? (sourceCount === targetDocuments ? 'OK' : 'MISMATCH')
    : 'DRY-RUN';
  console.log('[' + marker + '] ' + collectionPath + ': source=' + sourceCount
    + (APPLY ? ' target=' + targetDocuments : ''));
}

async function migrateDatabase(app, databaseId, target, stats) {
  const source = databaseId === '(default)' ? getFirestore(app) : getFirestore(app, databaseId);
  const collections = await source.listCollections();
  console.log('Firestore database ' + databaseId + ': ' + collections.length + ' top-level collections');
  for (const collection of collections) {
    await copyCollection(collection, target, collection.id, stats);
  }
}

async function main() {
  if (!process.env.TURSO_DATABASE_URL) throw new Error('TURSO_DATABASE_URL is required');
  if (!process.env.TURSO_AUTH_TOKEN && !process.env.TURSO_DATABASE_AUTH_TOKEN) {
    throw new Error('TURSO_AUTH_TOKEN is required');
  }

  const app = ensureFirebase();
  const target = targetDb();
  const stats = [];

  console.log(APPLY
    ? 'Applying Firestore -> Turso migration. Existing target document IDs will be replaced idempotently.'
    : 'Dry run only. Re-run with --apply to write to Turso.');

  for (const databaseId of SOURCE_DATABASE_IDS) {
    await migrateDatabase(app, databaseId, target, stats);
  }

  const totalSource = stats.reduce((sum, item) => sum + item.sourceDocuments, 0);
  const mismatches = stats.filter((item) => item.verified === false);

  console.log(JSON.stringify({
    applied: APPLY,
    sourceDatabaseIds: SOURCE_DATABASE_IDS,
    collections: stats.length,
    sourceDocuments: totalSource,
    mismatches: mismatches.map((item) => item.collectionPath),
  }, null, 2));

  if (mismatches.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
