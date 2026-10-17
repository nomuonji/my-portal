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
  publishedAt:str('Source-verified original publication date YYYY-MM-DD (not ingestion time); omit if unknown.',40),
  storyKey:str('Stable topic/event identity shared across publishers AND video/article formats. Use a precise entity-event-period slug to suppress duplicate coverage.',180),
  selfEvaluation:{
    type:'object',additionalProperties:false,
    description:'Predict user-specific interest, not generic quality. All new items require separate scores; known-fit lane requires verified user feedback. Exploration lane allows unknown taste. Sources, copyright, date and duplicates are binary checks, not score axes.',
    properties:{
      scores:{type:'object',additionalProperties:false,properties:{
        tasteFit:{type:['integer','null'],minimum:1,maximum:5,description:'Personal preference prediction; 4 with verified user hobby or saved/loved item; 5 only with saved/loved item; null if unknown.'},
        discovery:{type:'integer',minimum:1,maximum:5,description:'Does this unlock a genuinely unfamiliar but plausible interest, not another boilerplate headline?'},
        payoff:{type:'integer',minimum:1,maximum:5,description:'Specific enjoyable content/experience from opening the original item, not just the title.'},
      },required:['tasteFit','discovery','payoff']},
      reasons:{type:'object',additionalProperties:false,properties:{
        tasteFit:str('Reference to real liked/saved item, or explicitly state that fit is a guess or unknown',500),
        discovery:str('Specific novel discovery that the original work offers',500),
        payoff:str('Specific reward/experience in the original work; acknowledge if full video not inspected',500),
      },required:['tasteFit','discovery','payoff']},
      fitBasis:{type:'string',enum:['user_feedback','declared_interest','hypothesis','unknown'],description:'High fit requires direct user-liked/saved item or exact saved user hobby reference. Browsing alone is not a like.'},
      feedbackExampleId:str('Exact cur-... ID of a user-loved/saved item for fit 4 or 5; omit otherwise',100),
      interestExampleId:str('Exact 20-char My Portal hobbies ID for declared_interest fit 4; omit otherwise. Hobby interest is not proof of enjoyment.',100),
      weakness:str('Most likely concrete reason THIS user would reject this recommendation',800),
    },required:['scores','reasons','fitBasis','weakness']
  },
};
const TOOLS=[
 {name:'personal_feed_list',description:'Read the personal entertainment discovery feed before recommending. Includes human likes, skips and saved states. Never submit these to project idea ledger.',inputSchema:{type:'object',additionalProperties:false,properties:{limit:{type:'integer',minimum:1,maximum:500},includeSkipped:{type:'boolean'},type:{type:'string',enum:['video','article','website','music','art','game','other']}}},annotations:{readOnlyHint:true}},
 {name:'personal_feed_rejected',description:'Read recently rejected self-scored candidates for deduplication and score audit; these were not published in the feed.',inputSchema:{type:'object',additionalProperties:false,properties:{limit:{type:'integer',minimum:1,maximum:40}}},annotations:{readOnlyHint:true}},
 {name:'personal_feed_get',description:'Read a curated item and recorded feedback.',inputSchema:{type:'object',additionalProperties:false,properties:{id:str('Content ID',100)},required:['id']},annotations:{readOnlyHint:true}},
 {name:'personal_feed_add',description:'Add one real verified public media item to the private personal discovery stream; not a speculative task, not a business idea. Existing URL deduplicates, self-scored low-fit items go to rejected-candidate memory, user reactions never overwritten.',inputSchema:{type:'object',additionalProperties:false,properties:add,required:['url','title','description','reason','type','checkedAt','selfEvaluation']},annotations:{readOnlyHint:false,destructiveHint:false}},
 {name:'personal_feed_batch_add',description:'Curate 1-35 distinct fresh real videos or articles in one batch with canonical URL, same-event topic dedupe and individual outcomes; each item must be fact-checked. Read the existing feed including skips before the call.',inputSchema:{type:'object',additionalProperties:false,properties:{items:{type:'array',minItems:1,maxItems:35,items:{type:'object',additionalProperties:false,properties:add,required:['url','title','description','reason','type','checkedAt','publishedAt','storyKey','selfEvaluation']}}},required:['items']},annotations:{readOnlyHint:false,destructiveHint:false}},
 {name:'personal_feed_feedback',description:'Record explicit user feedback, never infer appreciation from mere viewing.',inputSchema:{type:'object',additionalProperties:false,properties:{id:str('Content ID',100),status:{type:'string',enum:['new','saved','loved','skipped','seen']},note:str('Optional feedback reason',500),expectedRevision:{type:'integer',minimum:1}},required:['id','status','expectedRevision']},annotations:{readOnlyHint:false,destructiveHint:false}}
];
module.exports={TOOLS};
