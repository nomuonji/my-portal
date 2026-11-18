'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {copyExactly}=require('../functions/consumerModelStore');
function memory(){
 const map=new Map();
 const snap=ref=>({exists:map.has(ref.path),data:()=>map.get(ref.path)});
 const coll=path=>({doc:id=>({path:path+'/'+id,collection:name=>coll(path+'/'+id+'/'+name)})});
 return {map,collection:coll,getAll:async(...refs)=>refs.map(snap),runTransaction:async f=>{const writes=[];await f({get:async ref=>snap(ref),set:(ref,data)=>writes.push([ref.path,data])});for(const [path,data] of writes)map.set(path,JSON.parse(JSON.stringify(data)));}};
}
test('migration preserves nested evidence and immutable version, retries safely, rejects conflicts before overwriting',async()=>{
 const d=memory();
 const rows=[{path:'consumerModels/example',data:{id:'example',searchEvidence:Array.from({length:138},(_,i)=>({keyword:'語'+i,volume:i===5?null:i}))}},{path:'consumerModels/example/versions/1.0',data:{id:'example',version:'1.0',frozenAt:'2026-11-02T00:00:00.000Z'}}];
 await copyExactly(d,rows);await copyExactly(d,rows);
 assert.deepEqual(d.map.get(rows[0].path),rows[0].data);
 assert.equal(d.map.size,2);
 await assert.rejects(copyExactly(d,[{path:rows[0].path,data:{id:'different'}}]),/conflict/);
 assert.deepEqual(d.map.get(rows[0].path),rows[0].data);
});
