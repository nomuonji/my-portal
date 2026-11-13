import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, Paper, Stack, Typography
} from '@mui/material';
import { DeleteOutline, Refresh, WarningAmber } from '@mui/icons-material';
import { auth } from '../firebase';

async function request(path = '', body = null) {
  const user = auth.currentUser;
  if (!user) throw new Error('My Portal にログインしてください');
  const response = await fetch('/api/agent-ideas' + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: 'Bearer ' + await user.getIdToken(),
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '通信に失敗しました (' + response.status + ')');
  return data;
}

const GROUPS = [
  {
    key: 'bases', title: '閉鎖済みの道場', resource: 'exploration_bases',
    action: 'cleanup_exploration_base', eligible: item => item.status === 'closed',
    note: '道場本体・台帳・実行記録・イベントを削除します。',
  },
  {
    key: 'skills', title: 'アーカイブ済みChat Skill', resource: 'chat_skills&includeArchived=true',
    action: 'cleanup_chat_skill', eligible: item => item.status === 'archived',
    note: 'Skill本文と全バージョンを削除します。現役の道場が使用中の場合は削除できません。',
  },
  {
    key: 'contexts', title: 'アーカイブ済みContext', resource: 'contexts&includeArchived=true',
    action: 'cleanup_context', eligible: item => item.status === 'archived',
    note: 'ContextとContextイベントを削除します。旧Space等の元データは変更しません。',
  },
  {
    key: 'jobs', title: '停止中の定期ジョブ', resource: 'routine_jobs',
    action: 'cleanup_routine_job', eligible: item => item.status === 'paused',
    note: 'ジョブ定義を削除します。実行履歴は監査用に残します。',
  },
];

function itemsOf(data) {
  return Array.isArray(data?.items) ? data.items : [];
}

export default function CleanupCenter() {
  const [records, setRecords] = useState({ bases: [], skills: [], contexts: [], jobs: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [bases, skills, contexts, jobs] = await Promise.all([
        request('?resource=exploration_bases'),
        request('?resource=chat_skills&includeArchived=true'),
        request('?resource=contexts&includeArchived=true'),
        request('?resource=routine_jobs'),
      ]);
      setRecords({
        bases: itemsOf(bases).filter(GROUPS[0].eligible),
        skills: itemsOf(skills).filter(GROUPS[1].eligible),
        contexts: itemsOf(contexts).filter(GROUPS[2].eligible),
        jobs: itemsOf(jobs).filter(GROUPS[3].eligible),
      });
    } catch (e) {
      setError(e.message || '一覧を読み込めませんでした');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const total = useMemo(
    () => Object.values(records).reduce((sum, list) => sum + list.length, 0),
    [records],
  );

  const remove = async () => {
    if (!selected) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await request('', {
        action: selected.action,
        id: selected.item.id,
        expectedRevision: selected.item.revision,
        confirm: true,
      });
      setNotice('削除しました：' + (result.title || selected.item.title || selected.item.id));
      setSelected(null);
      await refresh();
    } catch (e) {
      setError(e.message || '削除に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const countOf = key => records[key]?.length || 0;

  return (
    <Box sx={{ maxWidth: 1040, mx: 'auto', pb: 5 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1.5}>
        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '.14em' }}>SYSTEM MAINTENANCE</Typography>
          <Typography component="h1" sx={{ fontSize: { xs: 25, md: 32 }, fontWeight: 900 }}>削除センター</Typography>
          <Typography color="text.secondary" sx={{ mt: .5, lineHeight: 1.7 }}>
            アーカイブ・終了・停止済みの不要レコードを、保存先から完全削除します。
          </Typography>
        </Box>
        <Button startIcon={<Refresh />} onClick={refresh} disabled={loading || busy} variant="outlined">再読み込み</Button>
      </Stack>

      <Paper variant="outlined" sx={{ mt: 2.5, p: 2, borderRadius: 2.5 }}>
        <Stack direction="row" spacing={1.2} alignItems="center">
          <WarningAmber color="warning" />
          <Typography fontWeight={800}>削除対象は状態で制限されています</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: .7, lineHeight: 1.7 }}>
          開いている道場・利用中のSkill・activeなContext・稼働中の定期ジョブは一覧に出しません。
          削除ボタンを押した後、確認ダイアログでもう一度対象を確認します。
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.4 }}>
          <Chip size="small" label={loading ? '確認中…' : '削除可能 ' + total + ' 件'} color={total ? 'warning' : 'default'} variant="outlined" />
          {GROUPS.map(group => <Chip key={group.key} size="small" variant="outlined" label={group.title + ' ' + countOf(group.key)} />)}
        </Stack>
      </Paper>

      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mt: 2 }}>{notice}</Alert>}

      {loading ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 7 }}><CircularProgress /></Box>
      ) : (
        <Stack spacing={2.2} sx={{ mt: 2.5 }}>
          {GROUPS.map(group => (
            <Box key={group.key}>
              <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 1 }}>
                <Typography variant="h6" fontWeight={850}>{group.title}</Typography>
                <Chip size="small" label={countOf(group.key)} variant="outlined" />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.1 }}>{group.note}</Typography>
              {records[group.key].length === 0 ? (
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Typography variant="body2" color="text.secondary">削除可能なレコードはありません。</Typography>
                </Paper>
              ) : (
                <Stack spacing={.8}>
                  {records[group.key].map(item => (
                    <Paper key={item.id} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1.2}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography fontWeight={800} sx={{ overflowWrap: 'anywhere' }}>{item.title || item.name || item.id}</Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
                            {item.id}　·　{item.status}　·　revision {item.revision ?? '—'}
                          </Typography>
                          {item.summary && <Typography variant="body2" color="text.secondary" sx={{ mt: .45 }}>{item.summary}</Typography>}
                        </Box>
                        <Button color="error" variant="outlined" size="small" startIcon={<DeleteOutline />}
                          disabled={busy} onClick={() => setSelected({ action: group.action, group, item })}>
                          完全削除
                        </Button>
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              )}
              {group.key !== 'jobs' && <Divider sx={{ mt: 2 }} />}
            </Box>
          ))}
        </Stack>
      )}

      <Dialog open={Boolean(selected)} onClose={() => !busy && setSelected(null)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 900 }}>このレコードを完全削除しますか？</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            削除した内容は画面から復元できません。元データの別コピーや旧履歴は、削除契約に従って残る場合があります。
          </Alert>
          <Typography fontWeight={850}>{selected?.item?.title || selected?.item?.id}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: .5, overflowWrap: 'anywhere' }}>
            {selected?.group?.title} ／ {selected?.item?.id}
          </Typography>
          <Typography variant="body2" sx={{ mt: 1.3, lineHeight: 1.7 }}>
            {selected?.group?.note}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setSelected(null)}>キャンセル</Button>
          <Button color="error" variant="contained" startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <DeleteOutline />}
            disabled={busy} onClick={remove}>完全削除する</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
