import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../firebase';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  AddCircleOutline as AddCircleOutlineIcon,
  FolderOutlined as FolderOutlinedIcon,
  GitHub as GitHubIcon,
  HubOutlined as HubOutlinedIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

const statusLabel = {
  active: '進行中',
  paused: '一時停止',
  completed: '完了',
  archived: 'アーカイブ',
};

const formatDate = (value) => {
  if (!value) return '';
  try {
    const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ja-JP', { month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return '';
  }
};

const getStatusTone = (theme, status, isDark) => {
  const map = {
    active: theme.palette.success.main,
    paused: theme.palette.warning.main,
    completed: theme.palette.info.main,
    archived: theme.palette.text.secondary,
  };
  const color = map[status] || theme.palette.primary.main;
  return {
    color,
    background: alpha(color, isDark ? 0.16 : 0.09),
    border: alpha(color, isDark ? 0.28 : 0.2),
  };
};

function Project() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const navigate = useNavigate();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  useEffect(() => {
    const q = query(collection(db, 'projects'));
    return onSnapshot(
      q,
      (snapshot) => {
        setProjects(snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() })));
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching projects:', err);
        setError('プロジェクトの読み込み中にエラーが発生しました。');
        setLoading(false);
      },
    );
  }, []);

  const filteredProjects = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return projects
      .filter((project) => statusFilter === 'all' || (project.status || 'active') === statusFilter)
      .filter((project) => {
        if (!keyword) return true;
        return [
          project.name,
          project.description,
          project.status,
          ...(project.tags || []),
          ...(project.repositories || []).flatMap((repo) => [repo.fullName, repo.url, repo.role]),
          ...(project.mcpTools || []).flatMap((tool) => [tool.name, tool.purpose]),
        ].filter(Boolean).join(' ').toLowerCase().includes(keyword);
      })
      .sort((a, b) => {
        const rank = { active: 0, paused: 1, completed: 2, archived: 3 };
        const statusDiff = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
        if (statusDiff !== 0) return statusDiff;
        const aDate = a.updatedAt?.toMillis?.() || Date.parse(a.updatedAt || a.createdAt || 0) || 0;
        const bDate = b.updatedAt?.toMillis?.() || Date.parse(b.updatedAt || b.createdAt || 0) || 0;
        return bDate - aDate;
      });
  }, [projects, searchText, statusFilter]);

  const stats = useMemo(() => ({
    active: projects.filter((project) => (project.status || 'active') === 'active').length,
    repositories: projects.reduce((sum, project) => sum + (project.repositories?.length || 0), 0),
    tools: projects.reduce((sum, project) => sum + (project.mcpTools?.length || 0), 0),
  }), [projects]);

  const border = isDark
    ? alpha(theme.palette.common.white, 0.09)
    : 'rgba(83, 124, 149, 0.16)';
  const surface = isDark
    ? alpha(theme.palette.background.paper, 0.86)
    : 'rgba(255,255,255,0.80)';

  if (loading) {
    return (
      <Box sx={{ minHeight: 360, display: 'grid', placeItems: 'center' }}>
        <CircularProgress size={34} />
      </Box>
    );
  }

  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Box sx={{ minHeight: '100%', p: { xs: 0.4, sm: 0.8 } }}>
      <Paper
        elevation={0}
        sx={{
          mb: 1.4,
          p: { xs: 1.6, md: 2.2 },
          border: `1px solid ${border}`,
          background: surface,
          backdropFilter: 'blur(18px) saturate(135%)',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            width: 220,
            height: 220,
            borderRadius: '50%',
            right: -90,
            top: -120,
            background: alpha(theme.palette.primary.main, isDark ? 0.12 : 0.07),
            pointerEvents: 'none',
          }}
        />

        <Box sx={{ display: 'flex', gap: 2, alignItems: { xs: 'flex-start', md: 'center' }, flexDirection: { xs: 'column', md: 'row' }, position: 'relative' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 900, letterSpacing: '0.14em' }}>
              IMPLEMENTATION WORKSPACES
            </Typography>
            <Typography variant="h4" sx={{ mt: 0.15, fontWeight: 900, letterSpacing: '-0.035em' }}>
              Projects
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.6, maxWidth: 760, lineHeight: 1.7 }}>
              実際に動いている開発単位。GitHub repo・MCP / connector・Work Itemをまとめ、複数repoにまたがる運用も1つのProjectとして管理します。
            </Typography>
          </Box>
          <Button variant="contained" startIcon={<AddCircleOutlineIcon />} onClick={() => navigate('/project/new')}>
            Projectを追加
          </Button>
        </Box>

        <Box
          sx={{
            mt: 2,
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(3, minmax(0, 1fr))', sm: 'repeat(3, 150px)' },
            gap: 0.8,
          }}
        >
          {[
            ['進行中', stats.active],
            ['Repositories', stats.repositories],
            ['Connected tools', stats.tools],
          ].map(([label, value]) => (
            <Box
              key={label}
              sx={{
                p: 1,
                borderRadius: 2,
                border: `1px solid ${border}`,
                background: isDark ? alpha(theme.palette.common.white, 0.025) : 'rgba(255,255,255,0.52)',
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>{label}</Typography>
              <Typography variant="h6" sx={{ mt: 0.15, fontWeight: 900 }}>{value}</Typography>
            </Box>
          ))}
        </Box>
      </Paper>

      <Paper
        elevation={0}
        sx={{
          mb: 1.4,
          p: 1.1,
          border: `1px solid ${border}`,
          background: isDark ? alpha(theme.palette.background.paper, 0.72) : 'rgba(255,255,255,0.54)',
        }}
      >
        <Box sx={{ display: 'flex', gap: 0.8, flexDirection: { xs: 'column', md: 'row' }, alignItems: { md: 'center' } }}>
          <TextField
            size="small"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Project / repo / toolを検索"
            sx={{ width: { xs: '100%', md: 360 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
            {[
              ['all', 'すべて'],
              ['active', '進行中'],
              ['paused', '一時停止'],
              ['completed', '完了'],
              ['archived', 'アーカイブ'],
            ].map(([value, label]) => (
              <Chip
                key={value}
                label={label}
                clickable
                variant={statusFilter === value ? 'filled' : 'outlined'}
                color={statusFilter === value ? 'primary' : 'default'}
                onClick={() => setStatusFilter(value)}
                sx={{ fontWeight: 800 }}
              />
            ))}
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ ml: { md: 'auto' }, px: 0.5 }}>
            {filteredProjects.length}件
          </Typography>
        </Box>
      </Paper>

      {filteredProjects.length === 0 ? (
        <Paper elevation={0} sx={{ py: 8, px: 2, textAlign: 'center', border: `1px dashed ${border}`, background: 'transparent' }}>
          <FolderOutlinedIcon sx={{ fontSize: 38, color: 'text.secondary', opacity: 0.55 }} />
          <Typography variant="subtitle1" sx={{ mt: 1, fontWeight: 900 }}>
            {projects.length === 0 ? 'まだProjectがありません' : '条件に一致するProjectがありません'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {projects.length === 0 ? '実装中のrepoやMCPをまとめるProjectを作成できます。' : '検索語かステータスを変えてみてください。'}
          </Typography>
        </Paper>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))',
            gap: 1.2,
          }}
        >
          {filteredProjects.map((project) => {
            const status = project.status || 'active';
            const tone = getStatusTone(theme, status, isDark);
            const repos = project.repositories || [];
            const tools = project.mcpTools || [];
            return (
              <Card
                key={project.id}
                elevation={0}
                sx={{
                  minHeight: 258,
                  border: `1px solid ${border}`,
                  background: surface,
                  backdropFilter: 'blur(14px)',
                  transition: 'transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease',
                  '&:hover': {
                    transform: 'translateY(-2px)',
                    borderColor: alpha(theme.palette.primary.main, 0.38),
                    boxShadow: '0 14px 32px rgba(43, 82, 106, 0.11)',
                  },
                }}
              >
                <CardActionArea onClick={() => navigate(`/project/details/${project.id}`)} sx={{ height: '100%' }}>
                  <CardContent sx={{ p: 1.7, height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                      <Box
                        sx={{
                          width: 38,
                          height: 38,
                          borderRadius: 2.2,
                          flexShrink: 0,
                          display: 'grid',
                          placeItems: 'center',
                          color: 'primary.main',
                          backgroundColor: alpha(theme.palette.primary.main, isDark ? 0.16 : 0.08),
                        }}
                      >
                        <FolderOutlinedIcon fontSize="small" />
                      </Box>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 900, lineHeight: 1.35 }}>
                          {project.name || '無題のProject'}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 0.5, mt: 0.55, flexWrap: 'wrap' }}>
                          <Chip
                            size="small"
                            label={statusLabel[status] || status}
                            sx={{
                              height: 20,
                              fontSize: '0.58rem',
                              fontWeight: 900,
                              color: tone.color,
                              background: tone.background,
                              border: `1px solid ${tone.border}`,
                            }}
                          />
                          {(project.tags || []).slice(0, 2).map((tag) => (
                            <Chip key={tag} size="small" variant="outlined" label={tag} sx={{ height: 20, fontSize: '0.56rem' }} />
                          ))}
                        </Box>
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', mt: 0.2 }}>
                        {formatDate(project.updatedAt || project.createdAt)}
                      </Typography>
                    </Box>

                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        lineHeight: 1.65,
                        mt: 1.25,
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        minHeight: '4.9em',
                      }}
                    >
                      {project.description || '説明はまだありません。'}
                    </Typography>

                    <Box sx={{ mt: 1.35 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.55, mb: 0.65 }}>
                        <GitHubIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                        <Typography variant="caption" sx={{ fontWeight: 900 }}>Repositories</Typography>
                        <Typography variant="caption" color="text.secondary">{repos.length}</Typography>
                      </Box>
                      <Stack spacing={0.45}>
                        {repos.slice(0, 3).map((repo, index) => (
                          <Box key={`${repo.fullName || repo.url}-${index}`} sx={{ display: 'flex', gap: 0.65, alignItems: 'baseline', minWidth: 0 }}>
                            <Typography variant="caption" sx={{ fontWeight: 800, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {repo.fullName || repo.url || 'Repository'}
                            </Typography>
                            {repo.role && (
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.62rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {repo.role}
                              </Typography>
                            )}
                          </Box>
                        ))}
                        {repos.length > 3 && (
                          <Typography variant="caption" color="text.secondary">+{repos.length - 3} repositories</Typography>
                        )}
                        {repos.length === 0 && (
                          <Typography variant="caption" color="text.secondary">repo未登録</Typography>
                        )}
                      </Stack>
                    </Box>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', mt: 'auto', pt: 1.35 }}>
                      <HubOutlinedIcon sx={{ fontSize: 15, color: 'text.secondary' }} />
                      {tools.slice(0, 4).map((tool) => (
                        <Chip
                          key={tool.name}
                          size="small"
                          variant="outlined"
                          label={tool.name}
                          sx={{ height: 20, fontSize: '0.56rem', maxWidth: 120 }}
                        />
                      ))}
                      {tools.length > 4 && (
                        <Typography variant="caption" color="text.secondary">+{tools.length - 4}</Typography>
                      )}
                      {tools.length === 0 && (
                        <Typography variant="caption" color="text.secondary">tool未登録</Typography>
                      )}
                    </Box>
                  </CardContent>
                </CardActionArea>
              </Card>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

export default Project;
