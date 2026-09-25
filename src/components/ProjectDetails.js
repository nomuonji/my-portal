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
  Divider,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Edit as EditIcon,
  FolderOutlined as FolderOutlinedIcon,
  GitHub as GitHubIcon,
  HubOutlined as HubOutlinedIcon,
  PsychologyAltOutlined as PsychologyAltOutlinedIcon,
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
  blocked: 'Blocked',
  review: 'Review',
  done: 'Done',
  cancelled: 'Cancelled',
};

function ProjectDetails() {
  const { projectId } = useParams();
  const navigate = useNavigate();
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

  const sortedWorkItems = useMemo(() => [...workItems].sort((a, b) => {
    const rank = { in_progress: 0, blocked: 1, review: 2, ready: 3, backlog: 4, done: 5, cancelled: 6 };
    return (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
  }), [workItems]);

  if (loading) {
    return <Box sx={{ minHeight: 360, display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>;
  }

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!project) return null;

  return (
    <Box sx={{ p: { xs: 1, md: 2.5 }, maxWidth: 1280, mx: 'auto' }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/project')} sx={{ mb: 1.5 }}>
        プロジェクト一覧
      </Button>

      <Paper elevation={0} sx={{ p: { xs: 1.6, md: 2.2 }, mb: 1.5, border: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <Box sx={{ width: 42, height: 42, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: 'action.hover' }}>
            <FolderOutlinedIcon color="primary" />
          </Box>
          <Box sx={{ flex: 1, minWidth: 220 }}>
            <Typography variant="overline" color="text.secondary">IMPLEMENTATION WORKSPACE</Typography>
            <Typography variant="h4" sx={{ fontWeight: 900 }}>{project.name}</Typography>
            <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap', mt: 0.8 }}>
              <Chip size="small" label={statusLabel[project.status] || project.status || 'active'} />
              {(project.tags || []).map((tag) => <Chip key={tag} size="small" variant="outlined" label={tag} />)}
              <Chip size="small" variant="outlined" label={`${project.repositories?.length || 0} repos`} />
              <Chip size="small" variant="outlined" label={`${project.mcpTools?.length || 0} MCP tools`} />
              <Chip size="small" variant="outlined" label={`${workItems.length} work items`} />
            </Box>
          </Box>
          <Button startIcon={<EditIcon />} variant="outlined" onClick={() => navigate(`/project/edit/${projectId}`)}>
            編集
          </Button>
        </Box>

        {project.description && (
          <Box
            sx={{
              mt: 2,
              color: 'text.secondary',
              '& p': { mb: 1 },
              '& ul, & ol': { pl: 2.5 },
              '& a': { color: 'primary.main' },
              '& code': { fontFamily: 'monospace' },
            }}
            dangerouslySetInnerHTML={{ __html: marked(project.description) }}
          />
        )}
      </Paper>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 1.5, mb: 1.5 }}>
        <Paper elevation={0} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mb: 1.1 }}>
            <GitHubIcon fontSize="small" />
            <Typography variant="h6" sx={{ fontWeight: 900 }}>GitHub repositories</Typography>
            <Chip size="small" label={project.repositories?.length || 0} />
          </Box>
          <Stack spacing={0.8}>
            {(project.repositories || []).map((repo, index) => {
              const href = repo.url || (repo.fullName ? `https://github.com/${repo.fullName}` : '');
              return (
                <Card key={`${repo.fullName}-${index}`} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
                  <CardContent sx={{ p: '12px !important' }}>
                    <Typography
                      component={href ? 'a' : 'div'}
                      href={href || undefined}
                      target={href ? '_blank' : undefined}
                      rel={href ? 'noreferrer' : undefined}
                      sx={{ fontWeight: 900, color: href ? 'primary.main' : 'text.primary', textDecoration: 'none' }}
                    >
                      {repo.fullName || repo.url || 'Repository'}
                    </Typography>
                    {repo.role && <Typography variant="caption" color="text.secondary">{repo.role}</Typography>}
                  </CardContent>
                </Card>
              );
            })}
            {!(project.repositories || []).length && (
              <Typography variant="body2" color="text.secondary">関連repoはまだ登録されていません。</Typography>
            )}
          </Stack>
        </Paper>

        <Paper elevation={0} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mb: 1.1 }}>
            <HubOutlinedIcon fontSize="small" />
            <Typography variant="h6" sx={{ fontWeight: 900 }}>Related MCP tools</Typography>
            <Chip size="small" label={project.mcpTools?.length || 0} />
          </Box>
          <Stack spacing={0.8}>
            {(project.mcpTools || []).map((tool, index) => (
              <Card key={`${tool.name}-${index}`} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
                <CardContent sx={{ p: '12px !important' }}>
                  <Typography sx={{ fontWeight: 900 }}>{tool.name}</Typography>
                  {tool.purpose && <Typography variant="caption" color="text.secondary">{tool.purpose}</Typography>}
                </CardContent>
              </Card>
            ))}
            {!(project.mcpTools || []).length && (
              <Typography variant="body2" color="text.secondary">関連MCP toolはまだ登録されていません。</Typography>
            )}
          </Stack>
        </Paper>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '0.8fr 1.2fr' }, gap: 1.5 }}>
        <Paper elevation={0} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mb: 1.1 }}>
            <PsychologyAltOutlinedIcon fontSize="small" />
            <Typography variant="h6" sx={{ fontWeight: 900 }}>Related Spaces</Typography>
            <Chip size="small" label={spaces.length} />
          </Box>
          <Stack spacing={0.8}>
            {spaces.map((space) => (
              <Card key={space.id} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
                <CardContent sx={{ p: '12px !important' }}>
                  <Typography sx={{ fontWeight: 900 }}>{space.title || space.id}</Typography>
                  {space.summary && <Typography variant="caption" color="text.secondary">{space.summary}</Typography>}
                </CardContent>
              </Card>
            ))}
            {!spaces.length && <Typography variant="body2" color="text.secondary">関連Spaceはありません。</Typography>}
          </Stack>
        </Paper>

        <Paper elevation={0} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mb: 1.1 }}>
            <TaskAltOutlinedIcon fontSize="small" />
            <Typography variant="h6" sx={{ fontWeight: 900 }}>Execution Work Items</Typography>
            <Chip size="small" label={workItems.length} />
          </Box>
          <Stack spacing={0.8}>
            {sortedWorkItems.slice(0, 30).map((item) => (
              <Card key={item.id} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
                <CardContent sx={{ p: '12px !important' }}>
                  <Box sx={{ display: 'flex', gap: 0.7, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <Typography sx={{ fontWeight: 900, flex: 1, minWidth: 180 }}>{item.title || 'Untitled'}</Typography>
                    <Chip size="small" label={statusLabel[item.status] || item.status || 'ready'} />
                    <Chip size="small" variant="outlined" label={item.executionMode === 'human' ? 'Human' : 'Agent'} />
                  </Box>
                  {item.objective && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.45 }}>{item.objective}</Typography>}
                </CardContent>
              </Card>
            ))}
            {!workItems.length && <Typography variant="body2" color="text.secondary">このProjectに紐づくWork Itemはまだありません。</Typography>}
          </Stack>
        </Paper>
      </Box>

      <Divider sx={{ my: 2 }} />
      <Typography variant="caption" color="text.secondary">
        Project ID: {project.id} · schema v{project.schemaVersion || 1}
      </Typography>
    </Box>
  );
}

export default ProjectDetails;
