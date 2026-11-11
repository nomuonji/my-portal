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
  { id: 'job-base', title: '仕事DB探索', status: 'active', outcome: { statement: '応募する案件を見つける', target: { min: 1, max: 3 } }, confirmedCount: 0, methodVersion: 'jobdb-r4', runCount: 1, stalledRuns: 0, openRunId: null },
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
  position: { runCount: 1, stalledRuns: 0, openRunId: null, lastRuns: [] },
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

test('lists bases with progress', async () => {
  renderAt('');
  expect(await screen.findByText('仕事DB探索')).toBeInTheDocument();
  expect(screen.getByText('お宝KW探索')).toBeInTheDocument();
  expect(screen.getByText('成果 0 / 1〜3')).toBeInTheDocument();
});

test('shows the fixed points of one base and lets the user confirm a candidate', async () => {
  renderAt('id=job-base');
  expect(await screen.findByText('応募すると決められる案件を見つける')).toBeInTheDocument();
  expect(screen.getAllByText('件数より不明点')).toHaveLength(2); // ledger + event log
  expect(screen.getByText('応募はしない')).toBeInTheDocument();
  expect(screen.getByText('3つの募集元を調べる')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /docs\/treasure-method\.md/ })).toHaveAttribute('href', 'https://github.com/nomuonji/keywords/blob/20a5307/docs/treasure-method.md');
  // Rejected hypotheses are kept but folded away.
  expect(screen.queryByText('棄却された仮説')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText(/棄却・引退した仮説 1 件/));
  expect(await screen.findByText('棄却された仮説')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '確定' }));
  fireEvent.click(await screen.findByRole('button', { name: '確定する' }));
  await waitFor(() => expect(posted).toEqual({ action: 'exploration_achievement_decide', baseId: 'job-base', id: 'A-001', decision: 'confirmed', note: '' }));
});
