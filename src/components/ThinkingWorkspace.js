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
  Divider,
  Link as MuiLink,
  LinearProgress,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import {
  AutoAwesome as AutoAwesomeIcon,
  EditOutlined as EditOutlinedIcon,
  PsychologyAlt as PsychologyAltIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useLocation, useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';

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

async function contextApi(path = '', options = {}) {
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
  if (!response.ok) throw new Error(payload.error || `Context API error (${response.status})`);
  return payload;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function Section({ title, subtitle, children }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, borderRadius: 3 }}>
      <Box sx={{ mb: 1.25 }}>
        <Typography variant="subtitle1" fontWeight={900}>{title}</Typography>
        {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
      </Box>
      {children}
    </Paper>
  );
}

function Empty({ children = 'まだありません。' }) {
  return <Typography variant="body2" color="text.secondary">{children}</Typography>;
}

function FactRow({ fact, onEdit }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2.5 }}>
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={750} sx={{ whiteSpace: 'pre-wrap' }}>
            {fact.statement}
          </Typography>
          <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap sx={{ mt: 0.8 }}>
            <Chip size="small" label={fact.scope || 'global'} variant="outlined" />
            <Chip size="small" label={fact.category || 'general'} />
            <Chip
              size="small"
              color={fact.evidenceType === 'explicit' ? 'success' : fact.evidenceType === 'confirmed_inference' ? 'primary' : 'warning'}
              label={fact.evidenceType === 'explicit' ? '本人の明言' : fact.evidenceType === 'confirmed_inference' ? '確認済み推測' : 'AIによる推測'}
            />
            <Chip size="small" label={fact.stability || 'contextual'} variant="outlined" />
            {typeof fact.confidence === 'number' && (
              <Chip size="small" label={`confidence ${Math.round(fact.confidence * 100)}%`} variant="outlined" />
            )}
          </Stack>
        </Box>
        {onEdit && (
          <Button size="small" startIcon={<EditOutlinedIcon />} onClick={() => onEdit(fact)}>
            修正
          </Button>
        )}
      </Stack>
    </Paper>
  );
}

export default function ThinkingWorkspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const initialSpaceId = new URLSearchParams(location.search).get('space') || '';
  const [tab, setTab] = useState(0);
  const [spaceOwnerView, setSpaceOwnerView] = useState('user');
  const [spaces, setSpaces] = useState([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState(initialSpaceId);
  const [context, setContext] = useState(null);
  const [profile, setProfile] = useState([]);
  const [loading, setLoading] = useState(true);
  const [contextLoading, setContextLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [briefDraft, setBriefDraft] = useState('');
  const [goalDraft, setGoalDraft] = useState('');
  const [nextDraft, setNextDraft] = useState('');
  const [ownerDraft, setOwnerDraft] = useState('user');
  const [editingFact, setEditingFact] = useState(null);
  const [factDraft, setFactDraft] = useState(null);

  const loadBase = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [spaceResult, profileResult] = await Promise.all([
        contextApi('?resource=spaces'),
        contextApi('?resource=profile'),
      ]);
      setSpaces(spaceResult.items || []);
      setProfile(profileResult.items || []);
      if (!selectedSpaceId && (spaceResult.items || []).length) {
        const userSpaces = (spaceResult.items || []).filter((space) => (space.themeOwner || 'user') === 'user');
        const first = userSpaces.find((space) => space.status === 'active')
          || userSpaces[0]
          || (spaceResult.items || []).find((space) => space.status === 'active')
          || spaceResult.items[0];
        setSelectedSpaceId(first.id);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedSpaceId]);

  const loadContext = useCallback(async (spaceId) => {
    if (!spaceId) {
      setContext(null);
      return;
    }
    setContextLoading(true);
    setError('');
    try {
      const result = await contextApi(`?resource=space_context&id=${encodeURIComponent(spaceId)}`);
      setContext(result);
      setBriefDraft(result.currentBrief || '');
      setGoalDraft(result.goal || '');
      setNextDraft((result.nextActions || []).join('\n'));
      const themeOwner = result.space?.themeOwner || 'user';
      setOwnerDraft(themeOwner);
      setSpaceOwnerView(themeOwner);
    } catch (err) {
      setError(err.message);
    } finally {
      setContextLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBase();
  }, [loadBase]);

  useEffect(() => {
    if (selectedSpaceId) loadContext(selectedSpaceId);
  }, [selectedSpaceId, loadContext]);

  useEffect(() => {
    const querySpaceId = new URLSearchParams(location.search).get('space') || '';
    if (querySpaceId && querySpaceId !== selectedSpaceId) setSelectedSpaceId(querySpaceId);
  }, [location.search, selectedSpaceId]);

  const selectSpace = (id) => {
    setSelectedSpaceId(id);
    navigate(`/thinking?space=${encodeURIComponent(id)}`, { replace: true });
  };

  const selectSpaceOwnerView = (owner) => {
    setSpaceOwnerView(owner);
    const candidates = spaces.filter((space) => (space.themeOwner || 'user') === owner);
    const next = candidates.find((space) => space.status === 'active') || candidates[0];
    if (next) {
      selectSpace(next.id);
    } else {
      setSelectedSpaceId('');
      setContext(null);
      navigate('/thinking', { replace: true });
    }
  };

  const saveSpace = async () => {
    if (!context?.space) return;
    setError('');
    try {
      const updated = await contextApi('', {
        method: 'POST',
        body: JSON.stringify({
          action: 'space_update',
          id: context.space.id,
          expectedRevision: context.space.revision,
          patch: {
            themeOwner: ownerDraft,
            currentBrief: briefDraft,
            goal: goalDraft,
            nextActions: nextDraft.split('\n').map((item) => item.trim()).filter(Boolean),
          },
        }),
      });
      setNotice('Spaceを更新しました。');
      setSpaces((current) => current.map((space) => (space.id === updated.id ? updated : space)));
      await loadContext(updated.id);
    } catch (err) {
      setError(err.message);
    }
  };

  const openFactEdit = (fact) => {
    setEditingFact(fact);
    setFactDraft({
      statement: fact.statement || '',
      scope: fact.scope || 'global',
      category: fact.category || 'general',
      evidenceType: fact.evidenceType || 'explicit',
      stability: fact.stability || 'contextual',
      confidence: fact.confidence ?? 1,
    });
  };

  const saveFact = async () => {
    if (!editingFact || !factDraft) return;
    setError('');
    try {
      const updated = await contextApi('', {
        method: 'POST',
        body: JSON.stringify({
          action: 'profile_update',
          id: editingFact.id,
          patch: factDraft,
        }),
      });
      setProfile((current) => current.map((fact) => (fact.id === updated.id ? updated : fact)));
      setEditingFact(null);
      setFactDraft(null);
      setNotice('User Modelを更新しました。');
      if (selectedSpaceId) await loadContext(selectedSpaceId);
    } catch (err) {
      setError(err.message);
    }
  };

  const groupedProfile = useMemo(() => {
    const groups = new Map();
    profile.forEach((fact) => {
      const key = fact.category || 'general';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(fact);
    });
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [profile]);

  const constraints = useMemo(() => {
    if (!context) return [];
    return [...(context.themeLocalConstraints || []), ...(context.relevantProfileFacts || [])];
  }, [context]);

  const visibleSpaces = useMemo(
    () => spaces.filter((space) => (space.themeOwner || 'user') === spaceOwnerView),
    [spaces, spaceOwnerView],
  );
  const userSpaceCount = useMemo(
    () => spaces.filter((space) => (space.themeOwner || 'user') === 'user').length,
    [spaces],
  );
  const assistantSpaceCount = spaces.length - userSpaceCount;

  return (
    <Box sx={{ maxWidth: 1500, mx: 'auto', pb: 4 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} sx={{ mb: 2 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <PsychologyAltIcon color="primary" />
            <Typography variant="h5" fontWeight={950}>思考テーマ</Typography>
            <Chip label="Context Store" size="small" color="primary" variant="outlined" />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4 }}>
            長期テーマの「現在地・判断・次の行動」をSpace単位で保存し、AIとの続きをここから再開します。
          </Typography>
        </Box>
        <Button startIcon={<RefreshIcon />} onClick={() => { loadBase(); if (selectedSpaceId) loadContext(selectedSpaceId); }}>
          更新
        </Button>
      </Stack>

      {loading && <LinearProgress sx={{ mb: 2 }} />}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice('')}>{notice}</Alert>}

      <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ mb: 2 }}>
        <Tab label="テーマ" />
        <Tab label="自分について / User Model" />
      </Tabs>

      {tab === 0 && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '320px minmax(0,1fr)' }, gap: 2 }}>
          <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 3, alignSelf: 'start' }}>
            <Stack direction="row" spacing={0.8} alignItems="center" sx={{ px: 0.5, pb: 0.5 }}>
              <AutoAwesomeIcon fontSize="small" color="primary" />
              <Typography fontWeight={900}>長期テーマ</Typography>
            </Stack>
            <Tabs
              value={spaceOwnerView}
              onChange={(_, value) => selectSpaceOwnerView(value)}
              variant="fullWidth"
              sx={{ mb: 1, minHeight: 36, '& .MuiTab-root': { minHeight: 36, py: 0.5, fontSize: '0.78rem', fontWeight: 850 } }}
            >
              <Tab value="user" label={`あなたの課題 ${userSpaceCount}`} />
              <Tab value="assistant" label={`AI側の課題 ${assistantSpaceCount}`} />
            </Tabs>
            <Stack spacing={1}>
              {visibleSpaces.length === 0 && (
                <Empty>{spaceOwnerView === 'assistant' ? 'AI側の課題はまだありません。' : 'あなた側の長期テーマはまだありません。'}</Empty>
              )}
              {visibleSpaces.map((space) => (
                <Paper
                  key={space.id}
                  variant="outlined"
                  onClick={() => selectSpace(space.id)}
                  sx={{
                    p: 1.25,
                    borderRadius: 2.5,
                    cursor: 'pointer',
                    borderColor: selectedSpaceId === space.id ? 'primary.main' : 'divider',
                    bgcolor: selectedSpaceId === space.id ? 'action.selected' : 'background.paper',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Stack direction="row" spacing={0.7} alignItems="center">
                    <Typography variant="subtitle2" fontWeight={900} sx={{ flexGrow: 1 }}>{space.title}</Typography>
                    <Chip size="small" label={space.status || 'active'} />
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.65, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {space.currentBrief || space.summary || 'まだCurrent Briefがありません。'}
                  </Typography>
                  {(space.nextActions || []).length > 0 && (
                    <Typography variant="caption" color="primary.main" sx={{ display: 'block', mt: 0.8, fontWeight: 750 }}>
                      Next: {space.nextActions[0]}
                    </Typography>
                  )}
                </Paper>
              ))}
            </Stack>
          </Paper>

          <Box sx={{ minWidth: 0 }}>
            {contextLoading && <LinearProgress sx={{ mb: 2 }} />}
            {!context && !contextLoading && <Section title="Spaceを選択"><Empty>左から長期テーマを選択してください。</Empty></Section>}
            {context && (
              <Stack spacing={2}>
                <Paper
                  elevation={0}
                  sx={{
                    p: { xs: 1.75, md: 2.5 },
                    borderRadius: 3.5,
                    border: '1px solid',
                    borderColor: 'primary.light',
                    background: (theme) => `linear-gradient(135deg, ${theme.palette.primary.main}14, ${theme.palette.background.paper} 52%, ${theme.palette.info.main}0d)`,
                  }}
                >
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }}>
                    <Box sx={{ flexGrow: 1 }}>
                      <Typography variant="overline" color="primary.main" sx={{ fontWeight: 900, letterSpacing: '0.12em' }}>
                        CURRENT THEME
                      </Typography>
                      <Typography variant="h4" fontWeight={950} sx={{ mt: -0.25, letterSpacing: '-0.03em' }}>
                        {context.space.title}
                      </Typography>
                      {context.space.summary && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.65, maxWidth: 900 }}>{context.space.summary}</Typography>}
                    </Box>
                    <Stack direction={{ xs: 'row', md: 'column' }} spacing={0.8} alignItems={{ xs: 'center', md: 'stretch' }}>
                      <Chip
                        label={(context.space.themeOwner || 'user') === 'assistant' ? 'AI側の課題' : 'あなたの課題'}
                        color={(context.space.themeOwner || 'user') === 'assistant' ? 'secondary' : 'primary'}
                        variant="filled"
                      />
                      <Chip label={context.space.status || 'active'} color="primary" variant="outlined" />
                    </Stack>
                  </Stack>

                  <Box
                    sx={{
                      mt: 2,
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
                      gap: 1,
                    }}
                  >
                    <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2.5, bgcolor: 'background.paper' }}>
                      <Typography variant="caption" color="text.secondary" fontWeight={900}>現在地</Typography>
                      <Typography variant="body2" sx={{ mt: 0.45, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                        {context.currentBrief || 'まだCurrent Briefがありません。'}
                      </Typography>
                    </Paper>
                    <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2.5, bgcolor: 'background.paper' }}>
                      <Typography variant="caption" color="text.secondary" fontWeight={900}>GOAL</Typography>
                      <Typography variant="body2" sx={{ mt: 0.45, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                        {context.goal || 'まだGoalがありません。'}
                      </Typography>
                    </Paper>
                    <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2.5, bgcolor: 'background.paper' }}>
                      <Typography variant="caption" color="text.secondary" fontWeight={900}>NEXT</Typography>
                      <Stack spacing={0.45} sx={{ mt: 0.45 }}>
                        {(context.nextActions || []).length === 0 && <Typography variant="body2">まだNext Actionがありません。</Typography>}
                        {(context.nextActions || []).slice(0, 3).map((action, index) => (
                          <Typography key={action} variant="body2" sx={{ lineHeight: 1.55 }}>
                            {index + 1}. {action}
                          </Typography>
                        ))}
                      </Stack>
                    </Paper>
                  </Box>
                </Paper>

                <Section title="課題の主体" subtitle="あなた自身の課題と、AI自身の能力・品質課題をデータ上も分離します">
                  <TextField
                    select
                    fullWidth
                    size="small"
                    label="分類"
                    value={ownerDraft}
                    onChange={(event) => setOwnerDraft(event.target.value)}
                  >
                    <option value="user">あなたの課題 / 思考テーマ</option>
                    <option value="assistant">AI側の課題 / 改善テーマ</option>
                  </TextField>
                </Section>

                <Section title="1. Current State / Current Brief" subtitle="次回セッションが最初に読む、現在地の圧縮版">
                  <TextField multiline minRows={4} fullWidth value={briefDraft} onChange={(event) => setBriefDraft(event.target.value)} />
                </Section>

                <Section title="2. Goal">
                  <TextField multiline minRows={2} fullWidth value={goalDraft} onChange={(event) => setGoalDraft(event.target.value)} />
                </Section>

                <Section title="3. 自分の条件" subtitle="Space固有の一時条件と、再利用可能なUser Modelを分けて表示">
                  <Stack spacing={1}>
                    {constraints.length === 0 && <Empty />}
                    {constraints.map((fact) => <FactRow key={fact.id} fact={fact} />)}
                  </Stack>
                </Section>

                <Section title="4. Active Ideas" subtitle="Agent Idea Spaceはscratch / exploration layerとして残ります">
                  <Stack spacing={1}>
                    {(context.activeIdeas || []).length === 0 && <Empty />}
                    {(context.activeIdeas || []).map((idea) => (
                      <Paper key={idea.id} variant="outlined" sx={{ p: 1.25, borderRadius: 2.5 }}>
                        <Typography variant="subtitle2" fontWeight={850}>{idea.title}</Typography>
                        {idea.summary && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4 }}>{idea.summary}</Typography>}
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.8 }}>
                          <Chip size="small" label={idea.type || 'idea'} variant="outlined" />
                          <Chip size="small" label={idea.maturity || 'seed'} />
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                </Section>

                <Section title="5. Opportunities" subtitle="現実に存在する案件・bounty・microgrant・contest">
                  <Stack spacing={1}>
                    {(context.activeOpportunities || []).length === 0 && <Empty />}
                    {(context.activeOpportunities || []).map((opportunity) => (
                      <Paper key={opportunity.id} variant="outlined" sx={{ p: 1.25, borderRadius: 2.5 }}>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                          <Box sx={{ flexGrow: 1 }}>
                            <Typography variant="subtitle2" fontWeight={900}>{opportunity.title}</Typography>
                            {opportunity.summary && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4 }}>{opportunity.summary}</Typography>}
                            <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap sx={{ mt: 0.8 }}>
                              <Chip size="small" label={opportunity.type || 'opportunity'} />
                              {opportunity.reward && <Chip size="small" color="success" label={opportunity.reward} />}
                              {opportunity.deadline && <Chip size="small" variant="outlined" label={`deadline: ${opportunity.deadline}`} />}
                            </Stack>
                          </Box>
                          {opportunity.sourceUrl && (
                            <MuiLink href={opportunity.sourceUrl} target="_blank" rel="noreferrer" variant="body2">
                              Source
                            </MuiLink>
                          )}
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                </Section>

                <Section title="6. Methods / Protocols" subtitle="AIが再利用する制作方法論。Runごとに使用versionを固定し、結果を見ながら改善します">
                  <Stack spacing={1}>
                    {(context.activeMethods || []).length === 0 && <Empty>このSpaceにはまだMethodがありません。</Empty>}
                    {(context.activeMethods || []).map((method) => (
                      <Paper key={method.id} variant="outlined" sx={{ p: 1.35, borderRadius: 2.5 }}>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'flex-start' }}>
                          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                            <Typography variant="subtitle2" fontWeight={900}>{method.title}</Typography>
                            {method.summary && (
                              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4, lineHeight: 1.65 }}>
                                {method.summary}
                              </Typography>
                            )}
                            {method.purpose && (
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.65, lineHeight: 1.55 }}>
                                {method.purpose}
                              </Typography>
                            )}
                            <Stack direction="row" spacing={0.55} flexWrap="wrap" useFlexGap sx={{ mt: 0.9 }}>
                              <Chip size="small" color="secondary" label="Method" />
                              <Chip
                                size="small"
                                variant="outlined"
                                label={method.currentVersionNumber ? `current version #${method.currentVersionNumber}` : 'no active version'}
                              />
                              {(method.tags || []).slice(0, 5).map((tag) => (
                                <Chip key={tag} size="small" label={tag} variant="outlined" />
                              ))}
                            </Stack>
                          </Box>
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                </Section>

                <Section title="7. Decisions" subtitle="採用・却下・保留の理由をIdea属性から分離">
                  <Stack spacing={1}>
                    {(context.importantDecisions || []).length === 0 && <Empty />}
                    {(context.importantDecisions || []).map((decision) => (
                      <Paper key={decision.id} variant="outlined" sx={{ p: 1.2, borderRadius: 2.5 }}>
                        <Stack direction="row" spacing={0.8} alignItems="center">
                          <Chip size="small" label={decision.decision} color={decision.decision === 'reject' ? 'default' : 'primary'} />
                          <Typography variant="body2" fontWeight={750}>{decision.reason}</Typography>
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                </Section>

                <Section title="8. Evidence / Sources">
                  <Stack spacing={0.8}>
                    {(context.recentSources || []).length === 0 && <Empty />}
                    {(context.recentSources || []).map((source) => (
                      <Box key={source.id}>
                        <Typography variant="body2" fontWeight={750}>{source.title || source.url || source.type}</Typography>
                        {source.summary && <Typography variant="caption" color="text.secondary">{source.summary}</Typography>}
                      </Box>
                    ))}
                  </Stack>
                </Section>

                <Section title="9. Recent Sessions">
                  <Stack spacing={0.8}>
                    {(context.recentRuns || []).length === 0 && <Empty />}
                    {(context.recentRuns || []).map((run) => (
                      <Box key={run.id}>
                        <Typography variant="body2" fontWeight={750}>{run.objective || run.id}</Typography>
                        <Typography variant="caption" color="text.secondary">{run.status} · {formatDate(run.updatedAt || run.startedAt)}</Typography>
                      </Box>
                    ))}
                  </Stack>
                </Section>

                <Section title="10. Next Actions">
                  <TextField
                    multiline
                    minRows={3}
                    fullWidth
                    value={nextDraft}
                    onChange={(event) => setNextDraft(event.target.value)}
                    helperText="1行につき1アクション"
                  />
                  <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                    <Button variant="contained" onClick={saveSpace}>分類 / Brief / Goal / Next Actionsを保存</Button>
                    <Button onClick={() => loadContext(context.space.id)}>元に戻す</Button>
                  </Stack>
                </Section>
              </Stack>
            )}
          </Box>
        </Box>
      )}

      {tab === 1 && (
        <Box>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2 }}>
            <Typography variant="h6" fontWeight={950}>My Profile / User Model</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              「AIは現在こう理解している」を確認・修正できます。本人の明言とAIの推測は別ラベルで保持されます。
            </Typography>
          </Paper>
          <Stack spacing={2}>
            {groupedProfile.length === 0 && <Section title="Profile Facts"><Empty /></Section>}
            {groupedProfile.map(([category, facts]) => (
              <Section key={category} title={category.replaceAll('_', ' ')}>
                <Stack spacing={1}>
                  {facts.map((fact) => <FactRow key={fact.id} fact={fact} onEdit={openFactEdit} />)}
                </Stack>
              </Section>
            ))}
          </Stack>
        </Box>
      )}

      <Dialog open={Boolean(editingFact)} onClose={() => setEditingFact(null)} fullWidth maxWidth="sm">
        <DialogTitle>User Modelを修正</DialogTitle>
        <DialogContent>
          {factDraft && (
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              <TextField label="Statement" multiline minRows={3} value={factDraft.statement} onChange={(e) => setFactDraft({ ...factDraft, statement: e.target.value })} />
              <TextField label="Scope" value={factDraft.scope} onChange={(e) => setFactDraft({ ...factDraft, scope: e.target.value })} />
              <TextField label="Category" value={factDraft.category} onChange={(e) => setFactDraft({ ...factDraft, category: e.target.value })} />
              <TextField select SelectProps={{ native: true }} label="Evidence Type" value={factDraft.evidenceType} onChange={(e) => setFactDraft({ ...factDraft, evidenceType: e.target.value })}>
                <option value="explicit">explicit</option>
                <option value="inferred">inferred</option>
                <option value="confirmed_inference">confirmed_inference</option>
              </TextField>
              <TextField select SelectProps={{ native: true }} label="Stability" value={factDraft.stability} onChange={(e) => setFactDraft({ ...factDraft, stability: e.target.value })}>
                <option value="temporary">temporary</option>
                <option value="contextual">contextual</option>
                <option value="stable">stable</option>
              </TextField>
              <TextField label="Confidence (0-1)" type="number" inputProps={{ min: 0, max: 1, step: 0.05 }} value={factDraft.confidence} onChange={(e) => setFactDraft({ ...factDraft, confidence: Number(e.target.value) })} />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingFact(null)}>キャンセル</Button>
          <Button variant="contained" onClick={saveFact}>保存</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
