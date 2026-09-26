import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
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
  methodId: '',
  concurrencyPolicy: 'skip_if_open',
  rotationTargetsText: '',
  requireExecutionReceipt: false,
  allowedActionTypesText: '',
};

const emptyMethodDraft = {
  title: '',
  summary: '',
  purpose: '',
  instructions: '',
  protocolText: '{}',
  qualityGatesText: '',
  versionNote: '',
};

const clean = (value) => String(value || '').trim();
const jobTargets = (job) => Array.isArray(job.rotationTargets) ? job.rotationTargets : (job.metadata?.rotationTargets || []);
const jobNeedsReceipt = (job) => job.requireExecutionReceipt === undefined
  ? job.metadata?.requireExecutionReceipt === true
  : job.requireExecutionReceipt === true;

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

const methodDraftFromContext = (context) => ({
  title: context?.method?.title || '',
  summary: context?.method?.summary || '',
  purpose: context?.method?.purpose || '',
  instructions: context?.currentVersion?.instructions || '',
  protocolText: JSON.stringify(context?.currentVersion?.protocol || {}, null, 2),
  qualityGatesText: (context?.currentVersion?.qualityGates || []).join('\n'),
  versionNote: '',
});

const comparableMethodDraft = (draft) => ({
  title: clean(draft.title),
  summary: clean(draft.summary),
  purpose: clean(draft.purpose),
  instructions: String(draft.instructions || ''),
  protocolText: String(draft.protocolText || '').trim() || '{}',
  qualityGatesText: String(draft.qualityGatesText || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .join('\n'),
});

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
  if (!response.ok) throw new Error(payload.error || 'Manager Jobs API error (' + response.status + ')');
  return payload;
}

export default function RecurringJobsPanel({ projects = [] }) {
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
  const [methodContext, setMethodContext] = useState(null);
  const [methodDraft, setMethodDraft] = useState(emptyMethodDraft);
  const [methodBaseline, setMethodBaseline] = useState(emptyMethodDraft);
  const [methodContextLoading, setMethodContextLoading] = useState(false);

  const projectById = useMemo(
    () => new Map(projects.map((item) => [item.id, item])),
    [projects],
  );
  const methodById = useMemo(
    () => new Map(methods.map((item) => [item.id, item])),
    [methods],
  );

  const methodChanged = useMemo(
    () => JSON.stringify(comparableMethodDraft(methodDraft))
      !== JSON.stringify(comparableMethodDraft(methodBaseline)),
    [methodDraft, methodBaseline],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [jobResult, methodResult] = await Promise.all([
        api('?resource=manager_jobs'),
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

  const resetMethodEditor = () => {
    setMethodContext(null);
    setMethodDraft(emptyMethodDraft);
    setMethodBaseline(emptyMethodDraft);
    setMethodContextLoading(false);
  };

  const loadMethodContext = async (methodId) => {
    if (!methodId) {
      resetMethodEditor();
      return;
    }
    setMethodContextLoading(true);
    setError('');
    try {
      const result = await api('?resource=method_context&id=' + encodeURIComponent(methodId));
      const nextDraft = methodDraftFromContext(result);
      setMethodContext(result);
      setMethodDraft(nextDraft);
      setMethodBaseline(nextDraft);
    } catch (err) {
      resetMethodEditor();
      setError('Methodの読み込みに失敗しました: ' + err.message);
    } finally {
      setMethodContextLoading(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setDraft(emptyDraft);
    resetMethodEditor();
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
      methodId: job.methodId || '',
      concurrencyPolicy: job.concurrencyPolicy || 'skip_if_open',
      rotationTargetsText: jobTargets(job).join('\n'),
      requireExecutionReceipt: jobNeedsReceipt(job),
      allowedActionTypesText: (job.allowedActionTypes || job.metadata?.allowedActionTypes || []).join('\n'),
    });
    resetMethodEditor();
    setEditOpen(true);
    if (job.methodId) loadMethodContext(job.methodId);
  };

  const changeMethod = (methodId) => {
    setDraft((prev) => ({ ...prev, methodId }));
    loadMethodContext(methodId);
  };

  const saveMethodIfChanged = async () => {
    if (!draft.methodId || !methodContext || !methodChanged) return false;

    const baseline = comparableMethodDraft(methodBaseline);
    const next = comparableMethodDraft(methodDraft);
    const metadataChanged = baseline.title !== next.title
      || baseline.summary !== next.summary
      || baseline.purpose !== next.purpose;
    const versionChanged = baseline.instructions !== next.instructions
      || baseline.protocolText !== next.protocolText
      || baseline.qualityGatesText !== next.qualityGatesText;

    if (metadataChanged) {
      await api('', {
        method: 'POST',
        body: JSON.stringify({
          action: 'method_update',
          id: draft.methodId,
          expectedRevision: methodContext.method?.revision,
          patch: {
            title: next.title,
            summary: next.summary,
            purpose: next.purpose,
          },
        }),
      });
    }

    if (versionChanged) {
      let protocol;
      try {
        protocol = JSON.parse(next.protocolText || '{}');
      } catch {
        throw new Error('MethodのProtocol JSONが不正です。JSONとして保存できる形に直してください。');
      }

      await api('', {
        method: 'POST',
        body: JSON.stringify({
          action: 'method_version_create',
          methodId: draft.methodId,
          changeSummary: clean(methodDraft.versionNote)
            || ('Manager Job「' + (editing?.title || draft.title || draft.id) + '」の編集画面から更新'),
          instructions: next.instructions,
          protocol,
          qualityGates: next.qualityGatesText
            .split('\n')
            .map((item) => item.trim())
            .filter(Boolean),
          activate: true,
        }),
      });
    }

    return metadataChanged || versionChanged;
  };

  const save = async () => {
    if (!clean(draft.title)) {
      setError('Manager Jobのタイトルは必須です。');
      return;
    }
    if (draft.methodId && !methodContext && !methodContextLoading) {
      setError('紐付いたMethodを読み込めていません。Methodを選び直してください。');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const methodWasUpdated = await saveMethodIfChanged();

      if (editing) {
        await api('', {
          method: 'POST',
          body: JSON.stringify({
            action: 'manager_job_update',
            id: editing.id,
            expectedRevision: editing.revision,
            patch: {
              title: clean(draft.title),
              objective: clean(draft.objective),
              instructions: clean(draft.instructions),
              status: draft.status,
              priority: draft.priority,
              projectId: draft.projectId || null,
              methodId: draft.methodId || null,
              concurrencyPolicy: draft.concurrencyPolicy,
              rotationTargets: draft.rotationTargetsText.split('\n').map(clean).filter(Boolean),
              requireExecutionReceipt: draft.requireExecutionReceipt,
              allowedActionTypes: draft.allowedActionTypesText.split('\n').map(clean).filter(Boolean),
            },
          }),
        });
        setNotice(methodWasUpdated
          ? 'Manager Jobを更新し、Methodの新versionを反映しました。'
          : 'Manager Jobを更新しました。');
      } else {
        await api('', {
          method: 'POST',
          body: JSON.stringify({
            action: 'manager_job_create',
            id: clean(draft.id) || undefined,
            title: clean(draft.title),
            objective: clean(draft.objective),
            instructions: clean(draft.instructions),
            status: draft.status,
            priority: draft.priority,
            projectId: draft.projectId || null,
            methodId: draft.methodId || null,
            concurrencyPolicy: draft.concurrencyPolicy,
            rotationTargets: draft.rotationTargetsText.split('\n').map(clean).filter(Boolean),
            requireExecutionReceipt: draft.requireExecutionReceipt,
            allowedActionTypes: draft.allowedActionTypesText.split('\n').map(clean).filter(Boolean),
          }),
        });
        setNotice(methodWasUpdated
          ? 'Manager Jobを作成し、Methodの新versionを反映しました。'
          : 'Manager Jobを作成しました。外部スケジュールは別途ChatGPT等で設定してください。');
      }

      setEditOpen(false);
      resetMethodEditor();
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
          action: 'manager_job_update',
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
          action: 'manager_job_start',
          id: job.id,
          invocationId: 'portal-ui:' + job.id + ':' + Date.now(),
          requestedBy: 'portal-ui',
        }),
      });
      if (result.skipped) {
        setNotice('既存の未完了Manager Runがあります: ' + result.managerRun?.id);
      } else if (result.duplicate) {
        setNotice('同じ起動IDのManager Runがすでにあります。');
      } else {
        setNotice('Manager Runを作成しました。外部AgentはこのRunをclaimして、Queueの観測・整理・Work Item生成を行います。');
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
      const result = await api('?resource=manager_job_history&id=' + encodeURIComponent(job.id) + '&limit=40');
      setHistory(result.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setHistoryLoading(false);
    }
  };

  const copyTriggerPrompt = async (job) => {
    const prompt = [
      'My PortalのManager Job「' + job.id + '」を実行してください。',
      'manager_job_start({ id: "' + job.id + '" }) を呼び、返されたManager Runを manager_run_claim してください。スケジューラの再送IDがある場合だけinvocationIdを渡してください。',
      'manager_job_get_context({ id: "' + job.id + '" }) を読み、現在のQueue、Project、管理対象、紐付いたMethodのactive versionを確認してください。',
      'Manager自身が本作業を抱え込まず、Observe → Reconcile → Decide → Delegate の順で管理してください。必要な作業は manager_run_create_work_item で0〜N件生成し、既存Work Itemの優先度変更・整理・archive等は manager_run_reconcile_work_item を使ってください。',
      jobNeedsReceipt(job)
        ? 'このManager Jobから生成する実作業には、完了時にexecutionReceiptで対象・作業種別・成果物・確認結果を残させてください。'
        : '生成するWork Itemには、実行Agentが迷わないobjective / instructions / acceptance criteriaを含めてください。',
      '新しく作るべき仕事が0件でも正常です。最後に manager_run_finish で観測・判断・生成/整理結果を保存してください。',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(prompt);
      setNotice('外部ChatGPT用のManager起動指示をコピーしました。');
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
              Manager Jobs
            </Typography>
            <Typography variant="caption" color="text.secondary">
              対象領域を観測し、Queueを整理して必要なWork Itemを0〜N件生み出すマネージャー。実行時刻・cron・timezoneは外部スケジューラが担当します。
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
                    {method ? (
                      <Chip
                        size="small"
                        label={'Method · ' + method.title + (method.currentVersionNumber ? ' · v' + method.currentVersionNumber : '')}
                        color="primary"
                        variant="outlined"
                        sx={{ height: 20, fontSize: '0.56rem', fontWeight: 800 }}
                      />
                    ) : (
                      <Chip
                        size="small"
                        label="Method未設定"
                        color="warning"
                        variant="outlined"
                        sx={{ height: 20, fontSize: '0.56rem', fontWeight: 800 }}
                      />
                    )}
                    <Chip size="small" label={job.concurrencyPolicy === 'allow_overlap' ? '重複実行可' : '重複実行防止'} variant="outlined" sx={{ height: 20, fontSize: '0.56rem' }} />
                    {!!jobTargets(job).length && <Chip size="small" label={'管理対象 ' + jobTargets(job).length + '件'} variant="outlined" sx={{ height: 20, fontSize: '0.56rem' }} />}
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
                      {runningId === job.id ? '起動中…' : 'Manager起動'}
                    </Button>
                    <Button size="small" startIcon={<HistoryOutlinedIcon />} onClick={() => openHistory(job)}>
                      履歴
                    </Button>
                    <Button size="small" onClick={() => openEdit(job)}>
                      詳細・編集
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
              <Typography variant="body2" sx={{ fontWeight: 800 }}>Manager Jobはまだありません</Typography>
              <Typography variant="caption" color="text.secondary">
                定期的に外部ChatGPTへ任せたい仕事を登録し、目的・手順・Project・Methodをここに集約できます。
              </Typography>
            </Box>
          )}
        </Box>
      </Paper>

      <Dialog open={editOpen} onClose={() => !saving && setEditOpen(false)} fullWidth maxWidth="lg">
        <DialogTitle>{editing ? 'Manager Job 詳細・編集' : 'Manager Jobを追加'}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.6} sx={{ mt: 0.8 }}>
            <Paper variant="outlined" sx={{ p: 1.4 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 950, mb: 1 }}>
                Job
              </Typography>
              <Stack spacing={1.3}>
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
                  minRows={4}
                  helperText="共通して育てる実行方法は下のMethodに置き、この欄にはこのJobだけの条件を残します。"
                  fullWidth
                />
                <TextField
                  label="観測・管理対象（1行に1件）"
                  value={draft.rotationTargetsText}
                  onChange={(event) => setDraft((prev) => ({ ...prev, rotationTargetsText: event.target.value }))}
                  multiline
                  minRows={3}
                  helperText="サイト運用ならhost等を記入します。Managerが状況確認・Work Item発見の対象として使います。自動で実作業を割り当てるための欄ではありません。"
                  fullWidth
                />
                <FormControlLabel
                  control={<Checkbox checked={draft.requireExecutionReceipt} onChange={(event) => setDraft((prev) => ({ ...prev, requireExecutionReceipt: event.target.checked }))} />}
                  label="このManagerが生成した実作業に成果物・確認結果の記録を要求する"
                />
                <TextField
                  label="生成する実作業で認める作業種別（1行に1件、任意）"
                  value={draft.allowedActionTypesText}
                  onChange={(event) => setDraft((prev) => ({ ...prev, allowedActionTypesText: event.target.value }))}
                  multiline
                  minRows={2}
                  helperText="例: content_revision、internal_link、new_article、technical_fix。調査報告だけを完了扱いしたくないJobで設定します。"
                  fullWidth
                />
                {!!editing && jobTargets(editing).length > 0 && (
                  <Box sx={{ maxHeight: 170, overflowY: 'auto', border: '1px solid ' + border, borderRadius: 1, p: 1 }}>
                    <Typography variant="caption" sx={{ fontWeight: 800 }}>管理対象ごとの最終実作業</Typography>
                    {jobTargets(editing).map((target) => (
                      <Typography key={target} variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {target} · {formatDate(editing.targetProgress?.[target]?.lastActionAt)}
                        {editing.targetProgress?.[target]?.lastDeliveryStatus ? ' · ' + editing.targetProgress[target].lastDeliveryStatus : ''}
                      </Typography>
                    ))}
                  </Box>
                )}
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
                    <InputLabel>Method</InputLabel>
                    <Select
                      label="Method"
                      value={draft.methodId}
                      onChange={(event) => changeMethod(event.target.value)}
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
                      <MenuItem value="skip_if_open">未完了Manager Runがあれば新規Runを作らない</MenuItem>
                      <MenuItem value="allow_overlap">Manager Runの重複を許可</MenuItem>
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
              </Stack>
            </Paper>

            <Paper
              variant="outlined"
              sx={{
                p: 1.4,
                bgcolor: alpha(theme.palette.primary.main, isDark ? 0.07 : 0.025),
                borderColor: draft.methodId ? alpha(theme.palette.primary.main, 0.35) : border,
              }}
            >
              <Box sx={{ display: 'flex', gap: 0.7, alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 950, flex: 1 }}>
                  Method · 管理方法
                </Typography>
                {methodContext?.currentVersion && (
                  <Chip
                    size="small"
                    color="primary"
                    label={(methodContext.currentVersion.label || ('v' + methodContext.currentVersion.versionNumber)) + ' · active'}
                  />
                )}
                {methodChanged && <Chip size="small" color="warning" label="未保存の変更" />}
              </Box>

              {!draft.methodId && (
                <Alert severity="info">
                  Methodを選ぶと、観測・整理・判断・Work Item化の手順、Protocol、Quality Gatesをここに常時表示します。Manager JobではMethodを管理契約の中心として扱います。
                </Alert>
              )}

              {draft.methodId && methodContextLoading && (
                <Typography variant="body2" color="text.secondary">Methodを読み込み中…</Typography>
              )}

              {draft.methodId && !methodContextLoading && methodContext && (
                <Stack spacing={1.2}>
                  <Alert severity="info">
                    ここで実行手順を変更して保存すると、現在のversionを直接上書きせず、新しいMethod versionを作ってactive化します。過去の実行履歴は旧versionのまま残ります。
                  </Alert>

                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.2 }}>
                    <TextField
                      label="Method名"
                      value={methodDraft.title}
                      onChange={(event) => setMethodDraft((prev) => ({ ...prev, title: event.target.value }))}
                      fullWidth
                    />
                    <TextField
                      label="概要"
                      value={methodDraft.summary}
                      onChange={(event) => setMethodDraft((prev) => ({ ...prev, summary: event.target.value }))}
                      fullWidth
                    />
                  </Box>

                  <TextField
                    label="Purpose"
                    value={methodDraft.purpose}
                    onChange={(event) => setMethodDraft((prev) => ({ ...prev, purpose: event.target.value }))}
                    multiline
                    minRows={2}
                    fullWidth
                  />

                  {methodContext.currentVersion?.changeSummary && (
                    <Typography variant="caption" color="text.secondary">
                      現active versionの変更概要: {methodContext.currentVersion.changeSummary}
                    </Typography>
                  )}

                  <TextField
                    label="実行手順"
                    value={methodDraft.instructions}
                    onChange={(event) => setMethodDraft((prev) => ({ ...prev, instructions: event.target.value }))}
                    multiline
                    minRows={14}
                    fullWidth
                    helperText="外部AgentがManager Jobを実行するときに読む中心的な手順です。"
                  />

                  <TextField
                    label="Protocol（JSON）"
                    value={methodDraft.protocolText}
                    onChange={(event) => setMethodDraft((prev) => ({ ...prev, protocolText: event.target.value }))}
                    multiline
                    minRows={8}
                    fullWidth
                    inputProps={{ spellCheck: false }}
                    helperText="stages / decisionPrinciples / persistentArtifacts など、Method固有の構造化ルール。"
                  />

                  <TextField
                    label="Quality Gates（1行1項目）"
                    value={methodDraft.qualityGatesText}
                    onChange={(event) => setMethodDraft((prev) => ({ ...prev, qualityGatesText: event.target.value }))}
                    multiline
                    minRows={6}
                    fullWidth
                  />

                  <TextField
                    label="今回のMethod変更メモ（任意）"
                    value={methodDraft.versionNote}
                    onChange={(event) => setMethodDraft((prev) => ({ ...prev, versionNote: event.target.value }))}
                    fullWidth
                    helperText="手順・Protocol・Quality Gatesを変更した場合、新versionのchange summaryとして保存します。"
                  />

                  {(methodContext.versions || []).length > 0 && (
                    <Box>
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 850 }}>
                        Version history
                      </Typography>
                      <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 0.5 }}>
                        {methodContext.versions.slice(0, 8).map((version) => (
                          <Chip
                            key={version.id}
                            size="small"
                            variant={version.id === methodContext.method?.currentVersionId ? 'filled' : 'outlined'}
                            color={version.id === methodContext.method?.currentVersionId ? 'primary' : 'default'}
                            label={(version.label || ('v' + version.versionNumber)) + ' · ' + (version.status || 'draft')}
                          />
                        ))}
                      </Stack>
                    </Box>
                  )}
                </Stack>
              )}
            </Paper>

            <Alert severity="info">
              実行時刻・頻度・timezoneはMy Portalでは管理しません。外部ChatGPT等には、このManager Job IDだけを定期的に起動させます。Manager Jobは実作業ではなく、Queueを管理して仕事を生み出します。
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)} disabled={saving}>キャンセル</Button>
          <Button
            variant="contained"
            onClick={save}
            disabled={saving || methodContextLoading}
          >
            {saving ? '保存中…' : 'Job / Methodを保存'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>{historyJob?.title || 'Manager Job'} · Manager Run履歴</DialogTitle>
        <DialogContent>
          {historyLoading && <Typography variant="body2">読み込み中…</Typography>}
          {!historyLoading && history.length === 0 && (
            <Typography variant="body2" color="text.secondary">まだManager Run履歴はありません。</Typography>
          )}
          <Stack spacing={0.8} sx={{ mt: 0.5 }}>
            {history.map((item) => (
              <Paper key={item.id} variant="outlined" sx={{ p: 1.1 }}>
                <Box sx={{ display: 'flex', gap: 0.7, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography variant="body2" sx={{ fontWeight: 900, flex: 1 }}>
                    Manager Run · {item.id}
                  </Typography>
                  <Chip size="small" label={item.status} sx={{ height: 20, fontSize: '0.58rem' }} />
                  <Typography variant="caption" color="text.secondary">{formatDate(item.finishedAt || item.updatedAt || item.createdAt)}</Typography>
                </Box>
                <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 0.55 }}>
                  <Chip size="small" variant="outlined" label={'作成 ' + (item.createdWorkItemIds || []).length} sx={{ height: 19, fontSize: '0.55rem' }} />
                  <Chip size="small" variant="outlined" label={'更新 ' + (item.updatedWorkItemIds || []).length} sx={{ height: 19, fontSize: '0.55rem' }} />
                  <Chip size="small" variant="outlined" label={'Archive ' + (item.archivedWorkItemIds || []).length} sx={{ height: 19, fontSize: '0.55rem' }} />
                  {item.methodVersionNumber && <Chip size="small" variant="outlined" label={'Method v' + item.methodVersionNumber} sx={{ height: 19, fontSize: '0.55rem' }} />}
                </Stack>
                {item.summary && (
                  <Typography variant="caption" sx={{ display: 'block', mt: 0.55, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                    {item.summary}
                  </Typography>
                )}
                {(item.decisions || []).length > 0 && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.45, whiteSpace: 'pre-wrap' }}>
                    判断: {item.decisions.join(' / ')}
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
