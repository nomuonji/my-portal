import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Submarines, { lampOf } from './Submarines';

let mockQuery = '';
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => {
  const React = require('react');
  return {
    useSearchParams: () => {
      const [params, setParams] = React.useState(() => new URLSearchParams(mockQuery));
      return [params, (next) => setParams(new URLSearchParams(next))];
    },
    useNavigate: () => mockNavigate,
  };
}, { virtual: true });
jest.mock('../firebase', () => ({ auth: { currentUser: { getIdToken: () => Promise.resolve('token') } } }));

const DISCOVER_ACTIONS = [
  { key: 'loved', label: '好き', decision: 'confirmed', tone: 'good' },
  { key: 'saved', label: 'あとで', decision: 'candidate', tone: 'neutral' },
  { key: 'skipped', label: '興味なし', decision: 'declined', tone: 'bad' },
];
const JOB_ACTIONS = [
  { key: 'apply', label: '応募する', decision: 'confirmed', tone: 'good' },
  { key: 'consider', label: '検討中', decision: 'candidate', tone: 'neutral' },
  { key: 'pass', label: '見送る', decision: 'declined', tone: 'bad' },
];
const FLEET = { items: [
  { id: 'discover', hull: 'SS-01', name: 'Discover', status: 'active', mode: 'standing', mission: { statement: '本人が好きを付ける推薦を出す', target: { min: 10 } },
    confirmedCount: 1, candidateCount: 2, loadout: [{ kind: 'chat_skill', id: 'discover-curation', role: 'primary', version: 2, dojoId: 'personal-discovery' }],
    openSortieId: null, sortieCount: 3, stalledSorties: 0, lastSortie: { finishedAt: '2026-11-12T03:00:00Z', moved: true, haulCount: 2 } },
  { id: 'job-db', hull: 'SS-02', name: '仕事DB', status: 'active', mission: { statement: '応募すると決められる案件', target: { min: 1, max: 3 } },
    confirmedCount: 0, candidateCount: 0, loadout: [{ kind: 'chat_skill', id: 'privacy-first-job-search', role: 'primary', version: 1, dojoId: 'privacy-first-job-discovery' }],
    openSortieId: 'S-004', sortieCount: 3, stalledSorties: 0 },
] };
const DISCOVER = {
  submarine: { id: 'discover', hull: 'SS-01', name: 'Discover', summary: '好みの情報を探す', status: 'active', mode: 'standing', routineJobIds: ['personal-discovery-curation'], haulCanonical: { where: 'personal_feed', note: 'ref = personal_feed:<id>' } },
  mission: { statement: '本人が好きを付ける推薦を出す', unit: '好き1件', target: { min: 10 }, acceptance: '① 現物が面白い', confirmedCount: 1, stopConditions: ['10件連続で好きなしなら止める'] },
  loadout: [
    { kind: 'chat_skill', id: 'discover-curation', role: 'primary', version: 2, versionFrom: 'dojo', dojoId: 'personal-discovery', dojoTitle: 'Discover 道場', title: 'Discover Curation', train: true, body: '# 手順\n1. 読む', latestVersion: 3, unreleasedNewer: true },
    { kind: 'chat_skill', id: 'personal-media-recommendations', role: 'support', version: 2, versionFrom: 'pinned', title: 'Media', train: false, body: '' },
  ],
  actions: DISCOVER_ACTIONS,
  haul: {
    awaiting: [{ id: 'C-002', submarineId: 'discover', label: '足湯の記事', ref: 'personal_feed:cur-1', status: 'candidate', sortieId: 'S-003', foundAt: '2026-11-12T03:00:00Z',
      record: { kind: 'discover', title: '駅前の無料足湯', url: 'https://example.com/a', summary: '駅の中に足湯がある', reason: '身近な発見', weakness: '地域が限られる', state: 'new', stateLabel: '未読' } }],
    confirmed: [{ id: 'C-001', submarineId: 'discover', label: '高輪の足湯', status: 'confirmed', decidedAt: '2026-11-11T03:00:00Z', record: { kind: 'discover', title: '高輪の足湯', state: 'loved', stateLabel: '好き' } }],
  },
  recentFeedback: [{ at: '2026-11-12T04:00:00Z', haulId: 'C-009', label: 'ミームの歴史', actionLabel: '興味なし', comment: '前提知識が要る' }],
  chart: [{ id: 'F-001', statement: '海外ミームの経緯解説は刺さらない', basis: '17件で好き0' }],
  position: { sortieCount: 3, stalledSorties: 0, openSortieId: null, lastSorties: [{ finishedAt: '2026-11-12T03:00:00Z', moved: true, haulCount: 1 }] },
  warnings: [],
  full: {
    sorties: [{ id: 'S-003', status: 'finished', moved: true, startedAt: '2026-11-12T02:00:00Z', objective: '国内の見つけもの', summary: '1件', haulIds: ['C-002'], loadout: [{ kind: 'chat_skill', id: 'discover-curation', version: 2 }], dojoRuns: [{ dojoId: 'personal-discovery', runId: 'R-003' }] }],
    declined: [],
    schedule: { jobs: [{ id: 'personal-discovery-curation', title: 'Discover｜好みの情報の厳選', status: 'active', slots: ['04:30', '08:30'], lastRuns: [{ id: 'r1', status: 'completed', startedAt: '2026-11-12T00:00:00Z', summary: '2件追加' }] }] },
  },
};
const JOB = {
  ...DISCOVER,
  submarine: { ...DISCOVER.submarine, id: 'job-db', hull: 'SS-02', name: '仕事DB', haulCanonical: { where: 'job_opportunities' } },
  actions: JOB_ACTIONS,
  haul: { awaiting: [{ id: 'C-001', submarineId: 'job-db', label: 'Search evaluator', status: 'candidate', record: { kind: 'job', title: 'Search Engine Evaluator', url: 'https://example.com/job', reward: '時給$14', summary: '検索結果の評価', details: [{ label: '応募時に出す情報', value: 'CV（必須）' }] } }], confirmed: [] },
  recentFeedback: [],
};

const UNKNOWN_ACTIONS = [
  { key: 'widened', label: '広がった', decision: 'confirmed', tone: 'good' },
  { key: 'known', label: '知ってた', decision: 'declined', tone: 'bad' },
];
const BOARD = {
  items: [
    { ...DISCOVER.haul.awaiting[0], gearVersions: [{ gear: 'chat_skill:discover-curation', role: 'primary', version: 2, dojoId: 'personal-discovery' }], submarine: { id: 'discover', hull: 'SS-01', name: 'Discover', where: 'personal_feed' } },
    { id: 'C-001', submarineId: 'unknown', label: '盆栽の世界', status: 'candidate', foundAt: '2026-11-12T05:00:00Z',
      gearVersions: [{ gear: 'chat_skill:unknown-discovery-engine', role: 'primary', version: 1, dojoId: 'unknown-discovery-engine' }],
      record: { kind: 'note', title: '盆栽の世界', summary: '鉢の中の時間', reason: '知らない営み', bridge: 'ミニチュア好きから', firstStep: 'この動画を1本見る' },
      submarine: { id: 'unknown', hull: 'SS-04', name: '未知探索', where: 'here' } },
  ],
  actions: { personal_feed: DISCOVER_ACTIONS },
  actionsBySubmarine: { discover: DISCOVER_ACTIONS, unknown: UNKNOWN_ACTIONS },
  counts: { discover: { candidate: 1, confirmed: 1 }, 'job-db': { candidate: 0, confirmed: 0 } },
  nextCursor: '15',
};

let posted;
beforeEach(() => {
  posted = [];
  mockNavigate.mockReset();
  global.fetch = jest.fn((url, options) => {
    if (options?.method === 'POST') {
      const body = JSON.parse(options.body);
      posted.push(body);
      const status = body.feedbackAction === 'saved' || body.feedbackAction === 'curious' ? 'candidate' : 'confirmed';
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ haul: { id: body.haulId, submarineId: body.submarineId, status }, actions: body.submarineId === 'unknown' ? UNKNOWN_ACTIONS : DISCOVER_ACTIONS }) });
    }
    if (url.includes('resource=submarines')) return Promise.resolve({ ok: true, json: () => Promise.resolve(FLEET) });
    if (url.includes('resource=submarine_haul')) return Promise.resolve({ ok: true, json: () => Promise.resolve(url.includes('cursor=') ? { ...BOARD, items: [], nextCursor: null } : BOARD) });
    if (url.includes('resource=submarine&id=job-db')) return Promise.resolve({ ok: true, json: () => Promise.resolve(JOB) });
    if (url.includes('resource=submarine&')) return Promise.resolve({ ok: true, json: () => Promise.resolve(DISCOVER) });
    return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'unexpected ' + url }) });
  });
});

test('lamps say where each submarine is and whether it needs the user', () => {
  expect(lampOf({ status: 'active', openSortieId: 'S-1' }).label).toBe('潜航中');
  expect(lampOf({ status: 'active', candidateCount: 2 }).label).toBe('評価待ち');
  expect(lampOf({ status: 'active', stalledSorties: 3, sortieCount: 3 }).label).toBe('要点検');
  expect(lampOf({ status: 'active', sortieCount: 0 }).label).toBe('出航前');
  expect(lampOf({ status: 'paused' }).label).toBe('停泊');
});

test('each fleet card is drawn as a submarine with its hull number, gear and lamp', async () => {
  mockQuery = 'view=fleet';
  render(<Submarines />);
  const card = await screen.findByRole('button', { name: 'SS-01 Discover' });
  expect(within(card).getByRole('img', { name: 'SS-01：評価待ち' })).toBeInTheDocument();
  expect(within(card).getByText(/discover-curation v2/)).toBeInTheDocument();
  fireEvent.click(within(card).getByText(/discover-curation v2/));
  expect(mockNavigate).toHaveBeenCalledWith('/exploration?id=personal-discovery');
  const job = screen.getByRole('button', { name: 'SS-02 仕事DB' });
  expect(within(job).getByRole('img', { name: 'SS-02：潜航中' })).toBeInTheDocument();
});

test('a submarine console shows its own haul as a timeline and evaluates in place', async () => {
  mockQuery = 'id=discover';
  render(<Submarines />);
  expect(await screen.findByText('駅前の無料足湯')).toBeInTheDocument();
  expect(screen.getByText(/定期出航 04:30 08:30 JST/)).toBeInTheDocument();
  expect(global.fetch.mock.calls.some(([url]) => url.includes('resource=submarine_haul') && url.includes('sub=discover'))).toBe(true);
  const post = screen.getByRole('article', { name: '駅前の無料足湯' });
  fireEvent.click(within(post).getByRole('button', { name: '詳しく' }));
  expect(within(post).getByText('地域が限られる')).toBeInTheDocument();
  fireEvent.change(within(post).getByLabelText('コメント'), { target: { value: '近所なら行く' } });
  fireEvent.click(within(post).getByRole('button', { name: '好き' }));
  await waitFor(() => expect(posted[0]).toEqual({ action: 'submarine_haul_feedback', submarineId: 'discover', haulId: 'C-002', feedbackAction: 'loved', comment: '近所なら行く', light: true }));
  await waitFor(() => expect(screen.queryByRole('article', { name: '駅前の無料足湯' })).not.toBeInTheDocument());
});

test('the console keeps the mission, gear, logbook and chart', async () => {
  mockQuery = 'id=discover';
  render(<Submarines />);
  await screen.findByText('駅前の無料足湯');
  fireEvent.click(screen.getByRole('tab', { name: /任務/ }));
  expect(screen.getByText('① 現物が面白い')).toBeInTheDocument();
  expect(screen.getByText(/2件追加/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /装備/ }));
  expect(screen.getByText(/道場をまだ通っていない/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /航海日誌/ }));
  expect(screen.getByText(/personal-discovery R-003/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /海図/ }));
  expect(screen.getByText('海外ミームの経緯解説は刺さらない')).toBeInTheDocument();
});

test('the page opens on the whole fleet\'s timeline: one page, short posts, each submarine\'s own buttons', async () => {
  mockQuery = '';
  render(<Submarines />);
  expect(await screen.findByRole('heading', { name: '全艦の成果' })).toBeInTheDocument();
  expect(await screen.findByText('駅前の無料足湯')).toBeInTheDocument();
  const first = global.fetch.mock.calls.find(([url]) => url.includes('resource=submarine_haul'))[0];
  expect(first).toMatch(/limit=15/);
  expect(first).toMatch(/status=candidate/);
  const unknown = screen.getByRole('article', { name: '盆栽の世界' });
  expect(within(unknown).queryByText('この動画を1本見る')).not.toBeInTheDocument();
  fireEvent.click(within(unknown).getByRole('button', { name: '詳しく' }));
  expect(within(unknown).getByText('この動画を1本見る')).toBeInTheDocument();
  expect(within(unknown).getByText(/unknown-discovery-engine v1/)).toBeInTheDocument();
  fireEvent.click(within(unknown).getByRole('button', { name: '広がった' }));
  await waitFor(() => expect(posted[0]).toMatchObject({ submarineId: 'unknown', haulId: 'C-001', feedbackAction: 'widened', light: true }));
});

test('a submarine chip filters the timeline on the server, and the next page is fetched with the cursor', async () => {
  mockQuery = '';
  render(<Submarines />);
  await screen.findByText('駅前の無料足湯');
  fireEvent.click(screen.getByRole('button', { name: /^Discover/ }));
  await waitFor(() => expect(global.fetch.mock.calls.some(([url]) => url.includes('sub=discover'))).toBe(true));
  fireEvent.click(await screen.findByRole('button', { name: 'さらに読み込む' }));
  await waitFor(() => expect(global.fetch.mock.calls.some(([url]) => url.includes('cursor=15'))).toBe(true));
});
