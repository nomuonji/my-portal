import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, IconButton, Link, Stack, Typography } from '@mui/material';
import { Bookmark, BookmarkBorder, Favorite, FavoriteBorder, OpenInNew, Refresh, VisibilityOff } from '@mui/icons-material';
import { auth } from '../firebase';

// Discover: only what the curation job found and chose for the user. The RSS reader is gone; reactions here
// (好き / あとで / 興味なし) feed the taste ledger and count toward the Discover exploration base.

const V = {
  bg: 'var(--p-bg)', sunken: 'var(--p-sunken)', ink: 'var(--p-ink)', muted: 'var(--p-muted)', faint: 'var(--p-faint)',
  rule: 'var(--p-rule)', ruleStrong: 'var(--p-rule-strong)', accent: 'var(--p-accent)', pink: 'var(--p-pink)',
};

async function request(path = '', body = null) {
  const user = auth.currentUser;
  if (!user) throw new Error('My Portal にログインしてください');
  const response = await fetch('/api/agent-ideas' + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + await user.getIdToken(), 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '読み込みに失敗しました (' + response.status + ')');
  return data;
}

function dateText(value) {
  const t = Date.parse(value || '');
  if (!Number.isFinite(t)) return '';
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo' }).format(new Date(t));
}

const VIEWS = [
  ['fresh', 'おすすめ', (item) => item.feedback === 'new' || item.feedback === 'seen'],
  ['saved', 'あとで', (item) => item.feedback === 'saved'],
  ['loved', '好き', (item) => item.feedback === 'loved'],
];

function Segmented({ value, onChange, counts }) {
  return (
    <Box role="group" aria-label="表示" sx={{ display: 'inline-flex', border: '1px solid ' + V.ruleStrong, borderRadius: 1.2, overflow: 'hidden' }}>
      {VIEWS.map(([key, text], i) => (
        <Box key={key} component="button" type="button" onClick={() => onChange(key)} aria-pressed={value === key}
          sx={{
            border: 0, borderLeft: i ? '1px solid ' + V.ruleStrong : 0, background: value === key ? V.ink : 'transparent',
            color: value === key ? V.bg : V.muted, font: 'inherit', fontSize: 12.5, fontWeight: 700, px: 1.4, py: 0.65, cursor: 'pointer',
          }}>
          {text}{counts[key] ? ' ' + counts[key] : ''}
        </Box>
      ))}
    </Box>
  );
}

function Actions({ item, onAction, busy }) {
  const liked = item.feedback === 'loved';
  const saved = item.feedback === 'saved';
  const btn = { fontSize: 12.5, fontWeight: 650, minWidth: 0, color: V.muted, borderRadius: 1, px: 1, minHeight: 32, '&:hover': { background: V.sunken, color: V.ink } };
  return (
    <Stack direction="row" alignItems="center" gap={0.3}>
      <Button size="small" disabled={busy} aria-pressed={liked} onClick={() => onAction(item, liked ? 'seen' : 'loved')}
        startIcon={liked ? <Favorite sx={{ color: V.pink }} /> : <FavoriteBorder />} sx={btn}>好き</Button>
      <Button size="small" disabled={busy} aria-pressed={saved} onClick={() => onAction(item, saved ? 'seen' : 'saved')}
        startIcon={saved ? <Bookmark sx={{ color: V.accent }} /> : <BookmarkBorder />} sx={btn}>あとで</Button>
      <Button size="small" disabled={busy} onClick={() => onAction(item, 'skipped')} startIcon={<VisibilityOff sx={{ fontSize: 16 }} />} sx={{ ...btn, color: V.faint }}>
        興味なし
      </Button>
    </Stack>
  );
}

function Pick({ item, onAction, onOpen, busy }) {
  const meta = [item.category, item.creator, dateText(item.publishedAt || item.createdAt)].filter(Boolean).join('　');
  const weakness = item.selfEvaluation?.weakness;
  return (
    <Box component="article" sx={{ py: 2.2, borderBottom: '1px solid ' + V.rule }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: item.videoId ? { xs: '1fr', sm: '200px minmax(0,1fr)' } : '1fr', gap: 2 }}>
        {item.videoId && (
          <Box component="a" href={item.url} target="_blank" rel="noreferrer" onClick={() => onOpen(item)}
            sx={{ display: 'block', aspectRatio: '16/9', borderRadius: 1, overflow: 'hidden', background: V.sunken }}>
            <img src={'https://i.ytimg.com/vi/' + item.videoId + '/mqdefault.jpg'} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </Box>
        )}
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 12, color: V.faint }}>{meta}</Typography>
          <Link href={item.url} target="_blank" rel="noreferrer" underline="hover" onClick={() => onOpen(item)}
            sx={{ display: 'inline', color: V.ink, fontSize: 17, fontWeight: 800, lineHeight: 1.45, overflowWrap: 'anywhere' }}>
            {item.title}<OpenInNew sx={{ fontSize: 14, ml: 0.5, verticalAlign: '-2px', color: V.faint }} />
          </Link>
          {item.description && <Typography sx={{ fontSize: 14, lineHeight: 1.75, mt: 0.8 }}>{item.description}</Typography>}
          {item.reason && (
            <Typography sx={{ fontSize: 13, lineHeight: 1.7, mt: 0.8, color: V.muted }}>
              <b style={{ color: 'var(--p-ink)' }}>選んだ理由</b>　{item.reason}
            </Typography>
          )}
          {weakness && <Typography sx={{ fontSize: 12.5, lineHeight: 1.6, mt: 0.5, color: V.faint }}>合わないかもしれない点　{weakness}</Typography>}
          <Box sx={{ mt: 1, ml: -1 }}><Actions item={item} onAction={onAction} busy={busy} /></Box>
        </Box>
      </Box>
    </Box>
  );
}

export default function PersonalFeed() {
  const [items, setItems] = useState([]);
  const [view, setView] = useState('fresh');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await request('?resource=personal_feed&limit=500');
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const send = useCallback(async (item, status) => {
    setBusyId(item.id); setError('');
    try {
      const updated = await request('', { action: 'personal_feed_feedback', id: item.id, status, expectedRevision: item.revision });
      setItems((list) => list.map((entry) => (entry.id === item.id ? { ...entry, ...updated } : entry)));
    } catch (e) { setError(e.message); } finally { setBusyId(''); }
  }, []);
  // Opening an unread pick marks it seen; seen is not a like.
  const onOpen = useCallback((item) => { if (item.feedback === 'new') send(item, 'seen'); }, [send]);

  const counts = useMemo(() => Object.fromEntries(VIEWS.map(([key, , match]) => [key, items.filter(match).length])), [items]);
  const shown = useMemo(() => {
    const match = VIEWS.find(([key]) => key === view)[2];
    return items.filter(match).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }, [items, view]);

  return (
    <Box sx={{ maxWidth: 820, mx: 'auto', px: { xs: 2, md: 3 }, py: { xs: 2.5, md: 4 } }}>
      <Stack direction="row" alignItems="baseline" justifyContent="space-between" gap={2} flexWrap="wrap">
        <Typography component="h1" sx={{ fontSize: { xs: 24, md: 28 }, fontWeight: 900, letterSpacing: '-0.02em' }}>Discover</Typography>
        <Stack direction="row" alignItems="center" gap={1}>
          <Segmented value={view} onChange={setView} counts={counts} />
          <IconButton aria-label="再読み込み" size="small" onClick={load} disabled={loading}><Refresh fontSize="small" /></IconButton>
        </Stack>
      </Stack>
      <Typography sx={{ fontSize: 13.5, color: V.muted, mt: 0.8, lineHeight: 1.7 }}>
        あなた向けに探して選んだものだけを置いています。「好き」「興味なし」は次に選ぶときの手がかりになります。
        <Link component={RouterLink} to="/exploration?id=personal-discovery" sx={{ ml: 0.8, fontSize: 13 }}>選び方を見る</Link>
      </Typography>

      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      <Box sx={{ mt: 2, borderTop: '1px solid ' + V.ink }}>
        {loading && !items.length ? (
          <Box sx={{ py: 6, textAlign: 'center' }}><CircularProgress size={24} /></Box>
        ) : shown.length ? (
          shown.map((item) => <Pick key={item.id} item={item} onAction={send} onOpen={onOpen} busy={busyId === item.id} />)
        ) : (
          <Typography sx={{ py: 4, color: V.muted, fontSize: 14 }}>
            {view === 'fresh' ? 'いまはおすすめがありません。良いものが見つかったら、ここに追加されます。' : view === 'saved' ? '「あとで」にしたものはありません。' : '「好き」を付けたものはありません。'}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
