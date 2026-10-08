const CONFIRM = { type: 'boolean', description: 'Public CMSへの書き込みを確定するときtrue。公開操作はユーザーの明示的な依頼がある場合だけ行う。' };
const SEO = { type:'object', additionalProperties:false, properties:{
  primaryKeyword:{type:'string',maxLength:240}, secondaryKeywords:{type:'array',items:{type:'string',maxLength:240},maxItems:30},
  searchIntent:{type:'string',maxLength:120}, title:{type:'string',maxLength:300}, description:{type:'string',maxLength:500},
  canonicalPath:{type:'string',maxLength:500}, noindex:{type:'boolean'}
}};
const BLOCK_BASE = {
  id:{type:'string',maxLength:120},
  placement:{type:'string',enum:['before-body','after-body']},
  title:{type:'string',maxLength:300}
};
const DATASET_COLUMN = {type:'object',additionalProperties:false,properties:{
  key:{type:'string',maxLength:80},label:{type:'string',maxLength:120},
  type:{type:'string',enum:['text','status','date','url','number','boolean']},primary:{type:'boolean'}
},required:['key']};
const BLOCK = {type:'object',additionalProperties:true,properties:{
  ...BLOCK_BASE,
  type:{type:'string',enum:['markdown','dataset','timeline','summary','diagram']},
  markdown:{type:'string',maxLength:50000},
  text:{type:'string',maxLength:5000},
  items:{type:'array',maxItems:200},
  status:{type:'string',maxLength:120},
  mermaid:{type:'string',maxLength:30000},
  description:{type:'string',maxLength:3000},
  view:{type:'string',enum:['table','cards','matrix','tracker']},
  columns:{type:'array',items:DATASET_COLUMN,maxItems:20},
  records:{type:'array',items:{type:'object',additionalProperties:true},maxItems:500},
  sort:{type:'object',additionalProperties:false,properties:{key:{type:'string',maxLength:80},direction:{type:'string',enum:['asc','desc']}}}
},required:['type']};
const CONTENT = { type:'object', additionalProperties:false, properties:{
  title:{type:'string',minLength:1,maxLength:300}, summary:{type:'string',maxLength:3000}, bodyMarkdown:{type:'string',maxLength:100000},
  contentType:{type:'string',maxLength:80}, tags:{type:'array',items:{type:'string',maxLength:120},maxItems:50},
  keyTakeaways:{type:'array',items:{type:'string',maxLength:500},maxItems:8},
  blocks:{type:'array',items:BLOCK,maxItems:40},
  locale:{type:'string',enum:['ja','en']}, translationGroupId:{type:'string',maxLength:300},
  originalLocale:{type:'string',enum:['ja','en']}, translatedFromRevision:{type:'integer',minimum:1},
  seo:SEO
}};
const SOURCE = { type:'object', additionalProperties:false, properties:{ type:{type:'string',maxLength:80}, id:{type:'string',maxLength:200}, spaceId:{type:'string',maxLength:200}, note:{type:'string',maxLength:1000} } };
const siteId = {type:'string',minLength:1,maxLength:120};
const slug = {type:'string',minLength:1,maxLength:300};
const TOOLS = [
 {name:'public_cms_status',description:'My Portal Public CMSの接続状態を確認します。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'public_site_list',description:'Public CMSの配信先サイト一覧を取得します。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'public_site_upsert',description:'Public CMSの配信先サイトを作成・更新します。front-end repoは別管理で、ここには配信契約だけを保存します。',inputSchema:{type:'object',properties:{siteId,site:{type:'object',additionalProperties:true},confirm:CONFIRM},required:['siteId','site','confirm'],additionalProperties:false},annotations:{readOnlyHint:false}},
 {name:'public_site_deploy_status',description:'サイト別のCloudflare Deploy Hook設定状態を、secret値を返さず確認します。',inputSchema:{type:'object',properties:{siteId},required:['siteId'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'public_site_trigger_deploy',description:'設定済みCloudflare Deploy Hookを手動でtriggerします。Hook URL自体は返しません。',inputSchema:{type:'object',properties:{siteId,confirm:CONFIRM},required:['siteId','confirm'],additionalProperties:false},annotations:{readOnlyHint:false}},
 {name:'public_content_list',description:'指定サイトのCMSコンテンツ一覧を取得します。draftとpublished snapshotを含む管理用データです。',inputSchema:{type:'object',properties:{siteId,status:{type:'string',enum:['draft','published','archived']},limit:{type:'integer',minimum:1,maximum:500}},required:['siteId'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'public_content_get',description:'指定サイト・slugのCMSコンテンツを管理用形式で取得します。',inputSchema:{type:'object',properties:{siteId,slug},required:['siteId','slug'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'public_content_create',description:'必ず先にpublic_content_editorial_prepareを実行して現行執筆Method全文を取得し、返されたreviewIdをeditorialSessionIdとして渡してdraftを作成する。未読の編集セッションでは作成を拒否。private provenanceは公開しない。',inputSchema:{type:'object',properties:{siteId,slug,content:CONTENT,editorialSessionId:{type:'string',minLength:8,maxLength:100},sourceRefs:{type:'array',items:SOURCE,maxItems:30},seoResearch:{type:'object',additionalProperties:true},confirm:CONFIRM},required:['siteId','slug','content','editorialSessionId','confirm'],additionalProperties:false},annotations:{readOnlyHint:false}},
 {name:'public_content_update',description:'draft本文・公開SEO metadataの編集前にpublic_content_editorial_prepareで現行執筆Methodを読み、そのreviewIdをeditorialSessionIdへ渡す。本文更新時は必須。private provenanceのみの更新には不要。公開済みsnapshotはpublishまで変わらない。',inputSchema:{type:'object',properties:{siteId,slug,content:CONTENT,editorialSessionId:{type:'string',minLength:8,maxLength:100},sourceRefs:{type:'array',items:SOURCE,maxItems:30},seoResearch:{type:'object',additionalProperties:true},confirm:CONFIRM},required:['siteId','slug','confirm'],additionalProperties:false},annotations:{readOnlyHint:false}},
 {name:'public_content_privacy_scan',description:'draftの公開フィールドをdeterministic privacy scanします。秘密値そのものは返さず、検出カテゴリとフィールドだけを返します。semantic privacy reviewの代替ではありません。',inputSchema:{type:'object',properties:{siteId,slug},required:['siteId','slug'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'public_content_editorial_prepare',description:'執筆前および公開前に必須。現行Public Content Publishing Methodの指示全文と品質ゲートを取得し、draft未作成ならbegin_writingセッション、既存draftならreview_draftセッションを返す。作成・編集ではreviewIdをeditorialSessionIdとして使用。最終編集後に改めてprepareしてapproveする。',inputSchema:{type:'object',properties:{siteId,slug},required:['siteId','slug'],additionalProperties:false},annotations:{readOnlyHint:false}},
 {name:'public_content_editorial_approve',description:'公開前の必須編集工程2/2。prepareした最新draftのReader Contract・構成・連続具体例・用語・全文編集・事実確認・privacyをレビューし、私的なreviewNotes付きで明示確認する。省略またはdraft変更時はpublish拒否。人が読んで理解できることをソフトウェアが自動で保証するものではありません。',inputSchema:{type:'object',properties:{siteId,slug,reviewId:{type:'string',minLength:8,maxLength:100},checks:{type:'object',properties:{readerContract:{type:'boolean'},narrativeStructure:{type:'boolean'},concreteExampleOrRationale:{type:'boolean'},terminologyExplained:{type:'boolean'},wholeArticleEdit:{type:'boolean'},factsAndUncertainty:{type:'boolean'},semanticPrivacy:{type:'boolean'}},required:['readerContract','narrativeStructure','concreteExampleOrRationale','terminologyExplained','wholeArticleEdit','factsAndUncertainty','semanticPrivacy'],additionalProperties:false},reviewNotes:{type:'string',minLength:80,maxLength:3000},reviewer:{type:'string',minLength:1,maxLength:120},confirm:CONFIRM},required:['siteId','slug','reviewId','checks','reviewNotes','reviewer','confirm'],additionalProperties:false},annotations:{readOnlyHint:false}},
 {name:'public_content_publish',description:'privacy gateに加えて、現行Public Content Publishing Methodを取得・確認済みの有効な編集review receiptがあるdraftだけをpublished snapshotへコピーし、revisionを保存して公開します。メール・電話・credential/token等の高信頼パターンを検出した場合は拒否します。サイト別Cloudflare Deploy Hookが設定済みならrebuildもtriggerします。',inputSchema:{type:'object',properties:{siteId,slug,confirm:CONFIRM},required:['siteId','slug','confirm'],additionalProperties:false},annotations:{readOnlyHint:false}},
 {name:'public_content_archive',description:'公開コンテンツをarchiveし、匿名公開APIから除外します。サイト別Cloudflare Deploy Hookが設定済みならrebuildもtriggerします。',inputSchema:{type:'object',properties:{siteId,slug,confirm:CONFIRM},required:['siteId','slug','confirm'],additionalProperties:false},annotations:{readOnlyHint:false}}
];
module.exports = { TOOLS };
