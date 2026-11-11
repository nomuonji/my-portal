import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Card, CardContent,
  Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  FormControl, Grid, InputAdornment, InputLabel, Link, MenuItem, Select, Stack,
  TextField, Typography,
} from '@mui/material';
import {
  Add as AddIcon, EditOutlined as EditIcon, ExpandMore as ExpandMoreIcon,
  OpenInNew as OpenInNewIcon, Refresh as RefreshIcon, Search as SearchIcon,
  ShieldOutlined as ShieldIcon, WorkOutline as WorkIcon,
} from '@mui/icons-material';
import { auth } from '../firebase';
import { pick, toList, toText } from './jobOpportunityView';

const STATUS = [
  ['active', '募集中', 'success'],
  ['watching', '要確認', 'warning'],
  ['paused', '保留', 'default'],
  ['closed', '募集終了', 'default'],
  ['rejected', '除外', 'default'],
  ['completed', '完了', 'default'],
];
const EMPTY = {
  title: '',
  sourcePublisher: '',
  sourceUrl: '',
  summary: '',
  reward: '',
  deadline: '',
  status: 'watching',
  tags: [],
  attributes: {},
};
const APPLICANT_LABELS = {
  resumeCV: '履歴書・職務経歴書',
  fullName: '氏名',
  email: 'メールアドレス',
  phone: '電話番号',
  currentLocation: '現住所',
  currentCountry: '居住国',
  dateOfBirth: '生年月日',
  age18Plus: '18歳以上の確認',
  identityDocument: '身分証',
  biometric: '生体認証',
  taxInformation: '税務情報',
  bankAccount: '銀行口座',
  payoutAccount: '報酬受取アカウント',
  verifiedPhone: '電話番号認証',
  profileLinks: 'プロフィールURL',
};
const REQUIREMENT_LABEL = {
  required: '必須',
  optional: '任意',
  unknown: '不明',
};

async function api(path = '', body = null) {
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
  if (!response.ok) throw new Error(data.error || 'リクエストに失敗しました (' + response.status + ')');
  return data;
}

function statusMeta(value) {
  return STATUS.find(([key]) => key === value) || ['watching', '要確認', 'warning'];
}

function formatDate(value) {
  if (!value) return '未確認';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

const compactList = toList;

function requirementItems(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).map(([key, requirement]) => ({
    key,
    label: APPLICANT_LABELS[key] || key.replace(/([A-Z])/g, ' $1'),
    requirement: toText(requirement) || 'unknown',
  }));
}

function requiredDataSummary(value) {
  const required = requirementItems(value).filter((item) => item.requirement.toLowerCase().startsWith('required'));
  if (!required.length) return '必須情報は未確認';
  return required.slice(0, 5).map((item) => item.label).join('・') + (required.length > 5 ? ' ほか' : '');
}

function riskText(item) {
  const attrs = item.attributes || {};
  const explicit = toText(attrs.recommendationStatus).trim();
  if (explicit) return explicit;
  const risks = compactList(attrs.riskNotes);
  return risks[0] || 'プライバシー条件の確認が必要';
}

function initialDraft(item) {
  if (!item) return {
    ...EMPTY,
    attributesText: JSON.stringify({ requiredApplicantData: {}, riskNotes: [], unknowns: [] }, null, 2),
    tagsText: '',
  };
  return {
    ...item,
    attributesText: JSON.stringify(item.attributes || {}, null, 2),
    tagsText: compactList(item.tags).join(', '),
  };
}

function Metric({ label, value, tone = 'default' }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 2, height: '100%' }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
        <Typography variant="h4" sx={{ fontWeight: 850, letterSpacing: '-0.04em', mt: 0.15 }}>
          {value}
        </Typography>
      </CardContent>
    </Card>
  );
}

function DetailLine({ label, value }) {
  const values = compactList(value);
  if (!values.length) return null;
  return (
    <Box sx={{ py: 0.65 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 750, mb: 0.25 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.55 }}>
        {values.join(' / ')}
      </Typography>
    </Box>
  );
}

export default function JobOpportunities() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(initialDraft(null));

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const result = await api('?resource=job_opportunities&limit=100');
      setItems(Array.isArray(result.items) ? result.items : []);
    } catch (err) {
      setError('仕事DBを読み込めません: ' + err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (!needle) return true;
      const attrs = item.attributes || {};
      const haystack = [
        item.title, item.sourcePublisher, item.summary, item.reward, item.sourceUrl,
        ...compactList(item.tags), ...compactList(attrs.tasks),
        attrs.locationEligibility, attrs.location, attrs.languages, attrs.jobType, attrs.employmentType,
        attrs.recommendationStatus, attrs.accountPermissions, attrs.externalPermissions,
      ].map(toText).join(' ').toLocaleLowerCase();
      return haystack.includes(needle);
    });
  }, [items, search, statusFilter]);

  const counts = useMemo(() => ({
    total: items.length,
    active: items.filter((item) => item.status === 'active').length,
    watching: items.filter((item) => item.status === 'watching').length,
    privacy: items.filter((item) => /low|high|risk|burden|privacy|個人情報|低い|高い/i.test(riskText(item))).length,
  }), [items]);

  const openEditor = (item = null) => {
    setEditing(item || {});
    setDraft(initialDraft(item));
    setError('');
    setNotice('');
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const title = String(draft.title || '').trim();
      const sourceUrl = String(draft.sourceUrl || '').trim();
      if (!title) throw new Error('求人名を入力してください');
      let parsedUrl;
      try { parsedUrl = new URL(sourceUrl); } catch { throw new Error('公式求人URLの形式を確認してください'); }
      if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
        throw new Error('公式求人URLは認証情報を含まないHTTPSにしてください');
      }
      let attributes;
      try { attributes = JSON.parse(draft.attributesText || '{}'); } catch { throw new Error('詳細情報のJSONを確認してください'); }
      if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
        throw new Error('詳細情報はJSONオブジェクトで入力してください');
      }
      const tags = Array.from(new Set(String(draft.tagsText || '').split(/[,、\n]/).map((tag) => tag.trim()).filter(Boolean)));
      const result = await api('', {
        action: 'job_opportunity_upsert',
        title,
        sourcePublisher: String(draft.sourcePublisher || '').trim() || 'UNKNOWN',
        sourceUrl: parsedUrl.toString(),
        summary: String(draft.summary || '').trim(),
        reward: String(draft.reward || '').trim(),
        deadline: String(draft.deadline || '').trim(),
        status: draft.status || 'watching',
        tags,
        attributes,
      });
      const saved = result.item;
      setEditing(null);
      setNotice((result.created ? '仕事を登録しました: ' : '仕事を更新しました: ') + (saved?.title || title));
      await load(true);
    } catch (err) {
      setError(err.message || '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const field = (name, label, props = {}) => (
    <TextField
      fullWidth
      size="small"
      label={label}
      value={draft[name] || ''}
      onChange={(event) => setDraft((current) => ({ ...current, [name]: event.target.value }))}
      {...props}
    />
  );

  return (
    <Box sx={{ maxWidth: 1240, mx: 'auto', pb: 7 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }}
        justifyContent="space-between" gap={2} sx={{ mb: 2.5 }}>
        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 2, fontWeight: 800 }}>
            OPPORTUNITY DATABASE
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: '-0.045em' }}>
            仕事DB
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.55, maxWidth: 720 }}>
            オンライン仕事の募集状況、報酬、応募時の個人情報、アカウント権限、プライバシー条件を一元管理します。
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap">
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => load(true)} disabled={loading || refreshing}>
            {refreshing ? '更新中…' : '再読み込み'}
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => openEditor(null)}>
            仕事を登録
          </Button>
        </Stack>
      </Stack>

      <Grid container spacing={1.2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6, sm: 3 }}><Metric label="登録件数" value={counts.total} /></Grid>
        <Grid size={{ xs: 6, sm: 3 }}><Metric label="募集中" value={counts.active} /></Grid>
        <Grid size={{ xs: 6, sm: 3 }}><Metric label="要確認" value={counts.watching} /></Grid>
        <Grid size={{ xs: 6, sm: 3 }}><Metric label="プライバシー要確認" value={counts.privacy} /></Grid>
      </Grid>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 1.5 }}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice('')} sx={{ mb: 1.5 }}>{notice}</Alert>}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1.6 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="求人名・募集元・仕事内容・報酬・応募条件を検索"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
        />
        <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 170 } }}>
          <InputLabel>募集状態</InputLabel>
          <Select label="募集状態" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <MenuItem value="all">すべて</MenuItem>
            {STATUS.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
          </Select>
        </FormControl>
      </Stack>
      <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
        <Chip size="small" variant="outlined" label={'表示 ' + filtered.length + ' / ' + items.length} />
        <Chip size="small" variant="outlined" label="公式URLを記録" />
        <Chip size="small" variant="outlined" icon={<ShieldIcon />} label="応募者の実個人情報は保存しない" />
      </Stack>

      {loading ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 7 }}><CircularProgress /></Box>
      ) : !items.length ? (
        <Card variant="outlined" sx={{ borderStyle: 'dashed', borderRadius: 2.5 }}>
          <CardContent sx={{ py: 5, textAlign: 'center' }}>
            <WorkIcon sx={{ fontSize: 36, color: 'text.secondary', mb: 1 }} />
            <Typography fontWeight={800}>まだ仕事が登録されていません</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
              定期ジョブが見つけた案件、または手動で確認した募集を登録できます。
            </Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => openEditor(null)}>最初の仕事を登録</Button>
          </CardContent>
        </Card>
      ) : !filtered.length ? (
        <Alert severity="info">条件に一致する仕事はありません。検索語や状態フィルターを変更してください。</Alert>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2,minmax(0,1fr))' }, gap: 1.5 }}>
          {filtered.map((item) => {
            const attrs = item.attributes || {};
            const meta = statusMeta(item.status);
            const requirements = requirementItems(attrs.requiredApplicantData);
            const risk = riskText(item);
            const chipLocation = toText(pick(attrs, 'locationEligibility', 'location')).slice(0, 80);
            const chipType = toText(pick(attrs, 'jobType', 'employmentType')).slice(0, 80);
            return (
              <Card key={item.id} variant="outlined" sx={{ borderRadius: 2.5, minWidth: 0 }}>
                <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.15, height: '100%' }}>
                  <Stack direction="row" alignItems="flex-start" spacing={1}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 750 }}>
                        {toText(item.sourcePublisher) || '募集元未確認'}
                      </Typography>
                      <Typography variant="h6" sx={{ fontWeight: 850, lineHeight: 1.3, overflowWrap: 'anywhere' }}>
                        {toText(item.title)}
                      </Typography>
                    </Box>
                    <Chip size="small" color={meta[2]} variant={item.status === 'active' ? 'filled' : 'outlined'} label={meta[1]} />
                  </Stack>
                  <Typography variant="h6" sx={{ fontWeight: 850, color: 'primary.main', lineHeight: 1.2 }}>
                    {toText(item.reward) || '報酬未掲載'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{
                    display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    lineHeight: 1.55, minHeight: '4.65em',
                  }}>
                    {toText(item.summary) || '仕事内容の説明は未登録です。'}
                  </Typography>
                  <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
                    {chipLocation && <Chip size="small" variant="outlined" label={chipLocation} sx={{ maxWidth: '100%' }} />}
                    {chipType && <Chip size="small" variant="outlined" label={chipType} sx={{ maxWidth: '100%' }} />}
                    {compactList(item.tags).slice(0, 3).map((tag) => <Chip key={tag} size="small" variant="outlined" label={tag} />)}
                  </Stack>
                  <Box sx={{ borderRadius: 1.5, bgcolor: 'action.hover', p: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontWeight: 800 }}>
                      <ShieldIcon sx={{ fontSize: 15 }} /> 応募時の個人情報
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 0.35, lineHeight: 1.45 }}>
                      {requiredDataSummary(attrs.requiredApplicantData)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35 }}>
                      {risk}
                    </Typography>
                  </Box>
                  <Box sx={{ mt: 'auto' }}>
                    <Divider sx={{ mb: 1 }} />
                    <Stack direction="row" spacing={0.7} alignItems="center" flexWrap="wrap">
                      <Button size="small" component={Link} href={item.sourceUrl} target="_blank" rel="noreferrer" endIcon={<OpenInNewIcon />}>
                        公式募集
                      </Button>
                      <Button size="small" startIcon={<EditIcon />} onClick={() => openEditor(item)}>編集</Button>
                      <Box sx={{ flex: 1 }} />
                      <Typography variant="caption" color="text.secondary">
                        確認 {formatDate(item.lastVerifiedAt || item.updatedAt)}
                      </Typography>
                    </Stack>
                  </Box>
                  <Accordion disableGutters elevation={0} sx={{ bgcolor: 'transparent', '&:before': { display: 'none' }, mt: -0.5 }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 36, px: 0, '& .MuiAccordionSummary-content': { my: 0.5 } }}>
                      <Typography variant="caption" fontWeight={800}>応募条件・リスク・確認履歴</Typography>
                    </AccordionSummary>
                    <AccordionDetails sx={{ px: 0, pt: 0 }}>
                      <DetailLine label="主な作業" value={attrs.tasks} />
                      <DetailLine label="言語" value={attrs.languages} />
                      <DetailLine label="応募可能地域" value={pick(attrs, 'locationEligibility', 'location')} />
                      <DetailLine label="稼働条件" value={pick(attrs, 'workload', 'schedule')} />
                      <DetailLine label="条件" value={attrs.requirements} />
                      <DetailLine label="支払方法" value={attrs.payoutMethods} />
                      <DetailLine label="応募時に必要な情報" value={requirements.map((x) => x.label + '：' + (REQUIREMENT_LABEL[x.requirement] || x.requirement))} />
                      <DetailLine label="身分証・本人確認" value={attrs.identityChecks} />
                      <DetailLine label="アカウント権限" value={pick(attrs, 'accountPermissions', 'externalPermissions')} />
                      <DetailLine label="保存・共有条件" value={pick(attrs, 'retentionAndSharing', 'privacy')} />
                      <DetailLine label="削除・撤回" value={attrs.withdrawalOrDeletion} />
                      <DetailLine label="テスト・選考" value={pick(attrs, 'testsOrScreening', 'screening')} />
                      <DetailLine label="確認した事実" value={attrs.observedFacts} />
                      <DetailLine label="本人との適合" value={attrs.userFit} />
                      <DetailLine label="不明点" value={attrs.unknowns} />
                      <DetailLine label="リスクメモ" value={attrs.riskNotes} />
                      <DetailLine label="次回確認予定" value={attrs.nextCheckAfter} />
                      <DetailLine label="公式URL" value={item.sourceUrl} />
                      <DetailLine label="レコードID" value={item.id} />
                    </AccordionDetails>
                  </Accordion>
                </CardContent>
              </Card>
            );
          })}
        </Box>
      )}

      <Dialog open={Boolean(editing)} onClose={() => !saving && setEditing(null)} fullWidth maxWidth="md" fullScreen={false}>
        <DialogTitle>{editing?.id ? '仕事情報を編集' : '仕事を登録'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <Grid container spacing={1.2}>
              <Grid size={{ xs: 12, sm: 8 }}>{field('title', '求人名 *')}</Grid>
              <Grid size={{ xs: 12, sm: 4 }}>{field('sourcePublisher', '募集元')}</Grid>
              <Grid size={{ xs: 12 }}>{field('sourceUrl', '公式求人URL（HTTPS） *')}</Grid>
              <Grid size={{ xs: 12, sm: 7 }}>{field('reward', '報酬')}</Grid>
              <Grid size={{ xs: 12, sm: 5 }}>{field('deadline', '応募期限')}</Grid>
              <Grid size={{ xs: 12 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>募集状態</InputLabel>
                  <Select label="募集状態" value={draft.status || 'watching'}
                    onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}>
                    {STATUS.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12 }}>{field('summary', '仕事内容・応募上の注意', { multiline: true, minRows: 3 })}</Grid>
              <Grid size={{ xs: 12 }}>{field('tagsText', 'タグ（カンマ区切り）')}</Grid>
              <Grid size={{ xs: 12 }}>
                <TextField
                  fullWidth size="small" label="詳細データ（JSON）"
                  value={draft.attributesText || '{}'}
                  onChange={(event) => setDraft((current) => ({ ...current, attributesText: event.target.value }))}
                  multiline minRows={10}
                  inputProps={{ spellCheck: false, style: { fontFamily: 'monospace', fontSize: 12 } }}
                  helperText="応募必須項目、本人確認、アカウント権限、保存・削除条件、未確認点などを保持します。実際の応募者個人情報は入力しないでください。"
                />
              </Grid>
            </Grid>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 2, py: 1.5 }}>
          <Button onClick={() => setEditing(null)} disabled={saving}>キャンセル</Button>
          <Button variant="contained" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
