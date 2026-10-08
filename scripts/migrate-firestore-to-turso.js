#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { applicationDefault, cert, getApps, initializeApp } = require('firebase-admin/app');
const { FieldPath, getFirestore } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const RESET_CHECKPOINT = process.argv.includes('--reset-checkpoint');
const PAGE_SIZE = Math.min(Math.max(Number(process.env.MIGRATION_PAGE_SIZE) || 250, 25), 500);
const READ_BUDGET_VALUE = Number(process.env.MIGRATION_READ_BUDGET);
const READ_BUDGET = Number.isFinite(READ_BUDGET_VALUE) && READ_BUDGET_VALUE > 0
  ? Math.floor(READ_BUDGET_VALUE)
  : Infinity;
const CHECKPOINT_FILE = path.resolve(
  process.env.MIGRATION_CHECKPOINT_FILE || '.turso-migration-checkpoint.json',
);
const SOURCE_DATABASE_IDS = String(process.env.FIRESTORE_SOURCE_DATABASE_IDS || '(default)')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const CHECKPOINT_VERSION = 2;

const DEFAULT_EXPLICIT_COLLECTION_PATHS = Object.freeze([
  'memos/agent-control/workItems',
  'memos/agent-control/managerJobs',
  'memos/agent-control/managerRuns',
  'memos/agent-control/organizations',
  'memos/agent-control/operatingModels',
  'memos/agent-control/operatingModelVersions',
  'memos/agent-control/systemChangeSets',
]);

function explicitCollectionPaths(databaseId) {
  const configured = process.env.FIRESTORE_EXPLICIT_COLLECTION_PATHS;
  if (configured) {
    return String(configured)
      .split(',')
      .map((value) => value.trim().replace(/^\/+|\/+$/g, ''))
      .filter(Boolean);
  }
  return databaseId === '(default)' ? DEFAULT_EXPLICIT_COLLECTION_PATHS : [];
}

class PlannedStop extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlannedStop';
  }
}

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

function fingerprint(value) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function blankCheckpoint() {
  return {
    version: CHECKPOINT_VERSION,
    sourceDatabaseIds: SOURCE_DATABASE_IDS,
    targetFingerprint: fingerprint(process.env.TURSO_DATABASE_URL),
    pageSize: PAGE_SIZE,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    databases: {},
  };
}

function saveCheckpoint(checkpoint) {
  checkpoint.updatedAt = new Date().toISOString();
  const temp = CHECKPOINT_FILE + '.tmp';
  fs.mkdirSync(path.dirname(CHECKPOINT_FILE), { recursive: true });
  fs.writeFileSync(temp, JSON.stringify(checkpoint, null, 2) + '\n', { mode: 0o600 });
  try {
    fs.renameSync(temp, CHECKPOINT_FILE);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
    fs.rmSync(CHECKPOINT_FILE, { force: true });
    fs.renameSync(temp, CHECKPOINT_FILE);
  }
}

function loadCheckpoint() {
  if (RESET_CHECKPOINT && fs.existsSync(CHECKPOINT_FILE)) {
    fs.rmSync(CHECKPOINT_FILE, { force: true });
    console.log('[checkpoint] removed ' + CHECKPOINT_FILE);
  }
  if (!fs.existsSync(CHECKPOINT_FILE)) return blankCheckpoint();

  const checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
  if (checkpoint.version !== CHECKPOINT_VERSION) {
    throw new Error('Checkpoint version mismatch. Re-run with --reset-checkpoint.');
  }
  if (JSON.stringify(checkpoint.sourceDatabaseIds) !== JSON.stringify(SOURCE_DATABASE_IDS)) {
    throw new Error('FIRESTORE_SOURCE_DATABASE_IDS differs from the checkpoint. Re-run with --reset-checkpoint.');
  }
  if (checkpoint.targetFingerprint !== fingerprint(process.env.TURSO_DATABASE_URL)) {
    throw new Error('TURSO_DATABASE_URL differs from the checkpoint. Re-run with --reset-checkpoint.');
  }
  return checkpoint;
}

function databaseState(checkpoint, databaseId) {
  if (!checkpoint.databases[databaseId]) {
    checkpoint.databases[databaseId] = {
      topLevelDiscovered: false,
      collections: {},
    };
  }
  return checkpoint.databases[databaseId];
}

function collectionState(dbState, collectionPath) {
  if (!dbState.collections[collectionPath]) {
    dbState.collections[collectionPath] = {
      lastDocumentId: null,
      sourceDocuments: 0,
      completed: false,
      verified: false,
      targetDocuments: null,
    };
  }
  return dbState.collections[collectionPath];
}

function registerCollection(dbState, collectionPath) {
  collectionState(dbState, collectionPath);
}

function isQuotaError(error) {
  const code = error?.code;
  const message = String(error?.message || error || '');
  return code === 8
    || code === 429
    || code === '8'
    || code === '429'
    || code === 'resource-exhausted'
    || code === 'RESOURCE_EXHAUSTED'
    || /quota exceeded|resource exhausted|resource_exhausted/i.test(message);
}

function budgetLabel(value) {
  return Number.isFinite(value) ? String(value) : 'unlimited';
}

async function targetCount(target, collectionPath) {
  const snapshot = await target.collection(collectionPath).count().get();
  return Number(snapshot.data().count || 0);
}

async function discoverTopLevel(source, dbState, checkpoint, databaseId) {
  if (dbState.topLevelDiscovered) return;
  const collections = await source.listCollections();
  collections.forEach((collection) => registerCollection(dbState, collection.id));
  dbState.topLevelDiscovered = true;
  saveCheckpoint(checkpoint);
  console.log('[discover] Firestore database ' + databaseId + ': ' + collections.length + ' top-level collections');
}

async function copyCollection(source, target, collectionPath, state, dbState, checkpoint, run) {
  const sourceCollection = source.collection(collectionPath);

  while (!state.completed) {
    const remaining = Number.isFinite(READ_BUDGET) ? READ_BUDGET - run.documentsRead : PAGE_SIZE;
    if (remaining <= 0) {
      throw new PlannedStop('MIGRATION_READ_BUDGET reached (' + READ_BUDGET + ' documents this run).');
    }

    const limit = Math.min(PAGE_SIZE, remaining);
    let query = sourceCollection.orderBy(FieldPath.documentId()).limit(limit);
    if (state.lastDocumentId) query = query.startAfter(state.lastDocumentId);

    const snapshot = await query.get();
    run.documentsRead += snapshot.size;

    if (snapshot.empty) {
      state.targetDocuments = await targetCount(target, collectionPath);
      state.verified = state.sourceDocuments === state.targetDocuments;
      state.completed = true;
      saveCheckpoint(checkpoint);
      const marker = state.verified ? 'OK' : 'MISMATCH';
      console.log('[' + marker + '] ' + collectionPath + ': source=' + state.sourceDocuments
        + ' target=' + state.targetDocuments);
      return;
    }

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
        registerCollection(dbState, collectionPath + '/' + sourceDoc.id + '/' + child.id);
      }
    }

    state.sourceDocuments += snapshot.size;
    state.lastDocumentId = snapshot.docs[snapshot.docs.length - 1].id;
    saveCheckpoint(checkpoint);

    console.log('[page] ' + collectionPath + ': +' + snapshot.size
      + ' source=' + state.sourceDocuments
      + ' runReads=' + run.documentsRead + '/' + budgetLabel(READ_BUDGET));

    if (snapshot.size < limit) {
      state.targetDocuments = await targetCount(target, collectionPath);
      state.verified = state.sourceDocuments === state.targetDocuments;
      state.completed = true;
      saveCheckpoint(checkpoint);
      const marker = state.verified ? 'OK' : 'MISMATCH';
      console.log('[' + marker + '] ' + collectionPath + ': source=' + state.sourceDocuments
        + ' target=' + state.targetDocuments);
      return;
    }
  }
}

async function scanCollectionDryRun(sourceCollection, collectionPath, stats, run) {
  let cursor = null;
  let sourceCount = 0;

  while (true) {
    const remaining = Number.isFinite(READ_BUDGET) ? READ_BUDGET - run.documentsRead : PAGE_SIZE;
    if (remaining <= 0) throw new PlannedStop('MIGRATION_READ_BUDGET reached during dry run.');

    let query = sourceCollection.orderBy(FieldPath.documentId()).limit(Math.min(PAGE_SIZE, remaining));
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    run.documentsRead += snapshot.size;
    if (snapshot.empty) break;

    sourceCount += snapshot.size;
    for (const sourceDoc of snapshot.docs) {
      const subcollections = await sourceDoc.ref.listCollections();
      for (const child of subcollections) {
        await scanCollectionDryRun(
          child,
          collectionPath + '/' + sourceDoc.id + '/' + child.id,
          stats,
          run,
        );
      }
    }

    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < Math.min(PAGE_SIZE, remaining)) break;
  }

  stats.push({ collectionPath, sourceDocuments: sourceCount });
  console.log('[DRY-RUN] ' + collectionPath + ': source=' + sourceCount);
}

async function dryRunDatabase(app, databaseId, stats, run) {
  const source = databaseId === '(default)' ? getFirestore(app) : getFirestore(app, databaseId);
  const collections = await source.listCollections();
  console.log('Firestore database ' + databaseId + ': ' + collections.length + ' top-level collections');
  for (const collection of collections) {
    await scanCollectionDryRun(collection, collection.id, stats, run);
  }
}

async function applyDatabase(app, databaseId, target, checkpoint, run) {
  const source = databaseId === '(default)' ? getFirestore(app) : getFirestore(app, databaseId);
  const dbState = databaseState(checkpoint, databaseId);
  await discoverTopLevel(source, dbState, checkpoint, databaseId);

  // Firestore permits subcollections below a parent document that does not itself
  // exist. Such "phantom parent" paths are invisible to collection scans that
  // recurse only through returned documents, so seed known/configured collection
  // paths explicitly. Existing checkpoints are extended in-place; no reset needed.
  const explicitPaths = explicitCollectionPaths(databaseId);
  explicitPaths.forEach((collectionPath) => registerCollection(dbState, collectionPath));
  if (explicitPaths.length) {
    saveCheckpoint(checkpoint);
    console.log('[discover] seeded ' + explicitPaths.length
      + ' explicit collection paths for ' + databaseId);
  }

  while (true) {
    const next = Object.entries(dbState.collections).find(([, state]) => !state.completed);
    if (!next) break;
    const [collectionPath, state] = next;
    await copyCollection(source, target, collectionPath, state, dbState, checkpoint, run);
  }
}

function checkpointSummary(checkpoint) {
  const collections = [];
  for (const [databaseId, dbState] of Object.entries(checkpoint.databases)) {
    for (const [collectionPath, state] of Object.entries(dbState.collections || {})) {
      collections.push({ databaseId, collectionPath, ...state });
    }
  }
  return {
    collections: collections.length,
    completedCollections: collections.filter((item) => item.completed).length,
    sourceDocuments: collections.reduce((sum, item) => sum + Number(item.sourceDocuments || 0), 0),
    mismatches: collections.filter((item) => item.completed && item.verified === false)
      .map((item) => item.databaseId + ':' + item.collectionPath),
  };
}

async function main() {
  const app = ensureFirebase();
  const run = { documentsRead: 0 };

  if (!APPLY) {
    const stats = [];
    console.log('Dry run only. No Turso writes or checkpoint will be created.');
    console.log('Read budget for this run: ' + budgetLabel(READ_BUDGET));
    for (const databaseId of SOURCE_DATABASE_IDS) await dryRunDatabase(app, databaseId, stats, run);
    console.log(JSON.stringify({
      applied: false,
      sourceDatabaseIds: SOURCE_DATABASE_IDS,
      collections: stats.length,
      sourceDocuments: stats.reduce((sum, item) => sum + item.sourceDocuments, 0),
      documentsReadThisRun: run.documentsRead,
    }, null, 2));
    return;
  }

  if (!process.env.TURSO_DATABASE_URL) throw new Error('TURSO_DATABASE_URL is required');
  if (!process.env.TURSO_AUTH_TOKEN && !process.env.TURSO_DATABASE_AUTH_TOKEN) {
    throw new Error('TURSO_AUTH_TOKEN is required');
  }

  const target = targetDb();
  const checkpoint = loadCheckpoint();
  saveCheckpoint(checkpoint);

  console.log('Applying Firestore -> Turso migration with checkpoint/resume.');
  console.log('Checkpoint: ' + CHECKPOINT_FILE);
  console.log('Read budget for this run: ' + budgetLabel(READ_BUDGET));

  try {
    for (const databaseId of SOURCE_DATABASE_IDS) {
      await applyDatabase(app, databaseId, target, checkpoint, run);
    }
  } catch (error) {
    saveCheckpoint(checkpoint);
    if (error instanceof PlannedStop) {
      console.log('[PAUSED] ' + error.message);
      console.log('Run the same command again to continue from the saved checkpoint.');
      process.exitCode = 75;
      return;
    }
    if (isQuotaError(error)) {
      console.error('[PAUSED] Firestore quota/resource limit reached: ' + String(error.message || error));
      console.error('Progress is saved. Run the same command after quota resets to resume.');
      process.exitCode = 75;
      return;
    }
    throw error;
  }

  const summary = checkpointSummary(checkpoint);
  console.log(JSON.stringify({
    applied: true,
    sourceDatabaseIds: SOURCE_DATABASE_IDS,
    documentsReadThisRun: run.documentsRead,
    checkpointFile: CHECKPOINT_FILE,
    ...summary,
  }, null, 2));

  if (summary.mismatches.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
