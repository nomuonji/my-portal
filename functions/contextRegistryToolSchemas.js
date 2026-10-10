const str=(desc,n)=>({type:'string',description:desc,maxLength:n});
const arr=(max)=>({type:'array',maxItems:max,items:{type:'string'}});
const obj=(properties,required=[])=>({type:'object',additionalProperties:false,properties,required});
const contextFields={
 title:str('Context title',220),summary:str('What this context covers',2000),
 purpose:str('Stable goal and rationale',2500),
 decisions:str('Binding decisions and no-go boundaries',6500),
 currentState:str('Verified current state, not inferred status',6500),
 nextActions:str('Open next actions',3500),
 projectIds:arr(30),domains:arr(30),
 status:{type:'string',enum:['active','paused','archived']},
};
const TOOLS=[
 {name:'context_list',description:'List standalone Contexts linked to project IDs and/or knowledge domains. Distinct from user Thinking Spaces and Manager Methods. Read with world_map_get to find the right continuation context.',inputSchema:obj({projectId:str('Filter by project ID',140),domain:str('Filter by domain',100),includeArchived:{type:'boolean'}}),annotations:{readOnlyHint:true}},
 {name:'context_get',description:'Get a Context brief, linked projects and its decision/correction/handoff history. This is the canonical chat continuity object; legacy assistant-owned Spaces only remain as provenance.',inputSchema:obj({id:str('Context ID',160)},['id']),annotations:{readOnlyHint:true}},
 {name:'context_save',description:'Create or update a domain/project-linked Context. Supports revision-checked updates; never edits a human Space. At least one projectId or domain required.',inputSchema:obj({id:str('Optional ID; omit to create',160),context:obj(contextFields,['title']),expectedRevision:{type:'integer',minimum:0},confirm:{type:'boolean'}},['context','expectedRevision','confirm']),annotations:{readOnlyHint:false,destructiveHint:false}},
 {name:'context_history',description:'Read Context decision/correction/handoff events, including legacy notes preserved at migration.',inputSchema:obj({contextId:str('Context ID',160),limit:{type:'integer',minimum:1,maximum:100}},['contextId']),annotations:{readOnlyHint:true}},
 {name:'context_event_create',description:'Append a confirmed decision, correction, finding or handoff to a Context. Use idempotencyKey for retries. This does not write to human Thinking Spaces or automated Manager.',inputSchema:obj({contextId:str('Context ID',160),kind:{type:'string',enum:['decision','correction','handoff','finding','update']},summary:str('Lasting actionable conclusion',1000),detail:str('Background / why / counterexample',5000),source:str('Source like chat or named project',200),sourceUrl:str('Source chat/issue URL',1000),idempotencyKey:str('Retry dedupe key',160),confirm:{type:'boolean'}},['contextId','summary','confirm']),annotations:{readOnlyHint:false,destructiveHint:false}},
];
module.exports={TOOLS};
