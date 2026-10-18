'use strict';
const s=(description,maxLength=2000)=>({type:'string',description,maxLength});
const sourceRef={type:'object',additionalProperties:false,properties:{
 kind:{type:'string',enum:['user_message','user_post','discover_item','external_raw','bookmark','other']},
 id:s('Exact original record ID or chat event marker',170),url:s('Optional original HTTPS URL',1200),
 note:s('What was observed, without inventing source meaning',500)
},required:['kind']};
const record={type:'object',additionalProperties:false,properties:{
 title:s('Specific taste rule, verdict or hypothesis; no personality labels',180),
 detail:s('Actual explicit preference or cautious inference and its scope',2300),
 domain:{type:'string',enum:['discover','humor','writing','design','ideas','media','general']},
 evidenceKind:{type:'string',enum:['explicit_user','expression_inference','external_reference','watch_later'],
   description:'Never relabel watch-later as liked, a first-person creative post as explicit viewing preference, or a teacher example as own taste.'},
 direction:{type:'string',enum:['like','dislike','boundary','unknown'],
   description:'like/dislike/boundary only with explicit user message or liked/skipped Discover item; all inferred/reference/bookmark use unknown.'},
 confidence:{type:'number',minimum:0,maximum:1},status:{type:'string',enum:['active','superseded','archived']},
 caveat:s('What this judgment does NOT establish; exceptions and counterexamples',1200),
 origin:s('chat, Discover feedback, manual, observed source',100),
 topicKey:s('Optional normalized pattern identifier for future evidence comparison',140),
 target:{type:'object',additionalProperties:false,properties:{
  kind:{type:'string',enum:['item','creator','genre','pattern','format','editorial_policy','unspecified']},
  key:s('Stable source ID or pattern key if known; never invent an external ID',160),
  label:s('Concrete subject of the judgment',180)
 },required:['kind','label']},
 facets:{type:'array',maxItems:12,items:s('Concrete reason/feature tag, not a broad personality trait',64)},
 appliesTo:{type:'array',maxItems:7,items:{type:'string',enum:['discover','humor','writing','design','ideas','media','general']}},

 sourceRefs:{type:'array',maxItems:12,items:sourceRef}
},required:['title','detail','domain','evidenceKind','direction','sourceRefs']};
const TOOLS=[
 {name:'lastfm_connection_get',description:'Status of Last.fm goodhangedman official API read-only connection (no key contents).',inputSchema:{type:'object',additionalProperties:false,properties:{}},annotations:{readOnlyHint:true}},
 {name:'lastfm_profile_get',description:'Live Last.fm goodhangedman listening data from the official API: play counts, recent tracks, top artists, top tracks, loved tracks. Listening is not explicit liking. Loved tracks are explicit like.',inputSchema:{type:'object',additionalProperties:false,properties:{period:{type:'string',enum:['overall','7day','1month','3month','6month','12month']}}},annotations:{readOnlyHint:true}},
 {name:'trakt_filmarks_migration_status',description:'Read exact migration progress for approved Filmarks @postmodern137 to Trakt copy, with per-item verified/unresolved status and retained source 5 point ratings.',inputSchema:{type:'object',additionalProperties:false,properties:{}},annotations:{readOnlyHint:true}},
 {name:'trakt_filmarks_migration_run',description:'Resume user-approved Filmarks to Trakt one-time transfer in 1-5 entries: unique exact title and production year, external write readback and audit. Continue until pending=0; unresolved require review. Filmarks unchanged.',inputSchema:{type:'object',additionalProperties:false,properties:{limit:{type:'integer',minimum:1,maximum:5}}},annotations:{readOnlyHint:false}},
 {name:'trakt_connection_get',description:'Check current Trakt OAuth connection and linked username, never disclose tokens.',inputSchema:{type:'object',additionalProperties:false,properties:{}},annotations:{readOnlyHint:true}},
 {name:'trakt_profile_get',description:'Live personal Trakt sync watchlist, ratings and history from official API. Separate want-to-watch, explicitly rated and viewed records.',inputSchema:{type:'object',additionalProperties:false,properties:{limit:{type:'integer',minimum:1,maximum:120}}},annotations:{readOnlyHint:true}},
 {name:'trakt_media_search',description:'Batch-search 1..10 film or TV titles against live Trakt official API for Filmarks migration. Return each candidate with year, exact Trakt ID and IMDb/TMDB IDs; never auto-choose an ambiguous candidate. Read only.',inputSchema:{type:'object',additionalProperties:false,properties:{queries:{type:'array',minItems:1,maxItems:10,items:{type:'object',additionalProperties:false,properties:{title:{type:'string',minLength:2,maxLength:160},mediaType:{type:'string',enum:['movie','show']},year:{type:'integer',minimum:1880,maximum:2100}},required:['title']}}},required:['queries']},annotations:{readOnlyHint:true}},
 {name:'trakt_filmarks_import',description:'One-time authorized user-requested migration of up to 8 independently VERIFIED Filmarks @postmodern137 Clip/Mark entries to Trakt @__c4a362; verified canonical Trakt ID and year required. Includes Trakt watched history+rounded rating for Marks and watchlist for Clips, source score audit, idempotency, API readback. Only call after inspecting trakt_media_search results against original Filmarks sources. Do NOT guess title mappings.',inputSchema:{type:'object',additionalProperties:false,properties:{items:{type:'array',minItems:1,maxItems:8,items:{type:'object',additionalProperties:false,properties:{title:{type:'string',minLength:2,maxLength:170},intent:{type:'string',enum:['watchlist','mark']},mediaType:{type:'string',enum:['movie','show']},year:{type:'integer',minimum:1880,maximum:2100},traktId:{type:'integer',minimum:1},filmarksId:{type:'string',maxLength:90},filmarksRating:{type:'number',minimum:0.5,maximum:5}},required:['title','intent','traktId']}}},required:['items']},annotations:{readOnlyHint:false}},
 {name:'trakt_entry_add',description:'Write ONE user-requested film/show to Trakt watchlist or add a 1-10 rating. Requires prior Trakt OAuth and exact Trakt ID. Only call after user explicitly requests change; no speculative rating. Check confirmed added count and first-page readback.',inputSchema:{type:'object',additionalProperties:false,properties:{kind:{type:'string',enum:['watchlist','rating']},mediaType:{type:'string',enum:['movie','show']},traktId:{type:'integer',minimum:1},rating:{type:'integer',minimum:1,maximum:10},changeReason:{type:'string',minLength:5,maxLength:350}},required:['kind','mediaType','traktId','changeReason']},annotations:{readOnlyHint:false}},
 {name:'anilist_connection_get',description:'Check AniList topgear account public/API and owner-authorized editing connection status. Returns NO OAuth credentials.',inputSchema:{type:'object',additionalProperties:false,properties:{}},annotations:{readOnlyHint:true}},
 {name:'anilist_profile_get',description:'Read topgear AniList anime and manga live public lists, status, owner scores and genres. No user login necessary. Use when personally recommending anime or manga; PLANNING does not mean liked.',inputSchema:{type:'object',additionalProperties:false,properties:{type:{type:'string',enum:['ALL','ANIME','MANGA']},limit:{type:'integer',minimum:1,maximum:450}}},annotations:{readOnlyHint:true}},
 {name:'anilist_media_search',description:'Search AniList works by title and select the right canonical AniList media ID. Use before writing ambiguous titles.',inputSchema:{type:'object',additionalProperties:false,properties:{text:{type:'string',minLength:2,maxLength:150},type:{type:'string',enum:['ANIME','MANGA']}},required:['text']},annotations:{readOnlyHint:true}},
 {name:'anilist_entry_get',description:'Read existing topgear AniList user list entry for a media ID before making changes.',inputSchema:{type:'object',additionalProperties:false,properties:{mediaId:{type:'integer',minimum:1}},required:['mediaId']},annotations:{readOnlyHint:true}},
 {name:'anilist_entry_save',description:'On a specific new user request, add/update exactly ONE anime or manga entry on the topgear AniList account using the owner-approved OAuth token. Requires actual user direction, never use speculatively and never mass-edit. Preserve unmentioned fields and verify readback. Status CURRENT/PLANNING/COMPLETED/DROPPED/PAUSED/REPEATING; score on a 0..100 scale. If not authorized, return connection instructions.',inputSchema:{type:'object',additionalProperties:false,properties:{mediaId:{type:'integer',minimum:1},status:{type:'string',enum:['CURRENT','PLANNING','COMPLETED','DROPPED','PAUSED','REPEATING']},score:{type:'number',minimum:0,maximum:100},progress:{type:'integer',minimum:0},progressVolumes:{type:'integer',minimum:0},changeReason:{type:'string',minLength:5,maxLength:300}},required:['mediaId','changeReason']},annotations:{readOnlyHint:false}},
 {name:'taste_external_sources_list',description:'Read user-imported Filmarks Clips and Booklog bookshelf snapshots. These are distinct from direct like/dislike verdicts. No third-party scraping.',inputSchema:{type:'object',additionalProperties:false,properties:{includeItems:{type:'boolean'}}},annotations:{readOnlyHint:true}},
 {name:'taste_evidence_list',description:'Canonical personal-taste evidence ledger. Always distinguish direct verdicts, X-expression hypotheses, Radichichi/Murakami references and watch-later. Use for Discover and other creative work.',inputSchema:{type:'object',additionalProperties:false,properties:{
  limit:{type:'integer',minimum:1,maximum:300},scanLimit:{type:'integer',minimum:1,maximum:450},
  includeInactive:{type:'boolean'},domain:{type:'string',enum:['discover','humor','writing','design','ideas','media','general']},
  evidenceKind:{type:'string',enum:['explicit_user','expression_inference','external_reference','watch_later']},
  direction:{type:'string',enum:['like','dislike','boundary','unknown']}
 }},annotations:{readOnlyHint:true}},
 {name:'taste_profile_get',description:'Aggregate evidence-backed reasons across direct evaluations; exposes conflicting and one-off signals. Inferred expression and saved items NEVER count as preference.',inputSchema:{type:'object',additionalProperties:false,properties:{
  domain:{type:'string',enum:['discover','humor','writing','design','ideas','media','general']}
 }},annotations:{readOnlyHint:true}},
 {name:'taste_evidence_get',description:'Read one preference evidence entry, including provenance, uncertainty and current revision.',inputSchema:{type:'object',additionalProperties:false,properties:{id:s('Exact taste evidence ID',120)},required:['id']},annotations:{readOnlyHint:true}},
 {name:'taste_evidence_upsert',description:'Record a genuine user judgment or cautious inferred/teacher/bookmark evidence; every revision is audited. Requires changeReason and expectedRevision for edits. Never convert inference into explicit user evidence without an actual direct utterance.',inputSchema:{type:'object',additionalProperties:false,properties:{
  id:s('Optional stable taste- ID for idempotent records',120),
  record,expectedRevision:{type:'integer',minimum:1},
  changeReason:s('Who made the correction and why; for audit',400)
 },required:['record','changeReason']},annotations:{readOnlyHint:false,destructiveHint:false}},
 {name:'taste_evidence_history',description:'Read the immutable edit/correction history for one taste evidence ID.',inputSchema:{type:'object',additionalProperties:false,properties:{id:s('Taste ID',120),limit:{type:'integer',minimum:1,maximum:80}},required:['id']},annotations:{readOnlyHint:true}}
];
module.exports={TOOLS};
