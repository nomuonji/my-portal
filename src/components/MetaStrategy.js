import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { auth } from '../firebase';
import {
  Alert, Box, Button, Card, Chip, CircularProgress, Divider, Link,
  MenuItem, Paper, Select, Stack, TextField, Typography, useTheme,
} from '@mui/material';
import {
  AutoAwesomeOutlined as SparkIcon, CheckCircleOutline as AcceptIcon,
  CloseOutlined as RejectIcon, RefreshOutlined as RefreshIcon,
  NorthEast as LinkIcon, TipsAndUpdatesOutlined as IdeaIcon,
} from '@mui/icons-material';

const STATUS = {
  new: '未判断', considering: '気になる', accepted: '採用', rejected: '見送り', done: '試した・完了',
};
const PRIORITY = { now: '今やる', soon: '次にやる', explore: '探索する' };
const LENSES = {
  all: 'すべての提案', curiosity: '興味を広げる', personal: '個人的なこと', projects: '活動・仕事', 'cross-cutting': '横断的な発見',
};
const getLens = item => LENSES[item.lens] ? item.lens : 'cross-cutting';

async function request(path, body) {
  const user = auth.currentUser;
  if (!user) throw new Error('ログインしてください');
  const token = await user.getIdToken();
  const response = await fetch('/api/agent-ideas' + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '保存・取得に失敗しました (' + response.status + ')');
  return data;
}
function formatDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('ja-JP') : '不明';
}
function ProposalCard({ proposal, onSaved }) {
  const [status, setStatus] = useState(proposal.status);
  const [feedback, setFeedback] = useState(proposal.feedback || '');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setStatus(proposal.status); setFeedback(proposal.feedback || ''); }, [proposal]);
  const dirty = status !== proposal.status || feedback !== (proposal.feedback || '');
  const save = async (nextStatus) => {
    const chosen = nextStatus || status;
    setSaving(true); setError('');
    try {
      const updated = await request('', { action: 'meta_proposal_feedback', id: proposal.id,
        status: chosen, feedback, expectedRevision: proposal.revision });
      onSaved(updated);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };
  return (
    <Card variant="outlined" sx={{ borderRadius: 2.4, p: { xs: 2, sm: 2.4 }, height: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: 1.1 }}>
        <Stack direction="row" spacing={.75} useFlexGap flexWrap="wrap">
          <Chip size="small" label={LENSES[getLens(proposal)]} variant="outlined" />
          <Chip size="small" label={PRIORITY[proposal.priority] || '探索する'}
            color={proposal.priority === 'now' ? 'primary' : 'default'} variant={proposal.priority === 'now' ? 'filled' : 'outlined'} />
          <Chip size="small" label={STATUS[proposal.status] || proposal.status} variant="outlined" />
          <Chip size="small" label={proposal.category || '全体'} sx={{ maxWidth: 180 }} />
        </Stack>
        <Typography variant="caption" color="text.secondary">{formatDate(proposal.createdAt)}</Typography>
      </Stack>
      <Typography variant="h6" component="h2" sx={{ fontWeight: 800, fontSize: '1.09rem', lineHeight: 1.4 }}>{proposal.title}</Typography>
      <Typography variant="body2" sx={{ mt: 1, lineHeight: 1.78, whiteSpace: 'pre-wrap' }}>{proposal.summary}</Typography>
      <Paper variant="outlined" sx={{ mt: 1.7, p: 1.6, borderRadius: 1.8, bgcolor: 'action.hover' }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 750 }}>なぜ提案するのか</Typography>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.65, mt: .4 }}>{proposal.reason}</Typography>
        <Divider sx={{ my: 1.2 }} />
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 750 }}>まず試すなら</Typography>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.65, mt: .4 }}>{proposal.nextStep}</Typography>
      </Paper>
      <Button onClick={() => setOpen(v => !v)} size="small" sx={{ mt: 1.1, px: 0 }}>
        {open ? '根拠と評価を閉じる' : '根拠・留保・評価を表示'}
      </Button>
      {open && <>
        {(proposal.evidence || []).map((item, index) => (
          <Box key={index} sx={{ mt: 1, pl: 1.3, borderLeft: '2px solid', borderColor: 'divider' }}>
            <Typography variant="caption" sx={{ fontWeight: 800 }}>{item.label || '根拠'}</Typography>
            {item.observation && <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>{item.observation}</Typography>}
            {item.url && <Link href={item.url} target="_blank" rel="noreferrer" variant="caption"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: .4 }}>出典 <LinkIcon fontSize="inherit" /></Link>}
          </Box>
        ))}
        {proposal.uncertainty && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          未確認：{proposal.uncertainty}
        </Typography>}
        {(proposal.context || []).length > 0 &&
          <Stack direction="row" gap={.6} flexWrap="wrap" sx={{ mt: 1.4 }}>
            {(proposal.context || []).map(value => <Chip key={value} size="small" variant="outlined" label={value} />)}
          </Stack>}
      </>}
      <Divider sx={{ my: 1.6 }} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Select size="small" value={status} onChange={e => setStatus(e.target.value)}
          sx={{ minWidth: 115, flexShrink: 0 }} aria-label="提案の評価">
          {Object.entries(STATUS).map(([key, label]) => <MenuItem value={key} key={key}>{label}</MenuItem>)}
        </Select>
        <TextField size="small" fullWidth value={feedback} onChange={e => setFeedback(e.target.value)}
          placeholder="面白い・興味なし・方向違いなど、率直な理由（次回に反映）"
          inputProps={{ maxLength: 1800, 'aria-label': '評価理由' }} />
      </Stack>
      <Stack direction="row" justifyContent="flex-end" gap={1} sx={{ mt: 1.2 }}>
        <Button size="small" onClick={() => save('rejected')} disabled={saving}
          startIcon={<RejectIcon />}>見送り</Button>
        <Button size="small" onClick={() => save(getLens(proposal) === 'curiosity' || getLens(proposal) === 'personal' ? 'considering' : 'accepted')} disabled={saving}
          startIcon={<AcceptIcon />}>{getLens(proposal) === 'curiosity' || getLens(proposal) === 'personal' ? '気になる' : '採用'}</Button>
        <Button size="small" variant="contained" onClick={() => save()} disabled={!dirty || saving}>評価を保存</Button>
      </Stack>
      {error && <Alert severity="error" sx={{ mt: 1.1 }}>{error}</Alert>}
    </Card>
  );
}

export default function MetaStrategy() {
  const theme = useTheme();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('active');
  const [lens, setLens] = useState('all');
  const [query, setQuery] = useState('');
  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try { const data = await request('?resource=meta_proposals&limit=200'); setItems(data.items || []); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const counts = useMemo(() => ({
    waiting: items.filter(p => ['new','considering'].includes(p.status)).length,
    adopted: items.filter(p => p.status === 'accepted').length,
    rejected: items.filter(p => p.status === 'rejected').length,
  }), [items]);
  const visible = useMemo(() => items.filter(p => {
    if (filter === 'active' && !['new','considering'].includes(p.status)) return false;
    if (lens !== 'all' && getLens(p) !== lens) return false;
    if (filter !== 'all' && filter !== 'active' && p.status !== filter) return false;
    const q = query.trim().toLocaleLowerCase();
    return !q || [p.title, p.summary, p.reason, p.category, ...(p.context || [])]
      .join(' ').toLocaleLowerCase().includes(q);
  }).sort((a,b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)), [items, filter, lens, query]);
  const updateOne = proposal => setItems(current => current.map(p => p.id === proposal.id ? proposal : p));
  return (
    <Box sx={{ maxWidth: 1480, mx: 'auto', pb: 8 }}>
      <Paper elevation={0} sx={{ borderRadius: 3, p: { xs: 2.4, md: 4 }, border: '1px solid', borderColor: 'divider',
        bgcolor: theme.palette.mode === 'dark' ? 'background.paper' : '#f1f6f7' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} gap={2}>
          <Box>
            <Stack direction="row" alignItems="center" spacing={1}>
              <SparkIcon color="primary" />
              <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '.15em', fontWeight: 800 }}>CURIOUS / PERSONAL / PROJECTS</Typography>
            </Stack>
            <Typography variant="h4" component="h1" sx={{ fontWeight: 900, letterSpacing: '-.045em', mt: .5 }}>次、何をしてみる？</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 760, lineHeight: 1.8 }}>
              既存プロジェクトの改善・新企画・事業の方向転換から、知らなかった分野、趣味、文化、遊び、日常の楽しみまで。
              仕事の提案も、仕事と無関係な発見も、どちらも蓄積します。興味や余暇の提案には、収益化の理由は要りません。
            </Typography>
          </Box>
          <Button onClick={reload} disabled={loading} startIcon={<RefreshIcon />} variant="outlined">更新</Button>
        </Stack>
        <Stack direction="row" flexWrap="wrap" gap={3} sx={{ mt: 3 }}>
          {[['未判断・検討中',counts.waiting],['採用',counts.adopted],['見送り',counts.rejected]].map(([label,value]) =>
            <Box key={label}><Typography variant="h5" sx={{ fontWeight: 900 }}>{value}</Typography><Typography variant="caption" color="text.secondary">{label}</Typography></Box>)}
        </Stack>
      </Paper>
      <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 2 }} aria-label="提案の領域を選ぶ">
        {Object.entries(LENSES).map(([key, label]) => <Chip key={key} clickable
          label={label + (key === 'all' ? '' : ' · ' + items.filter(p => getLens(p) === key).length)}
          color={lens === key ? 'primary' : 'default'}
          variant={lens === key ? 'filled' : 'outlined'}
          onClick={() => setLens(key)} />)}
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 2, mb: 2 }}>
        <TextField size="small" fullWidth placeholder="テーマ・キーワードから探す" value={query}
          onChange={e => setQuery(e.target.value)} inputProps={{ 'aria-label':'提案を検索' }} />
        <Select value={filter} size="small" onChange={e => setFilter(e.target.value)} sx={{ minWidth: 150 }} aria-label="評価状態で絞り込み">
          <MenuItem value="active">未判断・検討中</MenuItem><MenuItem value="all">すべて</MenuItem>
          {Object.entries(STATUS).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
        </Select>
      </Stack>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error} <Button onClick={reload}>再取得</Button></Alert>}
      {loading && <Stack alignItems="center" sx={{ py: 9 }}><CircularProgress /></Stack>}
      {!loading && visible.length === 0 && <Paper variant="outlined" sx={{ p: 5, textAlign: 'center', borderRadius: 2 }}>
        <IdeaIcon color="disabled" sx={{ fontSize: 42 }} />
        <Typography variant="h6" sx={{ mt: 1.2 }}>該当する提案はありません</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          仕事に関係のない楽しみや発見もここに貯まります。対象に絞った提案がなければ、他の領域も見てみてください。
        </Typography>
      </Paper>}
      {!loading && visible.length > 0 && <Box sx={{ display:'grid',
        gridTemplateColumns: { xs:'1fr', xl:'repeat(2,minmax(0,1fr))' }, gap: 1.8, alignItems: 'stretch' }}>
        {visible.map(proposal => <ProposalCard key={proposal.id} proposal={proposal} onSaved={updateOne} />)}
      </Box>}
      <Typography color="text.secondary" variant="caption" sx={{ display:'block', mt: 2.5 }}>
        出典の確認範囲を超えて「全チャットを読んだ」とは扱いません。提案からの実装・投稿・公開は、ここでの「採用」だけでは自動実行されません。
      </Typography>
    </Box>
  );
}
