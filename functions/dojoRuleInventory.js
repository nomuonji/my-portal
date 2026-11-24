'use strict';

const {createHash}=require('node:crypto');
const digest=s=>createHash('sha256').update(s).digest('hex').slice(0,24);

// Lossless partition of the immutable executable Markdown. A block is an
// addressable unit, NOT a claim that its instructions are empirically proven.
function partition(body=''){
  const parts=[];
  let section='',buffer='',fence=null;
  function flush(){
    if(!buffer)return;
    parts.push({text:buffer,section,kind:!buffer.trim()?'layout':/^ {0,3}#{1,6}\s/.test(buffer)?'heading':'rule'});
    buffer='';
  }
  for(const line of body.match(/[^\n]*\n|[^\n]+$/g)||[]){
    const mark=line.match(/^ {0,3}(`{3,}|~{3,})/);
    if(fence){buffer+=line;if(mark&&mark[1][0]===fence[0]&&mark[1].length>=fence.length){fence=null;flush();}continue;}
    if(mark){flush();fence=mark[1];buffer=line;continue;}
    if(/^ {0,3}#{1,6}\s/.test(line)){flush();section=line.trim();buffer=line;flush();continue;}
    if(!line.trim()){flush();buffer=line;flush();continue;}
    if(/^ {0,3}(?:[-*+]\s|\d+[.)]\s)/.test(line))flush();
    buffer+=line;
  }
  flush();
  return parts;
}
function ruleBlocks(body){return partition(body).filter(x=>x.kind==='rule').map(x=>({...x,digest:digest(x.text)}));}
function findRule(blocks,anchor){
  if(!anchor)return null;
  const matches=blocks.filter(x=>x.text.includes(anchor));
  return matches.length===1?matches[0]:null;
}
function buildInventory({body='',version='',priorBody='',prior=null,priorVersion='',proposals=[]}={}){
  const before=ruleBlocks(priorBody),after=ruleBlocks(body);
  const metadata=prior?.methodVersion===priorVersion?prior.entries||[]:[];
  const old=before.map((b,i)=>({...b,...(metadata[i]?.digest===b.digest?metadata[i]:{
    id:'SR-'+digest(JSON.stringify([priorVersion,b.digest,i])),revision:1,firstVersion:priorVersion,proposalIds:[],hypothesisIds:[],supportingTrialIds:[],counterexampleTrialIds:[],moduleId:null
  })}));
  const entries=Array(after.length).fill(null),used=new Set(),changes=[];
  const count=(arr,key)=>arr.filter(x=>x.digest===key).length;
  function assign(i,previous,p,action){
    const b=after[i];
    if(entries[i]||previous&&used.has(previous.id))return false;
    if(previous)used.add(previous.id);
    const id=previous?.id||'SR-'+digest(JSON.stringify([version,b.digest,i]));
    const merge=(key)=>[...new Set([...(previous?.[key]||[]),...(p?.[key]||[])])].slice(-40);
    entries[i]={id,digest:b.digest,revision:(previous?.revision||0)+(previous?.digest===b.digest?0:1),
      firstVersion:previous?.firstVersion||version,lastChangedVersion:previous?.digest===b.digest?(previous.lastChangedVersion||priorVersion):version,
      moduleId:p?.moduleId||previous?.moduleId||null,
      proposalIds:[...new Set([...(previous?.proposalIds||[]),...(p?[p.id]:[])])].slice(-20),
      hypothesisIds:merge('hypothesisIds'),supportingTrialIds:merge('supportingTrialIds'),counterexampleTrialIds:merge('counterexampleTrialIds')};
    if(action)changes.push({id,action,proposalId:p?.id||null});
    return true;
  }
  for(const p of proposals){
    const prev=findRule(old,p.existingRuleAnchor);
    const next=findRule(after,p.replacementText);
    if(p.action==='replace'&&prev&&next)assign(after.indexOf(next),prev,p,'replace');
    if(p.action==='add'&&next)assign(after.indexOf(next),null,p,'add');
    if(p.action==='retire'&&prev&&!after.some(b=>b.digest===prev.digest)&&!used.has(prev.id)){
      used.add(prev.id);changes.push({id:prev.id,action:'retire',proposalId:p.id});
    }
  }
  after.forEach((b,i)=>{
    if(entries[i])return;
    // Duplicate blocks are intentionally ambiguous across edits; never
    // arbitrarily transfer evidence from one to another.
    if(count(old,b.digest)===1&&count(after,b.digest)===1){
      const prev=old.find(x=>x.digest===b.digest);
      if(prev&&assign(i,prev,null,null))return;
    }
    if(priorBody===body&&old[i]?.digest===b.digest&&assign(i,old[i],null,null))return;
    assign(i,null,null,'add');
  });
  old.filter(x=>!used.has(x.id)).forEach(x=>changes.push({id:x.id,action:'retire',proposalId:null}));
  return {schemaVersion:1,methodVersion:version,bodyDigest:digest(body),entries,changes};
}
function inventoryView(body,version,stored,full=false){
  const valid=stored?.methodVersion===version&&stored.bodyDigest===digest(body);
  const inventory=valid?stored:buildInventory({body,version});
  const blocks=ruleBlocks(body);
  return {status:valid?'versioned':'legacy_projection',methodVersion:version,bodyDigest:inventory.bodyDigest,
    count:blocks.length,changes:valid?inventory.changes:[],rules:blocks.map((b,i)=>({
      ...inventory.entries[i],section:b.section,...(full?{text:b.text}:{preview:b.text.trim().slice(0,180)})
    })),
    note:'Exact executable blocks; legacy projection is not independent validation. Unlinked edits have no inferred hypothesis evidence.'};
}

module.exports={partition,ruleBlocks,findRule,buildInventory,inventoryView};
