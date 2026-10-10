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

const EMPTY = { routes: [], projects: [], spaces: [], methods: [], chatSkills: [], aiContexts: [], aiContextNotes: [], warnings: [], coverage: {} };
const SEARCH_TABS = [
  { id: 'all', label: 'すべて' }, { id: 'routes', label: '分野・入口' },
  { id: 'projects', label: 'Projects' }, { id: 'skills', label: 'Skills' },
  { id: 'aiContexts', label: 'AI側の記録' },
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
  const [noteTarget, setNoteTarget] = useState(null);
  const [noteDraft, setNoteDraft] = useState({kind:'handoff',summary:'',detail:''});
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState('');
  const [skillDetail, setSkillDetail] = useState(null);
  const [skillDraft, setSkillDraft] = useState(null);
  const [skillHistory, setSkillHistory] = useState([]);
  const [skillLoading, setSkillLoading] = useState(false);
  const [skillSaving, setSkillSaving] = useState(false);
  const [skillError, setSkillError] = useState('');
  const [skillEditing, setSkillEditing] = useState(false);

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
  const skills = useMemo(() => (data.chatSkills || []).filter(item => !q || searchable(item).includes(q)), [data.chatSkills, q]);
  const aiContexts = useMemo(() => (data.aiContexts || []).filter(item => !q || searchable(item).includes(q)), [data.aiContexts, q]);
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
  const addNote = async () => {
    if (!noteTarget || !noteDraft.summary.trim()) return;
    setNoteSaving(true);
    setNoteError('');
    try {
      await fetchPortalWorld('', {method:'POST',body:JSON.stringify({
        action:'ai_context_note_create',spaceId:noteTarget.id,
        summary:noteDraft.summary.trim(),detail:noteDraft.detail.trim(),
        kind:noteDraft.kind,confirm:true,source:'my-portal-home',
      })});
      setNoteTarget(null);
      setNoteDraft({kind:'handoff',summary:'',detail:''});
      await reload();
    } catch(err) {
      setNoteError(err.message || '保存できませんでした');
    } finally {setNoteSaving(false);}
  };
  const openSkill = async (skill) => {
    setSkillDetail({id:skill.id,title:skill.title});
    setSkillLoading(true);setSkillEditing(false);setSkillError('');
    try {
      const [full,hist] = await Promise.all([
        fetchPortalWorld(`?resource=chat_skill&id=${encodeURIComponent(skill.id)}`),
        fetchPortalWorld(`?resource=chat_skill_versions&id=${encodeURIComponent(skill.id)}`),
      ]);
      setSkillDetail(full);
      setSkillDraft({...full,triggersText:(full.triggers||[]).join(', ')});
      setSkillHistory(hist.items||[]);
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
              チャット用Skill、AI側の検討履歴、Project、担当Operatorを明確に分けて探せます。
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
          <SummaryNumber label="Chat Skills" number={data.chatSkills?.length ?? '—'} caption="SKILL.md が正本" />
          <SummaryNumber label="AI Context" number={data.aiContexts?.length ?? '—'} caption="会話の記録と判断" />
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
          placeholder="SEO、Culture、Skill名、AIの検討記録、repo名から探す"
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

      {!loading && show('skills') && (
        <section aria-label="チャット専用Skills">
          <SectionHeading eyebrow="03 / CHATGPT SKILLS" title="Skills"
            subtitle="チャット用スキルはMy PortalのDBで本文と履歴を管理。Agent HQ Manager / WorkerのMethodとは別です。"
            count={skills.length} icon={<SparkIcon color="primary" />} />
          <Alert severity="info" sx={{ mb: 1.5, '& .MuiAlert-message':{fontSize:13} }}>
            Skill本文の正本はMy Portal DB（chatSkills）。GitHubは旧版・エクスポート先です。DB登録とChatGPTへのインストールは別です。
          </Alert>
          <Box sx={{ display:'grid', gridTemplateColumns:{xs:'1fr',md:'repeat(2,minmax(0,1fr))'},gap:1.15 }}>
            {skills.map(skill=>(
              <Paper key={skill.id} variant="outlined" sx={{ p:2,borderRadius:2.3,borderColor:line }}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
                  <Typography variant="subtitle1" fontWeight={850}>{skill.title}</Typography>
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

      {!loading && show('aiContexts') && (
        <section aria-label="AI側の会話記録と長期コンテクスト">
          <SectionHeading eyebrow="04 / AI CONTEXT" title="AI側のコンテクスト"
            subtitle="AI側のSpaceだけを独立表示。チャットで決まったこと・訂正・引き継ぎを保存して、手戻りを防ぎます。"
            count={aiContexts.length} icon={<ThinkingIcon color="primary" />} />
          <Box sx={{ display:'grid',gridTemplateColumns:{xs:'1fr',md:'repeat(2,minmax(0,1fr))'},gap:1.15 }}>
            {aiContexts.map(space=>(
              <Paper key={space.id} variant="outlined" sx={{p:2,borderRadius:2.3,borderColor:line}}>
                <Typography variant="subtitle1" fontWeight={850}>{space.title}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{mt:.45,lineHeight:1.65}}>{space.summary}</Typography>
                {(space.latestNotes||[]).length>0 && (
                  <Box sx={{mt:1.2}}>
                    <Typography variant="overline" color="text.secondary" fontWeight={850}>最近のチャット記録</Typography>
                    {(space.latestNotes||[]).map(note=>(
                      <Box key={note.id} sx={{py:.7,borderTop:`1px solid ${line}`}}>
                        <Typography variant="caption" color="text.secondary">{note.kind} · {note.createdAt?new Date(note.createdAt).toLocaleDateString('ja-JP'):''}</Typography>
                        <Typography variant="body2" sx={{mt:.2,lineHeight:1.55}}>{note.summary}</Typography>
                      </Box>
                    ))}
                  </Box>
                )}
                <Stack direction="row" flexWrap="wrap" useFlexGap spacing={.4} sx={{mt:1.25}}>
                  <RuleLink to={`/thinking?space=${encodeURIComponent(space.id)}`}>詳細を開く</RuleLink>
                  <Button size="small" onClick={()=>{
                    setNoteTarget(space);setNoteError('');setNoteDraft({kind:'handoff',summary:'',detail:''});
                  }}>会話の要点を記録</Button>
                </Stack>
              </Paper>
            ))}
          </Box>
          {aiContexts.length===0 && <Typography color="text.secondary">AI側のコンテクストがありません。</Typography>}
          <Paper variant="outlined" sx={{mt:1.5,p:1.6,borderColor:line,borderRadius:2.2}}>
            <Typography variant="body2" fontWeight={750}>人間側のSpace・運営Methodは別の場所にあります</Typography>
            <Typography variant="body2" color="text.secondary" sx={{mt:.4}}>
              人間側の長期テーマはThinking Workspaceへ。Manager/WorkerのMethodはAgent HQで運用します。
            </Typography>
            <Stack direction="row" spacing={.6} sx={{mt:.8}} flexWrap="wrap" useFlexGap>
              <RuleLink to="/thinking">Thinking Workspace</RuleLink>
              <RuleLink to="/dashboard">Agent HQ</RuleLink>
            </Stack>
          </Paper>
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
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={skillSaving} onClick={()=>{setSkillDetail(null);setSkillDraft(null);}}>閉じる</Button>
          {skillEditing && <Button variant="contained" disabled={skillSaving||!skillDraft?.body?.trim()||!skillDraft?.title?.trim()} onClick={saveSkill}>DBに保存</Button>}
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(noteTarget)} onClose={() => {if(!noteSaving)setNoteTarget(null);}} fullWidth maxWidth="sm">
        <DialogTitle sx={{fontWeight:850}}>AI側の会話記録を残す</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{mb:1.5}}>{noteTarget?.title}</Typography>
          <Stack spacing={1.7}>
            <TextField select SelectProps={{native:true}} label="記録の種類" value={noteDraft.kind}
              onChange={e=>setNoteDraft(d=>({...d,kind:e.target.value}))}>
              <option value="decision">確定した決定</option>
              <option value="correction">訂正・手戻り防止</option>
              <option value="handoff">次回への引き継ぎ</option>
              <option value="finding">新しい発見</option>
            </TextField>
            <TextField label="次のチャットに残す要点" value={noteDraft.summary} multiline minRows={2} required
              onChange={e=>setNoteDraft(d=>({...d,summary:e.target.value}))} inputProps={{maxLength:800}}/>
            <TextField label="理由・背景（任意）" value={noteDraft.detail} multiline minRows={3}
              onChange={e=>setNoteDraft(d=>({...d,detail:e.target.value}))} inputProps={{maxLength:4500}}/>
          </Stack>
          {noteError&&<Alert severity="error" sx={{mt:1.3}}>{noteError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button disabled={noteSaving} onClick={()=>setNoteTarget(null)}>キャンセル</Button>
          <Button variant="contained" disabled={noteSaving||!noteDraft.summary.trim()} onClick={addNote}>保存</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
