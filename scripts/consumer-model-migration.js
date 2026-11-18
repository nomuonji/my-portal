'use strict';
const { useTurso, getDocumentDb }=require('../functions/documentDb');
const store=require('../functions/consumerModelStore');
if(!useTurso()||process.env.CONTEXT!=='production')throw new Error('Snapshot migration requires production My Portal Turso');
(async()=>{
 const result=await store.importSnapshot({confirm:true});
 await store.recordLegacyWaiver();
 await store.registerFlappe();
 const database=getDocumentDb('(default)');
 const staged=await database.collection('ideas').doc('lx7F8Qqos2OEKRYDYdZM').get();
 const record=staged.data();
 if(!staged.exists||record.type!=='consumer-model-registration-staging'||record.attributes?.registrationKey!=='flappe-consumer-0.2-style-revision'||record.attributes.expectedRevision!==1)throw new Error('Invalid approved style revision staging');
 const model=JSON.parse(record.attributes.payloadJson);
 if(model.id!=='flappe-consumer'||model.version!=='0.2'||model.revision!==1)throw new Error('Unexpected style revision payload');
 const before=await store.get({id:model.id},database);
 if(!before.versions.some(v=>v.version==='0.2')){
   if(before.model.version!=='0.1'||before.model.revision!==1)throw new Error('Style revision conflict: current model changed');
   await store.save({confirm:true,model,expectedRevision:1,changeReason:'Owner requested preservation of concrete source article style; editorial revision only'},database);
 }
 const frozen=await store.get({id:model.id,version:'0.2'},database);
 for(const key of ['summary','definition','variables','searchEvidence','voices','researchProcedure','evidencePolicy']){
   if(store.encode(frozen.model[key])!==store.encode(model[key]))throw new Error('Style revision readback mismatch: '+key);
 }
 const flappe=(await store.get({id:model.id},database)).model;
 console.log('[consumer-models] verified import',JSON.stringify({counts:result.counts,flappe:{id:flappe.id,version:flappe.version}}));
})().catch(error=>{console.error('[consumer-models] import failed:',error.message);process.exitCode=1;});
