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
  { id: 'job-base', title: '仕事DB探索', status: 'active', outcome: { statement: '応募する案件を見つける', target: { min: 1, max: 3 } }, confirmedCount: 0, methodVersion: 'jobdb-r4', runCount: 1, stalledRuns: 0, openRunId: null, awaitingCount: 0, lastRun: { finishedAt: '2026-11-12T02:00:00Z', moved: true } },
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
    events: [{ seq: 1, createdAt: '2026-11-11T14:05:25Z', type: 'hypothesis_created', itemId: 'H-001', summary: '件数より不明点', actor: 'Claude' }],
  },
};

let posted;
beforeEach(() => {
  posted = null;
  global.fetch = jest.fn((url, options) => {
    if (options?.method === 'POST') {
      posted = JSON.parse(options.body);
      return Promise.resolve({ ok: true, json: () => Promise.resolve(DETAIL) });
    }
    const body = String(url).includes('resource=exploration_bases') ? LIST : DETAIL;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  });
});

test('lists bases with a one-line status and progress', async () => {
  renderAt('');
  expect(await screen.findByText('仕事DB探索')).toBeInTheDocument();
  expect(screen.getByText('お宝KW探索')).toBeInTheDocument();
  expect(screen.getByText('3 回続けて進展がありません。進め方の見直しが必要です')).toBeInTheDocument();
  expect(screen.getByText(/最後の実行は/)).toBeInTheDocument();
});

test('detail leads with status, decisions, goal, leading guesses and recent runs; the ledger is folded', async () => {
  renderAt('id=job-base');
  expect(await screen.findByText('あなたの判断を待っている候補が 1 件あります')).toBeInTheDocument();
  expect(screen.getByText('応募すると決められる案件を見つける')).toBeInTheDocument();
  expect(screen.getByText('件数より不明点')).toBeInTheDocument();
  expect(screen.getByText('3つの募集元を調べる')).toBeInTheDocument();
  expect(screen.getByText('件数より不明点：当たり')).toBeInTheDocument();
  // Constraints, rejected guesses and the event log stay out of the first view.
  expect(screen.queryByText('応募はしない')).not.toBeInTheDocument();
  expect(screen.queryByText('棄却された仮説')).not.toBeInTheDocument();

  fireEvent.click(screen.getByText(/詳しく見る/));
  expect(await screen.findByText('棄却された仮説')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /制約/ }));
  expect(screen.getByText('応募はしない')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: '探索法' }));
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
  fireEvent.click(await screen.findByText(/詳しく見る/));
  fireEvent.click(screen.getByRole('tab', { name: '探索法' }));
  expect(screen.getByRole('heading', { name: '測るもの' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: '月10以上' })).toBeInTheDocument();
  expect(document.querySelector('.method-body img')).toBeNull();
});
