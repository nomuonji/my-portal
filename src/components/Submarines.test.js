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

const FLEET = { items: [
  { id: 'discover', hull: 'SS-01', name: 'Discover', status: 'active', mode: 'standing', mission: { statement: '本人が好きを付ける推薦を出す', target: { min: 10 } },
    confirmedCount: 1, candidateCount: 2, loadout: [{ kind: 'chat_skill', id: 'discover-curation', role: 'primary', version: 2, dojoId: 'personal-discovery' }],
    openSortieId: null, sortieCount: 3, stalledSorties: 0, lastSortie: { finishedAt: '2026-11-12T03:00:00Z', moved: true, haulCount: 2 } },
  { id: 'jobs', hull: 'SS-02', name: '仕事DB', status: 'active', mission: { statement: '応募すると決められる案件', target: { min: 1, max: 3 } },
    confirmedCount: 0, candidateCount: 0, loadout: [{ kind: 'chat_skill', id: 'privacy-first-job-search', role: 'primary', version: 1, dojoId: 'privacy-first-job-discovery' }],
    openSortieId: 'S-004', sortieCount: 3, stalledSorties: 0 },
] };
const DETAIL = {
  submarine: { id: 'discover', hull: 'SS-01', name: 'Discover', summary: '好みの情報を探す', status: 'active', mode: 'standing', routineJobIds: ['personal-discovery-curation'], haulCanonical: { where: 'personal_feed', note: 'ref = personal_feed:<id>' } },
  mission: { statement: '本人が好きを付ける推薦を出す', unit: '好き1件', target: { min: 10 }, acceptance: '① 現物が面白い', confirmedCount: 1, stopConditions: ['10件連続で好きなしなら止める'] },
  loadout: [
    { kind: 'chat_skill', id: 'discover-curation', role: 'primary', version: 2, versionFrom: 'dojo', dojoId: 'personal-discovery', dojoTitle: 'Discover 道場', title: 'Discover Curation', train: true, body: '# 手順\n1. 読む', latestVersion: 3, unreleasedNewer: true },
    { kind: 'chat_skill', id: 'personal-media-recommendations', role: 'support', version: 2, versionFrom: 'pinned', title: 'Media', train: false, body: '' },
  ],
  haul: {
    awaiting: [{ id: 'C-002', label: '足湯の記事', url: 'https://example.com/a', evidence: '身近な発見', status: 'candidate', sortieId: 'S-003', foundAt: '2026-11-12T03:00:00Z' }],
    confirmed: [{ id: 'C-001', label: '高輪の足湯', evidence: '好き', status: 'confirmed', decidedAt: '2026-11-11T03:00:00Z' }],
  },
  chart: [{ id: 'F-001', statement: '海外ミームの経緯解説は刺さらない', basis: '17件で好き0' }],
  position: { sortieCount: 3, stalledSorties: 0, openSortieId: null, lastSorties: [{ finishedAt: '2026-11-12T03:00:00Z', moved: true, haulCount: 1 }] },
  warnings: [],
  full: { sorties: [{ id: 'S-003', status: 'finished', moved: true, startedAt: '2026-11-12T02:00:00Z', objective: '国内の見つけもの', summary: '1件', haulIds: ['C-002'], loadout: [{ kind: 'chat_skill', id: 'discover-curation', version: 2 }], dojoRuns: [{ dojoId: 'personal-discovery', runId: 'R-003' }] }], declined: [] },
};

let posted;
beforeEach(() => {
  posted = [];
  mockNavigate.mockReset();
  global.fetch = jest.fn((url, options) => {
    if (options?.method === 'POST') { posted.push(JSON.parse(options.body)); return Promise.resolve({ ok: true, json: () => Promise.resolve(DETAIL) }); }
    if (url.includes('resource=submarines')) return Promise.resolve({ ok: true, json: () => Promise.resolve(FLEET) });
    if (url.includes('resource=submarine_haul')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [{ ...DETAIL.haul.awaiting[0], submarineId: 'discover', submarine: { hull: 'SS-01', name: 'Discover' } }] }) });
    if (url.includes('resource=submarine&')) return Promise.resolve({ ok: true, json: () => Promise.resolve(DETAIL) });
    return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'unexpected ' + url }) });
  });
});

test('lamps say where each submarine is and whether it needs the user', () => {
  expect(lampOf({ status: 'active', openSortieId: 'S-1' }).label).toBe('潜航中');
  expect(lampOf({ status: 'active', candidateCount: 2 }).label).toBe('判断待ち');
  expect(lampOf({ status: 'active', stalledSorties: 3, sortieCount: 3 }).label).toBe('要点検');
  expect(lampOf({ status: 'active', sortieCount: 0 }).label).toBe('出航前');
  expect(lampOf({ status: 'paused' }).label).toBe('停泊');
});

test('the fleet shows each submarine with its gear version and opens the gear 道場', async () => {
  mockQuery = '';
  render(<Submarines />);
  expect(await screen.findByText('探索の艦隊')).toBeInTheDocument();
  const card = (await screen.findAllByText('Discover')).map((el) => el.closest('article')).find(Boolean);
  expect(within(card).getByText('判断待ち')).toBeInTheDocument();
  expect(within(card).getByText(/discover-curation v2/)).toBeInTheDocument();
  fireEvent.click(within(card).getByText(/discover-curation v2/));
  expect(mockNavigate).toHaveBeenCalledWith('/exploration?id=personal-discovery');
  expect(screen.getAllByText('潜航中').length).toBeGreaterThan(0);
  expect(screen.getByText('判断待ちの成果')).toBeInTheDocument();
});

test('the console shows mission, gear from the 道場, logbook and chart, and decides haul', async () => {
  mockQuery = 'id=discover';
  render(<Submarines />);
  expect(await screen.findByText('好みの情報を探す')).toBeInTheDocument();
  expect(screen.getByText('① 現物が面白い')).toBeInTheDocument();
  expect(screen.getByText(/personal_feed（ref = personal_feed:<id>）/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '成果にする' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '成果にする' }));
  await waitFor(() => expect(posted[0]).toEqual({ action: 'submarine_haul_decide', submarineId: 'discover', haulId: 'C-002', decision: 'confirmed', note: '' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(await screen.findByRole('tab', { name: /装備/ }));
  expect(screen.getByText(/道場をまだ通っていない/)).toBeInTheDocument();
  expect(screen.getByText(/道場なし/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /航海日誌/ }));
  expect(screen.getByText('国内の見つけもの')).toBeInTheDocument();
  expect(screen.getByText(/personal-discovery R-003/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /海図/ }));
  expect(screen.getByText('海外ミームの経緯解説は刺さらない')).toBeInTheDocument();
});

test('the fleet-wide haul view lists every submarine catch', async () => {
  mockQuery = 'view=haul';
  render(<Submarines />);
  expect(await screen.findByText('足湯の記事')).toBeInTheDocument();
  expect(screen.getByText(/すべての潜水艦が持ち帰ったもの/)).toBeInTheDocument();
});
