import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import CollectionBoard from './CollectionBoard';

jest.mock('../documentDbClient', () => {
  const items = [
    { id: '1', content: 'one', tags: ['A'] },
    { id: '2', content: 'two', tags: ['B'] },
  ];
  return {
    collection: (_db, name) => ({ name }),
    query: (base) => base,
    orderBy: () => null,
    doc: () => ({}),
    serverTimestamp: () => null,
    addDoc: async () => ({ id: 'new' }),
    setDoc: async () => {},
    updateDoc: async () => {},
    deleteDoc: async () => {},
    onSnapshot: (target, next) => {
      const docs = target.name === 'stocks'
        ? items.map((item) => ({ id: item.id, data: () => item }))
        : [];
      next({ docs });
      return () => {};
    },
  };
});

const setup = (collectionName = 'stocks') => render(
  <CollectionBoard database={{}} collectionName={collectionName} tagsCollectionName={null}
    placeholder="ネタを書く" emptyMessage="" deleteConfirmMessage="" draftKey="test:draft" />,
);

beforeEach(() => window.localStorage.clear());

test('switching the tag filter keeps the text being typed', () => {
  setup();
  const input = screen.getByLabelText('ネタを書く');
  fireEvent.change(input, { target: { value: '書きかけ' } });
  act(() => { screen.getAllByRole('button', { name: /^A/ })[0].click(); });
  expect(screen.getByLabelText('ネタを書く').value).toBe('書きかけ');
  act(() => { screen.getAllByRole('button', { name: /^B/ })[0].click(); });
  expect(screen.getByLabelText('ネタを書く').value).toBe('書きかけ');
});

test('draft text survives remounting (board tab switch / page navigation)', () => {
  const { unmount } = setup('stocks');
  fireEvent.change(screen.getByLabelText('ネタを書く'), { target: { value: '移動しても残る' } });
  unmount();
  setup('ideas');
  expect(screen.getByLabelText('ネタを書く').value).toBe('移動しても残る');
});
