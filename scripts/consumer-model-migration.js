'use strict';
const { useTurso }=require('../functions/documentDb');
const store=require('../functions/consumerModelStore');
if(!useTurso()||process.env.CONTEXT!=='production')throw new Error('Snapshot migration requires the production My Portal Turso environment');
store.importSnapshot({confirm:true}).then(result=>{
 console.log('[consumer-models] verified snapshot import',JSON.stringify({id:result.id,counts:result.counts,liveSqliteVerified:result.liveSqliteVerified,keywordsCutoverVerified:result.keywordsCutoverVerified}));
}).catch(error=>{console.error('[consumer-models] import failed:',error.message);process.exitCode=1;});
