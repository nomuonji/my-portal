#!/usr/bin/env node
'use strict';
// Production-only, one-shot semantic reclassification. No new method release.
// Existing approved version, human feedback, trial/hypothesis history and
// the monetization submarine's live gear stay intact.
const dojo=require('../functions/explorationBaseStore');
const targets=[
  ['monetization-ideation','monetization-intelligence',4,'monetization-pack-v5'],
  ['youtube-scriptwriting','youtube-view-growth-intelligence',6,'ytg-v6'],
  ['short-video-direction','video-production-intelligence',2,'vpi-v2'],
];
async function run(){
  for(const [baseId,packId,version,label] of targets){
    const before=await dojo.get({id:baseId,view:'state'});
    const ref=before.method?.bodyRef;
    if(ref?.location!==packId || Number(ref.versionNumber)!==version
      || before.method?.version!==label
      || !['intelligence_pack','skill_pack'].includes(ref.kind))
      throw Error('Unexpected source dojo version: '+baseId+'; refusing migration');
    const after=await dojo.migrateLegacyPackTarget({baseId,packId,confirm:true,actor:'production-classification-migration-2026-11-24'});
    const result=after.method?.bodyRef;
    if(result?.kind!=='skill_pack'||result.location!==packId
      ||Number(result.versionNumber)!==version||after.method?.version!==label)
      throw Error('Migration readback mismatch: '+baseId);
    console.log('[dojo-pack-migration] '+baseId+' '+packId+' v'+version+' classification verified');
  }
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1});
module.exports={run,targets};
