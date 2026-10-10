const assert=require('node:assert/strict');
const {test}=require('node:test');
const {normalizedSource,sourceId}=require('../functions/curationSourceRules');

test('same source URL uses stable identity and ignores fragments',()=>{
  assert.equal(sourceId('https://example.org/reviews/#foo'),sourceId('https://example.org/reviews/'));
  assert.notEqual(sourceId('https://example.org/reviews/'),sourceId('https://example.org/reviews/feed/'));
});
test('empty or credentialed/insecure source URLs are refused',()=>{
  for(const url of ['','http://example.org/feed','https://bob:secret@example.org/feed','javascript:alert(1)','https://']){
    assert.throws(()=>normalizedSource({title:'X',url}),/valid HTTPS URL/);
  }
});
test('unverified RSS and rights never become active',()=>{
  const a=normalizedSource({title:'Selected RSS',url:'https://example.org/',accessMethod:'rss',feedUrl:'https://example.org/feed',status:'active'});
  assert.equal(a.status,'candidate');
  assert.equal(a.rightsStatus,'unreviewed');
  assert.equal(a.fetchVerification,'untested');
  assert.equal(a.storageScope,'url_metadata_only');
});
test('verified rights and technical endpoint allow active registry status',()=>{
  const a=normalizedSource({title:'Selected RSS',url:'https://example.org/',accessMethod:'rss',feedUrl:'https://example.org/feed',status:'active',rightsStatus:'permitted',fetchVerification:'verified',rightsEvidenceUrl:'https://example.org/terms'});
  assert.equal(a.status,'active');
  assert.equal(a.feedUrl,'https://example.org/feed');
  assert.equal(a.storageScope,'url_metadata_only');
});
test('an existing record merges patch without losing fields',()=>{
  const old=normalizedSource({title:'Old',url:'https://example.org/',selectionDescription:'Human award',tags:['editorial']});
  const next=normalizedSource({notes:'checked',status:'active'},old);
  assert.equal(next.title,'Old');
  assert.equal(next.selectionDescription,'Human award');
  assert.equal(next.notes,'checked');
  assert.equal(next.status,'candidate');
});
test('do not accept output content or client-controlled ingestion grants',()=>{
  const record=normalizedSource({title:'Selected',url:'https://example.org/',articleBody:'copied-content',storageScope:'mirror_full_body',collectionMode:'auto_scrape'});
  assert.ok(!Object.hasOwn(record,'articleBody'));
  assert.equal(record.storageScope,'url_metadata_only');
  assert.ok(!Object.hasOwn(record,'collectionMode'));
});
console.log('curation source schema tests passed');
