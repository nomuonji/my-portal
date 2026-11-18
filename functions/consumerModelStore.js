'use strict';

const { createHash } = require('node:crypto');
const { getDocumentDb } = require('./documentDb');

const ROOT = 'consumerModels';
const ALIASES = 'consumerModelAliases';
const SEED_FILES = 'consumerModelSeedFiles';
const MIGRATIONS = 'consumerModelMigrations';
const MIGRATION_ID = 'keywords-2026-11-18';
const SPACE_ID = 'WQIGmoPmxfrASsyqes9D';
const SNAPSHOT_TAG = 'consumer-model-migration-20261118';
const SLUG = /^[a-z0-9][a-z0-9-]{1,63}$/;
const VERSION = /^[0-9]+(?:\.[0-9]+){0,2}$/;
const SOURCE_PARTS = Object.freeze({
  'daishu-consumer': ['gWMl1BlbfAweBdzoLg0Y','pSVWqfrqCr3zHJRAXb6f'],
  'ero-consumer': ['7SJMrS65tWMMjJjzThTs'],
  'gomi-consumer': ['U2BgMshdG3Xb5Z9L2otI','ldGKnltEtQn2xUYcSyJe','Iz3mc24BhpKwTT7ktGZv','F3Nrh7yGSNhgJK5DSIUZ','fs8KI2P5WpAmWfSjbrTJ'],
  'otaku-consumer': ['uGW3tE8uFRkRCWaLIJa3'],
  'reply-crowd-consumer': ['Ro4Ny9vW3TXjI4GGLLzl'],
});
const FILE_PARTS = Object.freeze({
  'ero-observe-2026q4.json': ['tS1qDqbZUdBCVz6qXq9g',4],
  'intuition-70.json': ['kDUNOUs8lZd1wVvhPRGK',70],
  'observed-trend-s1.json': ['UxZa3IoBSfEjfRnmvrq3',143],
  'observed-trend-s2-s11.json': ['JQDZxQKfM87CwybrWJEB',177],
  'otaku-observe-2026q4.json': ['iaZobQxBWWjbpHmImhSO',16],
  'reply-crowd-life-2026q4.json': ['H6gfr5EbuD1ZWeDzaR1k',16],
});
const EXPECTED_VERSIONS = Object.freeze({
  'daishu-consumer': 7, 'ero-consumer': 3,'gomi-consumer': 12,'otaku-consumer': 4,'reply-crowd-consumer': 2,
});

const db = () => getDocumentDb('(default)');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    if (typeof value.toDate === 'function') return value.toDate().toISOString();
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}
const encode = value => JSON.stringify(canonical(value));
const digest = value => createHash('sha256').update(encode(value)).digest('hex');
function assertId(id) {
  if (typeof id !== 'string' || !SLUG.test(id)) throw new Error('Invalid consumer model ID');
  return id;
}
function safeRef(database, path) {
  const p=path.split('/');
  if (p.length===2 && (p[0]===ROOT || p[0]===ALIASES) && SLUG.test(p[1])) return database.collection(p[0]).doc(p[1]);
  if (p.length===4 && p[0]===ROOT && SLUG.test(p[1]) && p[2]==='versions' && VERSION.test(p[3])) return database.collection(ROOT).doc(p[1]).collection('versions').doc(p[3]);
  if (p.length===2 && p[0]===SEED_FILES && Object.hasOwn(FILE_PARTS,p[1])) return database.collection(SEED_FILES).doc(p[1]);
  throw new Error('Unexpected migration document path: '+path);
}
function readArchive(snapshot, id, key) {
  if (!snapshot.exists) throw new Error('Missing archive '+id);
  const data=snapshot.data(), a=data.attributes||{};
  if (data.type!=='consumer-model-migration-snapshot'||data.spaceId!==SPACE_ID||data.status!=='archived'||!(data.tags||[]).includes(SNAPSHOT_TAG)||a.migrationKey!==key) throw new Error('Unexpected archive '+id);
  if (!Array.isArray(a.payloadChunks)||!a.payloadChunks.length||a.payloadChunks.some(s=>typeof s!=='string')) throw new Error('Invalid archive chunks '+id);
  return {a, raw:a.payloadChunks.join('')};
}
function validateRecords(records) {
  const paths = new Set();
  const current = new Map(), versions = new Map(), aliases = new Map();
  for (const record of records) {
    if (!record || typeof record.path!=='string'||!record.data||typeof record.data!=='object'||Array.isArray(record.data)||paths.has(record.path)) throw new Error('Invalid or duplicate snapshot document');
    paths.add(record.path);
    const p=record.path.split('/');
    if (p.length===2&&p[0]===ROOT&&Object.hasOwn(EXPECTED_VERSIONS,p[1])) {
      if (record.id!==p[1]||record.data.id!==p[1]) throw new Error('Current model ID mismatch');
      current.set(p[1],record.data);
    } else if (p.length===4&&p[0]===ROOT&&p[2]==='versions'&&Object.hasOwn(EXPECTED_VERSIONS,p[1])&&VERSION.test(p[3])) {
      if(record.id!==p[3]||record.data.id!==p[1]||record.data.version!==p[3]) throw new Error('History ID mismatch');
      const v=versions.get(p[1])||new Set();v.add(p[3]);versions.set(p[1],v);
    } else if(p.length===2&&p[0]===ALIASES&&SLUG.test(p[1])&&Object.hasOwn(EXPECTED_VERSIONS,record.data.modelId)){
      if(record.id!==p[1]||record.data.alias!==p[1])throw new Error('Alias ID mismatch');
      aliases.set(p[1],record.data.modelId);
    } else throw new Error('Unexpected source path '+record.path);
  }
  if(records.length!==44||current.size!==5||aliases.size!==11)throw new Error('Source inventory incomplete');
  for(const [id,count] of Object.entries(EXPECTED_VERSIONS)){
    const model=current.get(id), v=versions.get(id);
    if(!model||!v||v.size!==count||!v.has(model.version))throw new Error('Missing versions for '+id);
    const expectedAliases=new Set(model.aliases||[]);
    const actual=[...aliases].filter(([,owner])=>owner===id).map(([a])=>a);
    if(actual.length!==expectedAliases.size||actual.some(a=>!expectedAliases.has(a)))throw new Error('Alias mismatch for '+id);
  }
  return {models:current.size,versions:28,aliases:aliases.size};
}
async function loadSnapshot(database) {
  const ids = [...Object.values(SOURCE_PARTS).flat(), ...Object.values(FILE_PARTS).map(([id])=>id)];
  const snaps=await database.getAll(...ids.map(id=>database.collection('ideas').doc(id)));
  const byId=new Map(snaps.map(s=>[s.id,s]));
  const records=[], seedFiles=[];
  for(const [modelId,parts] of Object.entries(SOURCE_PARTS)){
    for(let i=0;i<parts.length;i++){
      const id=parts[i],{a,raw}=readArchive(byId.get(id),id,modelId+':'+(i+1));
      const docs=JSON.parse(raw);
      if(a.sourceDatabase!=='keywords'||a.modelId!==modelId||a.part!==i+1||a.parts!==parts.length||!Array.isArray(docs)||docs.length!==a.documentCount)throw new Error('Incomplete archive '+id);
      for(const row of docs){
        if(row.path.startsWith(ALIASES+'/')?row.data?.modelId!==modelId:!(row.path===ROOT+'/'+modelId||row.path.startsWith(ROOT+'/'+modelId+'/versions/')))throw new Error('Mismatched snapshot group');
        records.push(row);
      }
    }
  }
  const counts=validateRecords(records);
  for(const [name,[id,c]] of Object.entries(FILE_PARTS)){
    const {a,raw}=readArchive(byId.get(id),id,'seed-file:'+name);
    const parsed=JSON.parse(raw);
    const actualGitSha=createHash('sha1').update('blob '+Buffer.byteLength(raw)+'\0').update(raw).digest('hex');
    if(a.sourcePath!=='consumer-models/seed-pools/'+name||a.sourceSha!==actualGitSha||!Array.isArray(parsed.items)||parsed.items.length!==c||a.itemCount!==c||a.poolId!==parsed.poolId)throw new Error('Seed file mismatch '+name);
    seedFiles.push({path:SEED_FILES+'/'+name,data:{fileName:name,sourcePath:a.sourcePath,sourceSha:a.sourceSha,poolId:parsed.poolId,itemCount:c,rawJson:raw,sourceKind:'repository_seed_file',liveSqliteVerified:false}});
  }
  return {records,seedFiles,counts:{...counts,seedFiles:seedFiles.length,repositorySeedItems:seedFiles.reduce((sum,row)=>sum+row.data.itemCount,0)}};
}
async function copyExactly(database, rows) {
  // Reject conflicts before writing anything. Re-check each chunk under transaction;
  // interrupted imports are resumable, and a conflicting destination is never overwritten.
  const refs=rows.map(row=>safeRef(database,row.path));
  const existing=await database.getAll(...refs);
  for(let i=0;i<rows.length;i++)if(existing[i].exists&&encode(existing[i].data())!==encode(rows[i].data))throw new Error('Migration conflict: '+rows[i].path);
  for(let offset=0;offset<rows.length;offset+=8){
    const end=Math.min(offset+8,rows.length);
    await database.runTransaction(async tx=>{
      const before=[];
      for(let i=offset;i<end;i++)before.push(await tx.get(refs[i]));
      for(let i=offset;i<end;i++){
        const snap=before[i-offset];
        if(snap.exists){
          if(encode(snap.data())!==encode(rows[i].data))throw new Error('Migration conflict: '+rows[i].path);
        }else tx.set(refs[i],rows[i].data);
      }
    });
  }
  const after=await database.getAll(...refs);
  for(let i=0;i<rows.length;i++)if(!after[i].exists||encode(after[i].data())!==encode(rows[i].data))throw new Error('Readback mismatch: '+rows[i].path);
}
async function importSnapshot(input={},database=db()) {
  if(input.confirm!==true)throw new Error('Explicit migration confirmation required');
  const marker=database.collection(MIGRATIONS).doc(MIGRATION_ID);
  const existing=await marker.get();
  if(existing.exists){
    const data=existing.data();
    if(data.firestoreSnapshotVerified===true)return data;
    throw new Error('Unexpected incomplete migration marker');
  }
  const snapshot=await loadSnapshot(database);
  const rows=[...snapshot.records,...snapshot.seedFiles];
  await copyExactly(database,rows);
  const result={
    id:MIGRATION_ID,firestoreSnapshotVerified:true,counts:snapshot.counts,
    liveSqliteVerified:false,keywordsCutoverVerified:false,sourceRetired:false,
    source:'Keywords live Firestore, immutable snapshot staged 2026-11-18; repository seed files separately',
    importedAt:new Date().toISOString(),
    sourceManifest:snapshot.records.map(row=>({path:row.path,sha256:digest(row.data),sourceCreateTime:row.createTime||null,sourceUpdateTime:row.updateTime||null})),
    seedFileManifest:snapshot.seedFiles.map(row=>({path:row.path,sourceSha:row.data.sourceSha,itemCount:row.data.itemCount})),
  };
  await marker.set(result);
  const readback=await marker.get();
  if(!readback.exists||encode(readback.data())!==encode(result))throw new Error('Migration marker readback mismatch');
  return result;
}
async function migrationStatus(_input={},database=db()){
  const s=await database.collection(MIGRATIONS).doc(MIGRATION_ID).get();
  return s.exists?s.data():{id:MIGRATION_ID,firestoreSnapshotVerified:false,liveSqliteVerified:false,keywordsCutoverVerified:false,sourceRetired:false};
}
function summary(model){
  return {id:model.id,name:model.name,version:model.version,status:model.status,summary:model.summary,revision:model.revision,updatedAt:model.updatedAt,keywordCount:(model.searchEvidence||[]).length,personaCount:(model.personas||[]).length,voiceCount:(model.voices||[]).length};
}
async function list(input={},database=db()){
  const s=await database.collection(ROOT).get();
  const query=String(input.query||'').toLowerCase().trim();
  const models=s.docs.map(d=>summary({...d.data(),id:d.id})).filter(m=>!input.status||m.status===input.status).filter(m=>!query||(m.id+' '+m.name+' '+m.summary).toLowerCase().includes(query)).sort((a,b)=>a.name.localeCompare(b.name));
  return {items:models.slice(0,Math.max(1,Math.min(Number(input.limit)||100,200))),count:models.length,migration:await migrationStatus({},database)};
}
async function get(input={},database=db()){
  let id=assertId(input.id), ref=database.collection(ROOT).doc(id), current=await ref.get();
  if(!current.exists){
    const alias=await database.collection(ALIASES).doc(id).get();
    if(!alias.exists)throw new Error('Consumer model not found');
    id=assertId(alias.data().modelId);ref=database.collection(ROOT).doc(id);current=await ref.get();
  }
  if(!current.exists)throw new Error('Consumer model not found');
  const versions=await ref.collection('versions').get();
  let model=current.data();
  if(input.version){
    if(!VERSION.test(input.version))throw new Error('Invalid model version');
    const frozen=versions.docs.find(d=>d.id===input.version);
    if(!frozen)throw new Error('Version not found');
    model=frozen.data();
  }
  return {model,versions:versions.docs.map(d=>({version:d.id,revision:d.data().revision,frozenAt:d.data().frozenAt,changeReason:d.data().changeReason})).sort((a,b)=>(b.revision||0)-(a.revision||0))};
}
async function seedFiles(_input={},database=db()){
  const s=await database.collection(SEED_FILES).get();
  return {files:s.docs.map(d=>{const {rawJson,...metadata}=d.data();return metadata;}),note:'Repository seed material only; local SQLite state not yet verified.'};
}
module.exports={list,get,seedFiles,migrationStatus,importSnapshot,validateRecords,copyExactly,encode,loadSnapshot};
