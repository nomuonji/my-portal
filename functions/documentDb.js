const { randomBytes } = require('node:crypto');
const firebaseFirestore = require('firebase-admin/firestore');

const FIRESTORE_BACKEND = 'firestore';
const TURSO_BACKEND = 'turso';
const TABLE = 'portal_documents';

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const value = globalThis?.Netlify?.env?.get?.(name);
    return value ? String(value) : undefined;
  } catch {
    return undefined;
  }
}

function backend() {
  return String(env('PORTAL_DB_BACKEND') || FIRESTORE_BACKEND).trim().toLowerCase();
}

function useTurso() {
  return backend() === TURSO_BACKEND;
}

class TursoTimestamp {
  constructor(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error('Invalid timestamp');
    this.date = date;
  }
  toDate() { return new Date(this.date.getTime()); }
  toMillis() { return this.date.getTime(); }
  toJSON() { return this.date.toISOString(); }
  valueOf() { return this.date.getTime(); }
  static fromDate(value) { return new TursoTimestamp(value); }
}

class TursoFieldPath {
  constructor(kind) { this.kind = kind; }
  static documentId() { return new TursoFieldPath('documentId'); }
}

class TursoFieldValue {
  constructor(kind, value) {
    this.__portalFieldValue = true;
    this.kind = kind;
    this.value = value;
  }
  static serverTimestamp() { return new TursoFieldValue('serverTimestamp'); }
  static increment(value) { return new TursoFieldValue('increment', Number(value) || 0); }
  static arrayUnion() { return new TursoFieldValue('arrayUnion', Array.from(arguments)); }
  static arrayRemove() { return new TursoFieldValue('arrayRemove', Array.from(arguments)); }
  static delete() { return new TursoFieldValue('delete'); }
}

const FieldValue = {
  serverTimestamp: function () {
    return useTurso() ? TursoFieldValue.serverTimestamp() : firebaseFirestore.FieldValue.serverTimestamp();
  },
  increment: function (value) {
    return useTurso() ? TursoFieldValue.increment(value) : firebaseFirestore.FieldValue.increment(value);
  },
  arrayUnion: function () {
    return useTurso()
      ? TursoFieldValue.arrayUnion.apply(null, arguments)
      : firebaseFirestore.FieldValue.arrayUnion.apply(firebaseFirestore.FieldValue, arguments);
  },
  arrayRemove: function () {
    return useTurso()
      ? TursoFieldValue.arrayRemove.apply(null, arguments)
      : firebaseFirestore.FieldValue.arrayRemove.apply(firebaseFirestore.FieldValue, arguments);
  },
  delete: function () {
    return useTurso() ? TursoFieldValue.delete() : firebaseFirestore.FieldValue.delete();
  },
};

const FieldPath = {
  documentId: function () {
    return useTurso() ? TursoFieldPath.documentId() : firebaseFirestore.FieldPath.documentId();
  },
};

const Timestamp = {
  fromDate: function (value) {
    return useTurso() ? TursoTimestamp.fromDate(value) : firebaseFirestore.Timestamp.fromDate(value);
  },
};

function randomId() {
  return randomBytes(18).toString('base64url').replace(/[_-]/g, '').slice(0, 20);
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && !(value instanceof Date) && !(value instanceof TursoTimestamp);
}

const DELETE = Symbol('delete');

function storeValue(value, previous, now) {
  if (value && value.__portalFieldValue === true) {
    if (value.kind === 'serverTimestamp') return now;
    if (value.kind === 'increment') return (Number(previous) || 0) + value.value;
    if (value.kind === 'delete') return DELETE;
    if (value.kind === 'arrayUnion') {
      const next = Array.isArray(previous) ? previous.slice() : [];
      (value.value || []).forEach(function (item) {
        const normalized = storeValue(item, undefined, now);
        const encoded = JSON.stringify(normalized);
        if (!next.some(function (current) { return JSON.stringify(current) === encoded; })) next.push(normalized);
      });
      return next;
    }
    if (value.kind === 'arrayRemove') {
      const remove = (value.value || []).map(function (item) {
        return JSON.stringify(storeValue(item, undefined, now));
      });
      return (Array.isArray(previous) ? previous : []).filter(function (item) {
        return !remove.includes(JSON.stringify(item));
      });
    }
  }
  if (value instanceof TursoTimestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map(function (item, index) {
      return storeValue(item, Array.isArray(previous) ? previous[index] : undefined, now);
    });
  }
  if (isObject(value)) {
    const out = {};
    Object.entries(value).forEach(function (entry) {
      const normalized = storeValue(entry[1], previous && previous[entry[0]], now);
      if (normalized !== DELETE) out[entry[0]] = normalized;
    });
    return out;
  }
  return value;
}

function mergeValue(base, patch, now) {
  const out = isObject(base) ? JSON.parse(JSON.stringify(base)) : {};
  Object.entries(patch || {}).forEach(function (entry) {
    const key = entry[0];
    const value = entry[1];
    if (isObject(value) && isObject(out[key]) && value.__portalFieldValue !== true) {
      out[key] = mergeValue(out[key], value, now);
      return;
    }
    const normalized = storeValue(value, out[key], now);
    if (normalized === DELETE) delete out[key];
    else out[key] = normalized;
  });
  return out;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function hydrate(value) {
  if (typeof value === 'string' && ISO_DATE.test(value)) return new TursoTimestamp(value);
  if (Array.isArray(value)) return value.map(hydrate);
  if (isObject(value)) {
    const out = {};
    Object.entries(value).forEach(function (entry) { out[entry[0]] = hydrate(entry[1]); });
    return out;
  }
  return value;
}

function readField(data, field) {
  const parts = String(field).split('.').filter(Boolean);
  let current = data;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function pathFor(field) {
  return '$.' + String(field).split('.').map(function (part) {
    return '"' + String(part).replaceAll('"', '\\"') + '"';
  }).join('.');
}

function sqlValue(value) {
  if (value instanceof TursoTimestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === undefined) return null;
  return value;
}

let conn;
let schemaReady;

function connection() {
  if (!conn) {
    const { connect } = require('@tursodatabase/serverless');
    const url = env('TURSO_DATABASE_URL');
    const authToken = env('TURSO_AUTH_TOKEN') || env('TURSO_DATABASE_AUTH_TOKEN');
    if (!url) throw new Error('TURSO_DATABASE_URL is required when PORTAL_DB_BACKEND=turso');
    if (!authToken) throw new Error('TURSO_AUTH_TOKEN is required when PORTAL_DB_BACKEND=turso');
    conn = connect({ url: url, authToken: authToken });
  }
  return conn;
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = connection().batch([
      'CREATE TABLE IF NOT EXISTS ' + TABLE + ' (collection_path TEXT NOT NULL, document_id TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (collection_path, document_id))',
      'CREATE INDEX IF NOT EXISTS idx_portal_documents_collection_updated ON ' + TABLE + '(collection_path, updated_at DESC)',
    ]).catch(function (error) {
      schemaReady = undefined;
      throw error;
    });
  }
  await schemaReady;
}

class DocumentSnapshot {
  constructor(ref, raw) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = raw !== null && raw !== undefined;
    this.raw = raw;
  }
  data() { return this.exists ? hydrate(JSON.parse(JSON.stringify(this.raw))) : undefined; }
  get(field) {
    if (!this.exists) return undefined;
    if (field instanceof TursoFieldPath && field.kind === 'documentId') return this.id;
    return hydrate(readField(this.raw, field));
  }
}

class QuerySnapshot {
  constructor(docs) {
    this.docs = docs;
    this.size = docs.length;
    this.empty = docs.length === 0;
  }
  forEach(callback) { this.docs.forEach(callback); }
}

class DocumentRef {
  constructor(database, collectionPath, id) {
    this.database = database;
    this.collectionPath = collectionPath;
    this.id = id;
    this.path = collectionPath + '/' + id;
  }
  collection(name) { return this.database.collection(this.path + '/' + name); }
  get() { return this.database.getDoc(this); }
  set(data, options) { return this.database.setDoc(this, data, options); }
  update(data) { return this.database.updateDoc(this, data); }
  delete() { return this.database.deleteDoc(this); }
}

class Query {
  constructor(database, collectionPath, state) {
    const current = state || {};
    this.database = database;
    this.collectionPath = collectionPath;
    this.filters = current.filters || [];
    this.orders = current.orders || [];
    this.max = current.max || null;
    this.cursor = current.cursor || null;
  }
  copy(next) {
    return new Query(this.database, this.collectionPath, {
      filters: next.filters === undefined ? this.filters : next.filters,
      orders: next.orders === undefined ? this.orders : next.orders,
      max: next.max === undefined ? this.max : next.max,
      cursor: next.cursor === undefined ? this.cursor : next.cursor,
    });
  }
  where(field, op, value) {
    return this.copy({ filters: this.filters.concat([{ field: field, op: op, value: value }]) });
  }
  orderBy(field, direction) {
    return this.copy({ orders: this.orders.concat([{
      field: field,
      direction: String(direction || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc',
    }]) });
  }
  limit(value) { return this.copy({ max: Math.max(0, Number(value) || 0) }); }
  startAfter() { return this.copy({ cursor: Array.from(arguments) }); }
  count() {
    const query = this;
    return { get: async function () { return { data: function () { return { count: query.database.count(query) }; } }; } };
  }
  get() { return this.database.runQuery(this); }
}

class CollectionRef extends Query {
  constructor(database, path) {
    super(database, path);
    this.path = path;
    this.id = path.split('/').at(-1);
  }
  doc(id) { return new DocumentRef(this.database, this.collectionPath, id || randomId()); }
}

class WriteBatch {
  constructor(database) {
    this.database = database;
    this.operations = [];
  }
  set(ref, data, options) { this.operations.push({ type: 'set', ref: ref, data: data, options: options }); return this; }
  update(ref, data) { this.operations.push({ type: 'update', ref: ref, data: data }); return this; }
  delete(ref) { this.operations.push({ type: 'delete', ref: ref }); return this; }
  commit() { return this.database.commit(this.operations); }
}

class TursoFirestore {
  collection(path) { return new CollectionRef(this, String(path).replace(/^\/+|\/+$/g, '')); }
  batch() { return new WriteBatch(this); }
  getAll() {
    const refs = Array.from(arguments);
    return Promise.all(refs.map((ref) => this.getDoc(ref)));
  }

  async getDoc(ref, executor) {
    await ensureSchema();
    const db = executor || connection();
    const row = await db.get(
      'SELECT data_json FROM ' + TABLE + ' WHERE collection_path = ? AND document_id = ?',
      ref.collectionPath,
      ref.id,
    );
    return new DocumentSnapshot(ref, row ? JSON.parse(String(row.data_json)) : null);
  }

  async setDoc(ref, data, options, executor) {
    await ensureSchema();
    const db = executor || connection();
    const now = new Date().toISOString();
    let next;
    if (options && options.merge === true) {
      const existing = await this.getDoc(ref, db);
      next = mergeValue(existing.exists ? existing.raw : {}, data || {}, now);
    } else {
      next = storeValue(data || {}, undefined, now);
    }
    await db.run(
      'INSERT INTO ' + TABLE + ' (collection_path, document_id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?) '
        + 'ON CONFLICT(collection_path, document_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at',
      ref.collectionPath,
      ref.id,
      JSON.stringify(next),
      now,
      now,
    );
  }

  async updateDoc(ref, data, executor) {
    const existing = await this.getDoc(ref, executor);
    if (!existing.exists) throw new Error('Document does not exist: ' + ref.path);
    return this.setDoc(ref, data, { merge: true }, executor);
  }

  async deleteDoc(ref, executor) {
    await ensureSchema();
    const db = executor || connection();
    await db.run(
      'DELETE FROM ' + TABLE + ' WHERE collection_path = ? AND document_id = ?',
      ref.collectionPath,
      ref.id,
    );
  }

  fieldSql(field) {
    if (field instanceof TursoFieldPath && field.kind === 'documentId') return { sql: 'document_id', args: [] };
    return { sql: 'json_extract(data_json, ?)', args: [pathFor(field)] };
  }

  queryParts(query, includeOrder) {
    const where = ['collection_path = ?'];
    const args = [query.collectionPath];

    query.filters.forEach((filter) => {
      const field = this.fieldSql(filter.field);
      if (filter.op === '==') {
        where.push(field.sql + ' = ?');
        args.push.apply(args, field.args.concat([sqlValue(filter.value)]));
        return;
      }
      if (filter.op === 'in') {
        const values = Array.isArray(filter.value) ? filter.value : [];
        if (!values.length) {
          where.push('0 = 1');
          return;
        }
        where.push(field.sql + ' IN (' + values.map(function () { return '?'; }).join(',') + ')');
        args.push.apply(args, field.args.concat(values.map(sqlValue)));
        return;
      }
      if (['>', '>=', '<', '<='].includes(filter.op)) {
        where.push(field.sql + ' ' + filter.op + ' ?');
        args.push.apply(args, field.args.concat([sqlValue(filter.value)]));
        return;
      }
      throw new Error('Unsupported Turso query operator: ' + filter.op);
    });

    if (query.cursor && query.cursor.length) {
      if (!query.orders.length) throw new Error('startAfter requires orderBy on Turso');
      const variants = [];
      const cursorArgs = [];
      const count = Math.min(query.orders.length, query.cursor.length);
      for (let i = 0; i < count; i += 1) {
        const terms = [];
        for (let j = 0; j < i; j += 1) {
          const equalField = this.fieldSql(query.orders[j].field);
          terms.push(equalField.sql + ' = ?');
          cursorArgs.push.apply(cursorArgs, equalField.args.concat([sqlValue(query.cursor[j])]));
        }
        const order = query.orders[i];
        const cursorField = this.fieldSql(order.field);
        terms.push(cursorField.sql + (order.direction === 'desc' ? ' < ?' : ' > ?'));
        cursorArgs.push.apply(cursorArgs, cursorField.args.concat([sqlValue(query.cursor[i])]));
        variants.push('(' + terms.join(' AND ') + ')');
      }
      where.push('(' + variants.join(' OR ') + ')');
      args.push.apply(args, cursorArgs);
    }

    const order = [];
    const orderArgs = [];
    if (includeOrder) {
      query.orders.forEach((item) => {
        const field = this.fieldSql(item.field);
        order.push(field.sql + ' ' + item.direction.toUpperCase());
        orderArgs.push.apply(orderArgs, field.args);
      });
    }
    return {
      where: where.join(' AND '),
      args: args,
      order: order.length ? ' ORDER BY ' + order.join(', ') : '',
      orderArgs: orderArgs,
    };
  }

  async runQuery(query) {
    await ensureSchema();
    const parts = this.queryParts(query, true);
    const limit = query.max ? ' LIMIT ' + Math.floor(query.max) : '';
    const rows = await connection().all(
      'SELECT document_id, data_json FROM ' + TABLE + ' WHERE ' + parts.where + parts.order + limit,
      ...parts.args,
      ...parts.orderArgs,
    );
    return new QuerySnapshot(rows.map((row) => {
      return new DocumentSnapshot(
        new DocumentRef(this, query.collectionPath, String(row.document_id)),
        JSON.parse(String(row.data_json)),
      );
    }));
  }

  async count(query) {
    await ensureSchema();
    const parts = this.queryParts(query, false);
    const row = await connection().get(
      'SELECT COUNT(*) AS count FROM ' + TABLE + ' WHERE ' + parts.where,
      ...parts.args,
    );
    return Number(row?.count || 0);
  }

  async apply(operation, executor) {
    if (operation.type === 'set') return this.setDoc(operation.ref, operation.data, operation.options, executor);
    if (operation.type === 'update') return this.updateDoc(operation.ref, operation.data, executor);
    if (operation.type === 'delete') return this.deleteDoc(operation.ref, executor);
    throw new Error('Unknown write operation: ' + operation.type);
  }

  async commit(operations) {
    await ensureSchema();
    const transaction = connection().transactionAsync(async (tx) => {
      for (const operation of operations) await this.apply(operation, tx);
      return [];
    });
    return transaction.immediate();
  }

  async runTransaction(callback) {
    await ensureSchema();
    const database = this;
    const transaction = connection().transactionAsync(async (sqlTx) => {
      const writes = [];
      const tx = {
        get: function (ref) { return database.getDoc(ref, sqlTx); },
        set: function (ref, data, options) { writes.push({ type: 'set', ref: ref, data: data, options: options }); return tx; },
        update: function (ref, data) { writes.push({ type: 'update', ref: ref, data: data }); return tx; },
        delete: function (ref) { writes.push({ type: 'delete', ref: ref }); return tx; },
      };
      const result = await callback(tx);
      for (const write of writes) await database.apply(write, sqlTx);
      return result;
    });
    return transaction.immediate();
  }

  async healthCheck() {
    await ensureSchema();
    const row = await connection().get('SELECT COUNT(*) AS count FROM ' + TABLE);
    return { ok: true, backend: TURSO_BACKEND, documents: Number(row?.count || 0) };
  }
}

let tursoDb;

function getDocumentDb(databaseId) {
  const id = databaseId || '(default)';
  if (useTurso()) {
    if (!tursoDb) tursoDb = new TursoFirestore();
    return tursoDb;
  }
  return id === '(default)' ? firebaseFirestore.getFirestore() : firebaseFirestore.getFirestore(id);
}

async function healthCheck(databaseId) {
  if (useTurso()) return getDocumentDb(databaseId).healthCheck();
  const started = Date.now();
  await getDocumentDb(databaseId).collection('__healthcheck__').limit(1).get();
  return { ok: true, backend: FIRESTORE_BACKEND, latencyMs: Date.now() - started };
}

module.exports = {
  FIRESTORE_BACKEND,
  TURSO_BACKEND,
  backend,
  useTurso,
  getDocumentDb,
  healthCheck,
  FieldValue,
  FieldPath,
  Timestamp,
  TursoTimestamp,
};
