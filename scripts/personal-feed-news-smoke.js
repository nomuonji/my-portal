'use strict';
const assert=require('node:assert/strict');
const { test }=require('node:test');
const {canonicalUrl,youtubeId,normalizeStoryKey,sameContent}=require('../functions/personalFeedStore');
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