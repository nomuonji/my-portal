import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, CardActionArea, CardContent, Chip, CircularProgress,
  Dialog, DialogActions, DialogContent, DialogTitle, Divider, InputAdornment,
  Link as MuiLink, Paper, Stack, Tab, Tabs, TextField, Tooltip, Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  AccountTreeOutlined as TreeIcon,
  ArrowForward as ArrowIcon,
  AutoAwesomeOutlined as SparkIcon,
  HubOutlined as HubIcon,
  FolderOutlined as FolderIcon,
  Search as SearchIcon,
  MenuBookOutlined as BookIcon,
  RouteOutlined as RouteIcon,
  Refresh as RefreshIcon,
  OpenInNew as ExternalIcon,
  CodeOutlined as CodeIcon,
  InfoOutlined as InfoIcon,
  PsychologyAltOutlined as ThinkingIcon,
} from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import { auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';

async function fetchPortalWorld(path = '?resource=world_map') {
  let user = auth.currentUser;
  if (!user) {
    user = await new Promise((resolve, reject) => {
      const unsubscribe = onAuthStateChanged(auth, (next) => {
        unsubscribe();
        if (next) resolve(next);
        else reject(new Error('My Portalへのログインが必要です'));
      });
    });
  }
  const token = await user.getIdToken();
  const response = await fetch(`/api/agent-ideas${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `API error (${response.status})`);
  return data;
}

const EMPTY = { routes: [], projects: [], spaces: [], methods: [], warnings: [], coverage: {} };
const SEARCH_TABS = [
  { id: 'all', label: 'すべて' }, { id: 'routes', label: '分野・入口' },
  { id: 'projects', label: 'Projects' }, { id: 'methods', label: 'Methods' },
  { id: 'spaces', label: 'Spaces' },
];
function searchable(item) {
  return JSON.stringify(item || {}).toLocaleLowerCase();
}
function routeMatches(route, q) {
  return !q || searchable(route).includes(q);
}
function SummaryNumber({ label, number, caption }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="h4" sx={{ fontWeight: 850, lineHeight: 1.12, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' }}>
        {number}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 750, mt: 0.3 }}>{label}</Typography>
      <Typography variant="caption" color="text.secondary">{caption}</Typography>
    </Box>
  );
}
function SectionHeading({ eyebrow, title, subtitle, count, icon }) {
  return (
    <Stack direction="row" spacing={1.2} justifyContent="space-between" alignItems="flex-end" sx={{ mb: 1.55, mt: 3.2 }}>
      <Box>
        <Typography variant="overline" sx={{ letterSpacing: '0.16em', color: 'text.secondary', fontWeight: 850 }}>{eyebrow}</Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          {icon}
          <Typography variant="h6" sx={{ fontWeight: 850, letterSpacing: '-0.02em' }}>{title}</Typography>
          {count !== undefined && <Chip size="small" label={count} variant="outlined" />}
        </Stack>
        {subtitle && <Typography variant="body2" sx={{ mt: 0.35, color: 'text.secondary' }}>{subtitle}</Typography>}
      </Box>
    </Stack>
  );
}
function StateChip({ value }) {
  if (!value) return null;
  return (
    <Chip size="small" variant="outlined" label={value}
      color={value === 'active' ? 'success' : 'default'}
      sx={{ fontSize: '0.72rem', height: 23 }} />
  );
}
function RuleLink({ to, href, children, ...props }) {
  if (to) return <Button size="small" component={RouterLink} to={to} endIcon={<ArrowIcon fontSize="small" />} {...props}>{children}</Button>;
  if (href) return <Button size="small" component="a" href={href} target="_blank" rel="noreferrer" endIcon={<ExternalIcon fontSize="small" />} {...props}>{children}</Button>;
  return null;
}

export default function WorldHome() {
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('all');
  const [expanded, setExpanded] = useState(null);
  const [inspectedMethod, setInspectedMethod] = useState(null);
  const [methodLoading, setMethodLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchPortalWorld());
    } catch (err) {
      setError(err.message || 'World Mapを取得できませんでした');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const q = query.trim().toLocaleLowerCase();
  const routes = useMemo(() => (data.routes || []).filter(item => routeMatches(item, q)), [data.routes, q]);
  const projects = useMemo(() => (data.projects || []).filter(item => !q || searchable(item).includes(q)), [data.projects, q]);
  const methods = useMemo(() => (data.methods || []).filter(item => !q || searchable(item).includes(q)), [data.methods, q]);
  const spaces = useMemo(() => (data.spaces || []).filter(item => !q || searchable(item).includes(q)), [data.spaces, q]);
  const tools = useMemo(() => {
    const results = new Map();
    (data.projects || []).forEach(project => (project.mcpTools || []).forEach(tool => {
      const key = String(tool.name || '').trim();
      if (!key) return;
      if (!results.has(key)) results.set(key, { name: key, purpose: tool.purpose, projects: [] });
      results.get(key).projects.push(project.id);
    }));
    return [...results.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data.projects]);
  const show = (name) => tab === 'all' || tab === name;
  const openMethod = async method => {
    setInspectedMethod({ method, currentVersion: null });
    setMethodLoading(true);
    try {
      const context = await fetchPortalWorld(`?resource=method_context&id=${encodeURIComponent(method.id)}`);
      setInspectedMethod(context);
    } catch (err) {
      setInspectedMethod({ method, error: err.message });
    } finally {
      setMethodLoading(false);
    }
  };
  const line = dark ? alpha(theme.palette.common.white, 0.13) : 'rgba(31,57,80,0.13)';
  const surface = dark ? alpha(theme.palette.background.paper, 0.8) : '#fff';
  const linkedProjects = new Map((data.projects || []).map(item => [item.id, item]));

  return (
    <Box sx={{ maxWidth: 1460, mx: 'auto', minHeight: '100%', pb: 7 }}>
      <Paper elevation={0} sx={{
        px: { xs: 2, sm: 3.5, md: 4.5 }, py: { xs: 2.8, md: 4.5 },
        background: dark ? 'linear-gradient(130deg,#15293c,#1b3448)' : 'linear-gradient(130deg,#eaf3f1 0%,#f2f6fa 55%,#fff9f0 100%)',
        border: `1px solid ${line}`, borderRadius: 3, position: 'relative', overflow: 'hidden',
      }}>
        <Box sx={{ position: 'absolute', top: -110, right: -70, width: 300, height: 300, borderRadius: '50%', border: `1px solid ${line}`, boxShadow: `0 0 0 38px ${alpha(theme.palette.primary.main, .04)}, 0 0 0 83px ${alpha(theme.palette.primary.main, .025)}`, pointerEvents: 'none' }} />
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1.5} sx={{ position: 'relative' }}>
          <Box>
            <Typography variant="overline" sx={{ fontWeight: 850, letterSpacing: '0.19em', color: 'text.secondary' }}>
              MY PORTAL / START HERE
            </Typography>
            <Typography variant="h3" component="h1" sx={{ fontSize: { xs: '2.15rem', md: '3rem' }, fontWeight: 900, letterSpacing: '-0.045em', mt: .4 }}>
              World Home<span style={{ opacity: .45 }}>.</span>
            </Typography>
            <Typography variant="body1" sx={{ maxWidth: 680, mt: 1, lineHeight: 1.75, color: 'text.secondary' }}>
              何をしていて、何を知っていて、それぞれどこにあるのか。
              Project・Method・Space・接続先を一つの入口から探せます。
            </Typography>
          </Box>
          <Tooltip title="最新のディレクトリを読み直す">
            <Button onClick={reload} disabled={loading} variant="outlined" startIcon={<RefreshIcon />}
              sx={{ flexShrink: 0, bgcolor: dark ? 'transparent' : alpha('#ffffff', 0.6) }}>
              更新
            </Button>
          </Tooltip>
        </Stack>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(3,minmax(0,1fr))', sm: 'repeat(4,minmax(0,1fr))' }, gap: { xs: 1.2, sm: 3 }, mt: 3.8, position: 'relative' }}>
          <SummaryNumber label="Projects" number={data.projects?.length ?? '—'} caption="実装・運用単位" />
          <SummaryNumber label="Methods" number={data.methods?.length ?? '—'} caption="手順とスキル" />
          <SummaryNumber label="Spaces" number={data.spaces?.length ?? '—'} caption="長期的な知見" />
          <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
            <SummaryNumber label="Tools" number={tools.length} caption="Projectから検出" />
          </Box>
        </Box>
      </Paper>

      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}<Button onClick={reload}>再試行</Button></Alert>}
      {(data.warnings || []).length > 0 && <Alert severity="warning" sx={{ mt: 1.6 }}>
        一部の正本が読み取れていません: {(data.warnings || []).join(' / ')}。表示されないものを「存在しない」とは扱わないでください。
      </Alert>}

      <Paper variant="outlined" sx={{ p: { xs: 1.35, sm: 1.7 }, mt: 2, borderRadius: 2.5, borderColor: line, background: surface }}>
        <TextField
          value={query} onChange={e => setQuery(e.target.value)} fullWidth size="small"
          placeholder="SEO、Culture、ラジ父、repo名、Method名から探す"
          inputProps={{ 'aria-label': 'World Home内を検索' }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon color="action" /></InputAdornment> }}
        />
        <Tabs value={tab} onChange={(e, value) => setTab(value)} variant="scrollable" scrollButtons="auto"
          sx={{ mt: 1, minHeight: 39, '& .MuiTab-root': { minHeight: 39, minWidth: 'auto', fontWeight: 750, px: { xs: 1.3, md: 2 } } }}>
          {SEARCH_TABS.map(item => <Tab value={item.id} label={item.label} key={item.id} />)}
        </Tabs>
      </Paper>

      {loading && <Box sx={{ py: 7, display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>}

      {!loading && show('routes') && (
        <section aria-label="参照先の地図">
          <SectionHeading eyebrow="01 / FIND THE OWNER" title="まず、どこを見るか" subtitle="話題から担当システムを選択。ここは案内図であり、各システムの正本ではありません。" count={routes.length} icon={<RouteIcon color="primary" />} />
          {routes.length === 0 && <Typography color="text.secondary">該当する入口が見つかりません。</Typography>}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2,minmax(0,1fr))', lg: 'repeat(3,minmax(0,1fr))' }, gap: 1.45 }}>
            {routes.map((route, i) => {
              const active = expanded === route.id;
              const project = linkedProjects.get(route.projectId);
              return (
                <Card key={route.id} variant="outlined" sx={{
                  borderRadius: 2.4, borderColor: active ? 'primary.main' : line, background: surface,
                  transition: 'border-color .16s ease, box-shadow .16s ease',
                  boxShadow: active ? `0 7px 25px ${alpha(theme.palette.primary.main,.1)}` : 'none',
                }}>
                  <CardActionArea onClick={() => setExpanded(active ? null : route.id)}
                    aria-expanded={active} sx={{ p: 2, alignItems: 'stretch', display: 'block', minHeight: 156 }}>
                    <Stack direction="row" justifyContent="space-between" spacing={1}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 850, letterSpacing: '.12em' }}>
                        {String(i + 1).padStart(2, '0')} / DOMAIN
                      </Typography>
                      <ArrowIcon fontSize="small" color={active ? 'primary' : 'disabled'} sx={{ transform: active ? 'rotate(90deg)' : 'none', transition: '.2s' }} />
                    </Stack>
                    <Typography variant="subtitle1" sx={{ fontWeight: 850, mt: .55 }}>{route.title}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: .65, lineHeight: 1.65 }}>{route.description}</Typography>
                    <Chip size="small" label={route.primary || '参照先未設定'} variant="outlined" sx={{ mt: 1.15, maxWidth: '100%' }} />
                  </CardActionArea>
                  {active && (
                    <Box sx={{ px: 2, pb: 2, pt: .2 }}>
                      <Divider sx={{ mb: 1.5 }} />
                      {route.boundary && (
                        <Alert icon={<InfoIcon fontSize="small" />} severity="info" sx={{ mb: 1.2, py: .15, '& .MuiAlert-message': { fontSize: 12.5, lineHeight: 1.55 } }}>{route.boundary}</Alert>
                      )}
                      <Stack direction="row" useFlexGap flexWrap="wrap" gap={.55}>
                        {(route.tools || []).map(tool => <Chip size="small" key={tool} label={tool} variant="outlined" />)}
                      </Stack>
                      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={.3} sx={{ mt: 1.4 }}>
                        {route.projectId && <RuleLink to={`/project/details/${route.projectId}`}>Project</RuleLink>}
                        {(route.spaceIds || []).map(id => <RuleLink key={id} to={`/thinking?space=${encodeURIComponent(id)}`}>Space</RuleLink>)}
                        {route.url && <RuleLink href={route.url}>サイト</RuleLink>}
                        {project?.siteUrl && <RuleLink href={project.siteUrl}>公開サイト</RuleLink>}
                      </Stack>
                    </Box>
                  )}
                </Card>
              );
            })}
          </Box>
        </section>
      )}

      {!loading && show('projects') && (
        <section aria-label="プロジェクト一覧">
          <SectionHeading eyebrow="02 / EXECUTION" title="Projects" subtitle="実装の単位。GitHubとMCPの所在地を確認できます。" count={projects.length} icon={<FolderIcon color="primary" />} />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2,minmax(0,1fr))' }, gap: 1.25 }}>
            {projects.map(project => (
              <Paper key={project.id} variant="outlined" sx={{ p: 2, borderRadius: 2.3, borderColor: line }}>
                <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={1}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle1" fontWeight={850}>{project.name}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: .55, lineHeight: 1.6 }}>{project.description}</Typography>
                  </Box>
                  <StateChip value={project.status} />
                </Stack>
                <Stack direction="row" flexWrap="wrap" useFlexGap spacing={.5} sx={{ mt: 1.25 }}>
                  {(project.mcpTools || []).slice(0, 5).map(item => <Chip key={item.name} size="small" label={item.name} variant="outlined" />)}
                </Stack>
                {(project.repositories || []).length > 0 && (
                  <Box sx={{ mt: 1.4 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={850}>REPOSITORIES · {project.repositories.length}</Typography>
                    <Stack direction="row" flexWrap="wrap" useFlexGap gap={.9} sx={{ mt: .45 }}>
                      {project.repositories.slice(0, 4).map(repo => (
                        <MuiLink key={repo.fullName} href={repo.url || `https://github.com/${repo.fullName}`} target="_blank" rel="noreferrer"
                          sx={{ fontSize: 12.5, textDecoration: 'none', overflowWrap: 'anywhere' }}>{repo.fullName}</MuiLink>
                      ))}
                      {project.repositories.length > 4 && <Typography variant="caption" color="text.secondary">+{project.repositories.length - 4}</Typography>}
                    </Stack>
                  </Box>
                )}
                <Box sx={{ mt: 1.25 }}>
                  <RuleLink to={`/project/details/${project.id}`}>Projectを見る</RuleLink>
                  {project.siteUrl && <RuleLink href={project.siteUrl}>サイト</RuleLink>}
                </Box>
              </Paper>
            ))}
          </Box>
        </section>
      )}

      {!loading && show('methods') && (
        <section aria-label="Methodsとスキル">
          <SectionHeading eyebrow="03 / HOW WE WORK" title="Methods / スキル" subtitle="My Portalの有効な方法論。ChatGPTに導入されたスキルは別途確認します。" count={methods.length} icon={<SparkIcon color="primary" />} />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2,minmax(0,1fr))' }, gap: 1.15 }}>
            {methods.map(method => (
              <Paper key={method.id} variant="outlined" sx={{ p: 1.8, borderRadius: 2.3, borderColor: line }}>
                <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                  <Typography variant="subtitle2" fontWeight={850}>{method.title}</Typography>
                  <Chip size="small" label={method.currentVersionNumber ? `v${method.currentVersionNumber}` : 'version未設定'} variant="outlined" />
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mt: .65, lineHeight: 1.65 }}>{method.summary}</Typography>
                <Stack direction="row" flexWrap="wrap" useFlexGap spacing={.55} sx={{ mt: 1.05 }}>
                  <Button size="small" onClick={() => openMethod(method)} endIcon={<BookIcon fontSize="small" />}>Methodの中身</Button>
                  {method.spaceId && <RuleLink to={`/thinking?space=${encodeURIComponent(method.spaceId)}`}>関連Space</RuleLink>}
                </Stack>
              </Paper>
            ))}
          </Box>
        </section>
      )}

      {!loading && show('spaces') && (
        <section aria-label="知識と長期テーマ">
          <SectionHeading eyebrow="04 / WHAT WE KNOW" title="Spaces / 知見" subtitle="研究・決定・長期テーマの保存場所。ProjectやMethodとは役割が異なります。" count={spaces.length} icon={<ThinkingIcon color="primary" />} />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2,minmax(0,1fr))' }, gap: 1.05 }}>
            {spaces.map(space => (
              <Paper key={space.id} variant="outlined" sx={{ p: 1.7, borderRadius: 2.3, borderColor: line }}>
                <Typography variant="subtitle2" fontWeight={800}>{space.title}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: .4, lineHeight: 1.65 }}>{space.summary}</Typography>
                <Box sx={{ mt: 1 }}>
                  <RuleLink to={`/thinking?space=${encodeURIComponent(space.id)}`}>知見を開く</RuleLink>
                </Box>
              </Paper>
            ))}
          </Box>
        </section>
      )}

      {!loading && tab === 'all' && (
        <Paper variant="outlined" sx={{ p: 2.3, mt: 3.4, borderRadius: 2.5, borderColor: line }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <HubIcon color="primary" /><Typography variant="subtitle1" fontWeight={850}>接続先について</Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7, mt: .8 }}>
            現在のProjectsには {tools.length} 種類のMCP/外部ツール名が登録されています。
            これは登録された接続先の一覧であり、現在の接続可否や権限を保証しません。
          </Typography>
          <Stack direction="row" flexWrap="wrap" useFlexGap gap={.65} sx={{ mt: 1.4 }}>
            {tools.map(tool => (
              <Tooltip key={tool.name} title={tool.projects.join(' / ')}>
                <Chip size="small" label={tool.name} variant="outlined" />
              </Tooltip>
            ))}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ mt: 1.6 }} flexWrap="wrap" useFlexGap>
            <RuleLink to="/project">すべてのProject</RuleLink>
            <RuleLink to="/thinking">すべてのSpace</RuleLink>
            <RuleLink to="/dashboard">Agent HQ</RuleLink>
          </Stack>
        </Paper>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3.3, lineHeight: 1.65 }}>
        <TreeIcon sx={{ fontSize: 15, mr: .5, verticalAlign: 'text-bottom' }} />
        このホームは既存DBの索引です。重要な方針と責務の変更のみ地図を更新し、実行状態はそれぞれの専門システムで確認してください。
        {data.generatedAt && ` · 最終取得 ${new Date(data.generatedAt).toLocaleString('ja-JP')}`}
      </Typography>

      <Dialog open={Boolean(inspectedMethod)} onClose={() => setInspectedMethod(null)} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 850 }}>{inspectedMethod?.method?.title || 'Method'}</DialogTitle>
        <DialogContent dividers>
          {methodLoading ? <CircularProgress size={24} /> : (
            <Stack spacing={1.2}>
              {inspectedMethod?.error && <Alert severity="warning">{inspectedMethod.error}</Alert>}
              <Typography variant="body2" color="text.secondary">{inspectedMethod?.method?.summary}</Typography>
              {inspectedMethod?.currentVersion && (
                <>
                  <Chip size="small" label={inspectedMethod.currentVersion.label || `v${inspectedMethod.currentVersion.versionNumber}`} sx={{ alignSelf: 'start' }} />
                  <Typography variant="body2" component="div" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.7 }}>
                    {inspectedMethod.currentVersion.instructions || '手順は未登録です。'}
                  </Typography>
                </>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions><Button onClick={() => setInspectedMethod(null)}>閉じる</Button></DialogActions>
      </Dialog>
    </Box>
  );
}
