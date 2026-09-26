import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddTaskOutlinedIcon from '@mui/icons-material/AddTaskOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import RepeatRoundedIcon from '@mui/icons-material/RepeatRounded';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import { auth } from '../firebase';

const emptyDraft = {
  id: '',
  title: '',
  objective: '',
  instructions: '',
  status: 'active',
  priority: 'medium',
  projectId: '',
  spaceId: '',
  methodId: '',
  concurrencyPolicy: 'skip_if_open',
};

const clean = (value) => String(value || '').trim();

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

async function api(path = '', options = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('My Portal にログインしてください');
  const token = await user.getIdToken();
  const response = await fetch('/api/agent-ideas' + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Recurring Jobs API error (' + response.status + ')');
  return payload;
}

export default function RecurringJobsPanel({ projects = [], spaces = [] }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const border = isDark
    ? alpha(theme.palette.common.white, 0.1)
    : 'rgba(73, 112, 138, 0.16)';
  const glass = isDark
    ? alpha(theme.palette.background.paper, 0.84)
    : 'rgba(255,255,255,0.76)';

  const [jobs, setJobs] = useState([]);
  const [methods, setMethods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [editing, setEditing] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyJob, setHistoryJob] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const projectById = useMemo(
    () => new Map(projects.map((item) => [item.id, item])),
    [projects],
  );
  const methodById = useMemo(
    () => new Map(methods.map((item) => [item.id, item])),
    [methods],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [jobResult, methodResult] = await Promise.all([
        api('?resource=recurring_jobs'),
        api('?resource=methods'),
      ]);
      setJobs(jobResult.items || []);
      setMethods(methodResult.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openCreate = () => {
    setEditing(null);
    setDraft(emptyDraft);
    setEditOpen(true);
  };

  const openEdit = (job) => {
    setEditing(job);
    setDraft({
      id: job.id || '',
      title: job.title || '',
      objective: job.objective || '',
      instructions: job.instructions || '',
      status: job.status || 'active',
      priority: job.priority || 'medium',
      projectId: job.projectId || '',
      spaceId: job.spaceId || '',
      methodId: job.methodId || '',
      concurrencyPolicy: job.concurrencyPolicy || 'skip_if_open',
    });
    setEditOpen(true);
  };

  const save = async () => {
    if (!clean(draft.title)) {
      setError('Recurring Jobのタイトルは必須です。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (editing) {
        await api('', {
          method: 'POST',
          body: JSON.stringify({
            action: 'recurring_job_update',
            id: editing.id,
            expectedRevision: editing.revision,
            patch: {
              title: clean(draft.title),
              objective: clean(draft.objective),
              instructions: clean(draft.instructions),
              status: draft.status,
              priority: draft.priority,
              projectId: draft.projectId || null,
              spaceId: draft.spaceId || null,
              methodId: draft.methodId || null,
              concurrencyPolicy: draft.concurrencyPolicy,
            },
          }),
        });
        setNotice('Recurring Jobを更新しました。');
      } else {
        await api('', {
          method: 'POST',
          body: JSON.stringify({
            action: 'recurring_job_create',
            id: clean(draft.id) || undefined,
            title: clean(draft.title),
            objective: clean(draft.objective),
            instructions: clean(draft.instructions),
            status: draft.status,
            priority: draft.priority,
            projectId: draft.projectId || null,
            spaceId: draft.spaceId || null,
            methodId: draft.methodId || null,
            concurrencyPolicy: draft.concurrencyPolicy,
          }),
        });
        setNotice('Recurring Jobを作成しました。外部スケジュールは別途ChatGPT等で設定してください。');
      }
      setEditOpen(false);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (job, status) => {
    setError('');
    try {
      await api('', {
        method: 'POST',
        body: JSON.stringify({
          action: 'recurring_job_update',
          id: job.id,
          expectedRevision: job.revision,
          patch: { status },
        }),
      });
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const runNow = async (job) => {
    setRunningId(job.id);
    setError('');
    try {
      const result = await api('', {
        method: 'POST',
        body: JSON.stringify({
          action: 'recurring_job_start',
          id: job.id,
          invocationId: 'portal-ui:' + job.id + ':' + Date.now(),
          requestedBy: 'portal-ui',
        }),
      });
      if (result.skipped) {
        setNotice('既存の未完了Work Itemがあるため、新しい実行は作成しませんでした。');
      } else if (result.duplicate) {
        setNotice('同じ実行IDのWork Itemがすでにあります。');
      } else {
        setNotice('Ready Work Itemを作成しました。Agent Queueからclaimして実行できます。');
      }
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setRunningId('');
    }
  };

  const openHistory = async (job) => {
    setHistoryJob(job);
    setHistory([]);
    setHistoryOpen(true);
    setHistoryLoading(true);
    setError('');
    try {
      const result = await api('?resource=recurring_job_history&id=' + encodeURIComponent(job.id) + '&limit=40');
      setHistory(result.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setHistoryLoading(false);
    }
  };

  const copyTriggerPrompt = async (job) => {
    const prompt = [
      'My PortalのRecurring Job「' + job.id + '」を実行してください。',
      'recurring_job_start({ id: "' + job.id + '" }) で今回分のWork Itemを作成し、返されたWork Itemをwork_item_claimしてください。',
      '実行前に recurring_job_get_context({ id: "' + job.id + '" }) を読み、Job固有のinstructions、Project / Space、紐付いたMethodのactive versionに従ってください。',
      '完了後は通常のwork_item_finishで結果とnextActionsを残してください。',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(prompt);
      setNotice('外部ChatGPT用の起動指示をコピーしました。');
    } catch (err) {
      setError('コピーに失敗しました: ' + err.message);
    }
  };

  const visibleJobs = jobs.filter((job) => job.status !== 'archived');

  return (
    <>
      <Paper
        elevation={0}
        sx={{
          p: 1.25,
          mb: 1.5,
          border: '1px solid ' + border,
          background: glass,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mb: 1, flexWrap: 'wrap' }}>
          <RepeatRoundedIcon color="primary" />
          <Box sx={{ flex: 1, minWidth: 220 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
              Recurring Jobs
            </Typography>
            <Typography variant="caption" color="text.secondary">
              繰り返し行う仕事の正本。実行時刻・cron・timezoneは持たず、ChatGPT等の外部スケジューラがJob IDを指定して起動します。
            </Typography>
          </Box>
          <Chip size="small" label={visibleJobs.length} sx={{ height: 21 }} />
          <Button size="small" variant="contained" startIcon={<AddTaskOutlinedIcon />} onClick={openCreate}>
            Job追加
          </Button>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError('')}>{error}</Alert>}
        {notice && <Alert severity="success" sx={{ mb: 1 }} onClose={() => setNotice('')}>{notice}</Alert>}

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' },
            gap: 0.9,
          }}
        >
          {visibleJobs.map((job) => {
            const project = projectById.get(job.projectId);
            const method = methodById.get(job.methodId);
            return (
              <Card key={job.id} elevation={0} sx={{ border: '1px solid ' + border }}>
                <CardContent sx={{ p: '13px !important' }}>
                  <Box sx={{ display: 'flex', gap: 0.7, alignItems: 'flex-start' }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 950 }}>
                        {job.title}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.15 }}>
                        ID: {job.id}
                      </Typography>
                    </Box>
                    <Chip
                      size="small"
                      color={job.status === 'active' ? 'success' : 'default'}
                      variant={job.status === 'active' ? 'filled' : 'outlined'}
                      label={job.status}
                      sx={{ height: 20, fontSize: '0.58rem' }}
                    />
                  </Box>

                  {job.objective && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        mt: 0.7,
                        lineHeight: 1.55,
                      }}
                    >
                      {job.objective}
                    </Typography>
                  )}

                  <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 0.8 }}>
                    {project && <Chip size="small" label={'Project · ' + project.name} variant="outlined" sx={{ height: 20, fontSize: '0.56rem' }} />}
                    {method && <Chip size="small" label={'Method · ' + method.title + (method.currentVersionNumber ? ' · v' + method.currentVersionNumber : '')} variant="outlined" sx={{ height: 20, fontSize: '0.56rem' }} />}
                    <Chip size="small" label={job.concurrencyPolicy === 'allow_overlap' ? '重複実行可' : '重複実行防止'} variant="outlined" sx={{ height: 20, fontSize: '0.56rem' }} />
                  </Stack>

                  <Box sx={{ mt: 0.9, p: 0.8, borderRadius: 1.4, bgcolor: alpha(theme.palette.primary.main, isDark ? 0.08 : 0.04) }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      前回: {formatDate(job.lastFinishedAt || job.lastStartedAt)}
                      {job.lastExecutionStatus ? ' · ' + job.lastExecutionStatus : ''}
                    </Typography>
                    {job.lastResultSummary && (
                      <Typography
                        variant="caption"
                        sx={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          mt: 0.25,
                          lineHeight: 1.45,
                        }}
                      >
                        {job.lastResultSummary}
                      </Typography>
                    )}
                  </Box>

                  <Stack direction="row" spacing={0.55} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<PlayArrowRoundedIcon />}
                      onClick={() => runNow(job)}
                      disabled={job.status !== 'active' || runningId === job.id}
                    >
                      {runningId === job.id ? '作成中…' : '実行'}
                    </Button>
                    <Button size="small" startIcon={<HistoryOutlinedIcon />} onClick={() => openHistory(job)}>
                      履歴
                    </Button>
                    <Button size="small" onClick={() => openEdit(job)}>
                      編集
                    </Button>
                    <Button size="small" startIcon={<ContentCopyOutlinedIcon />} onClick={() => copyTriggerPrompt(job)}>
                      起動指示
                    </Button>
                    {job.status === 'active' ? (
                      <Button
                        size="small"
                        color="inherit"
                        startIcon={<PauseCircleOutlineIcon />}
                        onClick={() => updateStatus(job, 'paused')}
                      >
                        Pause
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        color="inherit"
                        startIcon={<PlayArrowRoundedIcon />}
                        onClick={() => updateStatus(job, 'active')}
                      >
                        Resume
                      </Button>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            );
          })}

          {!loading && visibleJobs.length === 0 && (
            <Box sx={{ p: 2, border: '1px dashed ' + border, borderRadius: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 800 }}>Recurring Jobはまだありません</Typography>
              <Typography variant="caption" color="text.secondary">
                定期的に外部ChatGPTへ任せたい仕事を登録し、目的・手順・Project・Methodをここに集約できます。
              </Typography>
            </Box>
          )}
        </Box>
      </Paper>

      <Dialog open={editOpen} onClose={() => !saving && setEditOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>{editing ? 'Recurring Jobを編集' : 'Recurring Jobを追加'}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.4} sx={{ mt: 0.8 }}>
            {!editing && (
              <TextField
                label="Job ID（任意）"
                value={draft.id}
                onChange={(event) => setDraft((prev) => ({ ...prev, id: event.target.value }))}
                helperText="外部スケジュールから呼びやすい固定IDを付けられます。空欄なら自動生成。"
                fullWidth
              />
            )}
            <TextField
              label="タイトル"
              value={draft.title}
              onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
              fullWidth
              required
            />
            <TextField
              label="目的"
              value={draft.objective}
              onChange={(event) => setDraft((prev) => ({ ...prev, objective: event.target.value }))}
              multiline
              minRows={2}
              fullWidth
            />
            <TextField
              label="このJob固有の手順・制約"
              value={draft.instructions}
              onChange={(event) => setDraft((prev) => ({ ...prev, instructions: event.target.value }))}
              multiline
              minRows={5}
              helperText="繰り返し改善したい方法論はMethodへ分離し、この欄にはJob固有の条件を残します。"
              fullWidth
            />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' }, gap: 1.2 }}>
              <FormControl fullWidth>
                <InputLabel>Project</InputLabel>
                <Select
                  label="Project"
                  value={draft.projectId}
                  onChange={(event) => setDraft((prev) => ({ ...prev, projectId: event.target.value }))}
                >
                  <MenuItem value="">なし</MenuItem>
                  {projects.map((project) => <MenuItem key={project.id} value={project.id}>{project.name || project.id}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel>Space</InputLabel>
                <Select
                  label="Space"
                  value={draft.spaceId}
                  onChange={(event) => setDraft((prev) => ({ ...prev, spaceId: event.target.value }))}
                >
                  <MenuItem value="">なし</MenuItem>
                  {spaces.map((space) => <MenuItem key={space.id} value={space.id}>{space.title || space.id}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel>Method</InputLabel>
                <Select
                  label="Method"
                  value={draft.methodId}
                  onChange={(event) => setDraft((prev) => ({ ...prev, methodId: event.target.value }))}
                >
                  <MenuItem value="">なし</MenuItem>
                  {methods.filter((method) => method.status === 'active').map((method) => (
                    <MenuItem key={method.id} value={method.id}>
                      {method.title}{method.currentVersionNumber ? ' · v' + method.currentVersionNumber : ''}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel>重複実行</InputLabel>
                <Select
                  label="重複実行"
                  value={draft.concurrencyPolicy}
                  onChange={(event) => setDraft((prev) => ({ ...prev, concurrencyPolicy: event.target.value }))}
                >
                  <MenuItem value="skip_if_open">未完了があれば新規作成しない</MenuItem>
                  <MenuItem value="allow_overlap">重複実行を許可</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel>Priority</InputLabel>
                <Select
                  label="Priority"
                  value={draft.priority}
                  onChange={(event) => setDraft((prev) => ({ ...prev, priority: event.target.value }))}
                >
                  <MenuItem value="critical">Critical</MenuItem>
                  <MenuItem value="high">High</MenuItem>
                  <MenuItem value="medium">Medium</MenuItem>
                  <MenuItem value="low">Low</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select
                  label="Status"
                  value={draft.status}
                  onChange={(event) => setDraft((prev) => ({ ...prev, status: event.target.value }))}
                >
                  <MenuItem value="active">Active</MenuItem>
                  <MenuItem value="paused">Paused</MenuItem>
                  <MenuItem value="archived">Archived</MenuItem>
                </Select>
              </FormControl>
            </Box>
            <Alert severity="info">
              実行時刻・頻度・timezoneはMy Portalでは管理しません。外部ChatGPT等には、このJob IDだけを定期的に起動させます。
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)} disabled={saving}>キャンセル</Button>
          <Button variant="contained" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>{historyJob?.title || 'Recurring Job'} · 実行履歴</DialogTitle>
        <DialogContent>
          {historyLoading && <Typography variant="body2">読み込み中…</Typography>}
          {!historyLoading && history.length === 0 && (
            <Typography variant="body2" color="text.secondary">まだ実行履歴はありません。</Typography>
          )}
          <Stack spacing={0.8} sx={{ mt: 0.5 }}>
            {history.map((item) => (
              <Paper key={item.id} variant="outlined" sx={{ p: 1.1 }}>
                <Box sx={{ display: 'flex', gap: 0.7, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography variant="body2" sx={{ fontWeight: 900, flex: 1 }}>{item.title}</Typography>
                  <Chip size="small" label={item.status} sx={{ height: 20, fontSize: '0.58rem' }} />
                  <Typography variant="caption" color="text.secondary">{formatDate(item.finishedAt || item.updatedAt || item.createdAt)}</Typography>
                </Box>
                {item.metadata?.recurringJob?.methodVersionNumber && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35 }}>
                    Method version: v{item.metadata.recurringJob.methodVersionNumber}
                  </Typography>
                )}
                {item.resultSummary && (
                  <Typography variant="caption" sx={{ display: 'block', mt: 0.45, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                    {item.resultSummary}
                  </Typography>
                )}
                {item.blockedReason && (
                  <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.45 }}>
                    Blocked: {item.blockedReason}
                  </Typography>
                )}
              </Paper>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHistoryOpen(false)}>閉じる</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
