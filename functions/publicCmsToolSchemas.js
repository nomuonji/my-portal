const CONFIRM = { type: 'boolean', description: 'Public CMSへの書き込みを確定するときtrue。公開操作はユーザーの明示的な依頼がある場合だけ行う。' };
const SEO = { type:'object', additionalProperties:false, properties:{
  primaryKeyword:{type:'string',maxLength:240}, secondaryKeywords:{type:'array',items:{type:'string',maxLength:240},maxItems:30},
  searchIntent:{type:'string',maxLength:120}, title:{type:'string',maxLength:300}, description:{type:'string',maxLength:500},
  canonicalPath:{type:'string',maxLength:500}, noindex:{type:'boolean'}
}};
const CONTENT = { type:'object', additionalProperties:false, properties:{
  title:{type:'string',minLength:1,maxLength:300}, summary:{type:'string',maxLength:3000}, bodyMarkdown:{type:'string',maxLength:100000},
  contentType:{type:'string',maxLength:80}, tags:{type:'array',items:{type:'string',maxLength:120},maxItems:50}, seo:SEO
}};
const SOURCE = { type:'object', additionalProperties:false, properties:{ type:{type:'string',maxLength:80}, id:{type:'string',maxLength:200}, spaceId:{type:'string',maxLength:200}, note:{type:'string',maxLength:1000} } };
const siteId = {type:'string',minLength:1,maxLength:120};
const slug = {type:'string',minLength:1,maxLength:300};
const TOOLS = [
 {name:'public_cms_status',description:'My Portal Public CMSの接続状態を確認します。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'public_site_list',description:'Public CMSの配信先サイト一覧を取得します。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'public_site_upsert',description:'Public CMSの配信先サイトを作成・更新します。front-end repoは別管理で、ここには配信契約だけを保存します。',inputSchema:{type:'object',properties:{siteId,site:{type:'object',additionalProperties:true},confirm:CONFIRM},required:['siteId','site','confirm'],additionalProperties:false},annotations:{readOnlyHint:false}},
 {name:'public_content_list',description:'指定サイトのCMSコンテンツ一覧を取得します。draftとpublished snapshotを含む管理用データです。',inputSchema:{type:'object',properties:{siteId,status:{type:'string',enum:['draft','published','archived']},limit:{type:'integer',minimum:1,maximum:500}},required:['siteId'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'public_content_get',description:'指定サイト・slugのCMSコンテンツを管理用形式で取得します。',inputSchema:{type:'object',properties:{siteId,slug},required:['siteId','slug'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'public_content_create',description:'privateな思考や会話からPublic CMSへ公開候補draftを作成します。sourceRefsはprivate provenanceで公開APIには出ません。',inputSchema:{type:'object',properties:{siteId,slug,content:CONTENT,sourceRefs:{type:'array',items:SOURCE,maxItems:30},seoResearch:{type:'object',additionalProperties:true},confirm:CONFIRM},required:['siteId','slug','content','confirm'],additionalProperties:false},annotations:{readOnlyHint:false}},
 {name:'public_content_update',description:'Public CMSのdraft本文・SEO metadata・source provenanceを更新します。公開中でもlive snapshotはpublishするまで変わりません。',inputSchema:{type:'object',properties:{siteId,slug,content:CONTENT,sourceRefs:{type:'array',items:SOURCE,maxItems:30},seoResearch:{type:'object',additionalProperties:true},confirm:CONFIRM},required:['siteId','slug','confirm'],additionalProperties:false},annotations:{readOnlyHint:false}},
 {name:'public_content_publish',description:'draftをpublished snapshotへコピーし、revisionを保存して公開します。',inputSchema:{type:'object',properties:{siteId,slug,confirm:CONFIRM},required:['siteId','slug','confirm'],additionalProperties:false},annotations:{readOnlyHint:false}},
 {name:'public_content_archive',description:'公開コンテンツをarchiveし、匿名公開APIから除外します。',inputSchema:{type:'object',properties:{siteId,slug,confirm:CONFIRM},required:['siteId','slug','confirm'],additionalProperties:false},annotations:{readOnlyHint:false}}
];
module.exports = { TOOLS };
