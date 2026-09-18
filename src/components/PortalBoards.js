import React, { useMemo } from 'react';
import { Box, Paper, Tab, Tabs, Typography } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { db, hobbyDb } from '../firebase';
import CollectionBoard from './CollectionBoard';

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
    manageLabel: 'アイデアを追加',
    manageRoute: '/idea',
    emptyMessage: '検索条件を変えるか、新しい短いアイデアを追加してください。',
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
    manageLabel: '趣味メモを追加',
    manageRoute: '/hobby',
    emptyMessage: '検索条件を変えるか、新しい短い趣味メモを追加してください。',
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
    manageLabel: 'ストックを追加',
    manageRoute: '/stock',
    emptyMessage: '検索条件を変えるか、新しい短いストックを追加してください。',
    deleteConfirmMessage: '本当にこのストックを削除しますか？',
  },
];

export default function PortalBoards() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('board') || 'ideas';
  const selected = BOARDS.some((board) => board.id === requested) ? requested : 'ideas';
  const board = useMemo(() => BOARDS.find((item) => item.id === selected) || BOARDS[0], [selected]);

  const changeBoard = (_, value) => {
    const next = new URLSearchParams(searchParams);
    next.set('board', value);
    setSearchParams(next, { replace: true });
  };

  return (
    <Box sx={{ minHeight: '100%' }}>
      <Paper
        elevation={0}
        sx={{
          mb: 1.2,
          px: { xs: 0.6, sm: 1 },
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2.5,
          overflow: 'hidden',
        }}
      >
        <Box sx={{ px: { xs: 0.8, sm: 1.1 }, pt: 0.8 }}>
          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 900, letterSpacing: '0.12em' }}>
            PORTAL BOARDS
          </Typography>
        </Box>
        <Tabs
          value={selected}
          onChange={changeBoard}
          variant="fullWidth"
          aria-label="Portal board category"
          sx={{ minHeight: 42, '& .MuiTab-root': { minHeight: 42, fontWeight: 900 } }}
        >
          {BOARDS.map((item) => <Tab key={item.id} value={item.id} label={item.label} />)}
        </Tabs>
      </Paper>

      <CollectionBoard
        key={board.id}
        database={board.database}
        collectionName={board.collectionName}
        tagsCollectionName={board.tagsCollectionName}
        eyebrow={board.eyebrow}
        title={board.title}
        description={board.description}
        manageLabel={board.manageLabel}
        manageRoute={board.manageRoute}
        emptyMessage={board.emptyMessage}
        deleteConfirmMessage={board.deleteConfirmMessage}
        itemFilter={board.itemFilter}
      />
    </Box>
  );
}
