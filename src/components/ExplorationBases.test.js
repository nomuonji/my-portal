import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ExplorationBases from './ExplorationBases';

// CRA's Jest cannot resolve react-router v7's package exports; stub the one hook the page uses.
let mockQuery = '';
jest.mock('react-router-dom', () => {
  const React = require('react');
  return {
    useSearchParams: () => {
      const [params, setParams] = React.useState(() => new URLSearchParams(mockQuery));
      return [params, (next) => setParams(new URLSearchParams(next))];
    },
  };
}, { virtual: true });

function renderAt(query) {
  mockQuery = query;
  return render(<ExplorationBases />);
}

jest.mock('../firebase', () => ({
  auth: { currentUser: { getIdToken: () => Promise.resolve('token') } },
}));

const LIST = { items: [
  { id: 'job-base', title: '仕事DB探索', status: 'active', target: { kind: 'chat_skill', id: 'discover-curation', versionNumber: 1 }, outcome: { statement: '応募する案件を見つける', target: { min: 1, max: 3 } }, confirmedCount: 0, loop: { rated: 8, pass: 3, passRate: 0.375, currentVersion: 'v1', currentRated: 4, currentPassRate: 0.5, awaiting: 0, failStreak: 0 }, methodVersion: 'jobdb-r4', runCount: 1, stalledRuns: 0, openRunId: null, awaitingCount: 0, lastRun: { finishedAt: '2026-11-12T02:00:00Z', moved: true } },
  { id: 'kw-base', title: 'お宝KW探索', status: 'active', outcome: { statement: '書く語を2〜3本', target: { min: 2, max: 3 } }, confirmedCount: 0, methodVersion: 'tsk-v25', runCount: 0, stalledRuns: 3, openRunId: null },
] };

const DETAIL = {
  base: { id: 'job-base', title: '仕事DB探索', summary: '個人情報を抑えた仕事探し', status: 'active', canonicalData: ['job_opportunities'], updatedAt: '2026-11-11T14:05:25.451Z' },
  outcome: {
    statement: '応募すると決められる案件を見つける', unit: '案件1件', target: { min: 1, max: 3 }, acceptance: '不明点が残っていない',
    confirmedBy: 'user', proxies: ['登録件数'], stopConditions: ['3回空振りで止める'], budget: { maxRuns: null, note: '上限なし' },
    confirmedCount: 0, reached: false,
    awaitingConfirmation: [{ id: 'A-001', runId: 'R-001', foundAt: '2026-11-12T01:00:00Z', label: 'RWS Search Engine Evaluator', evidence: '必須項目と単価を確認済み', ref: 'job_fe34', status: 'candidate' }],
    confirmed: [],
  },
  method: { title: '求人探索法', version: 'jobdb-r4', summary: '定期ジョブの手順', bodyRef: { kind: 'repo', location: 'nomuonji/keywords', path: 'docs/treasure-method.md', commit: '20a5307' }, setAt: '2026-11-11T14:05:01Z' },
  position: { runCount: 1, stalledRuns: 0, openRunId: null, lastRuns: [{ id: 'R-001', finishedAt: '2026-11-12T02:00:00Z', moved: true, nextStep: '有望な2件の不明点を潰す' }] },
  full: {
    hypotheses: [
      { id: 'H-001', kind: 'hypothesis', stage: 'observed', status: 'open', title: '件数より不明点', statement: '判断を止めるのは不明点', limits: '未検証', mechanism: '公開ページに載らない', evidence: [{ type: 'observation', ref: '3件ともUNKNOWN', source: 'https://example.com/a', date: '2026-10-30' }], counterexamples: [] },
      { id: 'H-009', kind: 'hypothesis', stage: 'conjecture', status: 'rejected', title: '棄却された仮説', statement: 'x', statusReason: '反例があった', evidence: [], counterexamples: [] },
    ],
    constraints: [
      { id: 'K-001', kind: 'constraint', owner: 'user', status: 'active', statement: '応募はしない', rationale: '本人の方針' },
      { id: 'K-006', kind: 'constraint', owner: 'environment', status: 'active', statement: '公開ページでは分からない' },
    ],
    methodHistory: [{ version: 'jobdb-r4', summary: '初版', setAt: '2026-11-11T14:05:01Z', motivatingRunIds: [] }],
    proposals: [],
    runs: [{ id: 'R-001', status: 'finished', moved: true, startedAt: '2026-11-12T01:00:00Z', methodVersion: 'jobdb-r4', objective: '3つの募集元を調べる', summary: '1件候補', targets: [{ hypothesisId: 'H-001', prediction: '不明点が残る' }], verdicts: [{ hypothesisId: 'H-001', result: 'supported', observed: '2件で不明点' }] }],
    events: [
      { seq: 2, createdAt: '2026-11-12T02:00:00Z', type: 'run_finished', runId: 'R-001', summary: '1件候補' },
      { seq: 1, createdAt: '2026-11-11T14:05:25Z', type: 'hypothesis_created', itemId: 'H-001', summary: '件数より不明点', actor: 'Claude' },
    ],
  },
};

const AWAITING = { items: [] };
let posted;
beforeEach(() => {
  posted = null;
  global.fetch = jest.fn((url, options) => {
    if (options?.method === 'POST') {
      posted = JSON.parse(options.body);
      return Promise.resolve({ ok: true, json: () => Promise.resolve(DETAIL) });
    }
    if (String(url).includes('resource=exploration_awaiting_trials')) return Promise.resolve({ ok: true, json: () => Promise.resolve(AWAITING) });
    const body = String(url).includes('resource=exploration_bases') ? LIST : DETAIL;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  });
});

test('lists bases with a one-line status and progress', async () => {
  renderAt('');
  expect(await screen.findByText('仕事DB探索')).toBeInTheDocument();
  expect(screen.getByText('お宝KW探索')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'スキル錬成道場' })).toBeInTheDocument();
  expect(screen.getByText(/discover-curation/)).toHaveTextContent('v1');
  expect(screen.getByText('3 回続けて進展がありません。進め方の見直しが必要です')).toBeInTheDocument();
  expect(screen.getByText(/最後の実行は/)).toBeInTheDocument();
  // The measure is the pass rate of the version in use, not a count against a target.
  expect(screen.getByText('50%')).toBeInTheDocument();
  expect(screen.getByText('合格率（いまの版・4件）')).toBeInTheDocument();
  expect(screen.getByText('合格率（評価はまだありません）')).toBeInTheDocument();
  expect(screen.queryByText('確定した成果')).not.toBeInTheDocument();
});

test('detail keeps status and decisions on top and puts each part of the base in its own tab', async () => {
  renderAt('id=job-base');
  expect(await screen.findByText('あなたの判断を待っている候補が 1 件あります')).toBeInTheDocument();
  // Goal tab is open first and holds the pass criteria.
  expect(screen.getByText('応募すると決められる案件を見つける')).toBeInTheDocument();
  expect(screen.getByText('不明点が残っていない')).toBeInTheDocument();
  expect(screen.queryByText('応募はしない')).not.toBeInTheDocument();

  // 経過 holds runs and changes to the base in one dated list, without the duplicate run events.
  fireEvent.click(screen.getByRole('tab', { name: '経過' }));
  expect(screen.getByText('3つの募集元を調べる')).toBeInTheDocument();
  expect(screen.getByText('件数より不明点：当たり')).toBeInTheDocument();
  expect(screen.getByText('見立てを追加')).toBeInTheDocument();
  expect(screen.queryByText('実行（進展あり）')).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: /実行記録|履歴/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /見立て/ }));
  expect(screen.getByText('棄却された仮説')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /制約/ }));
  expect(screen.getByText('応募はしない')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'スキル本文' }));
  expect(screen.getByRole('link', { name: /docs\/treasure-method\.md/ })).toHaveAttribute('href', 'https://github.com/nomuonji/keywords/blob/20a5307/docs/treasure-method.md');

  fireEvent.click(screen.getByRole('button', { name: '成果にする' }));
  const dialogButtons = await screen.findAllByRole('button', { name: '成果にする' });
  fireEvent.click(dialogButtons[dialogButtons.length - 1]);
  await waitFor(() => expect(posted).toEqual({ action: 'exploration_achievement_decide', baseId: 'job-base', id: 'A-001', decision: 'confirmed', note: '' }));
});

test('an inline method body is rendered as text on the page, with raw HTML escaped', async () => {
  const inline = { ...DETAIL, method: { title: '求人探索法', version: 'jobdb-r5', summary: 's', bodyRef: { kind: 'inline', location: '' },
    body: '## 測るもの\n\n| 言葉 | 線 |\n|---|---|\n| 検索されている | 月10以上 |\n\n<img src=x onerror=alert(1)>' } };
  global.fetch = jest.fn((url) => Promise.resolve({ ok: true, json: () => Promise.resolve(String(url).includes('exploration_bases') ? LIST : inline) }));
  renderAt('id=job-base');
  fireEvent.click(await screen.findByRole('tab', { name: 'スキル本文' }));
  expect(screen.getByRole('heading', { name: '測るもの' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: '月10以上' })).toBeInTheDocument();
  expect(document.querySelector('.method-body img')).toBeNull();
});

test('sources have their own tab, ordered by how well they are verified', async () => {
  const withSources = { ...DETAIL, full: { ...DETAIL.full, sources: [
    { id: 'S-001', kind: 'source', stage: 'yielded_candidate', status: 'open', title: 'はてブ おもしろ', locator: 'https://b.hatena.ne.jp/hotentry/fun', coverage: '軽い国内ネタ',
      evidence: [{ type: 'observation', ref: '好きが3件' }, { type: 'candidate', ref: '候補1件' }], counterexamples: [] },
    { id: 'S-002', kind: 'source', stage: 'conjecture', status: 'open', title: 'デイリーポータルZ', locator: 'https://dailyportalz.jp', coverage: '未試行', evidence: [], counterexamples: [] },
    { id: 'S-003', kind: 'source', stage: 'observed', status: 'rejected', title: 'Know Your Meme', locator: 'https://knowyourmeme.com', coverage: 'ミーム史', statusReason: '選んだ17件が全部スキップ', evidence: [], counterexamples: ['全スキップ'] },
  ] } };
  global.fetch = jest.fn((url) => Promise.resolve({ ok: true, json: () => Promise.resolve(String(url).includes('exploration_bases') ? LIST : withSources) }));
  renderAt('id=job-base');
  fireEvent.click(await screen.findByRole('tab', { name: '情報源 2' }));
  expect(screen.getAllByText('候補を生んだ').length).toBe(2); // group heading and item badge
  expect(screen.getByText('候補 1')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'https://b.hatena.ne.jp/hotentry/fun' })).toBeInTheDocument();
  expect(screen.getAllByText('未検証').length).toBe(2);
  expect(screen.getByText('選んだ17件が全部スキップ')).toBeInTheDocument();
  expect(screen.getByText('外した')).toBeInTheDocument();
});

test('a skill target shows which version execution uses and flags a newer unreleased one', async () => {
  const skill = { ...DETAIL, method: { title: '選書', version: 'disc-s1', summary: 's', setAt: '2026-11-12T01:00:00Z',
    bodyRef: { kind: 'chat_skill', location: 'discover-curation', versionNumber: 1 },
    target: { kind: 'chat_skill', id: 'discover-curation', title: 'Discover 選書', releasedVersion: 1, latestVersion: 3, unreleasedNewer: true },
    body: '## 手順\n\n1. 読む' } };
  global.fetch = jest.fn((url) => Promise.resolve({ ok: true, json: () => Promise.resolve(String(url).includes('exploration_bases') ? LIST : skill) }));
  renderAt('id=job-base');
  fireEvent.click(await screen.findByRole('tab', { name: 'スキル本文' }));
  expect(screen.getAllByText(/Discover 選書/).length).toBeGreaterThan(0);
  expect(screen.getByText(/v3 がこの道場の外で作られています/)).toBeInTheDocument();
  expect(screen.getByText(/道場を通っていない v3 があります/)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '手順' })).toBeInTheDocument();
});

test('the 道場 shows the user\'s evaluations grouped by the version that produced them', () => {
  const { VersionFeedback } = require('./ExplorationBases');
  render(<VersionFeedback feedback={{ byVersion: [
    { version: 2, released: true, total: 3, confirmed: 2, declined: 1, candidate: 0, comments: [{ text: '前提知識が要る', actionLabel: '興味なし', label: 'ミーム史' }] },
    { version: null, total: 1, confirmed: 0, declined: 0, candidate: 1, comments: [] },
  ] }} />);
  expect(screen.getByText('v2（いま実行で使う版）')).toBeInTheDocument();
  expect(screen.getByText('判断したもののうち成果 67%')).toBeInTheDocument();
  expect(screen.getByText(/前提知識が要る/)).toBeInTheDocument();
  expect(screen.getByText('版の記録なし')).toBeInTheDocument();
});

test('the 道場 shows the pass rate by version, what waits for the user and the last ratings', () => {
  const { LoopPanel } = require('./ExplorationBases');
  render(<LoopPanel loop={{
    byVersion: [
      { version: 'v52', released: true, rated: 4, pass: 1, partial: 1, fail: 2, passRate: 0.25 },
      { version: 'v44', released: false, rated: 5, pass: 3, partial: 0, fail: 2, passRate: 0.6 },
    ],
    calibration: { predicted: 4, hitRate: 0.5 },
    awaiting: [{ id: 'T-020', label: '母親の推薦で口説く男' }],
    lastRated: [{ id: 'T-019', label: '辞めた会社のLINEグループ', verdict: 'pass', at: '2026-11-15T01:00:00Z', userWords: '合格。いいね' }],
    nextActions: ['いまの版の合格率 25% は、前の版 v44 の 60% を下回っている。増やした規則を疑う。'],
  }} />);
  expect(screen.getByText('v52（いまの版）')).toBeInTheDocument();
  expect(screen.getByText('25%')).toBeInTheDocument();
  expect(screen.getByText('60%')).toBeInTheDocument();
  expect(screen.getByText('惜しい 1')).toBeInTheDocument();
  expect(screen.getByText(/AIの事前予測が当たった割合 50%/)).toBeInTheDocument();
  expect(screen.getByText('母親の推薦で口説く男')).toBeInTheDocument();
  expect(screen.getByText(/合格。いいね/)).toBeInTheDocument();
  expect(screen.getByText(/前の版 v44 の 60% を下回っている/)).toBeInTheDocument();
});

test('samples waiting for the user are rated from the list with one press and an optional line', async () => {
  AWAITING.items = [{ baseId: 'buzz', baseTitle: 'バズ投稿道場', id: 'T-031', label: '母親の推薦で口説く男', body: '本文そのもの', createdAt: '2026-11-15T01:00:00Z' }];
  renderAt('');
  expect(await screen.findByText('評価待ちの見本 1件')).toBeInTheDocument();
  expect(screen.getByText('本文そのもの')).toBeInTheDocument();
  expect(screen.getByText('バズ投稿道場')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('母親の推薦で口説く男 への一言'), { target: { value: '話者が変' } });
  fireEvent.click(screen.getByRole('button', { name: 'ボツ' }));
  await waitFor(() => expect(posted).toEqual({ action: 'exploration_trial_rate', baseId: 'buzz', id: 'T-031', verdict: 'fail', comment: '話者が変' }));
  AWAITING.items = [];
});
