const assert=require('node:assert/strict');
const { _test }=require('../functions/publicCmsStore');

(async () => {
  assert.equal(_test.normalizeSiteId('Site_1'),'site_1');
  assert.equal(_test.normalizeSlug('/hello/world/'),'hello/world');
  assert.equal(_test.contentDocId('site_1','hello/world'),'site_1__hello~world');
  // CMS does not own the surrounding site's existing code/content.
  assert.deepEqual(_test.safePublicationContract({
    routePrefix:'/features/', owner:'agent-hq',
    excludedPaths:['/articles/','/research/'],
    editorialScope:'Research essays only',
  }), {
    routePrefix:'/features/',owner:'agent-hq',mode:'additive',
    editorialScope:'Research essays only',excludedPaths:['/articles/','/research/']
  });
  assert.throws(() => _test.safePublicationContract({routePrefix:'/articles/other/'}),/one URL segment/);
  assert.throws(() => _test.safePublicationContract({owner:'groq'}),/Invalid publicationContract.owner/);
    // Editorial reviews are bound to both the actual draft body and active Method version.
  const sampleDraft=_test.safeDraft({title:'Reader test',bodyMarkdown:'This is a concrete explanation.'},{slug:'hello'});
  const fingerprint=_test.draftFingerprint(sampleDraft);
  assert.match(fingerprint,/^[a-f0-9]{64}$/);
  const session={id:'session-1',siteId:'site_1',slug:'hello',
    methodId:_test.EDITORIAL_METHOD_ID,methodVersionId:'active-method-v5',
    preparedAt:new Date().toISOString(),status:'begun'};
  assert.equal(_test.validateEditingSession(session,'site_1','hello','active-method-v5'),true);
  assert.equal(_test.validateEditingSession({...session,status:'prepared'},'site_1','hello','active-method-v5'),true);
  assert.throws(()=>_test.validateEditingSession(null,'site_1','hello','active-method-v5'),/session missing/);
  assert.throws(()=>_test.validateEditingSession({...session,status:'approved'},'site_1','hello','active-method-v5'),/session missing/);
  assert.throws(()=>_test.validateEditingSession(session,'another_site','hello','active-method-v5'),/does not match/);
  assert.throws(()=>_test.validateEditingSession(session,'site_1','different','active-method-v5'),/does not match/);
  assert.throws(()=>_test.validateEditingSession(session,'site_1','hello','new-active-version'),/does not match/);
  assert.throws(()=>_test.validateEditingSession(session,'site_1','hello','active-method-v5',Date.now()+2*86400000),/expired/);

  assert.notEqual(fingerprint,_test.draftFingerprint({...sampleDraft,bodyMarkdown:'New text'}));
  // In the Antonbase Notes publication lane, generic 7/7 checks alone are
  // insufficient. The private review needs an actual editorial angle brief.
  const validAngleBrief = [
    'sourceMotive: The work began because program approvals take time; store candidates before needing to publish.',
    'readerPull: One OAuth Allow click appeared inert but the next said used; the first click had changed server state.',
    'angleAlternatives: Candidate A starts with an error-code explainer; candidate B begins with the actual motivation and a surprising silent click; B preserves more specific reader interest.',
    'leadCheck: The title and first two paragraphs establish why the connection mattered and create a concrete question without revealing a secret.',
    'storyVsFacts: The browser console violation was not captured; the post-fix connection succeeded.',
    'omittedPrivateContext: Account identifiers, credential values, user identity and internal tickets were omitted.'
  ].join('\n');
  assert.equal(_test.assertEditorialAngleEvidence('antonbase-notes',9,validAngleBrief),true);
  assert.equal(_test.assertEditorialAngleEvidence('culture-institute',9,'brief not required'),true);
  assert.equal(_test.assertEditorialAngleEvidence('antonbase-notes',8,'existing pre-v9 method'),true);
  assert.throws(()=>_test.assertEditorialAngleEvidence('antonbase-notes',9,
    'All seven checks completed and article is ready to publish.'),/sourceMotive/);
  assert.throws(()=>_test.assertEditorialAngleEvidence('antonbase-notes',9,
    validAngleBrief.replace(/readerPull:[^\n]+/,'readerPull: OK')),/readerPull/);
  assert.throws(()=>_test.assertEditorialAngleEvidence('antonbase-notes',9,
    validAngleBrief.replace(/angleAlternatives:[^\n]+/,'angleAlternatives: none')),/angleAlternatives/);
  // A checklist can be gamed with identical, content-free paragraphs. The
  // audit can detect this obvious failure, even though it cannot score prose.
  const copyPasted = [
    'sourceMotive: This entire article is carefully reviewed and the content is suitable for publication.',
    'readerPull: This entire article is carefully reviewed and the content is suitable for publication.',
    'angleAlternatives: This entire article is carefully reviewed and the content is suitable for publication.',
    'leadCheck: This entire article is carefully reviewed and the content is suitable for publication.'
  ].join('\n');
  assert.throws(()=>_test.assertEditorialAngleEvidence('antonbase-notes',10,copyPasted),/distinct/);
  const punctuationOnly = validAngleBrief.replace(
    /readerPull:[^\n]+/,
    'readerPull: The work began because program approvals take time; store candidates before needing to publish!!!'
  );
  assert.throws(()=>_test.assertEditorialAngleEvidence('antonbase-notes',10,punctuationOnly),/distinct/);
  const filler = validAngleBrief.replace(/leadCheck:[^\n]+/,'leadCheck: '+ 'あ'.repeat(45));
  assert.throws(()=>_test.assertEditorialAngleEvidence('antonbase-notes',10,filler),/non-placeholder/);
  assert.equal(_test.assertEditorialAngleEvidence('antonbase-notes',10,validAngleBrief),true);


  const checks=Object.fromEntries(_test.EDITORIAL_CHECKS.map(name=>[name,true]));
  const approvedAt=new Date().toISOString();
  const methodVersionId='active-method-v5';
  const receipt={reviewId:'test-review-1',methodVersionId,draftFingerprint:fingerprint,approvedAt};
  const review={...receipt,id:receipt.reviewId,methodId:_test.EDITORIAL_METHOD_ID,status:'approved',checks};
  assert.deepEqual(_test.validateEditorialReceipt(receipt,review,methodVersionId,fingerprint),{
    reviewId:receipt.reviewId,methodVersionId,draftFingerprint:fingerprint
  });
  assert.throws(()=>_test.validateEditorialReceipt(null,review,methodVersionId,fingerprint),/no completed review/);
  assert.throws(()=>_test.validateEditorialReceipt(receipt,null,methodVersionId,fingerprint),/no completed review/);
  assert.throws(()=>_test.validateEditorialReceipt(receipt,{...review,status:'prepared'},methodVersionId,fingerprint),/no completed review/);
  assert.throws(()=>_test.validateEditorialReceipt(receipt,review,'new-method-version',fingerprint),/Method changed/);
  assert.throws(()=>_test.validateEditorialReceipt(receipt,review,methodVersionId,'different-draft-hash'),/draft changed/);
  assert.throws(()=>_test.validateEditorialReceipt(receipt,{...review,checks:{...checks,readerContract:false}},methodVersionId,fingerprint),/not all required/);
  assert.throws(()=>_test.validateEditorialReceipt(receipt,review,methodVersionId,fingerprint,Date.now()+8*86400000),/expired/);
  assert.equal(_test.validateEditorialReceipt(receipt,review,methodVersionId,fingerprint).methodVersionId,methodVersionId);


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
