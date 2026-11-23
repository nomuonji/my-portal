import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, CardActionArea, Chip, CircularProgress,
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
  InfoOutlined as InfoIcon,
  OndemandVideo as DiscoveryIcon,
  ViewCompact as BoardIcon,
  FavoriteBorder as TasteIcon,
  PsychologyAlt as ThinkingIcon,
  Dashboard as HqIcon,
} from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import ContextPanel from './ContextPanel';
import AgentGuidePanel from './AgentGuidePanel';
import { auth } from '../firebase';
import { fonts } from '../theme';
import { onAuthStateChanged } from 'firebase/auth';

async function fetchPortalWorld(path = '?resource=world_map', options = {}) {
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
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers||{}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `API error (${response.status})`);
  return data;
}

const EMPTY = { routes: [], projects: [], spaces: [], methods: [], chatSkills: [], skillPacks: [], contexts: [], warnings: [], coverage: {} };
const SEARCH_TABS = [
  { id: 'all', label: 'すべて' }, { id: 'guide', label: 'Agent Guide' }, { id: 'routes', label: '分野・入口' },
  { id: 'projects', label: 'Projects' }, { id: 'skills', label: 'Pack / Skills' },
  { id: 'contexts', label: 'Contexts' },
];
function searchable(item) {
  return JSON.stringify(item || {}).toLocaleLowerCase();
}
function routeMatches(route, q) {
  return !q || searchable(route).includes(q);
}
const LAUNCH = [
  { to: '/submarines', label: '全艦の成果', note: 'Discover・仕事DB・未知探索が持ち帰ったもの', icon: <DiscoveryIcon /> },
  { to: '/boards', label: 'ボード', note: '企画・興味・ネタのストック', icon: <BoardIcon /> },
  { to: '/thinking', label: '思考テーマ', note: '長期テーマとContext', icon: <ThinkingIcon /> },
  { to: '/taste', label: '好みの記録', note: '好き嫌いと訂正の履歴', icon: <TasteIcon /> },
  { to: '/dashboard', label: 'Agent HQ', note: '実行キューと定期ジョブ', icon: <HqIcon /> },
  { to: '/meta', label: 'プロジェクト提案', note: '戦略・次の一手', icon: <SparkIcon /> },
];
function greeting() {
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Tokyo' }).format(new Date()));
  if (hour >= 4 && hour < 11) return 'おはようございます';
  if (hour >= 11 && hour < 18) return 'こんにちは';
  return 'こんばんは';
}
function dateLine() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return `${parts.year}.${parts.month}.${parts.day} — ${String(parts.weekday).toUpperCase()} ${parts.hour}:${parts.minute} JST`;
}
function Launcher({ rule }) {
  return (
    <Box component="nav" aria-label="よく開く場所" sx={{
      display: 'grid', gridTemplateColumns: { xs: 'repeat(2,minmax(0,1fr))', md: 'repeat(3,minmax(0,1fr))' },
      borderTop: `1px solid ${rule}`, borderLeft: `1px solid ${rule}`, mt: { xs: 2.5, md: 3.5 }, bgcolor: 'background.paper', borderRadius: 1.5, overflow: 'hidden',
    }}>
      {LAUNCH.map((item, i) => (
        <Box key={item.to} component={RouterLink} to={item.to} sx={{
          position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 1.4, minWidth: 0,
          px: { xs: 1.5, md: 2.2 }, py: { xs: 1.5, md: 2 }, color: 'text.primary', textDecoration: 'none',
          borderRight: `1px solid ${rule}`, borderBottom: `1px solid ${rule}`, transition: 'background-color 120ms ease',
          '&:hover': { bgcolor: 'action.hover' }, '&:hover .launch-arrow': { transform: 'translateX(3px)', color: 'primary.main' },
        }}>
          <Box sx={{ color: 'text.secondary', display: 'flex', pt: .2, '& svg': { fontSize: 20 } }}>{item.icon}</Box>
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography sx={{ fontWeight: 800, fontSize: { xs: 14, md: 15 }, lineHeight: 1.35 }}>{item.label}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: { xs: 12, md: 13 }, lineHeight: 1.5, mt: .25 }}>{item.note}</Typography>
          </Box>
          <Typography aria-hidden sx={{ display: { xs: 'none', sm: 'block' }, fontFamily: fonts.mono, fontSize: 11, color: 'text.disabled', position: 'absolute', top: 10, right: 12 }}>
            {String(i + 1).padStart(2, '0')}
          </Typography>
          <ArrowIcon className="launch-arrow" sx={{ display: { xs: 'none', sm: 'block' }, alignSelf: 'flex-end', fontSize: 17, color: 'text.disabled', transition: 'transform 120ms ease, color 120ms ease' }} />
        </Box>
      ))}
    </Box>
  );
}
function SectionHeading({ eyebrow, title, subtitle, count, icon }) {
  return (
    <Box sx={{ mb: 1.6, mt: { xs: 4, md: 5 }, pt: 1.6, borderTop: theme => `1px solid ${theme.palette.divider}` }}>
      <Typography variant="overline" sx={{ color: 'text.disabled', display: 'block' }}>{eyebrow}</Typography>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: .2 }}>
        {icon}
        <Typography component="h2" variant="h6">{title}</Typography>
        {count !== undefined && <Typography component="span" sx={{ fontFamily: fonts.mono, fontSize: 12, color: 'text.secondary' }}>{count}</Typography>}
      </Stack>
      {subtitle && <Typography variant="body2" sx={{ mt: .4, color: 'text.secondary', maxWidth: 760 }}>{subtitle}</Typography>}
    </Box>
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

  const [skillDetail, setSkillDetail] = useState(null);
  const [skillDraft, setSkillDraft] = useState(null);
  const [skillHistory, setSkillHistory] = useState([]);
  const [skillLoading, setSkillLoading] = useState(false);
  const [skillSaving, setSkillSaving] = useState(false);
  const [skillError, setSkillError] = useState('');
  const [skillEditing, setSkillEditing] = useState(false);
  const [relationPolicy, setRelationPolicy] = useState(null);
  const [relationDraft, setRelationDraft] = useState('');
  const [relationChangeReason, setRelationChangeReason] = useState('');
  const [relationBenchmarkRef, setRelationBenchmarkRef] = useState('');
  const [relationBenchmarkCases, setRelationBenchmarkCases] = useState('');
  const [relationSaving, setRelationSaving] = useState(false);

  const refreshWorld = useCallback(async () => {
    try { setData(await fetchPortalWorld()); } catch (err) { setError(err.message || 'Context一覧の更新に失敗しました'); }
  }, []);
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
  const packEntries = useMemo(() => new Set((data.skillPacks || []).map(p => p.entrySkillId)), [data.skillPacks]);
  const skillPacks = useMemo(() => (data.skillPacks || []).filter(item => !q || searchable(item).includes(q) || (data.chatSkills||[]).some(s=>s.id===item.entrySkillId && searchable(s).includes(q))), [data.skillPacks, data.chatSkills, q]);
  const skills = useMemo(() => (data.chatSkills || []).filter(item => !packEntries.has(item.id) && (!q || searchable(item).includes(q))), [data.chatSkills, packEntries, q]);

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

  const openSkill = async (skill) => {
    setSkillDetail({id:skill.id,title:skill.title});
    setSkillLoading(true);setSkillEditing(false);setSkillError('');
    try {
      const [full,hist,relations] = await Promise.all([
        fetchPortalWorld(`?resource=chat_skill&id=${encodeURIComponent(skill.id)}`),
        fetchPortalWorld(`?resource=chat_skill_versions&id=${encodeURIComponent(skill.id)}`),
        fetchPortalWorld(`?resource=chat_skill_relation_policy&id=${encodeURIComponent(skill.id)}`),
      ]);
      setSkillDetail(full);
      setSkillDraft({...full,triggersText:(full.triggers||[]).join(', ')});
      setSkillHistory(hist.items||[]);
      setRelationPolicy(relations);
      setRelationDraft(JSON.stringify({id:relations.id,defaultIntent:relations.defaultIntent,relations:relations.relations||[]},null,2));
      setRelationChangeReason('');
      setRelationBenchmarkRef('');
      setRelationBenchmarkCases('');
    } catch(e) {setSkillError(e.message);}
    finally {setSkillLoading(false);}
  };
  const saveSkill = async () => {
    if(!skillDetail||!skillDraft)return;
    setSkillSaving(true);setSkillError('');
    try {
      const skill = {
        id:skillDetail.id,title:skillDraft.title,summary:skillDraft.summary,
        triggers:skillDraft.triggersText.split(/[,、\n]/).map(v=>v.trim()).filter(Boolean),
        body:skillDraft.body,status:skillDraft.status||'available',
      };
      await fetchPortalWorld('',{method:'POST',body:JSON.stringify({
        action:'chat_skill_upsert',skill,expectedRevision:skillDetail.revision,
        changeReason:'Updated from World Home Skill editor',confirm:true,
      })});
      await Promise.all([openSkill(skill),reload()]);
      setSkillEditing(false);
    } catch(err){setSkillError(err.message||'更新に失敗しました');}
    finally{setSkillSaving(false);}
  };
  const saveRelations = async () => {
    if(!skillDetail||!relationPolicy)return;
    setRelationSaving(true);setSkillError('');
    try {
      const policy=JSON.parse(relationDraft);
      if(policy.id!==skillDetail.id)throw new Error('参照元SkillのIDは変更できません');
      const benchmark=relationBenchmarkRef.trim()&&relationBenchmarkCases.trim()
        ? {passed:true,ref:relationBenchmarkRef.trim(),cases:relationBenchmarkCases.trim()} : undefined;
      await fetchPortalWorld('',{method:'POST',body:JSON.stringify({
        action:'chat_skill_relation_policy_publish',policy,expectedRevision:relationPolicy.revision,
        changeReason:relationChangeReason.trim(),benchmark,confirm:true,
      })});
      await openSkill({id:skillDetail.id,title:skillDetail.title});
    } catch(err){setSkillError(err.message||'依存ルールを保存できません');}
    finally{setRelationSaving(false);}
  };
  const line = theme.palette.divider;
  const surface = theme.palette.background.paper;
  const linkedProjects = new Map((data.projects || []).map(item => [item.id, item]));

  return (
    <Box sx={{ maxWidth: 1460, mx: 'auto', minHeight: '100%', pb: 7 }}>
      <Box component="header" sx={{ pt: { xs: 1, md: 1.5 } }}>
        <Typography sx={{ fontFamily: fonts.mono, fontSize: { xs: 11, md: 12 }, letterSpacing: '0.06em', color: 'text.secondary' }}>
          {dateLine()}
        </Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'flex-end' }} gap={2} sx={{ mt: 1 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography component="h1" sx={{ fontSize: { xs: 28, md: 40 }, fontWeight: 900, letterSpacing: '-0.035em', lineHeight: 1.12 }}>
              {greeting()}。
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 640, mt: 1 }}>
              何をしていて、何を知っていて、それぞれどこにあるのか。今日開く場所と、Skill・Context・担当Operatorの地図です。
            </Typography>
          </Box>
          <Stack direction="row" gap={1} alignItems="center" sx={{ flexShrink: 0 }}>
            <Button component={RouterLink} to="/meta" variant="contained" startIcon={<SparkIcon />}>次に何をする？</Button>
            <Tooltip title="最新のディレクトリを読み直す">
              <span>
                <Button onClick={reload} disabled={loading} variant="outlined" startIcon={<RefreshIcon />}>更新</Button>
              </span>
            </Tooltip>
          </Stack>
        </Stack>
        <Launcher rule={line} />
        <Typography component="p" sx={{ fontFamily: fonts.mono, fontSize: 11.5, color: 'text.secondary', mt: 1.4, letterSpacing: '0.03em' }}>
          INDEX — {data.projects?.length ?? '—'} projects · {data.chatSkills?.length ?? '—'} chat skills · {data.contexts?.length ?? '—'} contexts · {tools.length} tools
          {data.metadataRevision ? ` · map rev ${data.metadataRevision}` : ''}
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}<Button onClick={reload}>再試行</Button></Alert>}
      {(data.warnings || []).length > 0 && <Alert severity="warning" sx={{ mt: 1.6 }}>
        一部の正本が読み取れていません: {(data.warnings || []).join(' / ')}。表示されないものを「存在しない」とは扱わないでください。
      </Alert>}

      <Box sx={{
        position: { xs: 'static', md: 'sticky' }, top: { md: -24 }, zIndex: 3, mt: { xs: 3, md: 4 }, mx: { xs: -1, sm: -1.5, md: -3 }, px: { xs: 1, sm: 1.5, md: 3 },
        pt: { xs: 1, md: 1.5 }, bgcolor: 'background.default', borderBottom: `1px solid ${line}`,
      }}>
        <TextField
          value={query} onChange={e => setQuery(e.target.value)} fullWidth size="small"
          placeholder="地図を検索 — SEO、Culture、Skill名、Context、repo名"
          inputProps={{ 'aria-label': 'World Home内を検索' }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon color="action" /></InputAdornment> }}
        />
        <Tabs value={tab} onChange={(e, value) => setTab(value)} variant="scrollable" scrollButtons="auto"
          sx={{ mt: .5, minHeight: 40, '& .MuiTab-root': { minHeight: 40, minWidth: 'auto', px: { xs: 1.2, md: 1.8 } } }}>
          {SEARCH_TABS.map(item => <Tab value={item.id} label={item.label} key={item.id} />)}
        </Tabs>
      </Box>

      {loading && <Box sx={{ py: 7, display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>}

      {!loading && show('guide') && (
        <AgentGuidePanel guide={data.agentGuide} metadataRevision={data.metadataRevision}
          storage={data.agentGuideStorage} updatedAt={data.agentGuideUpdatedAt}
          api={fetchPortalWorld} onSaved={refreshWorld}/>
      )}

      {!loading && show('routes') && (
        <section aria-label="参照先の地図">
          <SectionHeading eyebrow="01 — Find the owner" title="まず、どこを見るか" subtitle="話題から担当システムを選択。ここは案内図であり、各システムの正本ではありません。" count={routes.length} icon={<RouteIcon color="primary" />} />
          {routes.length === 0 && <Typography color="text.secondary">該当する入口が見つかりません。</Typography>}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2,minmax(0,1fr))', lg: 'repeat(3,minmax(0,1fr))' }, gap: 1.2 }}>
            {routes.map((route, i) => {
              const active = expanded === route.id;
              const project = linkedProjects.get(route.projectId);
              return (
                <Card key={route.id} variant="outlined" sx={{
                  borderColor: active ? 'text.primary' : line, background: surface,
                  transition: 'border-color .12s ease',
                }}>
                  <CardActionArea onClick={() => setExpanded(active ? null : route.id)}
                    aria-expanded={active} sx={{ p: 2, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', alignItems: 'stretch', height: active ? 'auto' : '100%' }}>
                    <Stack direction="row" justifyContent="space-between" spacing={1}>
                      <Typography sx={{ fontFamily: fonts.mono, fontSize: 11, color: 'text.disabled', letterSpacing: '.06em' }}>
                        {String(i + 1).padStart(2, '0')}
                      </Typography>
                      <ArrowIcon fontSize="small" color={active ? 'primary' : 'disabled'} sx={{ transform: active ? 'rotate(90deg)' : 'none', transition: '.2s' }} />
                    </Stack>
                    <Typography variant="subtitle1" sx={{ fontWeight: 800, mt: .3 }}>{route.title}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: .65, lineHeight: 1.65 }}>{route.description}</Typography>
                    <Typography sx={{ mt: 1.1, fontFamily: fonts.mono, fontSize: 11.5, color: active ? 'primary.main' : 'text.secondary', overflowWrap: 'anywhere' }}>
                      → {route.primary || '参照先未設定'}
                    </Typography>
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
          <SectionHeading eyebrow="02 — Execution" title="Projects" subtitle="実装の単位。GitHubとMCPの所在地を確認できます。" count={projects.length} icon={<FolderIcon color="primary" />} />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2,minmax(0,1fr))' }, gap: 1.25 }}>
            {projects.map(project => (
              <Paper key={project.id} variant="outlined" sx={{ p: 2, borderRadius: 2.3, borderColor: line }}>
                <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={1}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle1" fontWeight={800}>{project.name}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: .55, lineHeight: 1.6 }}>{project.description}</Typography>
                  </Box>
                  <StateChip value={project.status} />
                </Stack>
                <Stack direction="row" flexWrap="wrap" useFlexGap spacing={.5} sx={{ mt: 1.25 }}>
                  {(project.mcpTools || []).slice(0, 5).map(item => <Chip key={item.name} size="small" label={item.name} variant="outlined" />)}
                </Stack>
                {(project.repositories || []).length > 0 && (
                  <Box sx={{ mt: 1.4 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={800}>REPOSITORIES · {project.repositories.length}</Typography>
                    <Stack direction="row" flexWrap="wrap" useFlexGap gap={.9} sx={{ mt: .45 }}>
                      {project.repositories.slice(0, 4).map(repo => (
                        <MuiLink key={repo.fullName} href={repo.url || `https://github.com/${repo.fullName}`} target="_blank" rel="noreferrer"
                          sx={{ fontFamily: fonts.mono, fontSize: 12, overflowWrap: 'anywhere' }}>{repo.fullName}</MuiLink>
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

      {!loading && show('skills') && (
        <section aria-label="Skill Pack階層とIntelligence">
          <SectionHeading eyebrow="03 — Pack / Skill / Intelligence" title="Skill Packs"
            subtitle="Packが複数Skillを統括します。Intelligenceは判断に使う独立した知性。道場はPackとSkillを鍛えます。"
            count={skillPacks.length} icon={<TreeIcon color="primary" />} />
          {skillPacks.map(pack=>(
            <Paper key={pack.id} variant="outlined" sx={{p:{xs:1.6,md:2.2},borderRadius:2.5,borderColor:line,mb:1.5}}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} flexWrap="wrap">
                <Box>
                  <Typography variant="h6" sx={{fontWeight:850}}>{pack.title}</Typography>
                  <Typography variant="body2" color="text.secondary">{pack.summary}</Typography>
                </Box>
                <Chip size="small" color="success" variant="outlined" label={`Skill Pack v${pack.currentVersionNumber||1}`} />
              </Stack>
              <Box sx={{mt:1.6,pl:{xs:1,md:2},borderLeft:'3px solid',borderColor:'primary.light'}}>
                <Typography variant="caption" color="text.secondary" sx={{display:'block',mb:.45}}>実行入口（旧統括SkillのIDと道場版を維持）</Typography>
                <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
                  <Typography variant="subtitle2" sx={{fontFamily:fonts.mono,overflowWrap:'anywhere'}}>{pack.entrySkillId}</Typography>
                  <Button size="small" onClick={()=>openSkill((data.chatSkills||[]).find(x=>x.id===pack.entrySkillId)||{id:pack.entrySkillId,title:pack.entrySkillId})}>原文を開く</Button>
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{display:'block',mt:1.6,mb:.7}}>専門Skill群（各Skillは独立した版を持ち、共通利用される）</Typography>
                <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',md:'repeat(2,minmax(0,1fr))'},gap:.8}}>
                  {(pack.skills||[]).map(member=>(
                    <Box key={member.skillId} sx={{border:'1px solid',borderColor:line,borderRadius:1.3,p:1.1,minWidth:0}}>
                      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                        <Typography sx={{fontFamily:fonts.mono,fontSize:12,overflowWrap:'anywhere'}}>{member.skillId}</Typography>
                        <Chip variant="outlined" size="small" label={member.stage} sx={{fontSize:10.5,height:21,flexShrink:0}}/>
                      </Stack>
                      <Button size="small" sx={{mt:.45,p:0,minWidth:0}} onClick={()=>openSkill((data.chatSkills||[]).find(x=>x.id===member.skillId)||{id:member.skillId,title:member.skillId})}>Skill本文</Button>
                      {!member.required && <Typography variant="caption" color="text.secondary" sx={{ml:1}}>必要時のみ</Typography>}
                    </Box>
                  ))}
                </Box>
              </Box>
              <Stack direction={{xs:'column',md:'row'}} useFlexGap gap={1} sx={{mt:1.5}}>
                <Paper variant="outlined" sx={{p:1.25,flex:1,borderRadius:1.5}}>
                  <Typography fontWeight={850} fontSize={13}>Intelligence（判断の知性）</Typography>
                  {(pack.intelligenceIds||[]).map(id=>(
                    <Typography key={id} sx={{fontFamily:fonts.mono,fontSize:12.5,mt:.45,overflowWrap:'anywhere'}}>{id}</Typography>
                  ))}
                  <Typography variant="caption" color="text.secondary">MCCはここ。Skill群の親ではなくPackが参照する共通知性です。</Typography>
                </Paper>
                <Paper variant="outlined" sx={{p:1.25,flex:1,borderRadius:1.5}}>
                  <Typography fontWeight={850} fontSize={13}>錬成道場（評価と改善）</Typography>
                  <Typography sx={{fontFamily:fonts.mono,fontSize:12.5,mt:.45,overflowWrap:'anywhere'}}>{pack.dojoBaseId}</Typography>
                  <Typography variant="caption" color="text.secondary">既存の仮説・評価・リリース版を引き継いでいます。</Typography>
                </Paper>
              </Stack>
            </Paper>
          ))}
          {!skillPacks.length && <Typography color="text.secondary">表示可能なSkill Packがありません。</Typography>}
        </section>
      )}

      {!loading && show('skills') && (
        <section aria-label="チャット専用Skills">
          <SectionHeading eyebrow="03 — Chat skills" title="個別Skills"
            subtitle="Packからも共通参照されるチャット用スキルはMy PortalのDBで本文と履歴を管理。Agent HQ Manager / WorkerのMethodとは別です。"
            count={skills.length} icon={<SparkIcon color="primary" />} />
          <Alert severity="info" sx={{ mb: 1.5, '& .MuiAlert-message':{fontSize:13} }}>
            Skill本文の正本はMy Portal DB（chatSkills）。GitHubは旧版・エクスポート先です。DB登録とChatGPTへのインストールは別です。
          </Alert>
          <Box sx={{ display:'grid', gridTemplateColumns:{xs:'1fr',md:'repeat(2,minmax(0,1fr))'},gap:1.15 }}>
            {skills.map(skill=>(
              <Paper key={skill.id} variant="outlined" sx={{ p:2,borderRadius:2.3,borderColor:line }}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
                  <Typography variant="subtitle1" fontWeight={800}>{skill.title}</Typography>
                  <Chip size="small" variant="outlined" color="success" label="My Portal DB" />
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{mt:.6,lineHeight:1.65}}>{skill.summary}</Typography>
                <Stack direction="row" flexWrap="wrap" useFlexGap spacing={.5} sx={{mt:1.1}}>
                  {(skill.triggers||[]).slice(0,4).map(t=><Chip key={t} label={t} size="small" variant="outlined" />)}
                </Stack>
                <Box sx={{mt:1.15}}>
                  <Button size="small" onClick={()=>openSkill(skill)} endIcon={<BookIcon fontSize="small"/>}>DBのSkill本文を開く・編集</Button>
                  <Typography variant="caption" color="text.secondary" sx={{display:'block',mt:.5}}>revision {skill.revision||1} · 正本: My Portal DB</Typography>
                </Box>
              </Paper>
            ))}
          </Box>
          {skills.length===0&&<Typography color="text.secondary">登録済みSkillがありません。</Typography>}
        </section>
      )}

      {!loading && show('contexts') && (
        <section aria-label="Contexts — ProjectとDomainに結びつくコンテクスト">
          <ContextPanel contexts={data.contexts || []} projects={data.projects || []}
            query={q} api={fetchPortalWorld} afterSave={refreshWorld}/>
        </section>
      )}

      {!loading && tab === 'all' && (
        <Paper variant="outlined" sx={{ p: 2.3, mt: 3.4, borderRadius: 2.5, borderColor: line }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <HubIcon color="primary" /><Typography variant="subtitle1" fontWeight={800}>接続先について</Typography>
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

      <Dialog open={Boolean(skillDetail)} onClose={() => {if(!skillSaving)setSkillDetail(null);}} fullWidth maxWidth="md">
        <DialogTitle sx={{fontWeight:850}}>{skillDetail?.title || 'Chat Skill'} — My Portal DB</DialogTitle>
        <DialogContent dividers>
          {skillLoading && <CircularProgress size={25}/>}
          {skillError && <Alert severity="error" sx={{mb:1.4}}>{skillError}</Alert>}
          {!skillLoading && skillDraft && (
            <Stack spacing={1.7}>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
                <Chip size="small" label={`revision ${skillDetail?.revision||1}`} />
                <Chip size="small" label="正本: My Portal DB" variant="outlined"/>
                {!skillEditing && <Button size="small" variant="outlined" onClick={()=>setSkillEditing(true)}>編集</Button>}
              </Stack>
              {skillEditing ? (
                <>
                  <TextField label="名称" value={skillDraft.title||''} onChange={e=>setSkillDraft(d=>({...d,title:e.target.value}))}/>
                  <TextField label="概要" multiline minRows={2} value={skillDraft.summary||''} onChange={e=>setSkillDraft(d=>({...d,summary:e.target.value}))}/>
                  <TextField label="呼び出しキーワード（カンマ区切り）" value={skillDraft.triggersText||''} onChange={e=>setSkillDraft(d=>({...d,triggersText:e.target.value}))}/>
                  <TextField label="Skill本文（Markdown）" multiline fullWidth minRows={15} maxRows={26}
                    value={skillDraft.body||''} onChange={e=>setSkillDraft(d=>({...d,body:e.target.value}))}
                    InputProps={{sx:{fontFamily:'monospace',fontSize:13,lineHeight:1.65}}}
                    helperText="本文を更新するとDBに新しいrevisionを保存します。Manager/Worker Methodは変更しません。"/>
                </>
              ):(
                <>
                  <Typography variant="body2" color="text.secondary">{skillDetail?.summary}</Typography>
                  <Paper variant="outlined" sx={{p:2,borderRadius:2,maxHeight:460,overflow:'auto'}}>
                    <Typography component="pre" variant="body2" sx={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontFamily:'monospace',fontSize:12.5,lineHeight:1.7}}>{skillDetail?.body||'本文がありません'}</Typography>
                  </Paper>
                </>
              )}
                            <Typography variant="caption" color="text.secondary">保存履歴: {skillHistory.map(v=>`v${v.versionNumber}`).join('、') || '未取得'}</Typography>
              {relationPolicy && (
                <Paper variant="outlined" sx={{p:1.7,borderRadius:2}}>
                  <Typography sx={{fontWeight:800,fontSize:13.5}}>関連Skill・用途条件</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{display:'block',my:0.75}}>
                    {relationPolicy.source==='my_portal_db' ? 'My Portal DBで管理' : '旧コード定義（DBへ未移行）'}
                    {' · '}関係定義 v{relationPolicy.revision}。関連Skillの本文は実行時に道場承認済み最新版を取得します。
                    変更は本文の改訂とは独立して記録され、変更時は事例ベンチマークが必要です。
                  </Typography>
                  <TextField fullWidth multiline minRows={4} maxRows={12} label="関係定義（JSON）"
                    value={relationDraft} onChange={e=>setRelationDraft(e.target.value)}
                    InputProps={{sx:{fontFamily:'monospace',fontSize:12.5}}} />
                  <TextField sx={{mt:1}} fullWidth size="small" label="変更理由（必須）"
                    value={relationChangeReason} onChange={e=>setRelationChangeReason(e.target.value)} />
                  <TextField sx={{mt:1}} fullWidth size="small" label="比較の証拠URL/記録ID（変更時は必須）"
                    value={relationBenchmarkRef} onChange={e=>setRelationBenchmarkRef(e.target.value)} />
                  <TextField sx={{mt:1}} fullWidth size="small" label="合否の具体例・比較内容（変更時は必須）"
                    value={relationBenchmarkCases} onChange={e=>setRelationBenchmarkCases(e.target.value)} />
                  <Stack direction="row" justifyContent="flex-end" sx={{mt:1}}>
                    <Button size="small" variant="outlined" disabled={relationSaving||!relationChangeReason.trim()}
                      onClick={saveRelations}>{relationSaving?'保存中…':'依存ルールを版付きで保存'}</Button>
                  </Stack>
                </Paper>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={skillSaving} onClick={()=>{setSkillDetail(null);setSkillDraft(null);}}>閉じる</Button>
          {skillEditing && <Button variant="contained" disabled={skillSaving||!skillDraft?.body?.trim()||!skillDraft?.title?.trim()} onClick={saveSkill}>DBに保存</Button>}
        </DialogActions>
      </Dialog>

    </Box>
  );
}
