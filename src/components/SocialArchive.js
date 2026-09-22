import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { auth } from '../firebase';

const PAGE_SIZE = 50;
const SCAN_LIMIT = 500;

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
  const [facets, setFacets] = useState({ accounts: [], years: [], totalPosts: 0, totalAccounts: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [queryText, setQueryText] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [category, setCategory] = useState('');
  const [type, setType] = useState('');
  const [year, setYear] = useState('');
  const [starredOnly, setStarredOnly] = useState(false);
  const [cursor, setCursor] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [lastScanned, setLastScanned] = useState(0);
  const [editing, setEditing] = useState(null);
  const [editCategory, setEditCategory] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);
  const requestVersionRef = useRef(0);

  const apiRequest = useCallback(async (path, options = {}) => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('ログイン情報を確認できません。');
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || 'API request failed');
    return data;
  }, []);

  useEffect(() => {
    let active = true;
    apiRequest('/api/social-archive?resource=facets')
      .then((data) => {
        if (!active) return;
        setFacets({
          accounts: Array.isArray(data.accounts) ? data.accounts : [],
          years: Array.isArray(data.years) ? data.years : [],
          totalPosts: Number(data.totalPosts || 0),
          totalAccounts: Number(data.totalAccounts || 0),
        });
      })
      .catch((err) => {
        if (active) setError(err.message || 'アーカイブ情報の読み込みに失敗しました。');
      });
    return () => { active = false; };
  }, [apiRequest]);

  const buildPostsPath = useCallback((cursorValue = '') => {
    const params = new URLSearchParams({
      resource: 'posts',
      limit: String(PAGE_SIZE),
      scanLimit: String(SCAN_LIMIT),
    });
    if (queryText.trim()) params.set('query', queryText.trim());
    if (selectedAccountId) params.set('account', selectedAccountId);
    if (category) params.set('category', category);
    if (type) params.set('type', type);
    if (year) params.set('year', String(year));
    if (starredOnly) params.set('starred', 'true');
    if (cursorValue) params.set('cursor', cursorValue);
    return `/api/social-archive?${params.toString()}`;
  }, [queryText, selectedAccountId, category, type, year, starredOnly]);

  const fetchPosts = useCallback(async ({ append = false, cursorValue = '', version }) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');

    try {
      const data = await apiRequest(buildPostsPath(cursorValue));
      if (version !== requestVersionRef.current) return;
      const items = Array.isArray(data.items) ? data.items : [];
      setPosts((current) => append ? [...current, ...items] : items);
      setCursor(data.nextCursor || '');
      setHasMore(Boolean(data.hasMore && data.nextCursor));
      setLastScanned(Number(data.scanned || 0));
    } catch (err) {
      if (version === requestVersionRef.current) {
        setError(err.message || '投稿の読み込みに失敗しました。');
      }
    } finally {
      if (version === requestVersionRef.current) {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    }
  }, [apiRequest, buildPostsPath]);

  useEffect(() => {
    const version = requestVersionRef.current + 1;
    requestVersionRef.current = version;
    setPosts([]);
    setCursor('');
    setHasMore(false);
    setLastScanned(0);

    const timer = setTimeout(() => {
      fetchPosts({ append: false, cursorValue: '', version });
    }, queryText.trim() ? 350 : 0);

    return () => clearTimeout(timer);
  }, [fetchPosts, queryText]);

  const accounts = facets.accounts;
  const years = facets.years;
  const categories = useMemo(() => DEFAULT_CATEGORIES, []);

  const loadMore = () => {
    if (!hasMore || !cursor || loadingMore) return;
    fetchPosts({
      append: true,
      cursorValue: cursor,
      version: requestVersionRef.current,
    });
  };

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
      await apiRequest('/api/social-archive', {
        method: 'POST',
        body: JSON.stringify({
          action: 'update_metadata',
          id: editing.id,
          category: editCategory || '未分類',
          tags,
          note: editNote.trim().slice(0, 4000),
        }),
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
      await apiRequest('/api/social-archive', {
        method: 'POST',
        body: JSON.stringify({ action: 'update_metadata', id: post.id, starred: next }),
      });
      if (starredOnly && !next) {
        setPosts((current) => current.filter((item) => item.id !== post.id));
      }
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
            <Select
              size="small"
              value={selectedAccountId}
              onChange={(event) => setSelectedAccountId(event.target.value)}
              displayEmpty
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="">全アカウント</MenuItem>
              {accounts.map((item) => (
                <MenuItem key={item.accountId} value={item.accountId}>
                  {item.username ? `@${item.username}` : item.accountId}
                  {item.displayName ? ` · ${item.displayName}` : ''}
                </MenuItem>
              ))}
            </Select>
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
            {loading
              ? '読み込み中…'
              : `${posts.length.toLocaleString()}件表示中 / 全${facets.totalPosts.toLocaleString()}件${hasMore ? ' · 続きあり' : ''}`}
            {!loading && lastScanned > PAGE_SIZE && (
              <> · 条件検索で直近{lastScanned.toLocaleString()}件を走査</>
            )}
          </Typography>
        </Stack>
      </Paper>

      <Stack spacing={1}>
        {posts.map((post) => {
          const image = firstImage(post);
          return (
            <Paper key={post.id} variant="outlined" sx={{ p: { xs: 1.2, sm: 1.6 }, borderRadius: 2.5 }}>
              <Stack direction="row" spacing={1.2} alignItems="flex-start">
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={0.6} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Chip size="small" label={post.category || '未分類'} />
                    <Chip size="small" variant="outlined" label={typeLabel(post.type)} />
                    {post.username && <Chip size="small" variant="outlined" label={`@${post.username}`} />}
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

        {!loading && posts.length === 0 && (
          <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', borderRadius: 2.5 }}>
            <Typography color="text.secondary">
              {hasMore ? 'この範囲には一致する投稿がありません。続きを検索できます。' : '条件に一致する投稿がありません。'}
            </Typography>
          </Paper>
        )}

        {!loading && hasMore && (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 1 }}>
            <Button variant="outlined" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? '読み込み中…' : `さらに${PAGE_SIZE}件読み込む`}
            </Button>
          </Box>
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
