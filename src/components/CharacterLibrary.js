import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Avatar, Box, Button, Card, CardActionArea, CardContent, Chip, CircularProgress,
  Divider, FormControl, InputLabel, MenuItem, Paper, Select, Stack, TextField, Typography,
} from '@mui/material';
import { AddPhotoAlternateOutlined, AddOutlined, AutoAwesomeOutlined, SaveOutlined, SearchOutlined } from '@mui/icons-material';
import { auth, db } from '../firebase';
import {
  addDoc, collection, doc, onSnapshot, query, serverTimestamp, updateDoc,
} from '../documentDbClient';

const COLLECTION = 'characters';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const STATUSES = [
  ['draft', '下書き'], ['active', '運用中'], ['paused', '休止'], ['archived', '保管'],
];
const emptyCharacter = () => ({
  name: '', summary: '', personality: '', voice: '', worldview: '', role: '',
  status: 'draft', tags: [], projectIds: [], externalRefs: [], assets: [],
});
const rows = (value) => Array.isArray(value) ? value.join(', ') : '';
const splitCSV = (value) => [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
const getThumbnail = (item) => (item?.assets || []).find((asset) => asset.role === 'avatar')?.url
  || (item?.assets || [])[0]?.url
  || '';
const dateValue = (item) => {
  const raw = item.updatedAt || item.createdAt;
  if (!raw) return 0;
  if (typeof raw.toMillis === 'function') return raw.toMillis();
  return Date.parse(raw) || 0;
};

export default function CharacterLibrary() {
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [tagText, setTagText] = useState('');
  const [projectText, setProjectText] = useState('');
  const [refsText, setRefsText] = useState('');
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    return onSnapshot(query(collection(db, COLLECTION)), (snapshot) => {
      setCharacters(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      setLoading(false);
    }, (cause) => {
      setError('キャラクターDBを読み込めませんでした: ' + cause.message);
      setLoading(false);
    });
  }, []);

  const filtered = useMemo(() => {
    const needle = searchText.toLowerCase().trim();
    return characters
      .filter((item) => statusFilter === 'all' || (item.status || 'draft') === statusFilter)
      .filter((item) => !needle || [
        item.name, item.summary, item.personality, item.voice, item.worldview, item.role,
        ...(item.tags || []), ...(item.projectIds || []),
      ].filter(Boolean).join(' ').toLowerCase().includes(needle))
      .sort((a, b) => dateValue(b) - dateValue(a));
  }, [characters, searchText, statusFilter]);

  const selectCharacter = (item) => {
    setSelectedId(item?.id || null);
    const next = item ? { ...emptyCharacter(), ...item } : emptyCharacter();
    setDraft(next);
    setTagText(rows(next.tags));
    setProjectText(rows(next.projectIds));
    setRefsText(rows(next.externalRefs));
    setError('');
    setNotice('');
  };

  const edit = (key, value) => setDraft((current) => ({ ...current, [key]: value }));

  const saveCharacter = async () => {
    if (!draft || busy) return;
    if (!draft.name.trim()) {
      setError('キャラクター名を入力してください。');
      return;
    }
    setError('');
    setNotice('');
    setBusy(true);
    const data = {
      name: draft.name.trim(),
      summary: draft.summary.trim(),
      personality: draft.personality.trim(),
      voice: draft.voice.trim(),
      worldview: draft.worldview.trim(),
      role: draft.role.trim(),
      status: draft.status,
      tags: splitCSV(tagText),
      projectIds: splitCSV(projectText),
      externalRefs: splitCSV(refsText),
      updatedAt: serverTimestamp(),
    };
    try {
      if (selectedId) {
        await updateDoc(doc(db, COLLECTION, selectedId), data);
      } else {
        const ref = await addDoc(collection(db, COLLECTION), {
          ...data, assets: [], schemaVersion: 1, createdAt: serverTimestamp(),
        });
        setSelectedId(ref.id);
      }
      setDraft((current) => ({ ...current, ...data, tags: data.tags, projectIds: data.projectIds, externalRefs: data.externalRefs }));
      setNotice('保存しました。');
    } catch (cause) {
      setError('保存に失敗しました: ' + cause.message);
    } finally {
      setBusy(false);
    }
  };

  const uploadImage = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!selectedId) {
      setError('先にキャラクターを保存してから画像を追加してください。');
      return;
    }
    if (!ALLOWED_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES || file.size === 0) {
      setError('JPEG / PNG / WebP / GIF / AVIF、8MB以下の画像を選んでください。');
      return;
    }
    if (!auth.currentUser) {
      setError('再ログインしてください。');
      return;
    }
    setUploading(true);
    setError('');
    setNotice('');
    try {
      const idToken = await auth.currentUser.getIdToken();
      const signing = await fetch('/api/imagekit-auth', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + idToken },
      });
      const credentials = await signing.json();
      if (!signing.ok) throw new Error(credentials.error || '画像のアップロード権限を取得できません。');

      const body = new FormData();
      body.append('file', file);
      body.append('fileName', file.name.replace(/[^a-zA-Z0-9._-]/g, '_'));
      body.append('publicKey', credentials.publicKey);
      body.append('signature', credentials.signature);
      body.append('expire', String(credentials.expire));
      body.append('token', credentials.token);
      body.append('folder', '/my-portal/characters/' + selectedId);
      body.append('useUniqueFileName', 'true');
      // For the first release, ImageKit files are public. Do not upload private materials.
      body.append('isPrivateFile', 'false');
      const response = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
        method: 'POST',
        body,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'ImageKitへのアップロードに失敗しました。');
      if (!result.fileId || !String(result.url || '').startsWith('https://')) {
        throw new Error('ImageKitの応答に必要なファイル情報がありません。');
      }

      const asset = {
        id: result.fileId,
        provider: 'imagekit',
        kind: 'image',
        role: draft.assets?.length ? 'reference' : 'avatar',
        url: result.url,
        filePath: result.filePath || '',
        name: file.name,
        size: file.size,
        mimeType: file.type,
        createdAt: new Date().toISOString(),
      };
      const nextAssets = [...(draft.assets || []), asset];
      await updateDoc(doc(db, COLLECTION, selectedId), {
        assets: nextAssets, updatedAt: serverTimestamp(),
      });
      setDraft((current) => ({ ...current, assets: [...(current.assets || []), asset] }));
      setNotice('画像を登録しました。');
    } catch (cause) {
      setError('画像の登録に失敗しました: ' + cause.message + '。アップロード済み画像がImageKitに残っている場合はMedia Libraryで確認してください。');
    } finally {
      setUploading(false);
    }
  };

  const removeReference = async (assetId) => {
    if (!selectedId || busy || uploading) return;
    const next = (draft.assets || []).filter((asset) => asset.id !== assetId);
    setBusy(true);
    try {
      await updateDoc(doc(db, COLLECTION, selectedId), { assets: next, updatedAt: serverTimestamp() });
      setDraft((current) => ({ ...current, assets: next }));
      setNotice('DBから参照を外しました。ImageKit本体のファイルは削除していません。');
      setError('');
    } catch (cause) {
      setError('画像の参照更新に失敗しました: ' + cause.message);
    } finally {
      setBusy(false);
    }
  };

  const makeAvatar = async (assetId) => {
    if (!selectedId || busy) return;
    const next = (draft.assets || []).map((asset) => ({
      ...asset,
      role: asset.id === assetId ? 'avatar' : 'reference',
    }));
    setBusy(true);
    try {
      await updateDoc(doc(db, COLLECTION, selectedId), { assets: next, updatedAt: serverTimestamp() });
      setDraft((current) => ({ ...current, assets: next }));
      setNotice('メイン画像を変更しました。');
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 1440, mx: 'auto', pb: 4 }}>
      <Paper sx={{ p: { xs: 2, md: 3 }, mb: 2, border: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <AutoAwesomeOutlined color="primary" />
          <Typography variant="overline" color="text.secondary" fontWeight={900}>CREATIVE ASSETS</Typography>
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} gap={2} alignItems={{ sm: 'center' }} justifyContent="space-between">
          <Box>
            <Typography variant="h4">キャラクターDB</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.8 }}>
              創作・SNS・メディアを横断する人物設定、画像、関連プロジェクトを管理します。
            </Typography>
          </Box>
          <Button variant="contained" startIcon={<AddOutlined />} onClick={() => selectCharacter(null)}>
            新しいキャラクター
          </Button>
        </Stack>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => setNotice('')}>{notice}</Alert>}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(280px, 0.85fr) minmax(0, 1.65fr)' }, gap: 2 }}>
        <Paper sx={{ p: 1.5, alignSelf: 'start', border: '1px solid', borderColor: 'divider' }}>
          <TextField
            fullWidth size="small" placeholder="キャラクター、タグ、プロジェクトを検索"
            value={searchText} onChange={(event) => setSearchText(event.target.value)}
            InputProps={{ startAdornment: <SearchOutlined sx={{ mr: 1, color: 'text.secondary' }} /> }}
          />
          <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap', my: 1.5 }}>
            {[['all', 'すべて'], ...STATUSES].map(([value, label]) => (
              <Chip key={value} label={label} size="small" clickable color={statusFilter === value ? 'primary' : 'default'}
                variant={statusFilter === value ? 'filled' : 'outlined'} onClick={() => setStatusFilter(value)} />
            ))}
          </Box>
          {loading ? <Box sx={{ py: 5, textAlign: 'center' }}><CircularProgress size={28} /></Box> : (
            <Stack spacing={1}>
              {filtered.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                該当するキャラクターはありません。
              </Typography>}
              {filtered.map((item) => (
                <Card key={item.id} variant="outlined" sx={{ borderColor: selectedId === item.id ? 'primary.main' : 'divider' }}>
                  <CardActionArea onClick={() => selectCharacter(item)}>
                    <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Avatar variant="rounded" src={getThumbnail(item)} sx={{ width: 62, height: 62, bgcolor: 'action.hover' }}>
                        {item.name?.slice(0, 1)}
                      </Avatar>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography fontWeight={800} noWrap>{item.name || '名前なし'}</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>{item.summary || item.role || '説明なし'}</Typography>
                        <Stack direction="row" spacing={0.5} sx={{ mt: 0.6 }}>
                          {(item.tags || []).slice(0, 3).map((tag) => <Chip key={tag} size="small" label={tag} variant="outlined" />)}
                        </Stack>
                      </Box>
                    </CardContent>
                  </CardActionArea>
                </Card>
              ))}
            </Stack>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
            {filtered.length} / {characters.length} 件
          </Typography>
        </Paper>

        <Paper sx={{ p: { xs: 2, sm: 2.5 }, border: '1px solid', borderColor: 'divider', minWidth: 0 }}>
          {!draft ? (
            <Box sx={{ py: 10, textAlign: 'center', color: 'text.secondary' }}>
              <AutoAwesomeOutlined sx={{ fontSize: 38, mb: 1 }} />
              <Typography>左の一覧から選ぶか、新しく作成してください。</Typography>
            </Box>
          ) : (
            <Stack spacing={2}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                <Typography variant="h6">{selectedId ? 'キャラクターを編集' : '新規作成'}</Typography>
                <Button startIcon={<SaveOutlined />} variant="contained" disabled={busy || uploading} onClick={saveCharacter}>
                  {busy ? '保存中' : '保存'}
                </Button>
              </Stack>
              <TextField label="名前" required fullWidth value={draft.name} onChange={(event) => edit('name', event.target.value)} inputProps={{ maxLength: 120 }} />
              <TextField label="短い紹介文" fullWidth value={draft.summary} onChange={(event) => edit('summary', event.target.value)} inputProps={{ maxLength: 500 }} />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="役割・活動領域" fullWidth value={draft.role} onChange={(event) => edit('role', event.target.value)} />
                <FormControl sx={{ minWidth: 140 }}>
                  <InputLabel>状態</InputLabel>
                  <Select label="状態" value={draft.status} onChange={(event) => edit('status', event.target.value)}>
                    {STATUSES.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                  </Select>
                </FormControl>
              </Stack>
              <TextField multiline minRows={2} label="性格・価値観" value={draft.personality} onChange={(event) => edit('personality', event.target.value)} />
              <TextField multiline minRows={2} label="話し方・文体" value={draft.voice} onChange={(event) => edit('voice', event.target.value)} />
              <TextField multiline minRows={2} label="世界観・バックストーリー" value={draft.worldview} onChange={(event) => edit('worldview', event.target.value)} />
              <TextField label="タグ（カンマ区切り）" value={tagText} onChange={(event) => setTagText(event.target.value)} />
              <TextField label="関連Project ID（カンマ区切り）" value={projectText} onChange={(event) => setProjectText(event.target.value)} />
              <TextField label="外部参照（SNS IDやURL、カンマ区切り）" value={refsText} onChange={(event) => setRefsText(event.target.value)} />
              <Divider />
              <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                <Box>
                  <Typography variant="subtitle1" fontWeight={800}>画像ライブラリ</Typography>
                  <Typography variant="caption" color="text.secondary">ImageKitに保存し、DBではファイルIDとURLを参照します。</Typography>
                </Box>
                <Button variant="outlined" component="label" disabled={!selectedId || uploading || busy} startIcon={<AddPhotoAlternateOutlined />}>
                  {uploading ? '送信中…' : '画像追加'}
                  <input hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onChange={uploadImage} />
                </Button>
              </Stack>
              {!selectedId && <Alert severity="info">画像を登録する前にキャラクターを保存してください。</Alert>}
              <Alert severity="warning" icon={false}>
                画像は公開URLで配信されます。非公開資料・個人情報はアップロードしないでください。1枚8MB以下。
              </Alert>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))', gap: 1.2 }}>
                {(draft.assets || []).map((asset) => (
                  <Paper key={asset.id} variant="outlined" sx={{ overflow: 'hidden', p: 0.8 }}>
                    <Box component="img" alt={asset.name || 'キャラクター画像'} src={asset.url}
                      sx={{ width: '100%', height: 120, objectFit: 'contain', borderRadius: 1, bgcolor: 'action.hover' }} />
                    <Typography variant="caption" noWrap sx={{ display: 'block', mt: 0.5 }}>{asset.name}</Typography>
                    {asset.role === 'avatar' ? <Chip size="small" label="メイン画像" color="primary" /> : (
                      <Button size="small" onClick={() => makeAvatar(asset.id)} disabled={busy || uploading}>メインにする</Button>
                    )}
                    <Button fullWidth size="small" color="inherit" disabled={busy || uploading}
                      onClick={() => removeReference(asset.id)}>参照を外す</Button>
                  </Paper>
                ))}
              </Box>
              <Typography variant="caption" color="text.secondary">
                「参照を外す」はDBからのリンク解除のみです。ImageKitの保存容量を空けるにはImageKitのMedia Libraryから元ファイルを削除してください。
              </Typography>
            </Stack>
          )}
        </Paper>
      </Box>
    </Box>
  );
}
