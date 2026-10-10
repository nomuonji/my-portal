/* Portal-wide information directory: independent of Spaces and Agent HQ.
 * A single mutable routing record plus live, read-only indexes of existing
 * Projects, Spaces and Methods. No scheduled Manager/Worker is changed.
 */
const { getDocumentDb, FieldValue } = require('./documentDb');
const chatContext = require('./chatContextRegistry');
const contexts = require('./contextRegistry');
const { DEFAULT_GUIDE, validateGuide } = require('./worldHomeGuide');

const DB_ID = process.env.AGENT_IDEAS_DATABASE_ID || '(default)';
const COLLECTION = 'portalContextAtlas';
const DOC_ID = 'home';
const ROUTES = Object.freeze([
  {
    id: 'site-seo', title: 'サイトSEO・インデックス', keywords: ['SEO', 'インデックス', 'GSC', 'GA4', '検索流入', 'サイト改善'],
    description: '運用中サイトの計測、SEO施策、ポートフォリオ方針、公開確認。',
    projectId: 'site-operations', primary: 'Sites Operator',
    tools: ['Sites Operator', 'GitHub'], spaceIds: ['ccRZUrFLFtXPj2CoxJBF'],
    boundary: 'サイトの実測と自動SEO運用はSites Operatorが正本。My PortalにSEO Managerを復活させない。',
  },
  {
    id: 'keywords', title: '検索需要・市場調査', keywords: ['キーワード', 'SERP', '市場探索', 'ショート動画', '検索需要'],
    description: 'キーワード需要、SERP、動画の市場観測、情報源ウォッチ。',
    projectId: 'site-operations', primary: 'Keywords Operator',
    tools: ['Keywords Operator'], spaceIds: ['dCl9tY6FgwkmMsamDUah'],
    boundary: 'SEO情報源のウォッチは研究知見の採用判断とは別。',
  },
  {
    id: 'seo-research', title: 'SEO研究・過去の判断', keywords: ['SEO知見', '検索アルゴリズム', 'SEO研究', '過去のSEO判断'],
    description: 'チャットで議論したSEOの研究・採否理由・合意した境界。',
    projectId: 'site-operations', primary: 'My Portal（SEO知見Space）',
    tools: ['My Portal'], spaceIds: ['ccRZUrFLFtXPj2CoxJBF'],
    boundary: 'この知見はチャットの判断材料。Sites Operatorの定期Manager/Workerには自動注入しない。',
  },
  {
    id: 'website-editorial', title: 'サイト編集・デザイン', keywords: ['UI', 'UX', 'ブランド', 'サイトデザイン', '文章', '記事執筆'],
    description: '個別サイトの世界観、記事、UI・UX。実装と公開状態は各GitHubリポジトリ。',
    projectId: 'site-operations', primary: '対象GitHubリポジトリ',
    tools: ['GitHub', 'Sites Operator', 'My Portal'], spaceIds: ['QUZEAo2LJ7c4XhaMGBj2'],
    boundary: '編集判断と実装先を混同しない。対象サイト固有の規約を優先。',
  },
  {
    id: 'creative', title: 'Creative Intelligence', keywords: ['大喜利', 'ラジ父', '村上RADIO', '創作', '発想', 'キャラクター'],
    description: '発想レンズはMy Portalのチャット用Skill DB、キャラクター設定は専用DB。画像の実体はImageKitの接続先を確認。',
    projectId: 'my-portal', primary: 'My Portal',
    tools: ['My Portal'], spaceIds: ['dCl9tY6FgwkmMsamDUah'],
    boundary: 'ラジ父と大喜利は同じレンズ。チャット用Skill本文はMy PortalのchatSkillsが正本。',
  },
  {
    id: 'skills', title: 'チャット用Skillの所在地', keywords: ['Skill', 'スキル', 'Method', 'SKILL.md', 'ChatGPTスキル'],
    description: 'チャット用Skill本文と更新履歴はMy Portal DBに保存。Manager/Worker MethodはAgent HQ内で扱う。',
    projectId: 'my-portal', primary: 'My Portal chatSkills DB',
    tools: ['My Portal'], spaceIds: [],
    boundary: 'チャット用Skillの正本はMy Portal DB（chatSkills）。GitHubは任意のエクスポート先。Manager/Worker MethodをSkillとして使わない。',
  },
  {
    id: 'sns', title: 'SNS投稿・運用', keywords: ['Threads', 'X投稿', '下書き', 'SNS', '自動投稿'],
    description: 'SNS投稿、人格、在庫、配信実績。',
    projectId: 'tweets', primary: 'Tweets Operator',
    tools: ['Tweets Operator'], spaceIds: [],
    boundary: 'A8の提携/承認状況はFree Consultで管理し、Tweets側に複製しない。',
  },
  {
    id: 'affiliate', title: 'A8・アフィリエイト案件', keywords: ['A8', '承認', 'アフィリエイト', 'Free Consult', '案件'],
    description: 'Free Consultの案件カタログとA8提携・承認状態。',
    projectId: 'affiliate-approval-hub', primary: 'Free Consult',
    tools: ['GitHub', 'My Portal'], spaceIds: [],
    boundary: 'Free ConsultをSEO成長サイトと混同しない。SNS配信はTweets Operator。',
  },
  {
    id: 'learning', title: '司法書士・学習ノート', keywords: ['司法書士', 'Learning OS', '法律', 'Living Note', '学習'],
    description: '学習アプリとノートはLearning OS、法令知識研究はKnowledge Institute。',
    projectId: 'learning-os', primary: 'Learning OS',
    tools: ['Learning OS', 'My Portal', 'GitHub'], spaceIds: ['YDdXPTFVRe1lSmb9GwgF'],
    boundary: '学習者のデータと公開知識研究を分離する。',
  },
  {
    id: 'culture', title: 'Culture Institute', keywords: ['Culture', 'ネット文化', 'Xトレンド', 'Groq', '文化研究'],
    description: 'trend-blogとMy Portalの文化研究。独立した公開系統が共存。',
    projectId: 'culture-institute', primary: 'trend-blog / My Portal',
    tools: ['GitHub', 'My Portal'], spaceIds: ['A0GZ73VhZjmw58m5vlWM'],
    boundary: 'Groq速報 /articles/、研究 /research/、My Portal CMS /features/は別。',
  },
  {
    id: 'publishing', title: 'Public CMS・公開記事', keywords: ['Public CMS', 'CMS', '公開', 'feature', 'Living Page'],
    description: 'My Portalの公開CMSと、各サイトの表示用フロントエンド。',
    projectId: 'my-portal', primary: 'My Portal Public CMS',
    tools: ['My Portal', 'GitHub'], spaceIds: ['9uNcHjZYDLIWGt4JOrcs'],
    boundary: 'CMS保存とGitHub本番反映は別の証拠で検証する。',
  },
  {
    id: 'video', title: 'YouTube・動画制作', keywords: ['YouTube', '動画', '切り抜き', 'Animation Factory'],
    description: '動画の各制作系統。対象選定・在庫・配信をパイプラインごとに確認。',
    projectId: 'video', primary: '各GitHubリポジトリ',
    tools: ['GitHub'], spaceIds: ['youtube-content-methodology'],
    boundary: '動画ワークストリーム間の公開・著作権・稼働状況を混同しない。',
  },
  {
    id: 'agent-hq', title: 'Agent HQ・組織管理', keywords: ['Agent HQ', 'Manager', 'Worker', 'Work Item', '自動化'],
    description: 'My Portal育成組織のManager/Workerと実行キュー。',
    projectId: 'my-portal', primary: 'My Portal Agent HQ',
    tools: ['My Portal'], spaceIds: [],
    boundary: '独立したSite SEO運用はHQの制御対象ではない。',
  },
  {
    id: 'english-notes', title: 'English Notesの収益化', keywords: ['English Notes', 'english.antonbase.com', '英語サイト収益'],
    description: 'English Notes単独サイトの商品、購入導線、サイト内売上。',
    projectId: 'english-notes', primary: 'English Notes（実装リポジトリ要確認）',
    tools: ['GitHub'], spaceIds: [], url: 'https://english.antonbase.com/',
    boundary: '別運用のThreads/A8/Tweets収益事業へ転換しない。Project登録済み、実装repoは未特定。',
  },
]);

const safeText = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const safeArray = (items, max = 30) => Array.isArray(items) ? items.slice(0, max).map(x => safeText(x, 200)).filter(Boolean) : [];
const db = () => getDocumentDb(DB_ID);
function cleanRoute(route) {
  if (!route || typeof route !== 'object' || Array.isArray(route)) throw new Error('route must be an object');
  const id = safeText(route.id, 100);
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('route.id must be kebab-case');
  const title = safeText(route.title, 140);
  if (!title) throw new Error('route.title required');
  return {
    id, title, description: safeText(route.description, 750),
    keywords: safeArray(route.keywords, 25),
    primary: safeText(route.primary, 150),
    projectId: safeText(route.projectId, 160) || null,
    tools: safeArray(route.tools, 20),
    spaceIds: safeArray(route.spaceIds, 20),
    boundary: safeText(route.boundary, 1000),
    url: safeText(route.url, 500) || null,
  };
}
function summarizeProject(p) {
  return {
    id: p.id, name: safeText(p.name || p.title, 230), status: safeText(p.status, 40) || 'unknown',
    description: safeText(p.description, 1300),
    tags: safeArray(p.tags, 25), siteUrl: safeText(p.siteUrl, 500) || null,
    repositories: (p.repositories || []).slice(0, 45).map(r => ({ fullName: safeText(r.fullName, 180), url: safeText(r.url, 500), role: safeText(r.role, 250) })),
    mcpTools: (p.mcpTools || []).slice(0, 30).map(t => ({ name: safeText(t.name, 100), purpose: safeText(t.purpose, 250) })),
    spaceIds: safeArray(p.spaceIds, 30),
  };
}
function summarizeSpace(p) {
  return {
    id: p.id, title: safeText(p.title, 220), status: safeText(p.status, 40),
    summary: safeText(p.summary, 600), tags: safeArray(p.tags, 20),
    themeOwner: safeText(p.themeOwner, 30),
  };
}
function summarizeMethod(p) {
  return {
    id: p.id, title: safeText(p.title, 220), status: safeText(p.status, 40),
    summary: safeText(p.summary, 600), spaceId: safeText(p.spaceId, 160) || null,
    currentVersionNumber: Number(p.currentVersionNumber) || null,
    tags: safeArray(p.tags, 22),
  };
}
async function listCollection(name) {
  const snapshot = await db().collection(name).limit(250).get();
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}
function dateValue(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value === 'string') return value;
  return null;
}
async function ensureAgentGuide() {
  const ref=db().collection(COLLECTION).doc(DOC_ID);
  const before=await ref.get();
  if(before.exists && before.data()?.agentGuide?.instructions)return before;
  // One-time seed: idempotent and never overwrites subsequent UI edits.
  await db().runTransaction(async tx=>{
    const snap=await tx.get(ref);
    if(snap.exists && snap.data()?.agentGuide?.instructions)return;
    const previous=snap.exists?snap.data():{};
    tx.set(ref,{...previous,agentGuide:{...DEFAULT_GUIDE},
      agentGuideUpdatedAt:FieldValue.serverTimestamp(),
      revision:Number(previous.revision)||0});
  });
  return ref.get();
}
async function get() {
  const results = await Promise.allSettled([
    ensureAgentGuide(),
    listCollection('projects'), listCollection('spaces'), listCollection('methods'),
    chatContext.listSkills(), contexts.list(),
  ]);
  const names = ['directory', 'projects', 'spaces', 'methods', 'chatSkills', 'contexts'];
  const warnings = results.flatMap((r, i) => r.status === 'rejected' ? [`${names[i]}: unavailable (${safeText(r.reason?.message || r.reason, 160)})`] : []);
  const settings = results[0].status === 'fulfilled' && results[0].value.exists ? results[0].value.data() : {};
  const edited = Array.isArray(settings.routes) ? settings.routes : [];
  const merged = new Map(ROUTES.map(r => [r.id, { ...r }]));
  edited.forEach(r => {
    try { const c = cleanRoute(r); merged.set(c.id, c); } catch (_) { /* ignore corrupted route */ }
  });
  const deleted = new Set(safeArray(settings.hiddenRouteIds, 100));
  const items = n => (results[n].status === 'fulfilled' ? results[n].value : []);
  const contextRows = results[5].status === 'fulfilled' ? results[5].value.items : [];
  return {
    schemaVersion: 3,
    title: 'My Portal · World Home',
    description: 'Project・Domainと紐づく独立Contexts、Chat Skills、運用Operatorの所在地を案内するホーム。',
    generatedAt: new Date().toISOString(),
    metadataRevision: Number(settings.revision) || 0,
    metadataUpdatedAt: dateValue(settings.updatedAt),
    agentGuide:settings.agentGuide?.instructions ? settings.agentGuide : {...DEFAULT_GUIDE},
    agentGuideUpdatedAt:dateValue(settings.agentGuideUpdatedAt),
    agentGuideStorage:results[0].status==='fulfilled'&&Boolean(settings.agentGuide?.instructions)?'persisted':'fallback-unavailable',
    routes: [...merged.values()].filter(r => !deleted.has(r.id)),
    boundaries: safeArray(settings.boundaries, 40),
    projects: items(1).map(summarizeProject).sort((a,b) => a.name.localeCompare(b.name)),
    spaces: items(2).filter(s=>s.themeOwner!=='assistant').map(summarizeSpace).sort((a,b) => a.title.localeCompare(b.title)),
    contexts: contextRows,
    chatSkills: results[4].status === 'fulfilled' ? results[4].value.items : [],
    methods: items(3).map(summarizeMethod).sort((a,b) => a.title.localeCompare(b.title)),
    coverage: Object.fromEntries(names.slice(1).map((n, i) => [n, results[i+1].status === 'fulfilled' ? 'loaded' : 'unavailable'])),
    registrySemantics: {skills:'My Portal DB / chatSkills',methods:'Agent HQ Manager/Worker execution',contexts:'Independent project/domain context records and decision history',spaces:'Human Thinking Workspace only'}, 
    warnings,
    help: '最初にWorld Homeで担当とProject/Domain別のContextsを確認する。ContextsはSpaceとは別DB。MethodはManager/Worker専用、Skillはチャット用。',
  };
}
async function update(input = {}) {
  if (input.confirm !== true) throw new Error('world_map_update requires confirm=true');
  const expectedRevision = Number(input.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error('expectedRevision must be a nonnegative integer');
  const routes = Array.isArray(input.routes) ? input.routes.map(cleanRoute) : null;
  const hiddenRouteIds = input.hiddenRouteIds === undefined ? null : safeArray(input.hiddenRouteIds, 100);
  const boundaries = input.boundaries === undefined ? null : safeArray(input.boundaries, 40);
  const guide = input.agentGuide === undefined ? null : validateGuide(input.agentGuide);
  if (routes === null && hiddenRouteIds === null && boundaries === null && guide === null) throw new Error('No world map changes');
  if (routes && routes.length > 80) throw new Error('Too many route overrides');
  const ref = db().collection(COLLECTION).doc(DOC_ID);
  await db().runTransaction(async tx => {
    const current = await tx.get(ref);
    const data = current.exists ? current.data() : {};
    if ((Number(data.revision) || 0) !== expectedRevision) throw new Error('World map revision conflict');
    tx.set(ref, {
      ...(data || {}),
      ...(routes !== null ? { routes } : {}),
      ...(hiddenRouteIds !== null ? { hiddenRouteIds } : {}),
      ...(boundaries !== null ? { boundaries } : {}),
      ...(guide !== null ? {agentGuide:{...guide,version:(Number(data.agentGuide?.version)||0)+1},agentGuideUpdatedAt:FieldValue.serverTimestamp()} : {}),
      revision: expectedRevision + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return get();
}
module.exports = { get, update, ROUTES, cleanRoute, summarizeProject, summarizeMethod, summarizeSpace, ensureAgentGuide };
