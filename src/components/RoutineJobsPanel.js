import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, FormControlLabel, IconButton, Paper, Stack, Switch, TextField, Typography,
} from '@mui/material';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import { auth } from '../firebase';

const blank = {
  id: '', title: '', description: '', instructions: '', targetSystem: '',
  status: 'paused', slots: ['04:30', '10:30', '16:30'], maxAccountsPerRun: 10,
};

async function request(path, body) {
  const user = auth.currentUser;
  if (!user) throw new Error('ログインしてから再度お試しください。');
  const token = await user.getIdToken();
  const response = await fetch('/api/agent-ideas' + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '通信に失敗しました');
  return result;
}

export default function RoutineJobsPanel() {
  const [jobs, setJobs] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [slotsText, setSlotsText] = useState('04:30, 10:30, 16:30');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [registry, history] = await Promise.all([
        request('?resource=routine_jobs'),
        request('?resource=routine_job_runs'),
      ]);
      setJobs(registry.items || []);
      setRuns(history.items || []);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const edit = (job) => {
    setEditing(job || {});
    setForm(job ? { ...job } : { ...blank });
    setSlotsText((job?.slots || blank.slots).join(', '));
    setNotice('');
    setError('');
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const parsedSlots = slotsText.split(/[\s,、]+/).map((value) => value.trim()).filter(Boolean);
      await request('', {
        action: 'routine_job_upsert', ...form,
        id: form.id.trim(), slots: parsedSlots,
        expectedRevision: editing?.revision,
      });
      setEditing(null);
      setNotice('ジョブの設定を保存しました。次の実行時から反映されます。');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (job) => {
    setError('');
    try {
      await request('', {
        action: 'routine_job_upsert', id: job.id,
        expectedRevision: job.revision,
        status: job.status === 'active' ? 'paused' : 'active',
      });
      await load();
    } catch (err) { setError(err.message); }
  };

  return (
    <Paper elevation={0} sx={{ p: { xs: 1.6, md: 2.4 }, mb: 1.5, border: '1px solid', borderColor: 'divider' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} justifyContent="space-between" mb={2}>
        <Box>
          <Stack direction="row" alignItems="center" spacing={1}>
            <ScheduleOutlinedIcon color="primary" />
            <Typography variant="h6" fontWeight={900}>定期ジョブ</Typography>
            <Chip size="small" label={jobs.filter((job) => job.status === 'active').length + ' 稼働設定'} />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            ChatGPTの専用起動枠を共有する軽量処理。Manager / Workerとは独立。
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" startIcon={<RefreshOutlinedIcon />} onClick={load} disabled={loading}>更新</Button>
          <Button size="small" variant="contained" startIcon={<AddCircleOutlineIcon />} onClick={() => edit(null)}>追加</Button>
        </Stack>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.4 }}>
        起動枠: 毎日 04:30 / 10:30 / 16:30（日本時間）。表示時刻はジョブの実行対象枠であり、実行基盤の起動予定自体は別途設定されます。
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 1.5 }}>{notice}</Alert>}
      {loading && <Typography color="text.secondary" variant="body2">定期ジョブを取得中…</Typography>}
      {!loading && !jobs.length && <Alert severity="info">ジョブはまだ登録されていません。</Alert>}
      <Stack spacing={1}>
        {jobs.map((job) => {
          const history = runs.find((run) => run.jobId === job.id);
          return (
            <Box key={job.id} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
                <Box flex={1} minWidth={0}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography fontWeight={800}>{job.title}</Typography>
                    <Chip size="small" color={job.status === 'active' ? 'success' : 'default'} label={job.status === 'active' ? '有効' : '停止中'} />
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{job.description}</Typography>
                  <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap mt={1}>
                    <Chip size="small" variant="outlined" label={job.targetSystem || 'Operator未指定'} />
                    {(job.slots || []).map((slot) => <Chip size="small" variant="outlined" key={slot} label={slot} />)}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.9 }}>
                    {history ? ('直近: ' + history.status + ' / ' + (history.finishedAt || history.startedAt || '').replace('T', ' ').slice(0, 16)) : '実行履歴なし — まだHQ経由実行を確認していません'}
                  </Typography>
                  {history?.resultSummary && <Typography variant="caption" sx={{ display: 'block', mt: 0.3 }}>{history.resultSummary}</Typography>}
                </Box>
                <Stack direction="row" alignItems="center">
                  <FormControlLabel control={<Switch size="small" checked={job.status === 'active'} onChange={() => toggle(job)} />} label="有効" />
                  <IconButton aria-label={job.title + 'を編集'} onClick={() => edit(job)}><EditOutlinedIcon /></IconButton>
                </Stack>
              </Stack>
            </Box>
          );
        })}
      </Stack>
      <Divider sx={{ my: 1.5 }} />
      <Typography variant="caption" color="text.secondary">
        ジョブの保存とスケジュールの実行は別です。実行後のTweets Operator在庫確認をもって成功判定します。
      </Typography>
      <Dialog open={Boolean(editing)} onClose={() => !saving && setEditing(null)} fullWidth maxWidth="sm">
        <DialogTitle>{editing?.id ? '定期ジョブを編集' : '定期ジョブを追加'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="ジョブID" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} disabled={Boolean(editing?.id)} helperText="英小文字・数字・ハイフン。後から変更できません。" fullWidth />
            <TextField label="表示名" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} fullWidth />
            <TextField label="担当Operator" value={form.targetSystem} onChange={(e) => setForm({ ...form, targetSystem: e.target.value })} fullWidth />
            <TextField label="目的・概要" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} multiline minRows={2} fullWidth />
            <TextField label="実行枠（JST、カンマ区切り）" value={slotsText} onChange={(e) => setSlotsText(e.target.value)} helperText="共有スケジュールで起動する時刻から指定してください。" fullWidth />
            <TextField label="実行指示（正本）" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} multiline minRows={7} fullWidth />
            <FormControlLabel control={<Switch checked={form.status === 'active'} onChange={(e) => setForm({ ...form, status: e.target.checked ? 'active' : 'paused' })} />} label="有効にする" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)} disabled={saving}>キャンセル</Button>
          <Button onClick={save} disabled={saving || !form.id || !form.title || !form.instructions} variant="contained">{saving ? '保存中…' : '保存'}</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
