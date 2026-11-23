'use strict';
const TOOL_DEFINITIONS=[
  { name:'intelligence_list',
    description:'List reusable Intelligences (judgment models, evidence interpretation). Legacy storage and API names call these Intelligence Packs; they are not Skill Packs. MCC is here.',
    inputSchema:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:100},query:{type:'string',maxLength:200}},additionalProperties:false}},
  { name:'intelligence_get',
    description:'Read an Intelligence definition, such as marketing-creative-cognition (MCC). This is a compatibility alias for intelligence_pack_get, not a workflow Pack.',
    inputSchema:{type:'object',properties:{id:{type:'string',minLength:2,maxLength:80},versionNumber:{type:'integer',minimum:1}},required:['id'],additionalProperties:false}},
  { name:'skill_pack_list',
    description:'List canonical Skill Packs: workflow groups of individual Chat Skills. Skill Packs are NOT Intelligence Packs. The migrated バズ投稿 Pack retains the released buzz-content-ideation coordinator as a backward-compatible entry and points to its original dojo.',
    inputSchema:{type:'object',properties:{},additionalProperties:false}},
  { name:'skill_pack_get',
    description:'Read a Skill Pack manifest with stages, its entry Chat Skill, shared specialist Skill references, linked Intelligence ID and owning dojo. resolve=true loads the actual current dojo-approved Skill texts for execution (not copied historical versions). Intelligence is resolved separately.',
    inputSchema:{type:'object',properties:{
      id:{type:'string',minLength:2,maxLength:90},
      versionNumber:{type:'integer',minimum:1},
      resolve:{type:'boolean',description:'Also load current approved entry Skill and required member Skills, optionally stage-selected additional Skills.'},
      stages:{type:'array',items:{type:'string',enum:['source','selection','audience','transform','humor','voice','gate','distribution']},maxItems:8,uniqueItems:true},
    },required:['id'],additionalProperties:false}},
];
module.exports={TOOLS:TOOL_DEFINITIONS};
