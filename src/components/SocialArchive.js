import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
  IconButton, InputAdornment, MenuItem, Paper, Select, Stack, Switch, TextField, Typography,
} from '@mui/material';
import {
  Bookmark as BookmarkIcon,
  BookmarkBorder as BookmarkBorderIcon,
  OpenInNew as OpenInNewIcon,
  Search as SearchIcon,
  Twitter as TwitterIcon,
} from '@mui/icons-material';
import { collection, doc, getDocs, limit, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

const DEFAULT_CATEGORIES = [
  '未分類',
  '日常',
  'ネタ・ユーモア',
  '人間関係',
  '恋愛',
  '学習・資格',
  '技術・AI',
  'SNS・ネット',
  '趣味・作品',
  '思想・考察',
  'その他',
];

function timestampToDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function displayDate(value) {
  const date = timestampToDate(value);
  if (!date) return '日付不明';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function metricLabel(post) {
  const metrics = post.metrics || {};
  return `♡ ${metrics.likes || 0}   ↻ ${metrics.reposts || 0}`;
}

function firstImage(post) {
  return (post.media || []).find((item) => item?.type === 'photo' && item?.mediaUrl)?.mediaUrl || '';
}

function typeLabel(type) {
  if (type === 'reply') return '返信';
  if (type === 'quote') return '引用';
  if (type === 'repost') return 'リポスト';
  return '投稿';
}

export default function SocialArchive() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [queryText, setQueryText] = useState('');
  const [category, setCategory] = useState('');
  const [type, setType] = useState('');
  const [year, setYear] = useState('');
  const [starredOnly, setStarredOnly] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editCategory, setEditCategory] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const snap = await getDocs(query(collection(db, 'social_posts'), orderBy('postedAt', 'desc'), limit(5000)));
      setPosts(snap.docs.map((item) => ({ id: item.id, ...item.data() })));
    } catch (err) {
      setError(err.message || '投稿の読み込みに失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const categories = useMemo(() => {
    const dynamic = posts.map((post) => post.category).filter(Boolean);
    return [...new Set([...DEFAULT_CATEGORIES, ...dynamic])];
  }, [posts]);

  const years = useMemo(() => {
    const values = posts.map((post) => timestampToDate(post.postedAt)?.getFullYear()).filter(Boolean);
    return [...new Set(values)].sort((a, b) => b - a);
  }, [posts]);

  const visiblePosts = useMemo(() => {
    const needle = queryText.trim().toLowerCase();
    return posts.filter((post) => {
      if (category && post.category !== category) return false;
      if (type && post.type !== type) return false;
      if (year && timestampToDate(post.postedAt)?.getFullYear() !== Number(year)) return false;
      if (starredOnly && !post.starred) return false;
      if (needle) {
        const haystack = [
          post.text, post.category, post.note, post.username,
          ...(post.tags || []), ...(post.hashtags || []),
        ].filter(Boolean).join('\n').toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [posts, queryText, category, type, year, starredOnly]);

  const openEdit = (post) => {
    setEditing(post);
    setEditCategory(post.category || '未分類');
    setEditTags((post.tags || []).join(', '));
    setEditNote(post.note || '');
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const tags = [...new Set(editTags.split(',').map((item) => item.trim()).filter(Boolean))].slice(0, 30);
      await updateDoc(doc(db, 'social_posts', editing.id), {
        category: editCategory || '未分類',
        tags,
        note: editNote.trim().slice(0, 4000),
        updatedAt: serverTimestamp(),
      });
      setPosts((current) => current.map((post) => post.id === editing.id
        ? { ...post, category: editCategory || '未分類', tags, note: editNote.trim().slice(0, 4000) }
        : post));
      setEditing(null);
    } catch (err) {
      setError(err.message || '更新に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const toggleStar = async (post) => {
    const next = !post.starred;
    setPosts((current) => current.map((item) => item.id === post.id ? { ...item, starred: next } : item));
    try {
      await updateDoc(doc(db, 'social_posts', post.id), { starred: next, updatedAt: serverTimestamp() });
    } catch (err) {
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, starred: !next } : item));
      setError(err.message || 'お気に入り更新に失敗しました。');
    }
  };

  return (
    <Box sx={{ maxWidth: 1050, mx: 'auto', pb: 4 }}>
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Stack direction="row" spacing={0.8} alignItems="center">
          <TwitterIcon color="primary" />
          <Typography variant="overline" color="text.secondary" fontWeight={900} letterSpacing="0.12em">
            SOCIAL ARCHIVE
          </Typography>
        </Stack>
        <Typography variant="h4" fontWeight={950}>X投稿アーカイブ</Typography>
        <Typography color="text.secondary">
          過去投稿を検索・分類して、自分のログを見返すためのアーカイブです。インポートはChatGPT経由で行います。
        </Typography>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError('')}>{error}</Alert>}

      <Paper variant="outlined" sx={{ p: 1.2, mb: 1.5, borderRadius: 2.5 }}>
        <Stack spacing={1}>
          <TextField
            fullWidth size="small" value={queryText} onChange={(event) => setQueryText(event.target.value)}
            placeholder="本文・タグ・メモを検索"
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Select size="small" value={category} onChange={(event) => setCategory(event.target.value)} displayEmpty sx={{ minWidth: 160 }}>
              <MenuItem value="">すべてのカテゴリ</MenuItem>
              {categories.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
            </Select>
            <Select size="small" value={type} onChange={(event) => setType(event.target.value)} displayEmpty sx={{ minWidth: 120 }}>
              <MenuItem value="">すべて</MenuItem>
              <MenuItem value="post">投稿</MenuItem>
              <MenuItem value="reply">返信</MenuItem>
              <MenuItem value="quote">引用</MenuItem>
              <MenuItem value="repost">リポスト</MenuItem>
            </Select>
            <Select size="small" value={year} onChange={(event) => setYear(event.target.value)} displayEmpty sx={{ minWidth: 120 }}>
              <MenuItem value="">全年</MenuItem>
              {years.map((item) => <MenuItem key={item} value={item}>{item}年</MenuItem>)}
            </Select>
            <FormControlLabel
              control={<Switch checked={starredOnly} onChange={(event) => setStarredOnly(event.target.checked)} />}
              label="お気に入り"
            />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {loading ? '読み込み中…' : `${visiblePosts.length.toLocaleString()} / ${posts.length.toLocaleString()} 件`}
          </Typography>
        </Stack>
      </Paper>

      <Stack spacing={1}>
        {visiblePosts.map((post) => {
          const image = firstImage(post);
          return (
            <Paper key={post.id} variant="outlined" sx={{ p: { xs: 1.2, sm: 1.6 }, borderRadius: 2.5 }}>
              <Stack direction="row" spacing={1.2} alignItems="flex-start">
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={0.6} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Chip size="small" label={post.category || '未分類'} />
                    <Chip size="small" variant="outlined" label={typeLabel(post.type)} />
                    {(post.tags || []).slice(0, 4).map((tag) => <Chip key={tag} size="small" variant="outlined" label={tag} />)}
                    <Typography variant="caption" color="text.secondary">{displayDate(post.postedAt)}</Typography>
                  </Stack>

                  <Typography sx={{ mt: 1, whiteSpace: 'pre-wrap', lineHeight: 1.65, fontSize: '0.98rem' }}>
                    {post.text || '—'}
                  </Typography>

                  {image && (
                    <Box
                      component="img"
                      src={image}
                      alt=""
                      loading="lazy"
                      sx={{ mt: 1, maxWidth: '100%', maxHeight: 360, borderRadius: 2, objectFit: 'contain', bgcolor: 'action.hover' }}
                    />
                  )}

                  {post.note && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1, pl: 1, borderLeft: '3px solid', borderColor: 'divider' }}>
                      {post.note}
                    </Typography>
                  )}

                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                    <Typography variant="caption" color="text.secondary">{metricLabel(post)}</Typography>
                    <Button size="small" onClick={() => openEdit(post)}>分類・メモ</Button>
                    {post.url && (
                      <Button size="small" component="a" href={post.url} target="_blank" rel="noreferrer" endIcon={<OpenInNewIcon />}>
                        Xで開く
                      </Button>
                    )}
                  </Stack>
                </Box>
                <IconButton aria-label="お気に入り" onClick={() => toggleStar(post)} color={post.starred ? 'primary' : 'default'}>
                  {post.starred ? <BookmarkIcon /> : <BookmarkBorderIcon />}
                </IconButton>
              </Stack>
            </Paper>
          );
        })}

        {!loading && visiblePosts.length === 0 && (
          <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', borderRadius: 2.5 }}>
            <Typography color="text.secondary">条件に一致する投稿がありません。</Typography>
          </Paper>
        )}
      </Stack>

      <Dialog open={Boolean(editing)} onClose={() => !saving && setEditing(null)} fullWidth maxWidth="sm">
        <DialogTitle>分類・メモ</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <Select value={editCategory} onChange={(event) => setEditCategory(event.target.value)} fullWidth>
              {categories.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
            </Select>
            <TextField
              fullWidth value={editTags} onChange={(event) => setEditTags(event.target.value)}
              label="タグ" helperText="カンマ区切り"
            />
            <TextField
              fullWidth multiline minRows={4} value={editNote} onChange={(event) => setEditNote(event.target.value)}
              label="メモ"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)} disabled={saving}>キャンセル</Button>
          <Button variant="contained" onClick={saveEdit} disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
