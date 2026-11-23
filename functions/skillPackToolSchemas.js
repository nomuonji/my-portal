'use strict';
const TOOL_DEFINITIONS=[
  { name:'intelligence_list',
    description:'LEGACY compatibility: list historical Intelligence definitions. New design treats Intelligence as a Skill or Skill Pack subtype; use chat_skill_list and skill_pack_list for capability discovery.',
    inputSchema:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:100},query:{type:'string',maxLength:200}},additionalProperties:false}},
  { name:'intelligence_get',
    description:'LEGACY compatibility: read historical Intelligence versions. For composite capabilities use skill_pack_get; for atomic Intelligence Skills use chat_skill_get.',
    inputSchema:{type:'object',properties:{id:{type:'string',minLength:2,maxLength:80},versionNumber:{type:'integer',minimum:1}},required:['id'],additionalProperties:false}},
  { name:'skill_pack_list',
    description:'List Skill Packs, including workflow and Intelligence subtypes. The four historical composite Intelligences are projected from immutable versions; original approved Dojo releases are preserved.',
    inputSchema:{type:'object',properties:{},additionalProperties:false}},
  { name:'skill_pack_get',
    description:'Read a Skill Pack manifest or historical composite projection. resolve=true follows the original Dojo release and loads approved member Skill texts; unapproved versions cannot be executed.',
    inputSchema:{type:'object',properties:{
      id:{type:'string',minLength:2,maxLength:90},
      versionNumber:{type:'integer',minimum:1},
      resolve:{type:'boolean',description:'Load approved entry Skill and selected member Skills.'},
      stages:{type:'array',items:{type:'string',maxLength:80},maxItems:20,uniqueItems:true,
        description:'Optional stage IDs from the Pack definition.'},
    },required:['id'],additionalProperties:false}},
];
module.exports={TOOLS:TOOL_DEFINITIONS};
