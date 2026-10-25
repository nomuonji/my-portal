import React, { useCallback, useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { db, hobbyDb } from '../firebase';
import CollectionBoard from './CollectionBoard';

const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

const isPortalIdea = (item) => (
  item?.owner === 'portal'
  || (Boolean(item?.content) && !item?.createdBy && !item?.maturity && !item?.spaceId)
);

const BOARDS = [
  {
    id: 'ideas',
    label: '企画・ビジネス',
    database: db,
    collectionName: 'ideas',
    tagsCollectionName: 'tags',
    eyebrow: 'IDEAS',
    title: 'アイデアボード',
    description: 'ビジネス・企画・作りたいもの・試したいことなど、思いついた短いアイデアを置いておく場所です。',
    placeholder: '思いついたアイデアを書く — 作りたいもの、試したいこと、事業のタネ',
    extraFields: { owner: 'portal' },
    emptyMessage: '上の欄に書いて追加してください。タグは入力しながら付けられます。',
    deleteConfirmMessage: '本当にこのアイデアを削除しますか？',
    itemFilter: isPortalIdea,
  },
  {
    id: 'hobbies',
    label: '興味・趣味',
    database: hobbyDb,
    collectionName: 'hobbies',
    tagsCollectionName: 'hobby_tags',
    eyebrow: 'INTERESTS',
    title: '趣味ボード',
    description: '気になる物・人・場所・作品・テーマなど、興味の対象を短く放り込んでおく場所です。',
    placeholder: '気になる物・人・場所・作品を書く',
    emptyMessage: '上の欄に書いて追加してください。タグは入力しながら付けられます。',
    deleteConfirmMessage: '本当にこの趣味を削除しますか？',
  },
  {
    id: 'stocks',
    label: 'ネタ・表現',
    database: db,
    collectionName: 'stocks',
    tagsCollectionName: 'stock_tags',
    eyebrow: 'STOCK',
    title: 'ストックボード',
    description: 'ネタ帳・大喜利・ユーモア・文体・言い回し・センスなど、言語化しづらい感覚的な素材をストックする場所です。',
    placeholder: 'ネタ・言い回し・ユーモアの断片を書く',
    emptyMessage: '上の欄に書いて追加してください。タグは入力しながら付けられます。',
    deleteConfirmMessage: '本当にこのストックを削除しますか？',
  },
];

// Open on ネタ・表現 unless ?board= says otherwise.
const DEFAULT_BOARD = 'stocks';

export default function PortalBoards() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('board') || DEFAULT_BOARD;
  const selected = BOARDS.some((board) => board.id === requested) ? requested : DEFAULT_BOARD;
  const board = useMemo(() => BOARDS.find((item) => item.id === selected) || BOARDS[0], [selected]);

  const [count, setCount] = useState(null);
  const handleCount = useCallback((value) => setCount(value), []);

  const changeBoard = (_, value) => {
    setCount(null);
    const next = new URLSearchParams(searchParams);
    next.set('board', value);
    setSearchParams(next, { replace: true });
  };

  return (
    <Box sx={{ maxWidth: 1460, mx: 'auto', pb: 8 }}>
      <Box component="header" sx={{ pt: { xs: 1, md: 1.5 } }}>
        <Typography sx={{ fontFamily: MONO, fontSize: { xs: 11, md: 12 }, letterSpacing: '.06em', color: 'text.secondary' }}>
          BOARDS — {board.label}{count !== null ? ` · ${count} items` : ''}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2, mt: 0.6 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography component="h1" sx={{ fontSize: { xs: 30, md: 40 }, fontWeight: 900, letterSpacing: '-.035em', lineHeight: 1.1 }}>
              {board.title}
            </Typography>
            <Typography sx={{ fontSize: { xs: 13.5, md: 14.5 }, color: 'text.secondary', mt: 0.9, maxWidth: 640, lineHeight: 1.7 }}>
              {board.description}
            </Typography>
          </Box>
          <Box role="tablist" aria-label="ボードの種類" sx={{ display: 'inline-flex', border: '1px solid var(--p-rule-strong)', borderRadius: 1.2, overflow: 'hidden', flexShrink: 0, maxWidth: '100%' }}>
            {BOARDS.map((item, i) => {
              const on = item.id === selected;
              return (
                <Box key={item.id} component="button" type="button" role="tab" aria-selected={on} onClick={() => changeBoard(null, item.id)}
                  sx={{
                    border: 0, borderLeft: i ? '1px solid var(--p-rule-strong)' : 0, background: on ? 'var(--p-ink)' : 'transparent',
                    color: on ? 'var(--p-bg)' : 'var(--p-muted)', font: 'inherit', fontSize: 13, fontWeight: 700, px: { xs: 1.3, sm: 1.8 }, py: 0.8,
                    cursor: 'pointer', whiteSpace: 'nowrap', '&:hover': { color: on ? 'var(--p-bg)' : 'var(--p-ink)' },
                  }}>
                  {item.label}
                </Box>
              );
            })}
          </Box>
        </Box>
      </Box>

      <Box sx={{ mt: { xs: 2.5, md: 3.5 } }}>
        <CollectionBoard
          key={board.id}
          database={board.database}
          collectionName={board.collectionName}
          tagsCollectionName={board.tagsCollectionName}
          placeholder={board.placeholder}
          emptyMessage={board.emptyMessage}
          deleteConfirmMessage={board.deleteConfirmMessage}
          itemFilter={board.itemFilter}
          extraFields={board.extraFields}
          onCount={handleCount}
          draftKey="portal-boards:draft"
        />
      </Box>
    </Box>
  );
}
