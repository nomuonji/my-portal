import * as firestore from 'firebase/firestore';
import { auth } from './firebase';

const USE_TURSO = String(process.env.REACT_APP_PORTAL_DB_BACKEND || '').toLowerCase() === 'turso';
const POLL_MS = Math.max(Number(process.env.REACT_APP_PORTAL_DB_POLL_MS) || 15000, 5000);
const listeners = new Set();

class PortalTimestamp {
  constructor(value) {
    this.value = new Date(value);
  }
  toDate() { return new Date(this.value.getTime()); }
  toMillis() { return this.value.getTime(); }
  toJSON() { return this.value.toISOString(); }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function hydrate(value) {
  if (typeof value === 'string' && ISO_DATE.test(value)) return new PortalTimestamp(value);
  if (Array.isArray(value)) return value.map(hydrate);
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).forEach(([key, item]) => { out[key] = hydrate(item); });
    return out;
  }
  return value;
}

class PortalDocumentSnapshot {
  constructor(id, data, exists = true) {
    this.id = id;
    this._data = data;
    this._exists = exists;
  }
  exists() { return this._exists; }
  data() { return this._exists ? hydrate(this._data) : undefined; }
  get(field) {
    const parts = String(field || '').split('.').filter(Boolean);
    let value = this.data();
    for (const part of parts) value = value == null ? undefined : value[part];
    return value;
  }
}

class PortalQuerySnapshot {
  constructor(docs) {
    this.docs = docs;
    this.size = docs.length;
    this.empty = docs.length === 0;
  }
  forEach(callback) { this.docs.forEach(callback); }
}

function collectionPathFromArgs(args) {
  const [base, ...segments] = args;
  if (base && base.__portalDbKind === 'collection') return [base.path, ...segments].join('/');
  if (base && base.__portalDbKind === 'document') return [base.path, ...segments].join('/');
  return segments.join('/');
}

function makeCollection(path) {
  return { __portalDbKind: 'collection', path: String(path).replace(/^\/+|\/+$/g, ''), constraints: [] };
}

function randomId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID().replaceAll('-', '').slice(0, 20);
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function makeDocument(path) {
  const normalized = String(path).replace(/^\/+|\/+$/g, '');
  const parts = normalized.split('/');
  return {
    __portalDbKind: 'document',
    path: normalized,
    id: parts[parts.length - 1],
    collectionPath: parts.slice(0, -1).join('/'),
  };
}

function serializeWrite(value) {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof PortalTimestamp) return value.toJSON();
  if (Array.isArray(value)) return value.map(serializeWrite);
  if (value && typeof value === 'object') {
    if (value.__portalDbOp) return value;
    const out = {};
    Object.entries(value).forEach(([key, item]) => { out[key] = serializeWrite(item); });
    return out;
  }
  return value;
}

async function api(body) {
  const user = auth.currentUser;
  if (!user) throw new Error('Firebase login is required');
  const token = await user.getIdToken();
  const response = await fetch('/api/document-db', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || ('Document DB request failed: ' + response.status));
  return payload;
}

function queryPayload(target) {
  const constraints = Array.isArray(target.constraints) ? target.constraints : [];
  const filters = [];
  const orders = [];
  let max;
  let cursor;
  constraints.forEach((item) => {
    if (item.type === 'where') filters.push({ field: item.field, op: item.op, value: serializeWrite(item.value) });
    if (item.type === 'orderBy') orders.push({ field: item.field, direction: item.direction });
    if (item.type === 'limit') max = item.value;
    if (item.type === 'startAfter') cursor = item.values.map(serializeWrite);
  });
  return { filters, orders, limit: max, cursor };
}

async function notifyListeners() {
  await Promise.allSettled(Array.from(listeners).map((refresh) => refresh(true)));
}

export function collection(...args) {
  if (!USE_TURSO) return firestore.collection(...args);
  return makeCollection(collectionPathFromArgs(args));
}

export function doc(...args) {
  if (!USE_TURSO) return firestore.doc(...args);
  const [base, ...segments] = args;
  if (base && base.__portalDbKind === 'collection' && segments.length === 0) return makeDocument(base.path + '/' + randomId());
  if (base && base.__portalDbKind === 'collection') return makeDocument([base.path, ...segments].join('/'));
  if (base && base.__portalDbKind === 'document') return makeDocument([base.path, ...segments].join('/'));
  return makeDocument(segments.join('/'));
}

export function query(base, ...constraints) {
  if (!USE_TURSO) return firestore.query(base, ...constraints);
  return { ...base, __portalDbKind: 'query', constraints: [...(base.constraints || []), ...constraints] };
}

export function where(field, op, value) {
  if (!USE_TURSO) return firestore.where(field, op, value);
  return { type: 'where', field, op, value };
}

export function orderBy(field, direction = 'asc') {
  if (!USE_TURSO) return firestore.orderBy(field, direction);
  return { type: 'orderBy', field, direction };
}

export function limit(value) {
  if (!USE_TURSO) return firestore.limit(value);
  return { type: 'limit', value: Number(value) };
}

export function startAfter(...values) {
  if (!USE_TURSO) return firestore.startAfter(...values);
  return { type: 'startAfter', values };
}

export function serverTimestamp() {
  return USE_TURSO ? { __portalDbOp: 'serverTimestamp' } : firestore.serverTimestamp();
}

export function increment(value) {
  return USE_TURSO ? { __portalDbOp: 'increment', value: Number(value) || 0 } : firestore.increment(value);
}

export function arrayUnion(...values) {
  return USE_TURSO ? { __portalDbOp: 'arrayUnion', values: values.map(serializeWrite) } : firestore.arrayUnion(...values);
}

export function arrayRemove(...values) {
  return USE_TURSO ? { __portalDbOp: 'arrayRemove', values: values.map(serializeWrite) } : firestore.arrayRemove(...values);
}

export function deleteField() {
  return USE_TURSO ? { __portalDbOp: 'delete' } : firestore.deleteField();
}

export async function getDoc(ref) {
  if (!USE_TURSO) return firestore.getDoc(ref);
  const payload = await api({ action: 'get', collection: ref.collectionPath, id: ref.id });
  return new PortalDocumentSnapshot(payload.id, payload.data, payload.exists);
}

export async function getDocs(target) {
  if (!USE_TURSO) return firestore.getDocs(target);
  const base = target.__portalDbKind === 'query' ? target : { ...target, constraints: target.constraints || [] };
  const payload = await api({
    action: 'query',
    collection: base.path,
    ...queryPayload(base),
  });
  return new PortalQuerySnapshot((payload.docs || []).map((item) => new PortalDocumentSnapshot(item.id, item.data, true)));
}

export async function addDoc(collectionRef, data) {
  if (!USE_TURSO) return firestore.addDoc(collectionRef, data);
  const payload = await api({ action: 'add', collection: collectionRef.path, data: serializeWrite(data || {}) });
  await notifyListeners();
  return makeDocument(collectionRef.path + '/' + payload.id);
}

export async function setDoc(ref, data, options = {}) {
  if (!USE_TURSO) return firestore.setDoc(ref, data, options);
  await api({
    action: 'set',
    collection: ref.collectionPath,
    id: ref.id,
    data: serializeWrite(data || {}),
    merge: options?.merge === true,
  });
  await notifyListeners();
}

export async function updateDoc(ref, data, ...rest) {
  if (!USE_TURSO) return firestore.updateDoc(ref, data, ...rest);
  let patch = data;
  if (typeof data === 'string') {
    patch = { [data]: rest[0] };
    for (let i = 1; i < rest.length; i += 2) patch[rest[i]] = rest[i + 1];
  }
  await api({
    action: 'update',
    collection: ref.collectionPath,
    id: ref.id,
    data: serializeWrite(patch || {}),
  });
  await notifyListeners();
}

export async function deleteDoc(ref) {
  if (!USE_TURSO) return firestore.deleteDoc(ref);
  await api({ action: 'delete', collection: ref.collectionPath, id: ref.id });
  await notifyListeners();
}

export function writeBatch(database) {
  if (!USE_TURSO) return firestore.writeBatch(database);
  const writes = [];
  const batch = {
    set(ref, data, options = {}) {
      writes.push({ type: 'set', collection: ref.collectionPath, id: ref.id, data: serializeWrite(data || {}), merge: options?.merge === true });
      return batch;
    },
    update(ref, data) {
      writes.push({ type: 'update', collection: ref.collectionPath, id: ref.id, data: serializeWrite(data || {}) });
      return batch;
    },
    delete(ref) {
      writes.push({ type: 'delete', collection: ref.collectionPath, id: ref.id });
      return batch;
    },
    async commit() {
      await api({ action: 'batch', writes });
      await notifyListeners();
    },
  };
  return batch;
}

export function onSnapshot(target, next, error) {
  if (!USE_TURSO) return firestore.onSnapshot(target, next, error);

  let stopped = false;
  let busy = false;
  let signature = null;

  const refresh = async (force = false) => {
    if (stopped || busy) return;
    busy = true;
    try {
      const snapshot = target.__portalDbKind === 'document' ? await getDoc(target) : await getDocs(target);
      const raw = target.__portalDbKind === 'document'
        ? JSON.stringify({ exists: snapshot.exists(), id: snapshot.id, data: snapshot.data() })
        : JSON.stringify(snapshot.docs.map((item) => ({ id: item.id, data: item.data() })));
      if (force || raw !== signature) {
        signature = raw;
        next(snapshot);
      }
    } catch (cause) {
      if (error) error(cause);
      else console.error(cause);
    } finally {
      busy = false;
    }
  };

  listeners.add(refresh);
  refresh(true);
  const timer = window.setInterval(() => refresh(false), POLL_MS);

  return () => {
    stopped = true;
    listeners.delete(refresh);
    window.clearInterval(timer);
  };
}

export const documentDbMode = USE_TURSO ? 'turso' : 'firestore';
