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
 assert.throws(()=>validateSelfEvaluation(score),/hypothesis cannot be scored above 3/);
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

test('Explicit saved user hobby supports at most 4/5 taste fit and must include actual DB ID',()=>{
 const good={scores:{tasteFit:4,discovery:3,payoff:4},fitBasis:'declared_interest',
   interestExampleId:'oRJBxmeUwbEkW9VvxcOw',
   reasons:{tasteFit:'User explicitly saved Evangelion to hobbies, not confirmed enjoyment of this particular video',discovery:'Explores how the related subculture works',payoff:'Actually shows distinctive creative scenes and craft'},
   weakness:'Familiar title may still be another low-effort promotional clip'};
 assert.equal(validateSelfEvaluation(good).lane,'familiar');
 assert.throws(()=>validateSelfEvaluation({...good,scores:{...good.scores,tasteFit:5}}),/score <=4/);
 assert.throws(()=>validateSelfEvaluation({...good,interestExampleId:'not-verified'}),/valid exact My Portal hobbies ID/);
});
