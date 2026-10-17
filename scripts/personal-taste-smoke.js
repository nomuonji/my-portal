'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validate,STARTER,KINDS}=require('../functions/personalTasteStore');
const user={title:'狙いすぎの変な動画は嫌い',detail:'本人が過剰に作為的な企画を否定した',domain:'discover',
 evidenceKind:'explicit_user',direction:'dislike',sourceRefs:[{kind:'user_message',id:'chat-20261017'}]};
test('Explicit user judgment has source and retains its scope',()=>{
 const result=validate(user);
 assert.equal(result.direction,'dislike');
 assert.equal(result.evidenceKind,'explicit_user');
 assert.equal(result.confidence,1);
 assert.equal(result.domain,'discover');
});
test('External corpora, authored expression and bookmarks are not automatically positives',()=>{
 for(const kind of ['expression_inference','external_reference','watch_later']){
  assert.throws(()=>validate({...user,evidenceKind:kind,direction:'like'}),/Only explicit user verdicts/);
 }
 assert.throws(()=>validate({...user,evidenceKind:'explicit_user',direction:'unknown'}),/requires/);
 assert.throws(()=>validate({...user,sourceRefs:[{kind:'bookmark',id:'hobby-foo'}]}),/must cite/);
});
test('Expression hypothesis cites two original posts and cannot pretend to be certain',()=>{
 const x={...user,evidenceKind:'expression_inference',direction:'unknown',
  sourceRefs:[{kind:'user_post',id:'x_12345'},{kind:'user_post',id:'x_11111'}],confidence:0.45};
 assert.equal(validate(x).confidence,0.45);
 assert.throws(()=>validate({...x,confidence:.92}),/cannot exceed/);
 assert.throws(()=>validate({...x,sourceRefs:[{kind:'user_post',id:'x_12345'}]}),/at least two/);
});
test('Teacher reference is explicitly separate from the owner creative output',()=>{
 const e=validate({...user,evidenceKind:'external_reference',direction:'unknown',
 sourceRefs:[{kind:'external_raw',id:'murakami_radio_20190210'}],confidence:0.2});
 assert.equal(e.direction,'unknown');
 assert.equal(e.sourceRefs[0].kind,'external_raw');
});
test('Bookmarks cannot be mistaken for user likes',()=>{
 const e=validate({...user,evidenceKind:'watch_later',direction:'unknown',
 sourceRefs:[{kind:'bookmark',id:'book-1'}]});
 assert.equal(e.direction,'unknown');
});
test('Initial ledger contains only confirmed user judgments/boundaries',()=>{
 assert.equal(STARTER.length,3);
 for(const {id,...entry} of STARTER){
  assert.ok(id.startsWith('taste-'));
  assert.equal(entry.evidenceKind,'explicit_user');
  assert.ok(['dislike','boundary'].includes(entry.direction));
  assert.ok(validate(entry).sourceRefs.some(x=>x.kind==='user_message'));
 }
 assert.ok(KINDS.has('expression_inference'));
});
