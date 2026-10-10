const string=(description,maxLength)=>({type:'string',description,maxLength});
const obj=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const skillFields={
 id:string('Stable skill slug',90),
 title:string('Skill display name',220),
 summary:string('ChatGPT skill objective',1100),
 triggers:{type:'array',items:{type:'string'},maxItems:25},
 body:string('Full executable chat Skill Markdown; canonical body is stored in My Portal DB.',45000),
 importProvenance:string('Optional one-time import provenance, not source of truth',350),
 status:{type:'string',enum:['available','paused','archived']},

};
const tools=[
 {name:'chat_skill_list',description:'List My Portal DB canonical chat Skills separately from Agent HQ Manager/Worker Methods. Returns metadata only; use chat_skill_get for full instructions.',
 inputSchema:obj({}),annotations:{readOnlyHint:true}},
 {name:'chat_skill_get',description:'Read the full authoritative chat Skill instructions from My Portal DB. A legacy GitHub SKILL.md is only an export/migration source.',
 inputSchema:obj({id:string('Skill slug',90)},['id']),annotations:{readOnlyHint:true}},
 {name:'chat_skill_upsert',description:'Create or update the canonical full ChatGPT Skill text in My Portal DB; revision-checked, keeps immutable version snapshots. Does not install it in ChatGPT.',
 inputSchema:obj({skill:obj(skillFields,['id','title','body']),expectedRevision:{type:'integer',minimum:0},changeReason:string('Why the skill changed',800),confirm:{type:'boolean'}},['skill','expectedRevision','confirm']),
 annotations:{readOnlyHint:false,destructiveHint:false}},
 {name:'chat_skill_versions',description:'Read version history of canonical chat Skill instructions stored in My Portal DB.',
 inputSchema:obj({id:string('Skill slug',90)},['id']),annotations:{readOnlyHint:true}},
 {name:'ai_context_notes_list',description:'Read durable conversation decisions, corrections and handoffs for AI-side Spaces, separately from user-side Spaces and scheduled Managers.',
 inputSchema:obj({spaceId:string('Optional AI-side Space ID',160),limit:{type:'integer',minimum:1,maximum:100}}),annotations:{readOnlyHint:true}},
 {name:'ai_context_note_create',description:'Record a confirmed conversational decision, correction, handoff or finding against an existing assistant-owned Space. Append-only, not a Manager/Worker Method.',
 inputSchema:obj({
  spaceId:string('Existing assistant-owned Space ID',160),
  kind:{type:'string',enum:['decision','correction','handoff','finding']},
  summary:string('What should survive into a future chat',800),
  detail:string('Reason or relevant distinction',4500),
  source:string('Where the information came from, e.g. current user chat',180),
  sourceUrl:string('Optional chat/thread URL',1000),
  idempotencyKey:string('Stable ID to avoid repeating a note on retry',200),
  confirm:{type:'boolean'},
 },['spaceId','summary','confirm']),annotations:{readOnlyHint:false,destructiveHint:false}},
];
module.exports={TOOLS:tools};
