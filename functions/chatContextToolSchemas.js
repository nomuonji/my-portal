const { EDITS_SCHEMA } = require('./textEdits');
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
 {name:'chat_skill_get',description:'Read the executable Skill body (latest dojo-released version, otherwise Registry latest). Also resolve selected task-conditional shared Skill links by canonical ID at execution, with no historical version pins. Set intent=technical_edit or serious_creation to avoid loading humour in unrelated character tasks. mode=edit returns draft metadata and should not be used for execution.',
 inputSchema:obj({id:string('Skill slug',90),mode:{type:'string',enum:['execution','edit'],default:'execution'},
  intent:{type:'string',enum:['character_ideation','serious_creation','technical_edit','humor_ideation','personal_voice','distribution']},
  includeRelations:{type:'boolean',default:true}},['id']),annotations:{readOnlyHint:true}},
 {name:'chat_skill_upsert',description:'Create or update the canonical full ChatGPT Skill text in My Portal DB; revision-checked, keeps immutable version snapshots. Does not install it in ChatGPT. If a スキル錬成道場 (exploration base) trains this skill, execution keeps using the version that 道場 released: the result carries dojoNotice, and the new version must be released there (exploration_method_version_set) with its evidence before jobs use it. New skills need id, title and body. For a small change to an existing skill pass bodyEdits instead of the whole body.',
 inputSchema:obj({skill:obj(skillFields,['id']),bodyEdits:{...EDITS_SCHEMA,description:'Change part of the stored body without resending it: exact {find, replace} pairs, each find occurring exactly once. With bodyEdits, skill needs only id; other fields keep their stored value unless passed.'},expectedRevision:{type:'integer',minimum:0},changeReason:string('Why the skill changed',800),confirm:{type:'boolean'}},['skill','expectedRevision','confirm']),
 annotations:{readOnlyHint:false,destructiveHint:false}},
 {name:'chat_skill_versions',description:'Read version history of canonical chat Skill instructions stored in My Portal DB.',
 inputSchema:obj({id:string('Skill slug',90)},['id']),annotations:{readOnlyHint:true}},

];
module.exports={TOOLS:tools};