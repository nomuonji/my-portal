'use strict';
const assert=require('node:assert/strict');
const { test }=require('node:test');
const {canonicalUrl,youtubeId,normalizeStoryKey,sameContent,validateSelfEvaluation,SCORE_AXES}=require('../functions/personalFeedStore');
const seeded=require('../functions/personalFeedSeed20261017');
test('YouTube watch / shorts / share URLs canonicalize to identical content',()=>{
 const video='3FOzD4Sfgag';
 const paths=['https://youtu.be/'+video+'?si=tracked','https://www.youtube.com/watch?v='+video+'&t=1','https://m.youtube.com/shorts/'+video+'?feature=share'];
 for(const url of paths){
  assert.equal(youtubeId(url),video);
  assert.equal(canonicalUrl(url),'https://www.youtube.com/watch?v='+video);
 }
});
test('News tracking fragments and AMP-like trailing slashes do not create new content',()=>{
 assert.equal(
  canonicalUrl('https://www.example.org/stories/2026/10/17/?utm_medium=social&fbclid=x#body'),
  canonicalUrl('https://example.org/stories/2026/10/17')
 );
});
test('A cross-publisher video and article about one event use one story identity',()=>{
 const original={url:'https://www.youtube.com/watch?v=3FOzD4Sfgag',type:'video',title:'Trailer',storyKey:'same-game-trailer-20261016'};
 const report={url:'https://news.example.com/article/99',type:'article',title:'New trailer release',storyKey:'same-game-trailer-20261016'};
 assert.equal(sameContent(original,report),true);
 assert.equal(normalizeStoryKey('  SAME Game: Trailer (2026-10-16) '),'same-game-trailer-2026-10-16');
});
test('Unrelated stories are not treated as duplicates',()=>{
 const a={url:'https://first.example.com/news/1',title:'Game A launched',storyKey:'game-a-launch-20261017'};
 const b={url:'https://second.example.com/news/2',title:'Game B launched',storyKey:'game-b-launch-20261017'};
 assert.equal(sameContent(a,b),false);
});
test('Starter edition uses distinct URLs and topic keys',()=>{
 assert.ok(seeded.length>=10);
 assert.equal(new Set(seeded.map(i=>canonicalUrl(i.url))).size,seeded.length);
 assert.equal(new Set(seeded.map(i=>normalizeStoryKey(i.storyKey))).size,seeded.length);
 assert.ok(seeded.every(i=>/^\d{4}-\d{2}-\d{2}$/.test(i.publishedAt)));
});
test('Self-rating is required, concrete, and only evidence-backed user preference may get 4+',()=>{
 assert.deepEqual(SCORE_AXES,['tasteFit','discovery','payoff']);
 assert.throws(()=>validateSelfEvaluation(null),/required/);
 const score={scores:{tasteFit:5,discovery:4,payoff:4},fitBasis:'hypothesis',
  reasons:{tasteFit:'this is a guess not actual rating',discovery:'an unfamiliar real subculture',payoff:'full original piece is enjoyable'},
  weakness:'User could dislike the actual topic'};
 assert.throws(()=>validateSelfEvaluation(score),/Speculative taste cannot be scored above 3/);
 assert.throws(()=>validateSelfEvaluation({...score,fitBasis:'user_feedback'}),/feedbackExampleId/);
});
test('Cold-start exploration survives unknown taste, weak-content proposals go to rejection memory',()=>{
 const base={scores:{tasteFit:null,discovery:5,payoff:4},fitBasis:'unknown',
  reasons:{tasteFit:'There is no direct prior user rating yet',discovery:'An unexpected work from a niche internet scene',payoff:'Actual original video contains a distinctive sequence'},
  weakness:'Despite novelty this user may not enjoy the format'};
 const curious=validateSelfEvaluation(base);
 assert.equal(curious.lane,'explore');assert.equal(curious.passed,true);
 assert.equal(curious.scores.tasteFit,null);
 const weak=validateSelfEvaluation({...base,scores:{...base.scores,payoff:3}});
 assert.equal(weak.passed,false);assert.equal(weak.lane,'rejected');
 assert.equal(validateSelfEvaluation(base,true),null);
});
test('Verified-positive preferences make a familiar lane possible without requiring novelty',()=>{
 const likedId='cur-'+('a'.repeat(30));
 const score={scores:{tasteFit:4,discovery:2,payoff:4},fitBasis:'user_feedback',feedbackExampleId:likedId,
  reasons:{tasteFit:'Related to user-loved item cur-aaaaaa; citation is checked at insert',discovery:'Related material is already familiar to user',payoff:'Specific episode worth opening and seeing'},
  weakness:'Could be too similar to the previous liked item'};
 const evaluation=validateSelfEvaluation(score);
 assert.equal(evaluation.passed,true);assert.equal(evaluation.lane,'familiar');
 assert.equal(evaluation.feedbackExampleId,likedId);
});


test('Watch-later hobbies are not taste evidence and old declared_interest basis is rejected',()=>{
 const bad={scores:{tasteFit:4,discovery:3,payoff:4},fitBasis:'declared_interest',
  interestExampleId:'oRJBxmeUwbEkW9VvxcOw',
  reasons:{tasteFit:'Saved in a backlog without enjoyment judgment',discovery:'Shows a little-known filmmaking subculture',payoff:'Watch the whole short film for the creative payoff'},
  weakness:'User may not like this specific video at all'};
 assert.throws(()=>validateSelfEvaluation(bad),/fitBasis/);
});
test('Two authored raw tweets can support 4-point expression inference but not 5',()=>{
 const raw={
  scores:{tasteFit:4,discovery:2,payoff:4},fitBasis:'expression_inference',
  evidencePostIds:['x_1855476278692089898','x_1835165279699321167'],
  expressionMechanism:'Both actual original posts build an understated comic observation on a mundane social script; candidate might share that mechanism, but enjoyment is untested.',
  rawReferences:[{dataset:'radichichi',id:'radichichi_633973095_006',mechanism:'A low-temperature humorous turn on an everyday premise'}],
  reasons:{tasteFit:'Two original post IDs capture a repeated concrete observational turn; this is an inference only',
   discovery:'Not necessarily new; the appeal rests on an established style',
   payoff:'This original piece contains an actual comic set piece worth reading'},
  weakness:'The user might enjoy writing this kind of joke but dislike watching this type of video'};
 const assessment=validateSelfEvaluation(raw);
 assert.equal(assessment.lane,'familiar');
 assert.equal(assessment.version,'discover-taste-v3');
 assert.deepEqual(assessment.evidencePostIds,raw.evidencePostIds);
 assert.equal(assessment.rawReferences[0].dataset,'radichichi');
 assert.throws(()=>validateSelfEvaluation({...raw,scores:{...raw.scores,tasteFit:5}}),/at most 4/);
 assert.throws(()=>validateSelfEvaluation({...raw,evidencePostIds:[raw.evidencePostIds[0]]}),/at least 2/);
 assert.throws(()=>validateSelfEvaluation({...raw,rawReferences:[{dataset:'hobbies',id:'foo',mechanism:'I like it'}]}),/rawReferences/);
});

const curated=require('../functions/personalFeedEdition20261017Taste');
test('Taste-recalibrated issue contains 6 distinct verified original sources, no artificial comedy stunts',()=>{
 assert.equal(curated.length,6);
 assert.equal(curated.filter(x=>x.type==='video').length,1);
 assert.equal(new Set(curated.map(x=>canonicalUrl(x.url))).size,curated.length);
 assert.equal(new Set(curated.map(x=>normalizeStoryKey(x.storyKey))).size,curated.length);
 assert.equal(new Set(curated.map(x=>x.creator)).size,curated.length);
 for(const item of curated){
  assert.ok(item.url.startsWith('https://'),item.url);
  assert.ok(/2026-10-(?:0[9]|1[0-7])/.test(item.publishedAt),item.title);
  assert.equal(item.checkedAt,'2026-10-17');
  const score=validateSelfEvaluation(item.selfEvaluation);
  assert.equal(score.version,'discover-taste-v3');
  assert.equal(score.fitBasis,'unknown');
  assert.equal(score.scores.tasteFit,null);
  assert.equal(score.lane,'explore');
  assert.ok(score.passed,item.title);
 }
 assert.ok(curated.every(x=>!seeded.some(y=>sameContent(x,y))));
});

const netIssue=require('../functions/personalFeedEdition20261017NetCulture');
test('New Discover issue centers real internet culture and playable original video, not staged novelty',()=>{
 assert.equal(netIssue.length,8);
 assert.equal(netIssue.filter(x=>x.type==='video').length,2);
 assert.ok(netIssue.every(x=>x.category==='ネット文化'));
 assert.equal(new Set(netIssue.map(x=>canonicalUrl(x.url))).size,netIssue.length);
 assert.equal(new Set(netIssue.map(x=>normalizeStoryKey(x.storyKey))).size,netIssue.length);
 for(const entry of netIssue){
  assert.ok(entry.url.startsWith('https://'),entry.title);
  assert.ok(entry.checkedAt==='2026-10-17');
  assert.ok(/^2026-10-(?:0[9]|1[0-7])$/.test(entry.publishedAt),entry.title);
  const score=validateSelfEvaluation(entry.selfEvaluation);
  assert.equal(score.version,'discover-taste-v3');
  assert.equal(score.fitBasis,'unknown');
  assert.equal(score.scores.tasteFit,null);
  assert.equal(score.lane,'explore',entry.title);
  assert.ok(score.passed);
  assert.ok(!curated.some(old=>sameContent(old,entry)),entry.title);
  assert.ok(!seeded.some(old=>sameContent(old,entry)),entry.title);
 }
});
