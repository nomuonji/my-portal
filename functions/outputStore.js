'use strict';

const { getDocumentDb, FieldValue } = require('./documentDb');

const DATABASE_ID = '(default)';
const COLLECTIONS = Object.freeze({
  outputs: 'outputs',
  versions: 'output_versions',
  feedback: 'output_feedback',
});

function db() {
  return getDocumentDb(DATABASE_ID);
}

function text(value, max = 20000) {
  return value === undefined || value === null ? '' : String(value).trim().slice(0, max);
}

function jsonSafe(value, depth = 0) {
  if (depth > 8) return '[max-depth]';
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return value.slice(0, 50000);
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => jsonSafe(item, depth + 1));
  if (typeof value === 'object') {
    const result = {};
    Object.entries(value).slice(0, 200).forEach(([key, item]) => {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) return;
      result[text(key, 120)] = jsonSafe(item, depth + 1);
    });
    return result;
  }
  return String(value).slice(0, 5000);
}

function serialize(value) {
  if (value === null || value === undefined) return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    const result = {};
    Object.entries(value).forEach(([key, item]) => { result[key] = serialize(item); });
    return result;
  }
  return value;
}

function snapshotObject(snapshot) {
  return snapshot && snapshot.exists ? serialize({ id: snapshot.id, ...snapshot.data() }) : null;
}

function listItems(snapshot) {
  return snapshot.docs.map(snapshotObject).filter(Boolean);
}

function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, 80)).filter(Boolean))].slice(0, 40);
}

function normalizeScores(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  Object.entries(value).slice(0, 30).forEach(([key, score]) => {
    const normalized = Number(score);
    if (Number.isFinite(normalized) && normalized >= 1 && normalized <= 5) {
      result[text(key, 80)] = Math.round(normalized * 10) / 10;
    }
  });
  return result;
}

function requireConfirmation(input, action) {
  if (input.confirm !== true) {
    throw new Error(action + ' requires confirm=true after an explicit user request');
  }
}

function validateContent(input) {
  const content = text(input.content, 50000);
  const contentFormat = text(input.contentFormat || input.format || 'markdown', 40) || 'markdown';
  if (!content && !input.externalUrl) throw new Error('content or externalUrl is required');
  return { content, contentFormat };
}

function versionDocId(outputId, versionNumber) {
  return outputId + '__v' + String(versionNumber).padStart(6, '0');
}

function timestampMillis(value) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function list(input = {}) {
  const limit = Math.min(Math.max(Number(input.limit) || 100, 1), 300);
  const scanLimit = Math.min(Math.max(Number(input.scanLimit) || Math.max(limit * 3, 150), limit), 1000);
  const needle = text(input.query || input.q, 500).toLowerCase();
  const type = text(input.type, 80).toLowerCase();
  const status = text(input.status, 30).toLowerCase();
  const snapshot = await db().collection(COLLECTIONS.outputs)
    .orderBy('updatedAt', 'desc')
    .limit(scanLimit)
    .get();
  const items = listItems(snapshot).filter((item) => {
    if (status && (item.status || 'active') !== status) return false;
    if (type && String(item.type || '').toLowerCase() !== type) return false;
    if (needle) {
      const haystack = [
        item.title, item.summary, item.type, item.contentFormat,
        ...(Array.isArray(item.tags) ? item.tags : []),
        JSON.stringify(item.metadata || {}),
      ].join('\n').toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  }).slice(0, limit);
  return { collection: COLLECTIONS.outputs, items, count: items.length, scanned: snapshot.size, databaseId: DATABASE_ID };
}

async function get(input = {}) {
  const id = text(input.id, 180);
  if (!id) throw new Error('id is required');
  const ref = db().collection(COLLECTIONS.outputs).doc(id);
  const item = snapshotObject(await ref.get());
  if (!item) throw new Error('Output not found: ' + id);
  const includeVersions = input.includeVersions !== false;
  const includeFeedback = input.includeFeedback !== false;
  const [versionsSnapshot, feedbackSnapshot] = await Promise.all([
    includeVersions
      ? db().collection(COLLECTIONS.versions).where('outputId', '==', id).get()
      : Promise.resolve({ docs: [] }),
    includeFeedback
      ? db().collection(COLLECTIONS.feedback).where('outputId', '==', id).get()
      : Promise.resolve({ docs: [] }),
  ]);
  const versions = listItems(versionsSnapshot).sort((a, b) => Number(b.versionNumber || 0) - Number(a.versionNumber || 0));
  const feedback = listItems(feedbackSnapshot).sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));
  return { item, versions, feedback, databaseId: DATABASE_ID };
}

async function create(input = {}) {
  requireConfirmation(input, 'output_create');
  const title = text(input.title, 300);
  const type = text(input.type || 'other', 80) || 'other';
  if (!title) throw new Error('title is required');
  const { content, contentFormat } = validateContent(input);
  const now = FieldValue.serverTimestamp();
  const outputRef = db().collection(COLLECTIONS.outputs).doc();
  const versionNumber = 1;
  const versionId = versionDocId(outputRef.id, versionNumber);
  const versionRef = db().collection(COLLECTIONS.versions).doc(versionId);
  const output = {
    title,
    type,
    summary: text(input.summary, 3000),
    tags: normalizeTags(input.tags),
    metadata: jsonSafe(input.metadata || {}),
    status: 'active',
    currentVersion: versionNumber,
    versionCount: 1,
    currentVersionId: versionId,
    ratingCount: 0,
    ratingTotal: 0,
    ratingAverage: null,
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
  };
  const version = {
    outputId: outputRef.id,
    versionNumber,
    content,
    contentFormat,
    externalUrl: text(input.externalUrl, 3000) || null,
    changeSummary: text(input.changeSummary || '初版', 2000),
    promptNotes: text(input.promptNotes, 5000),
    model: text(input.model, 160) || null,
    createdAt: now,
    schemaVersion: 1,
  };
  const batch = db().batch();
  batch.set(outputRef, output);
  batch.set(versionRef, version);
  await batch.commit();
  return {
    created: true,
    item: snapshotObject(await outputRef.get()),
    version: snapshotObject(await versionRef.get()),
    databaseId: DATABASE_ID,
  };
}

async function createVersion(input = {}) {
  requireConfirmation(input, 'output_version_create');
  const id = text(input.id || input.outputId, 180);
  if (!id) throw new Error('id is required');
  const { content, contentFormat } = validateContent(input);
  const outputRef = db().collection(COLLECTIONS.outputs).doc(id);
  let createdVersion;
  await db().runTransaction(async (transaction) => {
    const outputSnapshot = await transaction.get(outputRef);
    if (!outputSnapshot.exists) throw new Error('Output not found: ' + id);
    const output = outputSnapshot.data();
    if (output.status === 'archived') throw new Error('Archived outputs cannot receive new versions');
    const versionNumber = Math.max(Number(output.currentVersion) || 0, Number(output.versionCount) || 0) + 1;
    const versionId = versionDocId(id, versionNumber);
    const versionRef = db().collection(COLLECTIONS.versions).doc(versionId);
    const version = {
      outputId: id,
      versionNumber,
      content,
      contentFormat,
      externalUrl: text(input.externalUrl, 3000) || null,
      changeSummary: text(input.changeSummary, 2000),
      promptNotes: text(input.promptNotes, 5000),
      model: text(input.model, 160) || null,
      createdAt: FieldValue.serverTimestamp(),
      schemaVersion: 1,
    };
    transaction.set(versionRef, version);
    transaction.update(outputRef, {
      currentVersion: versionNumber,
      versionCount: versionNumber,
      currentVersionId: versionId,
      updatedAt: FieldValue.serverTimestamp(),
    });
    createdVersion = { id: versionId, ...version };
  });
  return { item: snapshotObject(await outputRef.get()), version: snapshotObject(await db().collection(COLLECTIONS.versions).doc(createdVersion.id).get()), databaseId: DATABASE_ID };
}

async function addFeedback(input = {}) {
  requireConfirmation(input, 'output_feedback_add');
  const outputId = text(input.id || input.outputId, 180);
  const versionId = text(input.versionId, 220);
  const score = Number(input.score);
  if (!outputId || !versionId) throw new Error('id and versionId are required');
  if (!Number.isFinite(score) || score < 1 || score > 5) throw new Error('score must be between 1 and 5');
  const outputRef = db().collection(COLLECTIONS.outputs).doc(outputId);
  const versionRef = db().collection(COLLECTIONS.versions).doc(versionId);
  const feedbackRef = db().collection(COLLECTIONS.feedback).doc();
  const feedback = {
    outputId,
    versionId,
    versionNumber: Number(input.versionNumber) || null,
    score: Math.round(score * 10) / 10,
    scores: normalizeScores(input.scores),
    verdict: text(input.verdict, 40) || 'review',
    feedback: text(input.feedback, 10000),
    strengths: normalizeTags(input.strengths),
    improvements: normalizeTags(input.improvements),
    createdAt: FieldValue.serverTimestamp(),
    schemaVersion: 1,
  };
  await db().runTransaction(async (transaction) => {
    const [outputSnapshot, versionSnapshot] = await Promise.all([
      transaction.get(outputRef),
      transaction.get(versionRef),
    ]);
    if (!outputSnapshot.exists) throw new Error('Output not found: ' + outputId);
    if (!versionSnapshot.exists || versionSnapshot.data().outputId !== outputId) {
      throw new Error('Version not found for output: ' + versionId);
    }
    const output = outputSnapshot.data();
    const nextCount = (Number(output.ratingCount) || 0) + 1;
    const nextTotal = (Number(output.ratingTotal) || 0) + feedback.score;
    transaction.set(feedbackRef, feedback);
    transaction.update(outputRef, {
      ratingCount: nextCount,
      ratingTotal: nextTotal,
      ratingAverage: Math.round((nextTotal / nextCount) * 100) / 100,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return {
    created: true,
    feedback: snapshotObject(await feedbackRef.get()),
    item: snapshotObject(await outputRef.get()),
    databaseId: DATABASE_ID,
  };
}

async function updateMetadata(input = {}) {
  requireConfirmation(input, 'output_update');
  const id = text(input.id, 180);
  if (!id) throw new Error('id is required');
  const patch = {};
  if (input.title !== undefined) patch.title = text(input.title, 300);
  if (input.type !== undefined) patch.type = text(input.type, 80) || 'other';
  if (input.summary !== undefined) patch.summary = text(input.summary, 3000);
  if (input.tags !== undefined) patch.tags = normalizeTags(input.tags);
  if (input.metadata !== undefined) patch.metadata = jsonSafe(input.metadata);
  if (input.status !== undefined) {
    if (!['active', 'archived'].includes(input.status)) throw new Error('status must be active or archived');
    patch.status = input.status;
  }
  if (!Object.keys(patch).length) throw new Error('No fields to update');
  patch.updatedAt = FieldValue.serverTimestamp();
  const ref = db().collection(COLLECTIONS.outputs).doc(id);
  await ref.update(patch);
  return { item: snapshotObject(await ref.get()), databaseId: DATABASE_ID };
}

module.exports = { DATABASE_ID, COLLECTIONS, list, get, create, createVersion, addFeedback, updateMetadata };
