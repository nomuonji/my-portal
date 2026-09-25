import React, { useEffect, useMemo, useState } from 'react';
import { marked } from 'marked';
import { useParams, useNavigate } from 'react-router-dom';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  ArrowBack as ArrowBackIcon,
  Edit as EditIcon,
  FolderOutlined as FolderOutlinedIcon,
  GitHub as GitHubIcon,
  HubOutlined as HubOutlinedIcon,
  Launch as LaunchIcon,
  PsychologyAltOutlined as PsychologyAltOutlinedIcon,
  RuleOutlined as RuleOutlinedIcon,
  TaskAltOutlined as TaskAltOutlinedIcon,
} from '@mui/icons-material';

const statusLabel = {
  active: '進行中',
  paused: '一時停止',
  completed: '完了',
  archived: 'アーカイブ',
  backlog: 'Backlog',
  ready: 'Ready',
  in_progress: 'Working',
  running: 'Running',
  blocked: 'Blocked',
  review: 'Review',
  done: 'Done',
  cancelled: 'Cancelled',
};

const workStatusOrder = ['running', 'in_progress', 'blocked', 'review', 'ready', 'backlog', 'done', 'cancelled'];

function ProjectDetails() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [project, setProject] = useState(null);
  const [workItems, setWorkItems] = useState([]);
  const [spaces, setSpaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!projectId) return undefined;
    return onSnapshot(
      doc(db, 'projects', projectId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setError('プロジェクトが見つかりませんでした。');
          setLoading(false);
          return;
        }
        setProject({ id: snapshot.id, ...snapshot.data() });
        setLoading(false);
      },
      (snapshotError) => {
        console.error('Failed to load project:', snapshotError);
        setError('プロジェクトの読み込みに失敗しました。');
        setLoading(false);
      },
    );
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return undefined;
    const q = query(
      collection(db, 'memos', 'agent-control', 'workItems'),
      where('projectId', '==', projectId),
    );
    return onSnapshot(
      q,
      (snapshot) => setWorkItems(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
      (snapshotError) => console.error('Failed to load project work items:', snapshotError),
    );
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    const loadSpaces = async () => {
      const ids = project?.spaceIds || [];
      if (!ids.length) {
        setSpaces([]);
        return;
      }
      const snapshots = await Promise.all(ids.map((id) => getDoc(doc(db, 'spaces', id))));
      if (!cancelled) {
        setSpaces(snapshots.filter((snapshot) => snapshot.exists()).map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })));
      }
    };
    loadSpaces().catch((loadError) => console.error('Failed to load project spaces:', loadError));
    return () => { cancelled = true; };
  }, [project?.spaceIds]);

  const sortedWorkItems = useMemo(() => [...workItems].sort((a, b) => (
    workStatusOrder.indexOf(a.status) - workStatusOrder.indexOf(b.status)
  )), [workItems]);

  const workStats = useMemo(() => ({
    running: workItems.filter((item) => item.status === 'running').length,
    working: workItems.filter((item) => item.status === 'in_progress').length,
    open: workItems.filter((item) => !['done', 'cancelled'].includes(item.status)).length,
    done: workItems.filter((item) => item.status === 'done').length,
  }), [workItems]);

  const border = isDark
    ? alpha(theme.palette.common.white, 0.09)
    : 'rgba(83, 124, 149, 0.16)';
  const surface = isDark
    ? alpha(theme.palette.background.paper, 0.88)
    : 'rgba(255,255,255,0.82)';

  if (loading) {
    return <Box sx={{ minHeight: 360, display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>;
  }

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!project) return null;

  const repos = project.repositories || [];
  const tools = project.mcpTools || [];

  return (
    <Box sx={{ p: { xs: 0.6, sm: 1, md: 1.5 }, maxWidth: 1360, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/project')}>
          Projects
        </Button>
      </Box>

      <Paper
        elevation={0}
        sx={{
          p: { xs: 1.6, md: 2.3 },
          mb: 1.3,
          border: `1px solid ${border}`,
          background: surface,
          backdropFilter: 'blur(18px) saturate(135%)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            width: 250,
            height: 250,
            borderRadius: '50%',
            right: -110,
            top: -145,
            background: alpha(theme.palette.primary.main, isDark ? 0.13 : 0.07),
          }}
        />
        <Box sx={{ display: 'flex', gap: 1.4, alignItems: 'flex-start', flexWrap: 'wrap', position: 'relative' }}>
          <Box
            sx={{
              width: 46,
              height: 46,
              borderRadius: 2.4,
              display: 'grid',
              placeItems: 'center',
              bgcolor: alpha(theme.palette.primary.main, isDark ? 0.16 : 0.08),
              color: 'primary.main',
              flexShrink: 0,
            }}
          >
            <FolderOutlinedIcon />
          </Box>
          <Box sx={{ flex: 1, minWidth: 220 }}>
            <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 900, letterSpacing: '0.13em' }}>
              IMPLEMENTATION WORKSPACE
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: '-0.035em', lineHeight: 1.15 }}>
              {project.name || 'Untitled Project'}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.55, flexWrap: 'wrap', mt: 0.85 }}>
              <Chip size="small" color="primary" label={statusLabel[project.status] || project.status || '進行中'} />
              {(project.tags || []).map((tag) => (
                <Chip key={tag} size="small" variant="outlined" label={tag} />
              ))}
            </Box>
          </Box>
          <Button startIcon={<EditIcon />} variant="outlined" onClick={() => navigate(`/project/edit/${projectId}`)}>
            編集
          </Button>
        </Box>

        {project.description && (
          <Box
            sx={{
              mt: 1.8,
              maxWidth: 900,
              color: 'text.secondary',
              lineHeight: 1.75,
              '& p': { my: 0.7 },
              '& ul, & ol': { pl: 2.5 },
              '& a': { color: 'primary.main' },
              '& code': { fontFamily: 'monospace' },
            }}
            dangerouslySetInnerHTML={{ __html: marked(project.description) }}
          />
        )}

        <Box
          sx={{
            mt: 1.9,
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(100px, 1fr))', lg: 'repeat(6, minmax(100px, 1fr))' },
            gap: 0.75,
          }}
        >
          {[
            ['Repositories', repos.length],
            ['Connected tools', tools.length],
            ['Open work', workStats.open],
            ['Working', workStats.working],
            ['Running', workStats.running],
            ['Done', workStats.done],
          ].map(([label, value]) => (
            <Box key={label} sx={{ p: 0.9, borderRadius: 2, border: `1px solid ${border}`, background: isDark ? alpha(theme.palette.common.white, 0.025) : 'rgba(255,255,255,0.48)' }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>{label}</Typography>
              <Typography variant="h6" sx={{ fontWeight: 900, mt: 0.1 }}>{value}</Typography>
            </Box>
          ))}
        </Box>
      </Paper>

      {project.managedRepoPolicy && (
        <Paper elevation={0} sx={{ p: 1.2, mb: 1.3, border: `1px solid ${border}`, background: alpha(theme.palette.info.main, isDark ? 0.08 : 0.045) }}>
          <Box sx={{ display: 'flex', gap: 0.8, alignItems: 'flex-start' }}>
            <RuleOutlinedIcon sx={{ mt: 0.15, color: 'info.main' }} fontSize="small" />
            <Box>
              <Typography variant="caption" sx={{ fontWeight: 900 }}>Project rule</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.15, lineHeight: 1.6 }}>
                {project.managedRepoPolicy}
              </Typography>
            </Box>
          </Box>
        </Paper>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1.05fr 0.95fr' }, gap: 1.3, alignItems: 'start' }}>
        <Stack spacing={1.3}>
          <Paper elevation={0} sx={{ p: 1.4, border: `1px solid ${border}`, background: surface }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, mb: 1.1 }}>
              <GitHubIcon fontSize="small" />
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>Repositories</Typography>
                <Typography variant="caption" color="text.secondary">このProjectを構成する実装repo</Typography>
              </Box>
              <Chip size="small" label={repos.length} />
            </Box>

            <Stack spacing={0.75}>
              {repos.map((repo, index) => {
                const href = repo.url || (repo.fullName ? `https://github.com/${repo.fullName}` : '');
                return (
                  <Card key={`${repo.fullName || repo.url}-${index}`} elevation={0} sx={{ border: `1px solid ${border}`, background: 'transparent' }}>
                    <CardContent sx={{ p: '12px !important' }}>
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography
                            component={href ? 'a' : 'div'}
                            href={href || undefined}
                            target={href ? '_blank' : undefined}
                            rel={href ? 'noreferrer' : undefined}
                            sx={{
                              fontWeight: 900,
                              color: href ? 'primary.main' : 'text.primary',
                              textDecoration: 'none',
                              overflowWrap: 'anywhere',
                              '&:hover': { textDecoration: href ? 'underline' : 'none' },
                            }}
                          >
                            {repo.fullName || repo.url || 'Repository'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                            {repo.role || 'role未設定'}
                          </Typography>
                        </Box>
                        {href && <LaunchIcon sx={{ fontSize: 16, color: 'text.secondary', mt: 0.25 }} />}
                      </Box>
                    </CardContent>
                  </Card>
                );
              })}
              {repos.length === 0 && (
                <Typography variant="body2" color="text.secondary">関連repoはまだ登録されていません。</Typography>
              )}
            </Stack>
          </Paper>

          <Paper elevation={0} sx={{ p: 1.4, border: `1px solid ${border}`, background: surface }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, mb: 1.1 }}>
              <HubOutlinedIcon fontSize="small" />
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>Connected tools</Typography>
                <Typography variant="caption" color="text.secondary">AgentがこのProjectで使うMCP / connector / deploy tool</Typography>
              </Box>
              <Chip size="small" label={tools.length} />
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 0.7 }}>
              {tools.map((tool, index) => (
                <Box key={`${tool.name}-${index}`} sx={{ p: 1, borderRadius: 2, border: `1px solid ${border}` }}>
                  <Typography variant="body2" sx={{ fontWeight: 900 }}>{tool.name}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, lineHeight: 1.5 }}>
                    {tool.purpose || '用途未設定'}
                  </Typography>
                </Box>
              ))}
              {tools.length === 0 && (
                <Typography variant="body2" color="text.secondary">関連toolはまだ登録されていません。</Typography>
              )}
            </Box>
          </Paper>

          {spaces.length > 0 && (
            <Paper elevation={0} sx={{ p: 1.4, border: `1px solid ${border}`, background: surface }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, mb: 1 }}>
                <PsychologyAltOutlinedIcon fontSize="small" />
                <Box sx={{ flex: 1 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>関連する長期テーマ</Typography>
                  <Typography variant="caption" color="text.secondary">実装そのものではなく、背景にある継続的な思考テーマ</Typography>
                </Box>
                <Chip size="small" label={spaces.length} />
              </Box>
              <Stack spacing={0.65}>
                {spaces.map((space) => (
                  <Box key={space.id} sx={{ p: 0.9, borderRadius: 2, border: `1px solid ${border}` }}>
                    <Typography variant="body2" sx={{ fontWeight: 900 }}>{space.title || space.id}</Typography>
                    {(space.summary || space.currentBrief) && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          mt: 0.25,
                          lineHeight: 1.5,
                        }}
                      >
                        {space.summary || space.currentBrief}
                      </Typography>
                    )}
                  </Box>
                ))}
              </Stack>
            </Paper>
          )}
        </Stack>

        <Paper elevation={0} sx={{ p: 1.4, border: `1px solid ${border}`, background: surface, position: { xl: 'sticky' }, top: { xl: 12 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, mb: 1 }}>
            <TaskAltOutlinedIcon fontSize="small" />
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>Work Items</Typography>
              <Typography variant="caption" color="text.secondary">このProjectに紐づく実行単位</Typography>
            </Box>
            <Chip size="small" label={workItems.length} />
          </Box>

          <Stack spacing={0.7}>
            {sortedWorkItems.slice(0, 30).map((item) => (
              <Card key={item.id} elevation={0} sx={{ border: `1px solid ${border}`, background: 'transparent' }}>
                <CardContent sx={{ p: '11px !important' }}>
                  <Box sx={{ display: 'flex', gap: 0.6, alignItems: 'flex-start' }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 900, lineHeight: 1.45 }}>
                        {item.title || 'Untitled'}
                      </Typography>
                      {item.objective && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            mt: 0.3,
                            lineHeight: 1.45,
                          }}
                        >
                          {item.objective}
                        </Typography>
                      )}
                    </Box>
                    <Stack spacing={0.35} alignItems="flex-end">
                      <Chip size="small" label={statusLabel[item.status] || item.status || 'Ready'} sx={{ height: 20, fontSize: '0.56rem' }} />
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem' }}>
                        {item.executionMode === 'human' ? 'Human' : 'Agent'}
                      </Typography>
                    </Stack>
                  </Box>
                </CardContent>
              </Card>
            ))}
            {workItems.length === 0 && (
              <Box sx={{ py: 3.5, textAlign: 'center', border: `1px dashed ${border}`, borderRadius: 2 }}>
                <Typography variant="body2" sx={{ fontWeight: 800 }}>Work Itemはまだありません</Typography>
                <Typography variant="caption" color="text.secondary">Agent HQからこのProjectへ作業を紐づけられます。</Typography>
              </Box>
            )}
          </Stack>
        </Paper>
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5, px: 0.3 }}>
        {project.id} · schema v{project.schemaVersion || 1}
      </Typography>
    </Box>
  );
}

export default ProjectDetails;
