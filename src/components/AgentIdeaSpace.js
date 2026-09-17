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
  Drawer,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  AutoAwesome as AutoAwesomeIcon,
  ContentCopy as ContentCopyIcon,
  DoneAll as DoneAllIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { auth } from '../firebase';

const MATURITY = [
  { id: 'seed', label: 'Seed', accent: '#5d8be8' },
  { id: 'exploring', label: 'Exploring', accent: '#9b6ce3' },
  { id: 'developed', label: 'Developed', accent: '#54a778' },
  { id: 'validated', label: 'Validated', accent: '#d39b3a' },
  { id: 'execution_ready', label: 'Ready', accent: '#d95d75' },
];

function toDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value) {
  const date = toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

async function agentApi(path = '', options = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('My Portal にログインしてください');
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
  if (!response.ok) throw new Error(payload.error || `Agent Idea API error (${response.status})`);
  return payload;
}

function IdeaCard({ idea, onClick }) {
  return (
    <Paper
      variant="outlined"
      onClick={() => onClick(idea)}
      sx={{
        p: 1.35,
        borderRadius: 2.5,
        cursor: 'pointer',
        bgcolor: 'background.paper',
        transition: 'transform .15s ease, box-shadow .15s ease',
        '&:hover': { transform: 'translateY(-1px)', boxShadow: 3 },
      }}
    >
      <Typography variant="subtitle2" fontWeight={850} sx={{ lineHeight: 1.4 }}>
        {idea.title || 'Untitled'}
      </Typography>
      {(idea.summary || idea.content) && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            mt: 0.6,
            lineHeight: 1.55,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {idea.summary || idea.content}
        </Typography>
      )}
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
        {(idea.tags || []).slice(0, 3).map((tag) => (
          <Chip key={tag} label={`#${tag}`} size="small" sx={{ height: 21, fontSize: 10 }} />
        ))}
      </Stack>
      <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.8 }}>
        {idea.createdBy?.agent || 'agent'} · {formatDate(idea.updatedAt || idea.createdAt)}
      </Typography>
    </Paper>
  );
}

export default function AgentIdeaSpace() {
  const [tab, setTab] = useState(0);
  const [ideas, setIdeas] = useState([]);
  const [runs, setRuns] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [selectedIdea, setSelectedIdea] = useState(null);
  const [ideaContext, setIdeaContext] = useState(null);
  const [selectedRun, setSelectedRun] = useState(null);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [objective, setObjective] = useState('');
  const [instructions, setInstructions] = useState('');
  const [seedIdeaId, setSeedIdeaId] = useState('');
  const [finishOpen, setFinishOpen] = useState(false);
  const [finding, setFinding] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [ideaResult, runResult] = await Promise.all([
        agentApi('?resource=ideas'),
        agentApi('?resource=runs'),
      ]);
      setIdeas(ideaResult.items || []);
      setRuns(runResult.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filteredIdeas = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return ideas.filter((idea) => {
      if (status && idea.status !== status) return false;
      if (!needle) return true;
      return [idea.title, idea.summary, idea.content, ...(idea.tags || []), ...(idea.domains || [])]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [ideas, search, status]);

  const openIdea = async (idea) => {
    setSelectedIdea(idea);
    setIdeaContext({ loading: true, relations: [], sources: [], evaluations: [], artifacts: [] });
    try {
      const context = await agentApi(`?resource=context&id=${encodeURIComponent(idea.id)}`);
      setIdeaContext({
        loading: false,
        relations: context.relations || [],
        sources: context.sources || [],
        evaluations: context.evaluations || [],
        artifacts: context.artifacts || [],
      });
    } catch (err) {
      setIdeaContext({ loading: false, relations: [], sources: [], evaluations: [], artifacts: [] });
      setError(err.message);
    }
  };

  const startSession = (idea = null) => {
    const seed = idea || selectedIdea;
    setSeedIdeaId(seed?.id || '');
    setObjective(seed ? `「${seed.title || 'このアイデア'}」をさらに展開する` : '');
    setInstructions('');
    setSessionOpen(true);
  };

  const createSession = async () => {
    if (!objective.trim()) return;
    try {
      const run = await agentApi('', {
        method: 'POST',
        body: JSON.stringify({
          action: 'run_start',
          objective: objective.trim(),
          instructions: instructions.trim(),
          seedIdeaIds: seedIdeaId ? [seedIdeaId] : [],
        }),
      });
      setSessionOpen(false);
      setTab(1);
      setSelectedRun(run);
      setNotice('セッションを開始しました。');
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const finishSession = async () => {
    if (!selectedRun) return;
    try {
      const run = await agentApi('', {
        method: 'POST',
        body: JSON.stringify({
          action: 'run_finish',
          id: selectedRun.id,
          expectedRevision: selectedRun.revision,
          findings: finding.trim() ? [finding.trim()] : [],
          nextActions: nextAction.trim() ? [nextAction.trim()] : [],
        }),
      });
      setSelectedRun(run);
      setFinishOpen(false);
      setFinding('');
      setNextAction('');
      setNotice('セッションを完了しました。');
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const copyRunPrompt = async (run) => {
    const prompt = [
      '@my-portal このAgent Idea Spaceの作業セッションを継続してください。',
      `Run ID: ${run.id}`,
      `目的: ${run.objective || ''}`,
      `指示: ${run.instructions || ''}`,
      `Seed Idea IDs: ${(run.seedIdeaIds || []).join(', ')}`,
      'idea_get_context と idea_run_finish を使い、agent-ideas DB上の続きとして作業してください。',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(prompt);
      setNotice('ChatGPT再開文をコピーしました。');
    } catch (err) {
      setError(`コピーに失敗しました: ${err.message}`);
    }
  };

  return (
    <Box sx={{ maxWidth: 1700, mx: 'auto' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} sx={{ mb: 2 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <AutoAwesomeIcon color="primary" />
            <Typography variant="h5" fontWeight={900}>Agent Idea Space</Typography>
            <Chip label="agent-ideas DB" size="small" color="primary" variant="outlined" />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Agent専用DBのアイデアと作業セッションを、My Portalのログインだけで確認・操作します。
          </Typography>
        </Box>
        <Button startIcon={<RefreshIcon />} onClick={refresh} variant="outlined">更新</Button>
        <Button startIcon={<AddIcon />} onClick={() => startSession()} variant="contained">セッション開始</Button>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice('')} sx={{ mb: 2 }}>{notice}</Alert>}
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
        <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ px: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <Tab label={`Ideas (${ideas.length})`} />
          <Tab label={`Sessions (${runs.length})`} />
        </Tabs>

        {tab === 0 && (
          <Box sx={{ p: { xs: 1.5, md: 2 } }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2 }}>
              <TextField size="small" fullWidth placeholder="タイトル・本文・タグを検索" value={search} onChange={(e) => setSearch(e.target.value)} />
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel>状態</InputLabel>
                <Select value={status} label="状態" onChange={(e) => setStatus(e.target.value)}>
                  <MenuItem value="">すべて</MenuItem>
                  <MenuItem value="active">active</MenuItem>
                  <MenuItem value="paused">paused</MenuItem>
                  <MenuItem value="promoted">promoted</MenuItem>
                  <MenuItem value="archived">archived</MenuItem>
                </Select>
              </FormControl>
            </Stack>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(230px, 1fr))', gap: 1.25, overflowX: 'auto', pb: 1 }}>
              {MATURITY.map((lane) => {
                const laneIdeas = filteredIdeas.filter((idea) => (idea.maturity || 'seed') === lane.id);
                return (
                  <Paper key={lane.id} variant="outlined" sx={{ minWidth: 230, p: 1, borderRadius: 2.5, bgcolor: 'action.hover' }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                      <Box sx={{ width: 6, height: 26, borderRadius: 3, bgcolor: lane.accent }} />
                      <Typography variant="subtitle2" fontWeight={900}>{lane.label}</Typography>
                      <Chip label={laneIdeas.length} size="small" sx={{ ml: 'auto!important', height: 21 }} />
                    </Stack>
                    <Stack spacing={1}>
                      {laneIdeas.map((idea) => <IdeaCard key={idea.id} idea={idea} onClick={openIdea} />)}
                      {!laneIdeas.length && <Typography variant="caption" color="text.disabled" textAlign="center" sx={{ py: 4 }}>まだありません</Typography>}
                    </Stack>
                  </Paper>
                );
              })}
            </Box>
          </Box>
        )}

        {tab === 1 && (
          <Box sx={{ p: { xs: 1.5, md: 2 }, display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 380px' }, gap: 2 }}>
            <Stack spacing={1}>
              {runs.map((run) => (
                <Paper key={run.id} variant="outlined" onClick={() => setSelectedRun(run)} sx={{ p: 1.5, borderRadius: 2.5, cursor: 'pointer', borderLeft: 4, borderLeftColor: run.status === 'active' ? 'success.main' : 'primary.main', bgcolor: selectedRun?.id === run.id ? 'action.selected' : 'background.paper' }}>
                  <Typography fontWeight={850}>{run.objective || 'Untitled session'}</Typography>
                  <Typography variant="caption" color="text.secondary">{run.agent || 'agent'} · {run.status || 'active'} · {formatDate(run.updatedAt || run.startedAt)}</Typography>
                </Paper>
              ))}
              {!runs.length && <Typography color="text.secondary" textAlign="center" sx={{ py: 5 }}>セッションはまだありません</Typography>}
            </Stack>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, alignSelf: 'start', position: { lg: 'sticky' }, top: { lg: 8 } }}>
              {selectedRun ? (
                <>
                  <Typography variant="h6" fontWeight={850}>{selectedRun.objective}</Typography>
                  <Stack direction="row" spacing={0.5} sx={{ my: 1 }}>
                    <Chip label={selectedRun.status || 'active'} size="small" />
                    <Chip label={`rev ${selectedRun.revision || 1}`} size="small" variant="outlined" />
                  </Stack>
                  <Typography variant="overline" color="text.secondary">Instructions</Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mb: 1.5 }}>{selectedRun.instructions || '—'}</Typography>
                  <Typography variant="overline" color="text.secondary">Findings</Typography>
                  {(selectedRun.findings || []).map((item, index) => <Typography key={index} variant="body2">• {item}</Typography>)}
                  <Typography variant="overline" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>Next actions</Typography>
                  {(selectedRun.nextActions || []).map((item, index) => <Typography key={index} variant="body2">• {item}</Typography>)}
                  <Divider sx={{ my: 2 }} />
                  <Stack spacing={1}>
                    <Button startIcon={<ContentCopyIcon />} variant="outlined" onClick={() => copyRunPrompt(selectedRun)}>ChatGPT再開文をコピー</Button>
                    {selectedRun.status === 'active' && <Button startIcon={<DoneAllIcon />} variant="contained" color="success" onClick={() => setFinishOpen(true)}>セッションを完了</Button>}
                  </Stack>
                </>
              ) : <Typography color="text.secondary">左のセッションを選択してください。</Typography>}
            </Paper>
          </Box>
        )}
      </Paper>

      <Drawer anchor="right" open={Boolean(selectedIdea)} onClose={() => setSelectedIdea(null)} PaperProps={{ sx: { width: { xs: '100%', sm: 440 }, p: 2.5 } }}>
        {selectedIdea && (
          <>
            <Typography variant="h6" fontWeight={900}>{selectedIdea.title || 'Untitled'}</Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ my: 1 }}>
              <Chip label={selectedIdea.status || 'active'} size="small" />
              <Chip label={selectedIdea.maturity || 'seed'} size="small" variant="outlined" />
              {(selectedIdea.tags || []).map((tag) => <Chip key={tag} label={`#${tag}`} size="small" variant="outlined" />)}
            </Stack>
            {selectedIdea.summary && <Typography color="text.secondary" sx={{ mb: 1.5 }}>{selectedIdea.summary}</Typography>}
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.75 }}>{selectedIdea.content || ''}</Typography>
            <Button variant="contained" startIcon={<AutoAwesomeIcon />} sx={{ mt: 2 }} onClick={() => startSession(selectedIdea)}>このアイデアでセッション開始</Button>
            {ideaContext?.loading && <LinearProgress sx={{ my: 2 }} />}
            {!ideaContext?.loading && ideaContext && (
              <>
                <Typography variant="overline" color="text.secondary" sx={{ mt: 2.5, display: 'block' }}>Relations</Typography>
                {ideaContext.relations.map((relation) => <Typography key={relation.id} variant="body2">{relation.type} → {relation.fromIdeaId === selectedIdea.id ? relation.toIdeaId : relation.fromIdeaId}</Typography>)}
                <Typography variant="overline" color="text.secondary" sx={{ mt: 2, display: 'block' }}>Sources</Typography>
                {ideaContext.sources.map((source) => <Typography key={source.id} variant="body2">{source.title || source.url || source.type}</Typography>)}
                <Typography variant="overline" color="text.secondary" sx={{ mt: 2, display: 'block' }}>Evaluations</Typography>
                {ideaContext.evaluations.map((evaluation) => <Typography key={evaluation.id} variant="body2"><b>{evaluation.evaluator || 'agent'}</b> {evaluation.comment || ''}</Typography>)}
                <Typography variant="overline" color="text.secondary" sx={{ mt: 2, display: 'block' }}>Artifacts</Typography>
                {ideaContext.artifacts.map((artifact) => <Typography key={artifact.id} variant="body2">{artifact.title || artifact.type}</Typography>)}
              </>
            )}
          </>
        )}
      </Drawer>

      <Dialog open={sessionOpen} onClose={() => setSessionOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Agent セッション開始</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="目的" value={objective} onChange={(e) => setObjective(e.target.value)} autoFocus required />
            <TextField label="作業指示・制約" value={instructions} onChange={(e) => setInstructions(e.target.value)} multiline minRows={4} />
            {seedIdeaId && <TextField label="Seed Idea ID" value={seedIdeaId} disabled />}
            <Alert severity="info">追加ログインは不要です。My PortalのGoogleログインをAPI側で検証して保存します。</Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSessionOpen(false)}>キャンセル</Button>
          <Button variant="contained" onClick={createSession} disabled={!objective.trim()}>開始</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={finishOpen} onClose={() => setFinishOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>セッションを完了</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="今回の主な発見（任意）" value={finding} onChange={(e) => setFinding(e.target.value)} multiline minRows={3} />
            <TextField label="次にやること（任意）" value={nextAction} onChange={(e) => setNextAction(e.target.value)} multiline minRows={3} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFinishOpen(false)}>キャンセル</Button>
          <Button variant="contained" color="success" onClick={finishSession}>完了にする</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
