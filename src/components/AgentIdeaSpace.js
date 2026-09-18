import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  LinearProgress,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  AutoAwesome as AutoAwesomeIcon,
  CheckCircleOutline as CheckCircleOutlineIcon,
  EditOutlined as EditOutlinedIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';

const BOARD_TABS = [
  { id: 'ideas', label: 'アイデア' },
  { id: 'hobbies', label: '趣味' },
  { id: 'stocks', label: 'ストック' },
];

async function getAuthenticatedUser() {
  if (auth.currentUser) return auth.currentUser;
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      if (user) resolve(user);
      else reject(new Error('My Portal にログインしてください'));
    });
  });
}

async function agentApi(path = '', options = {}) {
  const user = await getAuthenticatedUser();
  const token = await user.getIdToken();
  const response = await fetch(`/api/agent-ideas${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Agent Ideas API error (${response.status})`);
  return payload;
}

function colorFromName(value, theme) {
  let hash = 0;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) hash = text.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 58% ${theme.palette.mode === 'dark' ? '68%' : '44%'})`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function boardLabel(boardId) {
  return BOARD_TABS.find((item) => item.id === boardId)?.label || boardId;
}

export default function AgentIdeaSpace() {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [ideas, setIdeas] = useState([]);
  const [categories, setCategories] = useState([]);
  const [work, setWork] = useState([]);
  const [selectedBoard, setSelectedBoard] = useState('ideas');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [selectedIdea, setSelectedIdea] = useState(null);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [ideaResult, categoryResult, workResult] = await Promise.all([
        agentApi('?resource=ideas'),
        agentApi('?resource=categories'),
        agentApi('?resource=generation_work'),
      ]);
      setIdeas(ideaResult.items || []);
      setCategories((categoryResult.items || []).filter((item) => item.status !== 'archived'));
      setWork(workResult.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const visibleCategories = useMemo(
    () => categories.filter((item) => item.portalBoard === selectedBoard && item.status !== 'archived'),
    [categories, selectedBoard],
  );

  useEffect(() => {
    if (!visibleCategories.length) {
      setSelectedCategoryId('');
      return;
    }
    if (!selectedCategoryId || !visibleCategories.some((item) => item.id === selectedCategoryId)) {
      const first = visibleCategories.find((item) => item.status === 'active') || visibleCategories[0];
      setSelectedCategoryId(first.id);
    }
  }, [visibleCategories, selectedCategoryId]);

  const workByCategory = useMemo(
    () => new Map(work.map((item) => [item.id, item])),
    [work],
  );

  const countByCategory = useMemo(() => {
    const counts = new Map();
    ideas.forEach((idea) => {
      if (!idea.categoryId || idea.status !== 'active') return;
      counts.set(idea.categoryId, (counts.get(idea.categoryId) || 0) + 1);
    });
    return counts;
  }, [ideas]);

  const selectedCategory = useMemo(
    () => visibleCategories.find((item) => item.id === selectedCategoryId) || null,
    [visibleCategories, selectedCategoryId],
  );

  const selectedWork = selectedCategory ? workByCategory.get(selectedCategory.id) : null;

  const selectedIdeas = useMemo(() => {
    const needle = searchText.trim().toLowerCase();
    return ideas
      .filter((idea) => idea.categoryId === selectedCategoryId)
      .filter((idea) => ['active', 'paused'].includes(idea.status || 'active'))
      .filter((idea) => {
        if (!needle) return true;
        return [idea.title, idea.summary, idea.content, ...(idea.tags || [])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(needle);
      });
  }, [ideas, searchText, selectedCategoryId]);

  const openCategoryEdit = () => {
    if (!selectedCategory) return;
    setCategoryForm({
      id: selectedCategory.id,
      revision: selectedCategory.revision,
      name: selectedCategory.name || '',
      description: selectedCategory.description || '',
      instructions: selectedCategory.instructions || '',
      targetCount: selectedCategory.targetCount ?? 5,
      status: selectedCategory.status || 'active',
    });
    setCategoryOpen(true);
  };

  const saveCategory = async () => {
    if (!categoryForm?.id) return;
    setSaving(true);
    setError('');
    try {
      const updated = await agentApi('', {
        method: 'POST',
        body: JSON.stringify({
          action: 'category_upsert',
          id: categoryForm.id,
          expectedRevision: categoryForm.revision,
          description: categoryForm.description.trim(),
          instructions: categoryForm.instructions.trim(),
          targetCount: Number(categoryForm.targetCount) || 0,
          status: categoryForm.status,
        }),
      });
      setCategoryOpen(false);
      setSelectedCategoryId(updated.id);
      setNotice('このPortalタグに対するAgent設定を更新しました。');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const requestReplenishment = async (count = 5) => {
    if (!selectedCategory) return;
    setError('');
    try {
      await agentApi('', {
        method: 'POST',
        body: JSON.stringify({
          action: 'replenish_request',
          categoryId: selectedCategory.id,
          count,
        }),
      });
      setNotice(`${boardLabel(selectedCategory.portalBoard)} > ${selectedCategory.name} に +${count}件の補充要求を追加しました。`);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const archiveIdea = async () => {
    if (!selectedIdea) return;
    setError('');
    try {
      await agentApi('', {
        method: 'POST',
        body: JSON.stringify({
          action: 'idea_archive',
          id: selectedIdea.id,
          expectedRevision: selectedIdea.revision,
          reason: 'Archived from Agent Ideas board',
        }),
      });
      setSelectedIdea(null);
      setNotice('Agent案をアーカイブしました。');
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const promoteIdea = async () => {
    if (!selectedIdea) return;
    setSaving(true);
    setError('');
    try {
      const result = await agentApi('', {
        method: 'POST',
        body: JSON.stringify({
          action: 'idea_promote',
          id: selectedIdea.id,
          expectedRevision: selectedIdea.revision,
        }),
      });
      setSelectedIdea(null);
      const destination = result.portalTag === '__untagged__'
        ? boardLabel(result.portalBoard)
        : `${boardLabel(result.portalBoard)} > #${result.portalTag}`;
      setNotice(`採用しました。Portalの ${destination} に移動しています。`);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const copyReplenishmentPrompt = async () => {
    const prompt = [
      '@my-portal Agent Ideasを補充してください。',
      'idea_generation_work でPortalからミラーされた不足カテゴリを取得し、neededCount が1以上のカテゴリだけを処理してください。',
      '大カテゴリ（ideas / hobbies / stocks）とPortalタグ、description / instructions を守り、idea_create の categoryId に対象カテゴリIDを必ず設定してください。',
      'Agent Ideasにだけ保存し、Portal本家ボードへは勝手に書き込まないでください。Portalへ移すのは採用時だけです。',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(prompt);
      setNotice('Agent補充用の指示文をコピーしました。');
    } catch (err) {
      setError(`コピーに失敗しました: ${err.message}`);
    }
  };

  const border = isDark
    ? alpha(theme.palette.common.white, 0.10)
    : 'rgba(62, 96, 119, 0.16)';

  return (
    <Box sx={{ minHeight: '100%', p: { xs: 0, sm: 0.5 } }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: { xs: 'flex-start', md: 'center' },
          justifyContent: 'space-between',
          flexDirection: { xs: 'column', md: 'row' },
          gap: 1,
          mb: 1,
          px: 0.25,
        }}
      >
        <Box>
          <Stack direction="row" spacing={0.8} alignItems="center">
            <AutoAwesomeIcon color="primary" />
            <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 900, letterSpacing: '0.12em' }}>
              AGENT IDEAS
            </Typography>
            <Chip label="Portal mirror" size="small" color="primary" variant="outlined" />
          </Stack>
          <Typography variant="h4" sx={{ mt: 0.2 }}>Agent アイデアボード</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.3 }}>
            Portal本家と同じ「大カテゴリ → タグ」構造の裏側で、Agentが候補を考えます。良い案だけ本家へ採用できます。
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.8} flexWrap="wrap" useFlexGap>
          <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={refresh}>同期・更新</Button>
          <Button size="small" variant="outlined" onClick={copyReplenishmentPrompt}>補充指示をコピー</Button>
        </Stack>
      </Box>

      <Paper
        elevation={0}
        sx={{
          mb: 1.2,
          px: { xs: 0.6, sm: 1 },
          border: `1px solid ${border}`,
          borderRadius: 2.5,
          overflow: 'hidden',
        }}
      >
        <Tabs
          value={selectedBoard}
          onChange={(_, value) => {
            setSelectedBoard(value);
            setSelectedCategoryId('');
            setSearchText('');
            setSelectedIdea(null);
          }}
          variant="fullWidth"
          aria-label="Agent Ideas large category"
          sx={{ minHeight: 42, '& .MuiTab-root': { minHeight: 42, fontWeight: 900 } }}
        >
          {BOARD_TABS.map((item) => <Tab key={item.id} value={item.id} label={item.label} />)}
        </Tabs>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 1.2 }} onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 1.2 }} onClose={() => setNotice('')}>{notice}</Alert>}
      {loading && <LinearProgress sx={{ mb: 1.2 }} />}

      {!visibleCategories.length && !loading ? (
        <Paper elevation={0} sx={{ py: 8, px: 2, textAlign: 'center', border: `1px dashed ${border}`, background: 'transparent' }}>
          <Typography variant="h6" fontWeight={900}>Portal側にミラーできるタグがありません</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.6 }}>
            Portalの「{boardLabel(selectedBoard)}」でタグ付きメモを作ると、その大カテゴリ・タグがここにも自動で現れます。
          </Typography>
        </Paper>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '225px minmax(0, 1fr)' },
            gap: { xs: 0.8, md: 1.2 },
            minHeight: { md: 'calc(100vh - 230px)' },
          }}
        >
          <Paper
            elevation={0}
            sx={{
              border: `1px solid ${border}`,
              backgroundColor: isDark ? alpha(theme.palette.background.paper, 0.96) : 'rgba(255,255,255,0.94)',
              overflow: 'hidden',
              alignSelf: 'start',
              position: 'sticky',
              top: { xs: 0, md: 76 },
              zIndex: { xs: 8, md: 1 },
              borderRadius: 2.5,
            }}
          >
            <Box sx={{ px: 1.2, pt: 1.2, pb: 0.8, display: 'flex', justifyContent: 'space-between', gap: 1 }}>
              <Typography fontWeight={900} fontSize="0.9rem">タグ</Typography>
              <Typography variant="caption" color="text.secondary">{visibleCategories.length}タグ</Typography>
            </Box>
            <Box
              sx={{
                px: 0.7,
                pb: 0.8,
                display: { xs: 'flex', md: 'block' },
                gap: 0.45,
                overflowX: { xs: 'auto', md: 'visible' },
                maxHeight: { md: 'calc(100vh - 300px)' },
                overflowY: { md: 'auto' },
              }}
            >
              {visibleCategories.map((category) => {
                const active = selectedCategoryId === category.id;
                const color = colorFromName(category.name, theme);
                const categoryWork = workByCategory.get(category.id);
                const count = countByCategory.get(category.id) || 0;
                const needed = categoryWork?.neededCount || 0;
                return (
                  <Box
                    key={category.id}
                    component="button"
                    type="button"
                    onClick={() => {
                      setSelectedCategoryId(category.id);
                      setSearchText('');
                    }}
                    sx={{
                      width: { xs: 'auto', md: '100%' },
                      minWidth: { xs: 150, md: 0 },
                      border: active ? `1px solid ${alpha(color, 0.3)}` : '1px solid transparent',
                      borderRadius: 1.8,
                      px: 1,
                      py: 0.9,
                      mb: { md: 0.35 },
                      display: 'grid',
                      gridTemplateColumns: '10px minmax(0,1fr) auto',
                      alignItems: 'center',
                      gap: 0.7,
                      textAlign: 'left',
                      cursor: 'pointer',
                      color: 'text.primary',
                      backgroundColor: active ? alpha(color, isDark ? 0.2 : 0.1) : 'transparent',
                      '&:hover': { backgroundColor: alpha(color, isDark ? 0.13 : 0.06) },
                    }}
                  >
                    <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: color }} />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography fontSize="0.84rem" fontWeight={active ? 900 : 750} noWrap>{category.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{count}/{category.targetCount || 0}</Typography>
                    </Box>
                    {needed > 0 && <Chip size="small" color="warning" label={`+${needed}`} sx={{ height: 20, fontSize: 10 }} />}
                  </Box>
                );
              })}
            </Box>
          </Paper>

          <Paper elevation={0} sx={{ border: `1px solid ${border}`, backgroundColor: isDark ? alpha(theme.palette.background.paper, 0.88) : 'rgba(255,255,255,0.78)', overflow: 'hidden', minWidth: 0 }}>
            {selectedCategory && (
              <>
                <Box sx={{ p: { xs: 1.1, sm: 1.6 }, borderBottom: `1px solid ${border}` }}>
                  <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.2} alignItems={{ lg: 'flex-start' }}>
                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Stack direction="row" spacing={0.7} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Typography variant="h5" fontWeight={950}>#{selectedCategory.name}</Typography>
                        <Chip size="small" label={`${selectedIdeas.length}件`} />
                        <Chip
                          size="small"
                          color={(selectedWork?.neededCount || 0) > 0 ? 'warning' : 'success'}
                          label={(selectedWork?.neededCount || 0) > 0 ? `補充 +${selectedWork.neededCount}` : '充足'}
                        />
                        {(selectedCategory.requestedCount || 0) > 0 && (
                          <Chip size="small" color="primary" variant="outlined" label={`明示要求 +${selectedCategory.requestedCount}`} />
                        )}
                      </Stack>
                      {selectedCategory.description && (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.6, maxWidth: 900 }}>
                          {selectedCategory.description}
                        </Typography>
                      )}
                    </Box>
                    <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap>
                      <Button size="small" startIcon={<EditOutlinedIcon />} onClick={openCategoryEdit}>Agent設定</Button>
                      <Button size="small" variant="contained" startIcon={<AutoAwesomeIcon />} onClick={() => requestReplenishment(5)}>
                        +5件補充
                      </Button>
                    </Stack>
                  </Stack>

                  {selectedCategory.instructions && (
                    <Box sx={{ mt: 1.2, p: 1.1, borderRadius: 2, bgcolor: alpha(theme.palette.primary.main, isDark ? 0.1 : 0.055) }}>
                      <Typography variant="caption" color="primary.main" fontWeight={900}>AGENT BRIEF</Typography>
                      <Typography variant="body2" sx={{ mt: 0.3, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                        {selectedCategory.instructions}
                      </Typography>
                    </Box>
                  )}

                  <TextField
                    size="small"
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    placeholder="このタグ内を検索"
                    sx={{ mt: 1.2, width: { xs: '100%', sm: 300 } }}
                    InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 0.8, color: 'text.secondary' }} /> }}
                  />
                </Box>

                {selectedIdeas.length === 0 ? (
                  <Box sx={{ py: 8, px: 2, textAlign: 'center' }}>
                    <Typography fontWeight={900}>このタグにはまだAgent案がありません</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      補充要求を追加するか、MCPの idea_generation_work から不足分を生成できます。
                    </Typography>
                  </Box>
                ) : (
                  <Box
                    sx={{
                      p: { xs: 0.8, sm: 1.3 },
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: '1fr',
                        sm: 'repeat(2, minmax(0, 1fr))',
                        lg: 'repeat(3, minmax(0, 1fr))',
                        xl: 'repeat(4, minmax(0, 1fr))',
                      },
                      gap: 0.8,
                      alignItems: 'start',
                    }}
                  >
                    {selectedIdeas.map((idea) => (
                      <Paper
                        key={idea.id}
                        elevation={0}
                        onClick={() => setSelectedIdea(idea)}
                        sx={{
                          p: 1.2,
                          border: `1px solid ${border}`,
                          borderRadius: 2,
                          cursor: 'pointer',
                          bgcolor: isDark ? alpha(theme.palette.background.paper, 0.96) : '#fff',
                          transition: 'transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease',
                          '&:hover': {
                            transform: 'translateY(-1px)',
                            borderColor: 'primary.light',
                            boxShadow: isDark ? '0 5px 12px rgba(0,0,0,.19)' : '0 5px 12px rgba(43,82,106,.09)',
                          },
                        }}
                      >
                        <Typography variant="subtitle2" fontWeight={900} sx={{ lineHeight: 1.4 }}>
                          {idea.title || 'Untitled'}
                        </Typography>
                        {(idea.summary || idea.content) && (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ mt: 0.55, lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                          >
                            {idea.summary || idea.content}
                          </Typography>
                        )}
                        <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.7 }}>
                          {idea.createdBy?.agent || 'agent'} · {formatDate(idea.updatedAt || idea.createdAt)}
                        </Typography>
                      </Paper>
                    ))}
                  </Box>
                )}
              </>
            )}
          </Paper>
        </Box>
      )}

      <Dialog open={categoryOpen} onClose={() => setCategoryOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>#{categoryForm?.name || ''} のAgent設定</DialogTitle>
        <DialogContent>
          {categoryForm && (
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              <Alert severity="info">
                大カテゴリとタグ名はPortal本家から自動ミラーされます。ここではAgentの考え方とストック量だけ設定します。
              </Alert>
              <TextField label="カテゴリ説明" value={categoryForm.description} onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })} multiline minRows={2} />
              <TextField label="Agentへの生成指示" value={categoryForm.instructions} onChange={(e) => setCategoryForm({ ...categoryForm, instructions: e.target.value })} multiline minRows={5} />
              <TextField label="目標Agentストック数" type="number" inputProps={{ min: 0, max: 500 }} value={categoryForm.targetCount} onChange={(e) => setCategoryForm({ ...categoryForm, targetCount: e.target.value })} />
              <TextField select SelectProps={{ native: true }} label="Agent補充" value={categoryForm.status} onChange={(e) => setCategoryForm({ ...categoryForm, status: e.target.value })}>
                <option value="active">active</option>
                <option value="paused">paused</option>
              </TextField>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCategoryOpen(false)}>キャンセル</Button>
          <Button variant="contained" disabled={saving || !categoryForm} onClick={saveCategory}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

      <Drawer
        anchor="right"
        open={Boolean(selectedIdea)}
        onClose={() => setSelectedIdea(null)}
        PaperProps={{ sx: { width: { xs: '100%', sm: 460 }, p: 2.5 } }}
      >
        {selectedIdea && (
          <>
            <Typography variant="overline" color="text.secondary" fontWeight={900}>AGENT IDEA</Typography>
            <Typography variant="h5" fontWeight={950}>{selectedIdea.title || 'Untitled'}</Typography>
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              label={`${boardLabel(selectedCategory?.portalBoard)} > #${selectedCategory?.name || ''}`}
              sx={{ mt: 1 }}
            />
            {selectedIdea.summary && <Typography color="text.secondary" sx={{ mt: 1.5 }}>{selectedIdea.summary}</Typography>}
            {selectedIdea.content && <Typography variant="body2" sx={{ mt: 1.5, whiteSpace: 'pre-wrap', lineHeight: 1.75 }}>{selectedIdea.content}</Typography>}
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 2 }}>
              {selectedIdea.createdBy?.agent || 'agent'} · {formatDate(selectedIdea.updatedAt || selectedIdea.createdAt)}
            </Typography>

            <Paper variant="outlined" sx={{ mt: 2.5, p: 1.3, borderRadius: 2 }}>
              <Typography variant="caption" color="text.secondary" fontWeight={900}>採用すると</Typography>
              <Typography variant="body2" sx={{ mt: 0.35 }}>
                Portal本家の「{boardLabel(selectedCategory?.portalBoard)} / #{selectedCategory?.name || ''}」へ短文メモとして移し、このAgent案は採用済みとして一覧から外れます。
              </Typography>
            </Paper>

            <Stack spacing={1} sx={{ mt: 2 }}>
              <Button
                variant="contained"
                color="success"
                startIcon={<CheckCircleOutlineIcon />}
                disabled={saving}
                onClick={promoteIdea}
              >
                {saving ? '採用中…' : '本家ボードへ採用'}
              </Button>
              <Button color="error" variant="outlined" onClick={archiveIdea}>
                見送る / アーカイブ
              </Button>
            </Stack>
          </>
        )}
      </Drawer>
    </Box>
  );
}
