'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const docs = new Map();
let failCommit = false;
const ref = (collection,id) => ({id,path:collection+'/'+id,get:async()=>snapshot(collection+'/'+id),set:async data=>docs.set(collection+'/'+id,data)});
function snapshot(path){const value=docs.get(path);return {id:path.split('/').pop(),exists:value!==undefined,data:()=>value};}
const db = {
 collection:name=>({doc:id=>ref(name,id)}),
 runTransaction:async action=>{
   const writes=[];
   const result=await action({get:r=>r.get(),set:(r,v)=>writes.push(()=>docs.set(r.path,v)),delete:r=>writes.push(()=>docs.delete(r.path))});
   if(failCommit)throw Error('simulated commit failure');
   writes.forEach(w=>w());return result;
 }
};
const old=Module._load;
let store;
try {
 Module._load=function(name,parent,isMain){
   if(name==='./documentDb'&&parent.filename.endsWith('learningInboxStore.js'))return {getDocumentDb:()=>db,FieldValue:{serverTimestamp:()=>new Date()},FieldPath:{documentId:()=> '__name__'}};
   return old.call(this,name,parent,isMain);
 };
 store=require('../functions/learningInboxStore');
} finally {Module._load=old;}
test('submission-only key, input validation, lossless atomic receipt and retry',async()=>{
 assert.equal(await store.authorized('anything'),false);
 await assert.rejects(store.setKey({key:'weak'}));
 await store.setKey({key:'learn-test-only-012345'});
 assert.equal(await store.authorized('learn-test-only-012345'),true);
 assert.equal(await store.authorized('learn-test-only-012346'),false);
 const post={platform:'x',postId:'123',url:'https://x.com/example/status/123',text:'観測原典🙂'.repeat(1800),author:{handle:'@example'},media:[{type:'image',url:'https://pbs.twimg.com/media/example'}],quoted:{text:'quote'},truncated:true};
 assert.throws(()=>store.normalize({...post,url:'https://example.com/status/123'}));
 assert.throws(()=>store.normalize({...post,text:'x'.repeat(150000)}));
 const first=await store.enqueue(post);
 const again=await store.enqueue(post);
 assert.deepEqual(again,first);
 assert.equal(first.status,'pending');
 const path='learningInbox/'+first.id;
 failCommit=true;
 await assert.rejects(store.receive({id:first.id}),/simulated commit failure/);
 failCommit=false;
 assert.equal(docs.has(path),true);
 assert.equal(docs.has('learningMaterials/'+first.id),false);
 const received=await store.receive({id:first.id});
 assert.equal(received.status,'received');
 assert.equal(docs.has(path),false);
 assert.equal([...docs.keys()].some(k=>k.startsWith('contextEvents/')),false);
 assert.equal(docs.get('learningMaterials/'+first.id).space,'agent-memory');
 const saved=await store.getMaterial({id:first.id});
 assert.equal(saved.post.text,post.text);
 assert.deepEqual(saved.post.media,post.media);
 assert.deepEqual(saved.post.quoted,post.quoted);
 assert.equal(saved.learningStatus,'unverified');
 assert.deepEqual(await store.receive({id:first.id}),received);
 assert.equal((await store.enqueue(post)).status,'received');
 assert.equal(docs.has(path),false);
 const modified=await store.enqueue({...post,text:'new evidence'});
 assert.notEqual(modified.id,first.id);
 assert.equal(docs.has('learningInbox/'+modified.id),true);
});
