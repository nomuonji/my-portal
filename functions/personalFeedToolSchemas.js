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
    description:'Personal prediction based on authored X archive posts and independently labeled external raw corpora. User hobby/watch-later lists are NOT positive preference signals. Source checks separate.',
    properties:{
      scores:{type:'object',additionalProperties:false,properties:{
        tasteFit:{type:['integer','null'],minimum:1,maximum:5,description:'Personal predicted fit. 4 for at least two verified authored X posts showing same mechanism, 5 reserved for directly loved recommendation; null when unknown. Never infer from hobby/watch-later list.'},
        discovery:{type:'integer',minimum:1,maximum:5,description:'Does this unlock a genuinely unfamiliar but plausible interest, not another boilerplate headline?'},
        payoff:{type:'integer',minimum:1,maximum:5,description:'Specific enjoyable content/experience from opening the original item, not just the title.'},
      },required:['tasteFit','discovery','payoff']},
      reasons:{type:'object',additionalProperties:false,properties:{
        tasteFit:str('Reference to real liked/saved item, or explicitly state that fit is a guess or unknown',500),
        discovery:str('Specific novel discovery that the original work offers',500),
        payoff:str('Specific reward/experience in the original work; acknowledge if full video not inspected',500),
      },required:['tasteFit','discovery','payoff']},
      fitBasis:{type:'string',enum:['user_feedback','expression_inference','hypothesis','unknown'],description:'user_feedback is actual loved feedback; expression_inference means two original archived tweets plus explained recurring mechanism. Other preference guesses must stay <=3.'},
      feedbackExampleId:str('Exact cur-... record with user feedback=loved. saved/reading lists are not likes.',100),
      evidencePostIds:{type:'array',maxItems:6,items:str('Verifiable original post document id x_123..., not repost/reply and not AI output',100)},
      expressionMechanism:str('Observed RECURRING aesthetic/semantic operation shared between at least two independent original tweets, and why candidate relates. Do not claim this proves viewing preference.',850),
      rawReferences:{type:'array',maxItems:5,items:{type:'object',additionalProperties:false,properties:{
        dataset:{type:'string',enum:['radichichi','murakami_radio']},
        id:str('Actual humor_examples or intelligence_raw_documents document ID, never simulated',120),
        mechanism:str('What structural move/observation/association appears in the raw external reference; not the user own writing',500)
      },required:['dataset','id','mechanism']}},

      weakness:str('Most likely concrete reason THIS user would reject this recommendation',800),
    },required:['scores','reasons','fitBasis','weakness']
  },
};
const TOOLS=[
 {name:'personal_feed_list',description:'Read personal discovery feed. loved is positive preference; saved is watch-later and not proof of liking; skipped is negative. Also consult authored tweets (social_posts_search) and separate external references (radichichi/Murakami raw), never hobby/reading list as taste.',inputSchema:{type:'object',additionalProperties:false,properties:{limit:{type:'integer',minimum:1,maximum:500},includeSkipped:{type:'boolean'},type:{type:'string',enum:['video','article','website','music','art','game','other']}}},annotations:{readOnlyHint:true}},
 {name:'personal_feed_rejected',description:'Read recently rejected self-scored candidates for deduplication and score audit; these were not published in the feed.',inputSchema:{type:'object',additionalProperties:false,properties:{limit:{type:'integer',minimum:1,maximum:40}}},annotations:{readOnlyHint:true}},
 {name:'personal_feed_get',description:'Read a curated item and recorded feedback.',inputSchema:{type:'object',additionalProperties:false,properties:{id:str('Content ID',100)},required:['id']},annotations:{readOnlyHint:true}},
 {name:'personal_feed_add',description:'Add one real verified public media item to the private personal discovery stream; not a speculative task, not a business idea. Existing URL deduplicates, self-scored low-fit items go to rejected-candidate memory, user reactions never overwritten.',inputSchema:{type:'object',additionalProperties:false,properties:add,required:['url','title','description','reason','type','checkedAt','selfEvaluation']},annotations:{readOnlyHint:false,destructiveHint:false}},
 {name:'personal_feed_batch_add',description:'Curate 1-35 distinct fresh real videos or articles in one batch with canonical URL, same-event topic dedupe and individual outcomes; each item must be fact-checked. Read the existing feed including skips before the call.',inputSchema:{type:'object',additionalProperties:false,properties:{items:{type:'array',minItems:1,maxItems:35,items:{type:'object',additionalProperties:false,properties:add,required:['url','title','description','reason','type','checkedAt','publishedAt','storyKey','selfEvaluation']}}},required:['items']},annotations:{readOnlyHint:false,destructiveHint:false}},
 {name:'personal_feed_feedback',description:'Record explicit user feedback. saved means watch-later, NOT positive enjoyment; only loved is a strong positive signal.',inputSchema:{type:'object',additionalProperties:false,properties:{id:str('Content ID',100),status:{type:'string',enum:['new','saved','loved','skipped','seen']},note:str('Optional feedback reason',500),expectedRevision:{type:'integer',minimum:1}},required:['id','status','expectedRevision']},annotations:{readOnlyHint:false,destructiveHint:false}}
];
module.exports={TOOLS};
