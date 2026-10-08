import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, Collapse, Stack, TextField, Typography } from '@mui/material';
import ApartmentOutlinedIcon from '@mui/icons-material/ApartmentOutlined';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import { auth } from '../firebase';

const initial = { id: '', title: '', mission: '', domain: '', systemOfRecord: '', primaryMetric: '' };
const statuses = {
  incubating: '育成中',
  graduation_ready: '独立準備中',
  independent: '独立済み（閲覧のみ）',
  archived: '終了',
};

async function request(path = '', body) {
  const user = auth.currentUser;
  if (!user) throw new Error('My Portalにログインしてください');
  const token = await user.getIdToken();
  const response = await fetch('/api/agent-ideas' + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '組織APIに接続できません');
  return data;
}

export default function OrganizationsPanel({ onCreated }) {
  const [organizations, setOrganizations] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [orgResult, jobResult] = await Promise.all([
        request('?resource=organizations'), request('?resource=manager_jobs'),
      ]);
      setOrganizations(orgResult.items || []);
      setJobs(jobResult.items || []);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const create = async () => {
    if (!form.id.trim() || !form.title.trim() || !form.mission.trim()) {
      setError('ID・組織名・Missionは必須です。');
      return;
    }
    setBusy(true);
    try {
      await request('', {
        action: 'organization_create',
        id: form.id.trim(),
        title: form.title.trim(),
        mission: form.mission.trim(),
        domain: form.domain.trim(),
        systemOfRecord: form.systemOfRecord.trim(),
        outcomeContract: {
          primaryMetric: form.primaryMetric.trim(),
          evidenceRequired: true,
          missingDataIsUnknown: true,
          evaluationWindowsDays: [7, 28, 90],
        },
      });
      setNotice('育成組織を登録しました。Manager Jobは組織IDで紐付けてください。');
      setOpen(false);
      setForm(initial);
      await reload();
      if (onCreated) onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card elevation={0} sx={{ mb: 1.5, border: '1px solid', borderColor: 'divider' }}>
      <CardContent sx={{ p: '16px !important' }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
          <ApartmentOutlinedIcon color="primary" />
          <Box sx={{ flexGrow: 1, minWidth: 200 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>組織インキュベーター</Typography>
            <Typography variant="caption" color="text.secondary">
              HQは育成中の組織だけを運営。独立済みの組織には指示しません。
            </Typography>
          </Box>
          <Button size="small" startIcon={<RefreshOutlinedIcon />} onClick={reload} disabled={loading}>更新</Button>
          <Button size="small" variant="contained" startIcon={<AddOutlinedIcon />} onClick={() => setOpen(v => !v)}>組織を設立</Button>
        </Box>

        {error && <Alert severity="error" sx={{ my: 1 }}>{error}</Alert>}
        {notice && <Alert severity="success" sx={{ my: 1 }}>{notice}</Alert>}

        <Collapse in={open}>
          <Stack spacing={1.2} sx={{ p: 1.5, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 800 }}>新しい育成組織</Typography>
            <TextField size="small" label="組織ID（半角小文字・ハイフン）" value={form.id} onChange={e => setForm(v => ({ ...v, id: e.target.value }))} />
            <TextField size="small" label="組織名" value={form.title} onChange={e => setForm(v => ({ ...v, title: e.target.value }))} />
            <TextField size="small" multiline minRows={2} label="Mission / 成果目標" value={form.mission} onChange={e => setForm(v => ({ ...v, mission: e.target.value }))} />
            <TextField size="small" label="分野" value={form.domain} onChange={e => setForm(v => ({ ...v, domain: e.target.value }))} />
            <TextField size="small" label="専門データの正本（例：Learning OS）" value={form.systemOfRecord} onChange={e => setForm(v => ({ ...v, systemOfRecord: e.target.value }))} />
            <TextField size="small" label="最重要成果指標（例：根拠付きの検証済み論点数）" value={form.primaryMetric} onChange={e => setForm(v => ({ ...v, primaryMetric: e.target.value }))} />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
              <Button onClick={() => setOpen(false)}>キャンセル</Button>
              <Button variant="contained" onClick={create} disabled={busy}>{busy ? '登録中…' : '登録'}</Button>
            </Box>
          </Stack>
        </Collapse>

        <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
          {organizations.map(org => {
            const linked = jobs.filter(job => job.organizationId === org.id);
            return (
              <Box key={org.id} sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, flexWrap: 'wrap' }}>
                  <Typography variant="body2" sx={{ fontWeight: 900 }}>{org.title}</Typography>
                  <Chip size="small" variant="outlined" label={statuses[org.status] || org.status} />
                </Box>
                <Typography variant="caption" color="text.secondary">{org.id}</Typography>
                <Typography variant="body2" sx={{ my: 0.8, whiteSpace: 'pre-line' }}>{org.mission}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  成果: {org.outcomeContract?.primaryMetric || '未定義'}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  運用: {org.controlPlane || 'HQ'} / 専門データ: {org.systemOfRecord || '未設定'}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Manager Job: {linked.length ? linked.map(job => job.title).join(' / ') : '未接続'}
                </Typography>
                {org.status === 'independent' && <Typography variant="caption" color="text.secondary">以後のタスク生成・Manager起動は独立先で実施します。</Typography>}
              </Box>
            );
          })}
        </Box>
        {!loading && organizations.length === 0 && !error && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            育成組織はまだありません。既存のSEO組織は独立済みのため、HQに再登録する必要はありません。
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
