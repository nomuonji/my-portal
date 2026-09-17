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
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  AddCircleOutline as AddCircleOutlineIcon,
  FolderOutlined as FolderOutlinedIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

const formatDate = (value) => {
  if (!value) return '';
  try {
    const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return '';
  }
};

function Project() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchText, setSearchText] = useState('');
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
    if (!keyword) return projects;
    return projects.filter((project) => [
      project.name,
      project.description,
      project.status,
      ...(project.tags || []),
    ].filter(Boolean).join(' ').toLowerCase().includes(keyword));
  }, [projects, searchText]);

  const border = isDark
    ? alpha(theme.palette.common.white, 0.09)
    : 'rgba(83, 124, 149, 0.16)';

  if (loading) {
    return (
      <Box sx={{ minHeight: 360, display: 'grid', placeItems: 'center' }}>
        <CircularProgress size={34} />
      </Box>
    );
  }

  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Box sx={{ minHeight: '100%', p: { xs: 0.25, sm: 0.75 } }}>
      <Paper
        elevation={0}
        sx={{
          mb: 1.5,
          p: { xs: 1.5, sm: 2 },
          border: `1px solid ${border}`,
          background: isDark ? alpha(theme.palette.background.paper, 0.82) : 'rgba(255,255,255,0.62)',
          backdropFilter: 'blur(18px) saturate(135%)',
        }}
      >
        <Box sx={{ display: 'flex', gap: 2, alignItems: { xs: 'flex-start', md: 'center' }, flexDirection: { xs: 'column', md: 'row' } }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 800, letterSpacing: '0.13em' }}>
              PROJECT SPACE
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="h4">プロジェクト</Typography>
              <Chip size="small" label={`${filteredProjects.length} / ${projects.length}`} sx={{ height: 23, fontSize: '0.66rem', fontWeight: 800 }} />
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.55, maxWidth: 720, lineHeight: 1.65 }}>
              継続して進めるテーマや制作物をまとめて、次に開くべき仕事がすぐ分かるようにします。
            </Typography>
          </Box>
          <Button variant="contained" startIcon={<AddCircleOutlineIcon />} onClick={() => navigate('/project/new')}>
            新しいプロジェクト
          </Button>
        </Box>
      </Paper>

      <Paper
        elevation={0}
        sx={{
          mb: 1.5,
          p: 1.25,
          border: `1px solid ${border}`,
          background: isDark ? alpha(theme.palette.background.paper, 0.7) : 'rgba(255,255,255,0.48)',
        }}
      >
        <TextField
          size="small"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="プロジェクトを検索"
          sx={{ width: { xs: '100%', sm: 360 } }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
      </Paper>

      {filteredProjects.length === 0 ? (
        <Paper
          elevation={0}
          sx={{ py: 8, px: 2, textAlign: 'center', border: `1px dashed ${border}`, background: 'transparent' }}
        >
          <FolderOutlinedIcon sx={{ fontSize: 36, color: 'text.secondary', opacity: 0.6 }} />
          <Typography variant="subtitle1" sx={{ mt: 1, fontWeight: 800 }}>
            {projects.length === 0 ? 'まだプロジェクトがありません' : '一致するプロジェクトがありません'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {projects.length === 0 ? '新しいプロジェクトを作成して、ここから育てていけます。' : '検索語を変えてみてください。'}
          </Typography>
        </Paper>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 285px), 1fr))',
            gap: 1.35,
          }}
        >
          {filteredProjects.map((project) => (
            <Card
              key={project.id}
              sx={{
                minHeight: 190,
                border: `1px solid ${border}`,
                background: isDark ? alpha(theme.palette.background.paper, 0.88) : 'rgba(255,255,255,0.84)',
                backdropFilter: 'blur(14px)',
                transition: 'transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease',
                '&:hover': {
                  transform: 'translateY(-2px)',
                  borderColor: alpha(theme.palette.primary.main, 0.35),
                  boxShadow: '0 12px 28px rgba(43, 82, 106, 0.12)',
                },
              }}
            >
              <CardActionArea onClick={() => navigate(`/project/details/${project.id}`)} sx={{ height: '100%' }}>
                <CardContent sx={{ p: 1.7, height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.15 }}>
                    <Box
                      sx={{
                        width: 32,
                        height: 32,
                        borderRadius: 2,
                        display: 'grid',
                        placeItems: 'center',
                        color: 'primary.main',
                        backgroundColor: alpha(theme.palette.primary.main, isDark ? 0.16 : 0.08),
                      }}
                    >
                      <FolderOutlinedIcon fontSize="small" />
                    </Box>
                    <Typography variant="h6" sx={{ fontSize: '1rem', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {project.name || '無題のプロジェクト'}
                    </Typography>
                  </Box>

                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{
                      lineHeight: 1.7,
                      display: '-webkit-box',
                      WebkitLineClamp: 4,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      flexGrow: 1,
                    }}
                  >
                    {project.description || '説明はまだありません。'}
                  </Typography>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, flexWrap: 'wrap', mt: 1.4 }}>
                    {project.status && <Chip size="small" label={project.status} sx={{ height: 21, fontSize: '0.6rem', fontWeight: 700 }} />}
                    {(project.tags || []).slice(0, 2).map((tag) => (
                      <Chip key={tag} size="small" variant="outlined" label={`#${tag}`} sx={{ height: 21, fontSize: '0.6rem' }} />
                    ))}
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', fontSize: '0.62rem' }}>
                      {formatDate(project.updatedAt || project.createdAt)}
                    </Typography>
                  </Box>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Box>
      )}
    </Box>
  );
}

export default Project;
