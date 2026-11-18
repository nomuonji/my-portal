'use strict';
const schema=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const str=(maxLength)=>({type:'string',maxLength});
const ro={readOnlyHint:true};
const TOOLS=[
 {name:'consumer_model_save',description:'Create or publish a new immutable consumer model version in My Portal after explicit owner approval. Supply the entire model including existing evidence; updates need expectedRevision and a new version. Never promote unverified claims to facts.',inputSchema:schema({model:{type:'object',additionalProperties:true},expectedRevision:{type:'integer',minimum:1},changeReason:str(2000),confirm:{type:'boolean',const:true}},['model','changeReason','confirm']),annotations:{readOnlyHint:false,destructiveHint:false}},
 {name:'consumer_model_list',description:'List consumer models in My Portal with migration status. Models are audience research data, separate from Intelligence Packs.',inputSchema:schema({query:str(300),status:{type:'string',enum:['active','paused','archived']},limit:{type:'integer',minimum:1,maximum:200}}),annotations:ro},
 {name:'consumer_model_get',description:'Read an exact current or historical consumer model, including evidence, personas and source claims. Accepts legacy aliases.',inputSchema:schema({id:str(64),version:str(12)},['id']),annotations:ro},
 {name:'consumer_model_seed_files',description:'List the migrated repository seed file inventory; not evidence or a claim that live local SQLite was copied.',inputSchema:schema(),annotations:ro},
 {name:'consumer_model_migration_status',description:'Read verified migration stages and counts. A staged Firestore copy is not final cutover.',inputSchema:schema(),annotations:ro},
 {name:'consumer_model_import_keywords_snapshot',description:'Idempotent import of the explicitly approved 2026-11-18 Keywords Firestore and repository seed snapshot. Rejects conflicts and verifies every document. Does not modify Keywords.',inputSchema:schema({confirm:{type:'boolean',const:true}},['confirm']),annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true}},
];
module.exports={TOOLS};
