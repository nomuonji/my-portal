import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PersonalFeed from './PersonalFeed';

jest.mock('react-router-dom', () => ({ Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a> }), { virtual: true });
jest.mock('../firebase', () => ({ auth: { currentUser: { getIdToken: () => Promise.resolve('token') } } }));

const ITEMS = [
  { id: 'cur-a', title: '高輪ゲートウェイの足湯', url: 'https://example.com/a', description: '無料の足湯', reason: '軽い国内の見つけもの', category: 'ネット文化', creator: 'ロケットニュース24', feedback: 'new', revision: 1, createdAt: '2026-11-12T01:00:00Z', selfEvaluation: { weakness: '短い' } },
  { id: 'cur-b', title: 'あとでの記事', url: 'https://example.com/b', feedback: 'saved', revision: 2, createdAt: '2026-11-11T01:00:00Z' },
];

let posted;
beforeEach(() => {
  posted = null;
  global.fetch = jest.fn((url, options) => {
    if (options?.method === 'POST') {
      posted = JSON.parse(options.body);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...ITEMS[0], feedback: posted.status, revision: 2 }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: ITEMS }) });
  });
});

test('shows only curated picks, with the reason they were chosen, and sends reactions', async () => {
  render(<PersonalFeed />);
  expect(await screen.findByText('高輪ゲートウェイの足湯')).toBeInTheDocument();
  expect(screen.getByText(/軽い国内の見つけもの/)).toBeInTheDocument();
  expect(screen.queryByText('あとでの記事')).not.toBeInTheDocument();
  expect(String(global.fetch.mock.calls[0][0])).toContain('resource=personal_feed');
  expect(screen.queryByText(/RSS/)).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '選び方を見る' })).toHaveAttribute('href', '/exploration?id=personal-discovery');

  fireEvent.click(within(screen.getByRole('article')).getByRole('button', { name: '好き' }));
  await waitFor(() => expect(posted).toEqual({ action: 'personal_feed_feedback', id: 'cur-a', status: 'loved', expectedRevision: 1 }));

  fireEvent.click(screen.getByRole('button', { name: /あとで 1/ }));
  expect(screen.getByText('あとでの記事')).toBeInTheDocument();
});
