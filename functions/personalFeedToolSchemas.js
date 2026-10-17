'use strict';
const str=(description,maxLength=2000)=>({type:'string',description,maxLength});
const add={
  url:str('Direct, verified public HTTPS link to the real playable/readable item. Never fabricate links.',1600),
  title:str('Actual work/video/article title, verified with source.',200),
  description:str('Specific, appealing, factual synopsis; do not invent contents.',1600),
  reason:str('Why this user might enjoy it; separate observed preferences from guesses. Pleasure, not productivity.',1000),
  type:{type:'string',enum:['video','article','website','music','art','game','other']},
  category:str('Broad entertainment shelf, e.g. ネット文化, 映画, ゲーム, 科学.',70),
  creator:str('Verified credited creator/publisher',140),
  tags:{type:'array',maxItems:12,items:str('Topic tag',70)},
  thumbnail:str('Optional trusted https image URL; never guess a random image.',1600),
  sourceUrl:str('Public source used to verify the item and its link.',1600),
  checkedAt:str('Date the link and actual content were verified, YYYY-MM-DD',40),
  uncertainty:str('Known caveat such as age/georestrictions or unavailable embed.',600),
};
const TOOLS=[
 {name:'personal_feed_list',description:'Read the personal entertainment discovery feed before recommending. Includes human likes, skips and saved states. Never submit these to project idea ledger.',inputSchema:{type:'object',additionalProperties:false,properties:{limit:{type:'integer',minimum:1,maximum:200},includeSkipped:{type:'boolean'},type:{type:'string',enum:['video','article','website','music','art','game','other']}}},annotations:{readOnlyHint:true}},
 {name:'personal_feed_get',description:'Read a curated item and recorded feedback.',inputSchema:{type:'object',additionalProperties:false,properties:{id:str('Content ID',100)},required:['id']},annotations:{readOnlyHint:true}},
 {name:'personal_feed_add',description:'Add one real verified public media item to the private personal discovery stream; not a speculative task, not a business idea. Existing URL deduplicates, user reactions never overwritten.',inputSchema:{type:'object',additionalProperties:false,properties:add,required:['url','title','description','reason','type','checkedAt']},annotations:{readOnlyHint:false,destructiveHint:false}},
 {name:'personal_feed_feedback',description:'Record explicit user feedback, never infer appreciation from mere viewing.',inputSchema:{type:'object',additionalProperties:false,properties:{id:str('Content ID',100),status:{type:'string',enum:['new','saved','loved','skipped','seen']},note:str('Optional feedback reason',500),expectedRevision:{type:'integer',minimum:1}},required:['id','status','expectedRevision']},annotations:{readOnlyHint:false,destructiveHint:false}}
];
module.exports={TOOLS};
