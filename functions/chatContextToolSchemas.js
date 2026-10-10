const string=(description,maxLength)=>({type:'string',description,maxLength});
const obj=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const skillFields={
 id:string('Stable skill slug',90),
 title:string('Skill display name',220),
 summary:string('ChatGPT skill objective',1100),
 triggers:{type:'array',items:{type:'string'},maxItems:25},
 repo:string('GitHub owner/repo holding SKILL.md',190),
 path:string('Relative path to SKILL.md',320),
 status:{type:'string',enum:['available','paused','archived']},
 note:string('Implementation/status note',1200)
};
const tools=[
 {name:'chat_skill_list',description:'List real chat-facing SKILL.md pointers separately from Agent HQ Methods. GitHub is canonical for skill content; installation in ChatGPT is NOT implied.',
 inputSchema:obj({}),annotations:{readOnlyHint:true}},
 {name:'chat_skill_get',description:'Get canonical GitHub SKILL.md location for a chat-facing Skill, never use a Manager Method as its content source.',
 inputSchema:obj({id:string('Skill slug',90)},['id']),annotations:{readOnlyHint:true}},
 {name:'chat_skill_upsert',description:'Register or update an independently stored chat Skill directory entry referencing an existing SKILL.md on GitHub. This does not create the GitHub file or install in ChatGPT.',
 inputSchema:obj({skill:obj(skillFields,['id','title','repo','path']),expectedRevision:{type:'integer',minimum:0},confirm:{type:'boolean'}},['skill','expectedRevision','confirm']),
 annotations:{readOnlyHint:false,destructiveHint:false}},
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
