'use strict';
const TOOL_DEFINITIONS=[
  { name:'intelligence_list',
    description:'LEGACY compatibility: list historical Intelligence records. New design treats Intelligence as a subtype of Skill or Skill Pack; use chat_skill_list and skill_pack_list for canonical capability discovery.',
    inputSchema:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:100},query:{type:'string',maxLength:200}},additionalProperties:false}},
  { name:'intelligence_get',
    description:'LEGACY compatibility: read a historical Intelligence version. For MCC and migrated composite capabilities use skill_pack_get; for atomic Intelligence Skills use chat_skill_get.',
    inputSchema:{type:'object',properties:{id:{type:'string',minLength:2,maxLength:80},versionNumber:{type:'integer',minimum:1}},required:['id'],additionalProperties:false}},
  { name:'skill_pack_list',
    description:'List Skill Packs as a distinct concept: workflow or intelligence subtypes. Historical composite Intelligences (MCC, Monetization, YouTube concept, Video production) are projected by their immutable legacy versions, preserving original dojo releases. Standalone Skills are listed by chat_skill_list.',
    inputSchema:{type:'object',properties:{},additionalProperties:false}},
  { name:'skill_pack_get',
    description:'Read a Skill Pack, including legacy composite Intelligence projections. resolve=true follows the original dojo-released version and loads approved member Skill texts; unapproved Pack versions cannot be executed. Pack is distinct from an individual Skill, and intelligence is just a subtype.',
    inputSchema:{type:'object',properties:{
      id:{type:'string',minLength:2,maxLength:90},
      versionNumber:{type:'integer',minimum:1},
      resolve:{type:'boolean',description:'Also load current approved entry Skill and required member Skills, optionally stage-selected additional Skills.'},
      stages:{type:'array',items:{type:'string',pattern:'^[a-z][a-z0-9-]*
    },required:['id'],additionalProperties:false}},
];
module.exports={TOOLS:TOOL_DEFINITIONS};
,maxLength:80},maxItems:20,uniqueItems:true,description:'Optional legacy composite stage IDs or Buzz workflow stages.'},
    },required:['id'],additionalProperties:false}},
];
module.exports={TOOLS:TOOL_DEFINITIONS};
