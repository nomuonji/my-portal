'use strict';

// Human verdicts and agent interpretations are separate. Keep originals as
// recorded, including whitespace, rhythm, and media refs, not only labels.
function artifact(t){
  return {id:t.id,label:t.label||'',body:t.body||'',ref:t.ref||'',imageUrl:t.imageUrl||'',mediaUrl:t.mediaUrl||'',
    sourceIds:t.sourceIds||[],hypothesisIds:t.hypothesisIds||[],methodVersion:t.methodVersion||null,
    version:t.version??null,verdict:t.verdict||null,userWords:t.userWords||'',ratedAt:t.ratedAt||''};
}
function sourceArtifact(s){
  return {id:s.id,label:s.title||'',body:s.originalProof?.excerpt||'',ref:s.originalProof?.originalUrl||s.locator||'',
    provenance:s.originalProof?.provenance||'source_ledger_reference',sourceRole:s.sourceRole||''};
}
function textField(v,key,max=900,min=20){
  if(typeof v!=='string'||v.trim().length<min||v.length>max)throw Error('textureReview.'+key+' requires specific '+min+'-'+max+' characters');
  return v.trim();
}
// Anchor an observed feature to actual artifact text, or an exact stored media
// reference. A timestamp/visual description remains an agent observation.
function validateTextureReview(raw,{trials=[],items=[]}={}){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('textureReview object required');
  const pool=new Map([...trials.filter(t=>t.status==='rated'&&['pass','partial','fail'].includes(t.verdict)).map(artifact),
    ...items.filter(s=>s.kind==='source'&&s.sourceRole==='observation'&&(s.originalProof||s.evidence?.length)).map(sourceArtifact)].map(x=>[x.id,x]));
  if(!Array.isArray(raw.cases)||raw.cases.length<2||raw.cases.length>4)throw Error('textureReview requires 2-4 distinct real case observations');
  const seen=new Set();
  const cases=raw.cases.map(c=>{
    const original=pool.get(c?.caseId);
    if(!original||seen.has(c.caseId))throw Error('textureReview requires distinct real rated trial or observed source IDs');
    seen.add(c.caseId);
    const anchor=textField(c.anchor,'anchor',1000,4);
    const media=Boolean(original.imageUrl||original.mediaUrl||original.ref);
    if(!(original.body&&original.body.includes(anchor))&&!(media&&[original.imageUrl,original.mediaUrl,original.ref].includes(anchor)))
      throw Error('textureReview anchor must quote exact original artifact text or its stored media/ref: '+c.caseId);
    return {caseId:c.caseId,anchor,observation:textField(c.observation,'observation'),
      context:textField(c.context,'context'),verdict:original.verdict||null,provenance:'agent_observation_not_user_reason'};
  });
  return {cases,distinction:textField(raw.distinction,'distinction',1200),
    transfer:textField(raw.transfer,'transfer',1200),boundary:textField(raw.boundary,'boundary',1200),
    uncertainty:textField(raw.uncertainty,'uncertainty',900,10)};
}
// Prefer explicit released rule evidence, then a relevant same-branch contrast
// and current/recent real human examples. Never imply recent cases are approved rules.
// Small lexical retrieval baseline; Japanese character bigrams preserve
// terminology without requiring a paid embedding service. Relevance is not quality.
function tokens(s){
 const clean=String(s||'').toLowerCase().normalize('NFKC');
 const words=clean.match(/[a-z0-9_]{2,}/g)||[];
 const japanese=clean.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]{2,}/gu)||[];
 for(const word of japanese)for(let i=0;i<word.length-1;i++)words.push(word.slice(i,i+2));
 return new Set(words);
}
function relevance(query,body){
 const a=tokens(query),b=tokens(body);
 if(!a.size)return 0;
 return [...a].filter(x=>b.has(x)).length/a.size;
}
function selectCasebook({base,items=[],trials=[],limit=4,topic='',hypothesisIds=[]}){
  const rated=trials.filter(t=>t.status==='rated'&&['pass','partial','fail'].includes(t.verdict)&&(t.body||t.imageUrl||t.mediaUrl||t.ref))
    .sort((a,b)=>String(b.ratedAt||b.createdAt||'').localeCompare(String(a.ratedAt||a.createdAt||'')));
  const rules=base.ruleInventory?.methodVersion===base.method?.version?base.ruleInventory.entries||[]:[];
  const linked=new Map();
  for(const r of rules)for(const id of [...(r.supportingTrialIds||[]),...(r.counterexampleTrialIds||[])]){
    if(!linked.has(id))linked.set(id,[]);
    linked.get(id).push(r.id);
  }
  const requested=new Set(Array.isArray(hypothesisIds)?hypothesisIds:[]);
  const itemById=new Map(items.map(h=>[h.id,h]));
  const score=t=>{
    const h=(t.hypothesisIds||[]).map(id=>itemById.get(id)).filter(Boolean);
    const refs=(t.sourceIds||[]).map(id=>itemById.get(id)).filter(Boolean);
    return 3*(t.hypothesisIds||[]).filter(id=>requested.has(id)).length+
      relevance(topic,[t.label,t.body,...h.flatMap(x=>[x.title,x.statement,x.textureReview?.distinction]),
        ...refs.flatMap(x=>[x.title,x.originalProof?.excerpt])].join(' '));
  };
  const relevant=Boolean(topic||requested.size);
  if(relevant)rated.sort((a,b)=>score(b)-score(a));
  const chosen=[];
  const add=t=>{if(t&&chosen.length<limit&&!chosen.includes(t))chosen.push(t);};
  const by=(pass)=>rated.filter(t=>(t.verdict==='pass')===pass);
  const sameBranch=(a,b)=>(a?.hypothesisIds||[]).some(h=>(b?.hypothesisIds||[]).includes(h));
  const first=(relevant?by(true).find(t=>score(t)>0):null)||by(true).find(t=>linked.has(t.id))||by(true).find(t=>t.methodVersion===base.method?.version)||by(true)[0];
  add(first);
  add((relevant?by(false).find(t=>score(t)>0&&sameBranch(first,t))||by(false).find(t=>score(t)>0):null)||by(false).find(t=>linked.has(t.id)&&sameBranch(first,t))||by(false).find(t=>sameBranch(first,t))||by(false).find(t=>linked.has(t.id))||by(false)[0]);
  for(const pass of [true,false])add((relevant?by(pass).find(t=>!chosen.includes(t)&&score(t)>0):null)||by(pass).find(t=>!chosen.includes(t)&&linked.has(t.id))||by(pass).find(t=>!chosen.includes(t)&&t.methodVersion===base.method?.version)||by(pass).find(t=>!chosen.includes(t)));
  const hids=new Set(chosen.flatMap(t=>t.hypothesisIds||[]));
  const hypotheses=items.filter(h=>h.kind==='hypothesis'&&hids.has(h.id)&&h.textureReview).slice(0,4)
    .map(h=>({id:h.id,statement:h.statement,textureReview:h.textureReview}));
  const sourceIds=new Set(chosen.flatMap(t=>t.sourceIds||[]));
  const sourcePool=items.filter(s=>s.kind==='source'&&s.sourceRole==='observation'&&(s.originalProof||s.fieldObservation));
  const sourceScore=s=> (sourceIds.has(s.id)?2:0)+relevance(topic,[s.title,s.coverage,s.originalProof?.excerpt,s.fieldObservation?.context].join(' '));
  const sources=sourcePool.filter(s=>sourceScore(s)>0).sort((a,b)=>sourceScore(b)-sourceScore(a)).slice(0,4)
    .map(s=>({...sourceArtifact(s),...(s.fieldObservation?{fieldObservation:s.fieldObservation}:{}),
      relevance:sourceScore(s)}));
  return {baseId:base.id,methodVersion:base.method?.version||null,releasedVersion:base.method?.bodyRef?.versionNumber??null,
    cases:chosen.map(t=>({...artifact(t),relevance:score(t),ruleIds:linked.get(t.id)||[],role:linked.has(t.id)?'release_linked_case':'observational_human_feedback'})),
    hypotheses,sources,retrieval:{mode:relevant?'task_conditioned_lexical_and_hypothesis':'released_rule_and_recent_contrast',topic:String(topic||'').slice(0,500),hypothesisIds:[...requested],warning:'Lexical relevance is advisory; inspect actual media, context and counterexamples. No matching case does not prove absence.'},coverage:{ratedWithArtifacts:rated.length,selected:chosen.length},
    instructions:'Read whole original cases, not just labels; inspect referenced visual/audio material where relevant. Compare positive and negative features (specific wording, rhythm, density, register, emotional temperature, visual texture or domain-specific subtle distinctions); human verdict does not identify its cause. Transfer the mechanism, not wording or surface style. Keep contextual exceptions and uncertainty. These are evidence, not new executable rules or permission to publish.'};
}
module.exports={artifact,sourceArtifact,validateTextureReview,selectCasebook,relevance};
