const assert=require('node:assert/strict');
const { _test }=require('../functions/publicCmsStore');

assert.equal(_test.normalizeSiteId('Site_1'),'site_1');
assert.equal(_test.normalizeSlug('/hello/world/'),'hello/world');
assert.equal(_test.contentDocId('site_1','hello/world'),'site_1__hello~world');

const projected=_test.publicProjection({
 id:'site_1__hello',siteId:'site_1',slug:'hello',status:'published',revision:2,
 sourceRefs:[{type:'space',id:'private-id'}],seoResearch:{secret:'internal'},
 draft:{title:'new draft'},
 published:{title:'Live',summary:'',bodyMarkdown:'# Live',contentType:'article',tags:['x'],seo:{primaryKeyword:'live keyword'},publishedAt:'2026-10-07T00:00:00Z'},
 publishedAt:'2026-10-07T00:00:00Z',updatedAt:'2026-10-07T00:00:00Z'
});
assert.equal(projected.title,'Live');
assert.equal(projected.bodyMarkdown,'# Live');
assert.equal('sourceRefs' in projected,false);
assert.equal('seoResearch' in projected,false);
assert.equal('draft' in projected,false);
assert.equal(_test.publicProjection({...projected,status:'draft',published:null}),null);
console.log('[OK] Public CMS projection keeps private draft/provenance out of the public payload.');
