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
   published:{title:'Live',summary:'',bodyMarkdown:'# Live',contentType:'article',tags:['x'],keyTakeaways:['A','B'],blocks:[{type:'summary',placement:'before-body',title:'Now',text:'Current state',items:['A']},{type:'dataset',title:'Data',view:'table',columns:[{key:'name',label:'Name',type:'text',primary:true},{key:'status',label:'Status',type:'status'}],records:[{name:'Alpha',status:'active'}]}],locale:'en',translationGroupId:'hello',originalLocale:'ja',translatedFromRevision:1,seo:{primaryKeyword:'live keyword'},publishedAt:'2026-10-07T00:00:00Z'},
   publishedAt:'2026-10-07T00:00:00Z',updatedAt:'2026-10-07T00:00:00Z'
  });
  assert.equal(projected.title,'Live');
  assert.equal(projected.bodyMarkdown,'# Live');
  assert.equal('sourceRefs' in projected,false);
  assert.equal('seoResearch' in projected,false);
  assert.equal('draft' in projected,false);
  assert.deepEqual(projected.keyTakeaways,['A','B']);
  assert.equal(projected.blocks.length,2);
  assert.equal(projected.blocks[0].type,'summary');
  assert.equal(projected.blocks[1].records[0].name,'Alpha');
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

  const safeBlocks=_test.safeBlocks([{type:'dataset',title:'Tools',view:'tracker',columns:[{key:'name',label:'Name',primary:true},{key:'status',label:'Status',type:'status'}],records:[{name:'One',status:'active',ignored:'drop me'}]}]);
  assert.equal(safeBlocks[0].view,'tracker');
  assert.equal(safeBlocks[0].records[0].ignored,undefined);
  const safeScan=_test.scanPublicContent({title:'Safe note',summary:'No identifiers',bodyMarkdown:'Public-safe body',tags:['topic'],keyTakeaways:['safe'],blocks:safeBlocks,seo:{title:'Safe',description:'Safe',canonicalPath:'/safe/'}});
  assert.equal(safeScan.ok,true);
  const unsafeScan=_test.scanPublicContent({title:'Contact me',summary:'user@example.com',bodyMarkdown:'password=abcdefghijklmnop',tags:[],keyTakeaways:[],blocks:[{type:'summary',text:'token=abcdefghijklmnop'}],seo:{}});
  assert.equal(unsafeScan.ok,false);
  assert.deepEqual(unsafeScan.issues.map(x=>x.type).sort(),['credential_assignment','credential_assignment','email']);
  assert.equal(JSON.stringify(unsafeScan).includes('user@example.com'),false);
  assert.throws(()=>_test.assertPrivacySafe({title:'Leak',summary:'',bodyMarkdown:'Bearer abcdefghijklmnopqrstu',tags:[],keyTakeaways:[],seo:{}}),/privacy gate blocked publish/i);

  const rejected=await _test.triggerDeployHookUrl('https://example.com/hook', async()=>{ throw new Error('must not run'); });
  assert.equal(rejected.triggered,false);
  assert.equal(rejected.reason,'invalid_hook_url');

  console.log('[OK] Public CMS projection, privacy gate, and Cloudflare deploy hooks are secret-safe.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
