const assert=require('node:assert/strict');
const { _test }=require('../functions/publicCmsStore');

(async () => {
  assert.equal(_test.normalizeSiteId('Site_1'),'site_1');
  assert.equal(_test.normalizeSlug('/hello/world/'),'hello/world');
  assert.equal(_test.contentDocId('site_1','hello/world'),'site_1__hello~world');

  const projected=_test.publicProjection({
   id:'site_1__hello',siteId:'site_1',slug:'hello',status:'published',revision:2,
   sourceRefs:[{type:'space',id:'private-id'}],seoResearch:{secret:'internal'},
   draft:{title:'new draft'},
   published:{title:'Live',summary:'',bodyMarkdown:'# Live',contentType:'article',tags:['x'],keyTakeaways:['A','B'],locale:'en',translationGroupId:'hello',originalLocale:'ja',translatedFromRevision:1,seo:{primaryKeyword:'live keyword'},publishedAt:'2026-10-07T00:00:00Z'},
   publishedAt:'2026-10-07T00:00:00Z',updatedAt:'2026-10-07T00:00:00Z'
  });
  assert.equal(projected.title,'Live');
  assert.equal(projected.bodyMarkdown,'# Live');
  assert.equal('sourceRefs' in projected,false);
  assert.equal('seoResearch' in projected,false);
  assert.equal('draft' in projected,false);
  assert.deepEqual(projected.keyTakeaways,['A','B']);
  assert.equal(projected.locale,'en');
  assert.equal(projected.translationGroupId,'hello');
  assert.equal(projected.originalLocale,'ja');
  assert.equal(projected.translatedFromRevision,1);
  const legacy=_test.publicProjection({id:'site_1__en~legacy',siteId:'site_1',slug:'en/legacy',status:'published',revision:1,published:{title:'Legacy',summary:'',bodyMarkdown:'',contentType:'article',tags:[],seo:{}},publishedAt:'2026-10-07T00:00:00Z'});
  assert.equal(legacy.locale,'en');
  assert.equal(legacy.translationGroupId,'legacy');
  assert.equal(_test.publicProjection({...projected,status:'draft',published:null}),null);

  assert.equal(
    _test.deployHookEnvName('antonbase-notes'),
    'PUBLIC_CMS_DEPLOY_HOOK_ANTONBASE_NOTES'
  );

  const validHook='https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/11111111-1111-1111-1111-111111111111';
  assert.equal(_test.isAllowedDeployHookUrl(validHook),true);
  assert.equal(_test.isAllowedDeployHookUrl('https://example.com/hook'),false);

  let requestedUrl='';
  const deploy=await _test.triggerDeployHookUrl(validHook, async (url, options) => {
    requestedUrl=String(url);
    assert.equal(options.method,'POST');
    return {
      ok:true,
      status:200,
      json:async()=>({success:true,result:{build_uuid:'build-123',status:'queued',already_exists:false}})
    };
  });
  assert.equal(requestedUrl,validHook);
  assert.equal(deploy.ok,true);
  assert.equal(deploy.triggered,true);
  assert.equal(deploy.buildUuid,'build-123');
  assert.equal('hookUrl' in deploy,false);

  const rejected=await _test.triggerDeployHookUrl('https://example.com/hook', async()=>{ throw new Error('must not run'); });
  assert.equal(rejected.triggered,false);
  assert.equal(rejected.reason,'invalid_hook_url');

  console.log('[OK] Public CMS projection is private-safe and Cloudflare deploy hooks are secret-safe.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
