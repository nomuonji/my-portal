'use strict';
const { useTurso }=require('../functions/documentDb');
const store=require('../functions/consumerModelStore');
if(!useTurso()||process.env.CONTEXT!=='production')throw new Error('Snapshot migration requires production My Portal Turso');
(async()=>{
 const result=await store.importSnapshot({confirm:true});
 await store.recordLegacyWaiver();
 const flappe=await store.registerFlappe();
 console.log('[consumer-models] verified import',JSON.stringify({counts:result.counts,flappe:{id:flappe.id,version:flappe.version}}));
})().catch(error=>{console.error('[consumer-models] import failed:',error.message);process.exitCode=1;});
