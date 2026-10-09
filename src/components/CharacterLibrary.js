import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, ButtonBase, Card, CardActionArea, CardContent, Chip, CircularProgress,
  Dialog, DialogContent, DialogTitle, Divider, FormControl, IconButton, InputLabel, MenuItem, Paper, Select, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import { AddPhotoAlternateOutlined, AddOutlined, ArrowBackIosNewOutlined, ArrowForwardIosOutlined, CloseOutlined, EditOutlined, ImageOutlined, OpenInNewOutlined, SaveOutlined, SearchOutlined, ZoomInOutlined } from '@mui/icons-material';
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
  const [viewedId, setViewedId] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [activeAssetId, setActiveAssetId] = useState(null);
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
    const next = item ? { ...emptyCharacter(), ...item, voice: item.voice || item.speechStyle || '' } : emptyCharacter();
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


  const viewed = characters.find((item) => item.id === viewedId) || null;
  const viewedAssets = (viewed?.assets || [])
    .filter((asset) => asset?.url)
    .slice()
    .sort((a, b) => Number(b.role === 'reference') - Number(a.role === 'reference'));
  // A full reference sheet is the default detail image; the avatar remains the gallery thumbnail.
  const activeAsset = viewedAssets.find((asset) => asset.id === activeAssetId) || viewedAssets[0] || null;
  const activeAssetIndex = activeAsset ? viewedAssets.findIndex((asset) => asset.id === activeAsset.id) : -1;
  const viewedIndex = filtered.findIndex((item) => item.id === viewedId);

  const openCharacter = (item) => {
    setViewedId(item.id);
    setActiveAssetId(null);
    setLightboxOpen(false);
  };
  const navigateCharacter = (step) => {
    if (!filtered.length || viewedIndex < 0) return;
    openCharacter(filtered[(viewedIndex + step + filtered.length) % filtered.length]);
  };
  const navigateImage = (step) => {
    if (!viewedAssets.length) return;
    const next = viewedAssets[(activeAssetIndex + step + viewedAssets.length) % viewedAssets.length];
    setActiveAssetId(next.id);
  };
  const openEditor = (item) => {
    selectCharacter(item);
    setViewedId(null);
    setLightboxOpen(false);
    setEditOpen(true);
  };

  return (
    <Box sx={{ maxWidth: 1660, mx: 'auto', pb: 6 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'flex-end' }} spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 2, fontWeight: 800 }}>CHARACTER LIBRARY</Typography>
          <Typography variant="h4" fontWeight={800}>キャラクター</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            ビジュアルから探して、設定画と人物像をまとめて閲覧できます。
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddOutlined />} onClick={() => openEditor(null)} sx={{ alignSelf: { xs: 'flex-start', sm: 'auto' } }}>
          新しいキャラクター
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice('')}>{notice}</Alert>}

      <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, mb: 2.5, borderRadius: 3 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} gap={1.5} alignItems={{ md: 'center' }} justifyContent="space-between">
          <TextField
            size="small" placeholder="名前・設定・タグで検索"
            value={searchText} onChange={(event) => setSearchText(event.target.value)}
            InputProps={{ startAdornment: <SearchOutlined sx={{ mr: 1, color: 'text.secondary' }} /> }}
            sx={{ width: { xs: '100%', md: 360 }, maxWidth: '100%' }}
            aria-label="キャラクターを検索"
          />
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
            {[['all', 'すべて'], ...STATUSES].map(([value, label]) => (
              <Chip key={value} label={label} size="small" clickable
                color={statusFilter === value ? 'primary' : 'default'}
                variant={statusFilter === value ? 'filled' : 'outlined'}
                onClick={() => setStatusFilter(value)} />
            ))}
          </Stack>
        </Stack>
      </Paper>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}><CircularProgress /></Box>
      ) : (
        <>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            {filtered.length} 件表示 / 全 {characters.length} 件
          </Typography>
          {filtered.length === 0 ? (
            <Paper variant="outlined" sx={{ py: 9, px: 2, textAlign: 'center', borderRadius: 3 }}>
              <ImageOutlined sx={{ fontSize: 42, color: 'text.disabled', mb: 1 }} />
              <Typography fontWeight={700}>該当するキャラクターはありません</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                検索語や状態フィルターを変更してください。
              </Typography>
            </Paper>
          ) : (
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
              gap: { xs: 1.25, sm: 2.25 },
            }}>
              {filtered.map((item) => {
                const thumbnail = getThumbnail(item);
                const imageCount = (item.assets || []).filter((asset) => asset?.url).length;
                const statusLabel = STATUSES.find(([status]) => status === (item.status || 'draft'))?.[1] || '下書き';
                return (
                  <Card key={item.id} variant="outlined" sx={{
                    borderRadius: 3, overflow: 'hidden', boxShadow: 'none',
                    transition: 'transform 160ms ease, box-shadow 160ms ease',
                    '&:hover': { transform: 'translateY(-3px)', boxShadow: 3 },
                    '&:focus-within': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
                  }}>
                    <CardActionArea onClick={() => openCharacter(item)} aria-label={(item.name || '名前なし') + 'の画像と設定を開く'}
                      sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', height: '100%' }}>
                      <Box sx={{ position: 'relative', width: '100%', aspectRatio: '4 / 3', bgcolor: 'action.hover',
                        backgroundImage: 'linear-gradient(145deg, rgba(255,255,255,.38), transparent 70%)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        {thumbnail ? (
                          <Box component="img" loading="lazy" src={thumbnail} alt="" sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        ) : (
                          <Stack alignItems="center" spacing={0.5} sx={{ color: 'text.disabled' }}>
                            <ImageOutlined sx={{ fontSize: 40 }} />
                            <Typography variant="caption">画像未登録</Typography>
                          </Stack>
                        )}
                        {imageCount > 1 && (
                          <Chip label={'画像 ' + imageCount + '枚'} size="small" sx={{
                            position: 'absolute', bottom: 9, right: 9, bgcolor: 'background.paper',
                            fontWeight: 700, boxShadow: 1,
                          }} />
                        )}
                      </Box>
                      <CardContent sx={{ width: '100%', minWidth: 0, p: { xs: 1.2, sm: 1.8 }, '&:last-child': { pb: { xs: 1.5, sm: 2 } }, flexGrow: 1 }}>
                        <Stack direction="row" alignItems="baseline" justifyContent="space-between" gap={0.5}>
                          <Typography fontWeight={800} noWrap sx={{ fontSize: { xs: '0.95rem', sm: '1.1rem' } }}>
                            {item.name || '名前なし'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, fontSize: '0.67rem' }}>
                            {statusLabel}
                          </Typography>
                        </Stack>
                        <Typography variant="body2" color="text.secondary" sx={{
                          mt: 0.75, fontSize: { xs: '0.76rem', sm: '0.84rem' }, lineHeight: 1.6,
                          overflow: 'hidden', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
                          minHeight: { xs: 0, sm: '2.7em' },
                        }}>
                          {item.summary || item.role || '設定を見る'}
                        </Typography>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                );
              })}
            </Box>
          )}
        </>
      )}

      <Dialog open={Boolean(viewed)} onClose={() => { setViewedId(null); setLightboxOpen(false); }}
        fullWidth maxWidth="xl" aria-labelledby="character-detail-title"
        PaperProps={{ sx: { borderRadius: { xs: 1, sm: 3 }, maxHeight: '94dvh' } }}>
        {viewed && (
          <>
            <DialogTitle id="character-detail-title" sx={{ px: { xs: 2, sm: 3 }, py: 1.5 }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="h6" fontWeight={800} noWrap>{viewed.name || '名前なし'}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {viewedAssets.length} 枚の画像
                  </Typography>
                </Box>
                <Stack direction="row" spacing={0.25} alignItems="center">
                  {filtered.length > 1 && (
                    <>
                      <Tooltip title="前のキャラクター">
                        <IconButton size="small" onClick={() => navigateCharacter(-1)} aria-label="前のキャラクター"><ArrowBackIosNewOutlined fontSize="small" /></IconButton>
                      </Tooltip>
                      <Tooltip title="次のキャラクター">
                        <IconButton size="small" onClick={() => navigateCharacter(1)} aria-label="次のキャラクター"><ArrowForwardIosOutlined fontSize="small" /></IconButton>
                      </Tooltip>
                    </>
                  )}
                  <Tooltip title="設定を編集">
                    <IconButton size="small" onClick={() => openEditor(viewed)} aria-label="設定を編集"><EditOutlined fontSize="small" /></IconButton>
                  </Tooltip>
                  <Tooltip title="閉じる">
                    <IconButton onClick={() => setViewedId(null)} aria-label="詳細を閉じる"><CloseOutlined /></IconButton>
                  </Tooltip>
                </Stack>
              </Stack>
            </DialogTitle>
            <DialogContent dividers sx={{ p: { xs: 1.5, sm: 2.5 } }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'minmax(0, 1.8fr) minmax(280px, 0.9fr)' }, gap: { xs: 2, md: 3 }, alignItems: 'start' }}>
                <Box sx={{ minWidth: 0 }}>
                  <Box sx={{
                    width: '100%', height: { xs: 'min(52dvh, 470px)', md: 'min(68dvh, 680px)' },
                    position: 'relative', bgcolor: 'action.hover', borderRadius: 2,
                    display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
                  }}>
                    {activeAsset ? (
                      <Box component="button" type="button" onClick={() => setLightboxOpen(true)}
                        aria-label="画像を拡大表示" sx={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: '100%', height: '100%', p: { xs: 1, sm: 2 }, border: 0,
                          cursor: 'zoom-in', bgcolor: 'transparent',
                        }}>
                        <Box component="img" src={activeAsset.url} alt={(viewed.name || 'キャラクター') + 'の画像'}
                          sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
                      </Box>
                    ) : (
                      <Stack alignItems="center" spacing={1} color="text.secondary">
                        <ImageOutlined sx={{ fontSize: 52, color: 'text.disabled' }} />
                        <Typography variant="body2">画像がまだありません</Typography>
                        <Button size="small" variant="outlined" onClick={() => openEditor(viewed)}>画像を追加する</Button>
                      </Stack>
                    )}
                    {viewedAssets.length > 1 && (
                      <>
                        <IconButton aria-label="前の画像" onClick={() => navigateImage(-1)}
                          sx={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
                            bgcolor: 'background.paper', boxShadow: 2, '&:hover': { bgcolor: 'background.paper' } }}>
                          <ArrowBackIosNewOutlined fontSize="small" />
                        </IconButton>
                        <IconButton aria-label="次の画像" onClick={() => navigateImage(1)}
                          sx={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                            bgcolor: 'background.paper', boxShadow: 2, '&:hover': { bgcolor: 'background.paper' } }}>
                          <ArrowForwardIosOutlined fontSize="small" />
                        </IconButton>
                      </>
                    )}
                  </Box>
                  {activeAsset && (
                    <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} sx={{ mt: 1 }}>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
                        {activeAsset.name || (activeAsset.role === 'avatar' ? 'プロフィール画像' : '参考画像')}
                        {'　'}{activeAssetIndex + 1} / {viewedAssets.length}
                      </Typography>
                      <Stack direction="row" spacing={0.5}>
                        <Button size="small" startIcon={<ZoomInOutlined />} onClick={() => setLightboxOpen(true)}>拡大</Button>
                        <Button size="small" startIcon={<OpenInNewOutlined />} href={activeAsset.url} target="_blank" rel="noopener noreferrer">原寸</Button>
                      </Stack>
                    </Stack>
                  )}
                  {viewedAssets.length > 1 && (
                    <Stack direction="row" spacing={1} sx={{ mt: 1.5, overflowX: 'auto', pb: 1 }}>
                      {viewedAssets.map((asset) => (
                        <ButtonBase key={asset.id} onClick={() => setActiveAssetId(asset.id)}
                          aria-label={(asset.name || '画像') + 'を表示'}
                          sx={{ flexShrink: 0, width: 94, height: 86, borderRadius: 1.5, overflow: 'hidden',
                            bgcolor: 'action.hover', border: '2px solid',
                            borderColor: activeAsset?.id === asset.id ? 'primary.main' : 'divider' }}>
                          <Box component="img" src={asset.url} alt="" loading="lazy"
                            sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        </ButtonBase>
                      ))}
                    </Stack>
                  )}
                </Box>
                <Stack spacing={2} sx={{ minWidth: 0, pb: 1 }}>
                  <Box>
                    <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.2 }}>PROFILE</Typography>
                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.85 }}>
                      {viewed.summary || '紹介文はまだありません。'}
                    </Typography>
                    {!!viewed.role && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>役割：{viewed.role}</Typography>}
                  </Box>
                  {!!viewed.tags?.length && (
                    <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
                      {viewed.tags.slice(0, 10).map((tag) => <Chip key={tag} label={tag} size="small" variant="outlined" />)}
                    </Stack>
                  )}
                  <Divider />
                  {[
                    ['性格', viewed.personality],
                    ['話し方', viewed.voice || viewed.speechStyle],
                    ['暮らし', viewed.lifestyle],
                    ['世界観', viewed.worldview],
                  ].filter(([, content]) => Boolean(content)).map(([label, content]) => (
                    <Box key={label}>
                      <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 0.5 }}>{label}</Typography>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, color: 'text.secondary' }}>
                        {content}
                      </Typography>
                    </Box>
                  ))}
                  {Array.isArray(viewed.sampleScenes) && viewed.sampleScenes.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 0.7 }}>エピソード</Typography>
                      <Stack spacing={1}>
                        {viewed.sampleScenes.map((scene, index) => (
                          <Typography key={index} variant="body2" color="text.secondary" sx={{ lineHeight: 1.75 }}>
                            {index + 1}. {scene}
                          </Typography>
                        ))}
                      </Stack>
                    </Box>
                  )}
                  <Button variant="outlined" startIcon={<EditOutlined />} onClick={() => openEditor(viewed)} sx={{ alignSelf: 'flex-start' }}>設定・画像を編集</Button>
                </Stack>
              </Box>
            </DialogContent>
          </>
        )}
      </Dialog>

      <Dialog open={Boolean(viewed && activeAsset && lightboxOpen)} onClose={() => setLightboxOpen(false)}
        fullScreen aria-label="画像を拡大表示"
        PaperProps={{ sx: { bgcolor: 'background.default' } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2, py: 1 }}>
          <Typography variant="subtitle2" noWrap sx={{ minWidth: 0 }}>{viewed?.name} — {activeAsset?.name || '画像'}</Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            {activeAsset && <Button size="small" href={activeAsset.url} target="_blank" rel="noopener noreferrer" startIcon={<OpenInNewOutlined />}>原寸</Button>}
            <IconButton onClick={() => setLightboxOpen(false)} aria-label="拡大表示を閉じる"><CloseOutlined /></IconButton>
          </Stack>
        </Stack>
        <Box sx={{ flex: 1, minHeight: 0, p: { xs: 1, md: 3 }, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {activeAsset && <Box component="img" src={activeAsset.url} alt={(viewed?.name || 'キャラクター') + 'の全体画像'}
            sx={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain' }} />}
        </Box>
        {viewedAssets.length > 1 && (
          <Stack direction="row" justifyContent="center" alignItems="center" spacing={2} sx={{ pb: 2 }}>
            <IconButton onClick={() => navigateImage(-1)} aria-label="前の画像"><ArrowBackIosNewOutlined /></IconButton>
            <Typography variant="caption">{activeAssetIndex + 1} / {viewedAssets.length}</Typography>
            <IconButton onClick={() => navigateImage(1)} aria-label="次の画像"><ArrowForwardIosOutlined /></IconButton>
          </Stack>
        )}
      </Dialog>

      <Dialog open={editOpen} onClose={() => !busy && !uploading && setEditOpen(false)}
        fullWidth maxWidth="md" aria-labelledby="character-editor-title"
        PaperProps={{ sx: { borderRadius: { xs: 1, sm: 3 }, maxHeight: '94dvh' } }}>
        {draft && (
          <>
            <DialogTitle id="character-editor-title" sx={{ py: 1.5 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="h6" fontWeight={800}>{selectedId ? 'キャラクターを編集' : 'キャラクターを作成'}</Typography>
                <IconButton onClick={() => setEditOpen(false)} disabled={busy || uploading} aria-label="編集を閉じる"><CloseOutlined /></IconButton>
              </Stack>
            </DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2} sx={{ py: 1 }}>
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
                    <Typography fontWeight={800}>画像ライブラリ</Typography>
                    <Typography variant="caption" color="text.secondary">トリミングせずに表示します。ImageKitの原本はそのまま保管されます。</Typography>
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
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: 1.2 }}>
                  {(draft.assets || []).map((asset) => (
                    <Paper key={asset.id} variant="outlined" sx={{ p: 1, borderRadius: 2, minWidth: 0 }}>
                      <Box component="img" alt={asset.name || 'キャラクター画像'} src={asset.url}
                        sx={{ width: '100%', height: 140, objectFit: 'contain', borderRadius: 1, bgcolor: 'action.hover' }} />
                      <Typography variant="caption" noWrap sx={{ display: 'block', mt: 0.5 }}>{asset.name || '画像'}</Typography>
                      {asset.role === 'avatar'
                        ? <Chip size="small" label="メイン画像" color="primary" />
                        : <Button size="small" onClick={() => makeAvatar(asset.id)} disabled={busy || uploading}>メインにする</Button>}
                      <Button fullWidth size="small" color="inherit" disabled={busy || uploading}
                        onClick={() => removeReference(asset.id)}>参照を外す</Button>
                    </Paper>
                  ))}
                </Box>
                <Typography variant="caption" color="text.secondary">
                  「参照を外す」はDBからのリンク解除のみです。ImageKitのファイルは削除しません。
                </Typography>
                <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ pt: 1 }}>
                  <Button onClick={() => setEditOpen(false)} disabled={busy || uploading}>閉じる</Button>
                  <Button startIcon={<SaveOutlined />} variant="contained" disabled={busy || uploading} onClick={saveCharacter}>
                    {busy ? '保存中…' : '保存'}
                  </Button>
                </Stack>
              </Stack>
            </DialogContent>
          </>
        )}
      </Dialog>
    </Box>
  );
}
