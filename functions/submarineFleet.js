'use strict';

// The commissioned fleet. Applied idempotently by ensureFleet(): a submarine already in the DB is never touched,
// so later changes (mission, loadout, chart) are made with submarine_update, not here. Each one takes its mission
// and achievements over from the 道場 that already held them.

const AUTHORIZATION = '2026-11-12 チャット（本人）:「project submarineとして、探索系ジョブを各サブマリンがスキルやpackを積んで探索をする…既存のdiscoveryとか仕事DBとかもこの系列に規格化しちゃうとか」「うまく道場と整合性をとりながらやってみて」';

const UNKNOWN_ACTIONS = [
  { key: 'widened', label: '広がった', decision: 'confirmed', tone: 'good' },
  { key: 'curious', label: '気になる', decision: 'candidate', tone: 'neutral' },
  { key: 'known', label: '知ってた', decision: 'declined', tone: 'bad' },
  { key: 'pass', label: '興味なし', decision: 'declined', tone: 'bad' },
];

const FLEET = [
  {
    id: 'discover', hull: 'SS-01', name: 'Discover',
    summary: '本人が開いて「好き」を付ける情報を探し、厳選したものだけを Discover に出す。推薦の正本は personal_feed、本人の好き嫌いの正本は /taste。',
    mode: 'standing', projectIds: ['my-portal'], routineJobIds: ['personal-discovery-curation'],
    migrateFromDojo: 'personal-discovery',
    haulCanonical: { where: 'personal_feed', note: 'ref = personal_feed:<id>。本人が Discover で「好き」を付けると確定する' },
    loadout: [
      { kind: 'chat_skill', id: 'discover-curation', role: 'primary', use: '選書の手順と自己採点' },
      { kind: 'chat_skill', id: 'personal-media-recommendations', role: 'support', versionNumber: 2, use: 'Trakt・AniList・Last.fm の信号の読み方（1〜2章）' },
    ],
    chart: [
      { statement: '海外ミームの経緯を解説する推薦は刺さっていない', basis: 'Know Your Meme・Reddit・Newgrounds 由来の推薦17件に「好き」が0件。', limits: '本人が「海外ミームが嫌い」と言ったわけではない。国内で実際に流行っているものとは区別する。', legacyRef: 'personal-discovery:H-001' },
      { statement: '国内の身近な「見つけもの」を短く読ませる記事は当たりやすい', basis: '明示的な「好き」は高輪ゲートウェイの無料足湯の記事1件。旧RSSリーダーでも国内の軽い記事に反応が寄っていた。', limits: '明示的な「好き」はまだ1件だけ。', legacyRef: 'personal-discovery:H-002' },
    ],
  },
  {
    id: 'job-db', hull: 'SS-02', name: '仕事DB',
    summary: '個人情報の提供を抑えて応募できるオンライン仕事を探す。求人の正本は job_opportunities、本人の目的と判断基準は Thinking Space XtbmAGzuA5IVraHjwgOU。',
    mode: 'standing', projectIds: ['my-portal'], routineJobIds: ['privacy-first-job-discovery'],
    migrateFromDojo: 'privacy-first-job-discovery',
    haulCanonical: { where: 'job_opportunities', note: 'ref = job_opportunities:<id>。本人に勧められる案件だけを成果として持ち帰る' },
    loadout: [{ kind: 'chat_skill', id: 'privacy-first-job-search', role: 'primary', use: '求人の探し方と、応募負荷・個人情報の記録' }],
  },
  {
    id: 'treasure-kw', hull: 'SS-03', name: 'お宝KW',
    summary: '競合が弱く、需要と収益導線のあるキーワードを探す。測定データの正本は Keywords Operator と keywords リポジトリ。',
    mode: 'one_shot', projectIds: ['site-operations'], routineJobIds: [],
    migrateFromDojo: 'treasure-keyword-note',
    haulCanonical: { where: 'here', note: '成果はキーワード。測定値は Keywords Operator にあり、haul.evidence に要点と取得日を書く' },
    loadout: [{ kind: 'chat_skill', id: 'treasure-keyword-discovery', role: 'primary', use: '探し方と測り方' }],
  },
  {
    id: 'unknown', hull: 'SS-04', name: '未知探索',
    summary: '本人がまだ知らない世界（分野・文化・営み）を見つけてきて、興味の範囲を広げる艦。すでに好きなものからの橋と、最初の一歩を添えて持ち帰る。',
    mode: 'one_shot', projectIds: ['my-portal'], routineJobIds: [],
    migrateFromDojo: 'unknown-discovery-engine',
    feedbackActions: UNKNOWN_ACTIONS,
    loadout: [{ kind: 'chat_skill', id: 'unknown-discovery-engine', role: 'primary', use: '未知探索の手順' }],
  },
  {
    id: 'viral-post', hull: 'SS-05', name: 'バズ投稿',
    summary: 'X/Threads の実在投稿の高反応・通常・低反応例から、注意と共有を生む条件付きの投稿作成メカニズムを持ち帰る。',
    mode: 'one_shot', projectIds: ['tweets'], routineJobIds: [],
    migrateFromDojo: 'viral-post-method-discovery',
    loadout: [{ kind: 'chat_skill', id: 'viral-post-method-discovery', role: 'primary', use: '実例・反例からの発見手順' }],
  },
];

// Commission every submarine of the fleet that does not exist yet. Failures are reported per submarine and do not
// stop the others; a missing 道場 or gear leaves that submarine for the next call.
let settled = false;
async function ensureFleet(store, options) {
  if (settled && !(options && options.force)) return { checked: FLEET.length, results: [], settled: true };
  const existing = new Set(((await store.list({})).items || []).map((sub) => sub.id));
  const results = [];
  for (const ship of FLEET) {
    if (existing.has(ship.id)) continue;
    try {
      const { chart, ...spec } = ship;
      await store.commission({ ...spec, userAuthorized: true, authorizationNote: AUTHORIZATION, actor: (options && options.actor) || 'fleet manifest' });
      if (chart && chart.length) await store.update({ submarineId: ship.id, chartEdits: chart, reason: '道場の見立てのうち、探す対象についてのものを海図に移す', actor: 'fleet manifest' });
      results.push({ id: ship.id, commissioned: true });
    } catch (error) {
      results.push({ id: ship.id, commissioned: false, error: String(error?.message || error).slice(0, 300) });
    }
  }
  settled = FLEET.every((ship) => existing.has(ship.id) || results.some((r) => r.id === ship.id && r.commissioned));
  return { checked: FLEET.length, results, settled };
}

module.exports = { FLEET, ensureFleet, AUTHORIZATION };
