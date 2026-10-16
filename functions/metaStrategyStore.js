'use strict';

/**
 * Cross-project recommendations are neither Agent HQ Work Items nor human
 * Thinking Space ideas. The assistant proposes; the user alone decides.
 */
const { createHash } = require('node:crypto');
const { getDocumentDb, FieldValue } = require('./documentDb');

const COLLECTION = 'metaStrategyProposals';
const db = () => getDocumentDb(process.env.AGENT_IDEAS_DATABASE_ID || '(default)');
const STATES = new Set(['new', 'considering', 'accepted', 'rejected', 'done']);
const PRIORITIES = new Set(['now', 'soon', 'explore']);
// A proposal's lens tells us whom it serves; category remains open-ended.
// Legacy proposals without lens are still readable as cross-cutting.
const LENSES = new Set(['projects', 'personal', 'curiosity', 'cross-cutting']);
const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const unique = (array, n, max) => [...new Set((Array.isArray(array) ? array : [])
  .slice(0, n).map(value => clean(value, max)).filter(Boolean))];
const timestamp = value => value?.toDate?.()?.toISOString?.() || (typeof value === 'string' ? value : null);
const normalizeLens = value => LENSES.has(value) ? value : 'cross-cutting';
const fingerprint = value => createHash('sha256').update(clean(value, 200).toLocaleLowerCase('ja-JP')
  .normalize('NFKC').replace(/\s+/g, ' ')).digest('hex').slice(0, 30);
function sources(value) {
  return (Array.isArray(value) ? value : []).slice(0, 8).map(raw => ({
    label: clean(raw?.label, 140),
    observation: clean(raw?.observation, 700),
    url: /^https?:\/\//i.test(String(raw?.url || '')) ? clean(raw.url, 1000) : '',
    checkedAt: clean(raw?.checkedAt, 40),
  })).filter(s => s.label || s.observation || s.url);
}
function serialize(doc) {
  const data = typeof doc.data === 'function' ? doc.data() : doc;
  return { ...data, id: doc.id, lens: normalizeLens(data.lens), createdAt: timestamp(data.createdAt),
    updatedAt: timestamp(data.updatedAt), lastSeenAt: timestamp(data.lastSeenAt) };
}
async function list(args = {}) {
  const limit = Math.min(Math.max(Number(args.limit) || 100, 1), 200);
  const status = clean(args.status, 30);
  if (status && !STATES.has(status)) throw new Error('Unknown proposal status');
  // Sorted on the server; no full-history read on every scheduled run.
  const snapshot = await db().collection(COLLECTION).orderBy('updatedAt', 'desc').limit(limit).get();
  const items = snapshot.docs.map(serialize).filter(p => !status || p.status === status);
  return { items, count: items.length, sourceOfTruth: COLLECTION,
    limitations: 'Recent window only; unavailable chat history is not automatically visible.' };
}
async function get(args = {}) {
  const id = clean(args.id, 100);
  if (!/^[a-z0-9-]{1,100}$/.test(id)) throw new Error('Invalid proposal id');
  const snap = await db().collection(COLLECTION).doc(id).get();
  if (!snap.exists) throw new Error('Proposal not found');
  return serialize(snap);
}
async function create(args = {}) {
  const title = clean(args.title, 180);
  const summary = clean(args.summary, 2800);
  const reason = clean(args.reason, 2500);
  const nextStep = clean(args.nextStep, 1200);
  if (title.length < 8 || summary.length < 20 || !reason || !nextStep) {
    throw new Error('title, meaningful summary, reason and nextStep are required');
  }
  const ideaKey = clean(args.ideaKey || title, 180);
  const id = 'meta-' + fingerprint(ideaKey);
  const ref = db().collection(COLLECTION).doc(id);
  let outcome = 'created';
  await db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      // Explicit user rejection/acceptance must never be overwritten by a later run.
      outcome = 'already_exists';
      return;
    }
    tx.set(ref, {
      title, ideaKey, summary, reason, nextStep,
      category: clean(args.category || 'cross-cutting', 70),
      lens: normalizeLens(args.lens),
      priority: PRIORITIES.has(args.priority) ? args.priority : 'explore',
      evidence: sources(args.evidence),
      uncertainty: clean(args.uncertainty, 900),
      context: unique(args.context, 14, 160),
      status: 'new', feedback: '', revision: 1,
      origin: clean(args.origin || 'meta-strategist', 80),
      lastSeenAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { outcome, proposal: await get({ id }) };
}
async function feedback(args = {}) {
  const id = clean(args.id, 100);
  const status = clean(args.status, 30);
  if (!STATES.has(status)) throw new Error('Invalid feedback status');
  const ref = db().collection(COLLECTION).doc(id);
  const expectedRevision = Number(args.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new Error('expectedRevision is required');
  await db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Proposal not found');
    const old = snap.data();
    if (Number(old.revision) !== expectedRevision) throw new Error('Proposal revision conflict; refresh first');
    tx.update(ref, {
      status, feedback: clean(args.feedback, 1800),
      revision: expectedRevision + 1, updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return get({ id });
}
module.exports = { COLLECTION, list, get, create, feedback, fingerprint, normalizeLens };
