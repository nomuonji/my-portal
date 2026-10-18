'use strict';
const s=(description,maxLength=2000)=>({type:'string',description,maxLength});
const sourceRef={type:'object',additionalProperties:false,properties:{
 kind:{type:'string',enum:['user_message','user_post','discover_item','external_raw','bookmark','other']},
 id:s('Exact original record ID or chat event marker',170),url:s('Optional original HTTPS URL',1200),
 note:s('What was observed, without inventing source meaning',500)
},required:['kind']};
const record={type:'object',additionalProperties:false,properties:{
 title:s('Specific taste rule, verdict or hypothesis; no personality labels',180),
 detail:s('Actual explicit preference or cautious inference and its scope',2300),
 domain:{type:'string',enum:['discover','humor','writing','design','ideas','media','general']},
 evidenceKind:{type:'string',enum:['explicit_user','expression_inference','external_reference','watch_later'],
   description:'Never relabel watch-later as liked, a first-person creative post as explicit viewing preference, or a teacher example as own taste.'},
 direction:{type:'string',enum:['like','dislike','boundary','unknown'],
   description:'like/dislike/boundary only with explicit user message or liked/skipped Discover item; all inferred/reference/bookmark use unknown.'},
 confidence:{type:'number',minimum:0,maximum:1},status:{type:'string',enum:['active','superseded','archived']},
 caveat:s('What this judgment does NOT establish; exceptions and counterexamples',1200),
 origin:s('chat, Discover feedback, manual, observed source',100),
 topicKey:s('Optional normalized pattern identifier for future evidence comparison',140),
 target:{type:'object',additionalProperties:false,properties:{
  kind:{type:'string',enum:['item','creator','genre','pattern','format','editorial_policy','unspecified']},
  key:s('Stable source ID or pattern key if known; never invent an external ID',160),
  label:s('Concrete subject of the judgment',180)
 },required:['kind','label']},
 facets:{type:'array',maxItems:12,items:s('Concrete reason/feature tag, not a broad personality trait',64)},
 appliesTo:{type:'array',maxItems:7,items:{type:'string',enum:['discover','humor','writing','design','ideas','media','general']}},

 sourceRefs:{type:'array',maxItems:12,items:sourceRef}
},required:['title','detail','domain','evidenceKind','direction','sourceRefs']};
const TOOLS=[
 {name:'taste_external_sources_list',description:'Read user-imported Filmarks Clips and Booklog bookshelf snapshots. These are distinct from direct like/dislike verdicts. No third-party scraping.',inputSchema:{type:'object',additionalProperties:false,properties:{includeItems:{type:'boolean'}}},annotations:{readOnlyHint:true}},
 {name:'taste_evidence_list',description:'Canonical personal-taste evidence ledger. Always distinguish direct verdicts, X-expression hypotheses, Radichichi/Murakami references and watch-later. Use for Discover and other creative work.',inputSchema:{type:'object',additionalProperties:false,properties:{
  limit:{type:'integer',minimum:1,maximum:300},scanLimit:{type:'integer',minimum:1,maximum:450},
  includeInactive:{type:'boolean'},domain:{type:'string',enum:['discover','humor','writing','design','ideas','media','general']},
  evidenceKind:{type:'string',enum:['explicit_user','expression_inference','external_reference','watch_later']},
  direction:{type:'string',enum:['like','dislike','boundary','unknown']}
 }},annotations:{readOnlyHint:true}},
 {name:'taste_profile_get',description:'Aggregate evidence-backed reasons across direct evaluations; exposes conflicting and one-off signals. Inferred expression and saved items NEVER count as preference.',inputSchema:{type:'object',additionalProperties:false,properties:{
  domain:{type:'string',enum:['discover','humor','writing','design','ideas','media','general']}
 }},annotations:{readOnlyHint:true}},
 {name:'taste_evidence_get',description:'Read one preference evidence entry, including provenance, uncertainty and current revision.',inputSchema:{type:'object',additionalProperties:false,properties:{id:s('Exact taste evidence ID',120)},required:['id']},annotations:{readOnlyHint:true}},
 {name:'taste_evidence_upsert',description:'Record a genuine user judgment or cautious inferred/teacher/bookmark evidence; every revision is audited. Requires changeReason and expectedRevision for edits. Never convert inference into explicit user evidence without an actual direct utterance.',inputSchema:{type:'object',additionalProperties:false,properties:{
  id:s('Optional stable taste- ID for idempotent records',120),
  record,expectedRevision:{type:'integer',minimum:1},
  changeReason:s('Who made the correction and why; for audit',400)
 },required:['record','changeReason']},annotations:{readOnlyHint:false,destructiveHint:false}},
 {name:'taste_evidence_history',description:'Read the immutable edit/correction history for one taste evidence ID.',inputSchema:{type:'object',additionalProperties:false,properties:{id:s('Taste ID',120),limit:{type:'integer',minimum:1,maximum:80}},required:['id']},annotations:{readOnlyHint:true}}
];
module.exports={TOOLS};
