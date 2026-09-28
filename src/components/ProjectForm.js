import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import {
  collection,
  addDoc,
  serverTimestamp,
  updateDoc,
  doc,
  getDoc,
  deleteDoc,
} from '../documentDbClient';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Add as AddIcon,
  ArrowBack as ArrowBackIcon,
  Delete as DeleteIcon,
  FolderOutlined as FolderOutlinedIcon,
  GitHub as GitHubIcon,
  HubOutlined as HubOutlinedIcon,
  PsychologyAltOutlined as PsychologyAltOutlinedIcon,
  SellOutlined as SellOutlinedIcon,
} from '@mui/icons-material';

const blankRepo = () => ({ fullName: '', url: '', role: '' });
const blankTool = () => ({ name: '', purpose: '' });

function Section({ icon, title, description, children, border, surface }) {
  return (
    <Paper elevation={0} sx={{ p: { xs: 1.4, sm: 1.7 }, border: `1px solid ${border}`, background: surface }}>
      <Box sx={{ display: 'flex', gap: 0.9, alignItems: 'flex-start', mb: 1.35 }}>
        <Box sx={{ mt: 0.1, color: 'primary.main' }}>{icon}</Box>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>{title}</Typography>
          {description && <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.55 }}>{description}</Typography>}
        </Box>
      </Box>
      {children}
    </Paper>
  );
}

function ProjectForm() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectStatus, setProjectStatus] = useState('active');
  const [repositories, setRepositories] = useState([blankRepo()]);
  const [mcpTools, setMcpTools] = useState([blankTool()]);
  const [tagsText, setTagsText] = useState('');
  const [spaceIdsText, setSpaceIdsText] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchProject = async () => {
      if (!projectId) return;
      try {
        const docSnap = await getDoc(doc(db, 'projects', projectId));
        if (!docSnap.exists()) {
          navigate('/project');
          return;
        }
        const data = docSnap.data();
        setProjectName(data.name || '');
        setProjectDescription(data.description || '');
        setProjectStatus(data.status || 'active');
        setRepositories((data.repositories?.length ? data.repositories : [blankRepo()]).map((item) => ({
          fullName: item.fullName || '',
          url: item.url || '',
          role: item.role || '',
        })));
        setMcpTools((data.mcpTools?.length ? data.mcpTools : [blankTool()]).map((item) => ({
          name: item.name || '',
          purpose: item.purpose || '',
        })));
        setTagsText((data.tags || []).join(', '));
        setSpaceIdsText((data.spaceIds || []).join(', '));
      } catch (fetchError) {
        console.error('Error fetching project:', fetchError);
        setError('プロジェクトの読み込みに失敗しました。');
      }
    };
    fetchProject();
  }, [projectId, navigate]);

  const border = isDark
    ? alpha(theme.palette.common.white, 0.09)
    : 'rgba(83, 124, 149, 0.16)';
  const surface = isDark
    ? alpha(theme.palette.background.paper, 0.86)
    : 'rgba(255,255,255,0.82)';

  const updateRepo = (index, field, value) => {
    setRepositories((items) => items.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )));
  };

  const updateTool = (index, field, value) => {
    setMcpTools((items) => items.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )));
  };

  const handleSaveProject = async () => {
    if (!projectName.trim()) {
      setError('プロジェクト名は必須です。');
      return;
    }

    const normalizedRepositories = repositories
      .map((item) => ({
        fullName: item.fullName.trim(),
        url: item.url.trim(),
        role: item.role.trim(),
      }))
      .filter((item) => item.fullName || item.url);

    const normalizedTools = mcpTools
      .map((item) => ({ name: item.name.trim(), purpose: item.purpose.trim() }))
      .filter((item) => item.name);

    const projectData = {
      name: projectName.trim(),
      description: projectDescription.trim(),
      status: projectStatus,
      repositories: normalizedRepositories,
      mcpTools: normalizedTools,
      tags: [...new Set(tagsText.split(',').map((item) => item.trim()).filter(Boolean))],
      spaceIds: [...new Set(spaceIdsText.split(',').map((item) => item.trim()).filter(Boolean))],
      projectType: 'implementation_workspace',
      schemaVersion: 2,
      updatedAt: serverTimestamp(),
    };

    try {
      setError('');
      if (projectId) {
        await updateDoc(doc(db, 'projects', projectId), projectData);
      } else {
        await addDoc(collection(db, 'projects'), {
          ...projectData,
          createdAt: serverTimestamp(),
        });
      }
      navigate(projectId ? `/project/details/${projectId}` : '/project');
    } catch (saveError) {
      console.error('Failed to save project:', saveError);
      setError('プロジェクトの保存に失敗しました。');
    }
  };

  const handleDeleteProject = async () => {
    if (!projectId || !window.confirm('このProjectを削除しますか？')) return;
    try {
      await deleteDoc(doc(db, 'projects', projectId));
      navigate('/project');
    } catch (deleteError) {
      console.error('Failed to delete project:', deleteError);
      setError('プロジェクトの削除に失敗しました。');
    }
  };

  return (
    <Box sx={{ maxWidth: 1080, mx: 'auto', p: { xs: 0.6, sm: 1, md: 1.5 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(projectId ? `/project/details/${projectId}` : '/project')}>
          {projectId ? 'Project詳細' : 'Projects'}
        </Button>
      </Box>

      <Paper
        elevation={0}
        sx={{
          p: { xs: 1.6, md: 2.1 },
          mb: 1.2,
          border: `1px solid ${border}`,
          background: surface,
          backdropFilter: 'blur(18px) saturate(135%)',
        }}
      >
        <Box sx={{ display: 'flex', gap: 1.2, alignItems: 'flex-start' }}>
          <Box
            sx={{
              width: 42,
              height: 42,
              borderRadius: 2.2,
              display: 'grid',
              placeItems: 'center',
              bgcolor: alpha(theme.palette.primary.main, isDark ? 0.16 : 0.08),
              color: 'primary.main',
              flexShrink: 0,
            }}
          >
            <FolderOutlinedIcon />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 900, letterSpacing: '0.13em' }}>
              IMPLEMENTATION WORKSPACE
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: '-0.035em' }}>
              {projectId ? 'Projectを編集' : '新しいProject'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 760, lineHeight: 1.65 }}>
              Projectはアイデア置き場ではなく、実際に動いている開発・運用単位です。repoと接続toolを中心に登録し、必要な場合だけ長期テーマを関連付けます。
            </Typography>
          </Box>
          {projectId && (
            <IconButton onClick={handleDeleteProject} color="error" aria-label="Projectを削除">
              <DeleteIcon />
            </IconButton>
          )}
        </Box>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 1.2 }}>{error}</Alert>}

      <Stack spacing={1.2}>
        <Section
          icon={<FolderOutlinedIcon fontSize="small" />}
          title="基本情報"
          description="このProjectが何を実装・運用する単位なのかを短く定義します。"
          border={border}
          surface={surface}
        >
          <Stack spacing={1.2}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 190px' }, gap: 1 }}>
              <TextField
                label="Project名"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                fullWidth
                autoFocus={!projectId}
              />
              <FormControl fullWidth>
                <InputLabel id="project-status-label">ステータス</InputLabel>
                <Select
                  labelId="project-status-label"
                  value={projectStatus}
                  label="ステータス"
                  onChange={(event) => setProjectStatus(event.target.value)}
                >
                  <MenuItem value="active">進行中</MenuItem>
                  <MenuItem value="paused">一時停止</MenuItem>
                  <MenuItem value="completed">完了</MenuItem>
                  <MenuItem value="archived">アーカイブ</MenuItem>
                </Select>
              </FormControl>
            </Box>
            <TextField
              label="目的 / スコープ"
              value={projectDescription}
              onChange={(event) => setProjectDescription(event.target.value)}
              fullWidth
              multiline
              minRows={4}
              placeholder="何をまとめるProjectなのか、何を含み・何を含まないか"
            />
          </Stack>
        </Section>

        <Section
          icon={<GitHubIcon fontSize="small" />}
          title="Repositories"
          description="Projectの実装資産。単一repoでも、複数repoを束ねる上位Projectでも構いません。"
          border={border}
          surface={surface}
        >
          <Stack spacing={0.85}>
            {repositories.map((item, index) => (
              <Paper key={index} elevation={0} sx={{ p: 1, border: `1px solid ${border}`, background: 'transparent' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mb: 0.75 }}>
                  <Chip size="small" label={`repo ${index + 1}`} sx={{ height: 21, fontSize: '0.58rem', fontWeight: 900 }} />
                  <IconButton
                    aria-label="repositoryを削除"
                    size="small"
                    onClick={() => setRepositories((items) => items.filter((_, itemIndex) => itemIndex !== index))}
                    sx={{ ml: 'auto' }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1.15fr 1fr' }, gap: 0.8 }}>
                  <TextField size="small" label="owner/repo" placeholder="nomuonji/my-portal" value={item.fullName} onChange={(event) => updateRepo(index, 'fullName', event.target.value)} />
                  <TextField size="small" label="GitHub URL" value={item.url} onChange={(event) => updateRepo(index, 'url', event.target.value)} />
                  <TextField size="small" label="役割" placeholder="core / managed site / infra..." value={item.role} onChange={(event) => updateRepo(index, 'role', event.target.value)} />
                </Box>
              </Paper>
            ))}
            <Button startIcon={<AddIcon />} onClick={() => setRepositories((items) => [...items, blankRepo()])} sx={{ alignSelf: 'flex-start' }}>
              repoを追加
            </Button>
          </Stack>
        </Section>

        <Section
          icon={<HubOutlinedIcon fontSize="small" />}
          title="Connected tools"
          description="このProjectを進めるとき、Agentが利用するMCP / connector / deploy toolと役割。"
          border={border}
          surface={surface}
        >
          <Stack spacing={0.85}>
            {mcpTools.map((item, index) => (
              <Paper key={index} elevation={0} sx={{ p: 1, border: `1px solid ${border}`, background: 'transparent' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mb: 0.75 }}>
                  <Chip size="small" label={`tool ${index + 1}`} sx={{ height: 21, fontSize: '0.58rem', fontWeight: 900 }} />
                  <IconButton
                    aria-label="toolを削除"
                    size="small"
                    onClick={() => setMcpTools((items) => items.filter((_, itemIndex) => itemIndex !== index))}
                    sx={{ ml: 'auto' }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '0.9fr 2fr' }, gap: 0.8 }}>
                  <TextField size="small" label="MCP / tool" placeholder="GitHub / My Portal / Tweets Operator..." value={item.name} onChange={(event) => updateTool(index, 'name', event.target.value)} />
                  <TextField size="small" label="用途" placeholder="このProjectで何に使うか" value={item.purpose} onChange={(event) => updateTool(index, 'purpose', event.target.value)} />
                </Box>
              </Paper>
            ))}
            <Button startIcon={<AddIcon />} onClick={() => setMcpTools((items) => [...items, blankTool()])} sx={{ alignSelf: 'flex-start' }}>
              toolを追加
            </Button>
          </Stack>
        </Section>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.2 }}>
          <Section
            icon={<PsychologyAltOutlinedIcon fontSize="small" />}
            title="関連する長期テーマ"
            description="実装の背景にある長期テーマがある場合だけ関連付けます。Agent HQには常時表示しません。"
            border={border}
            surface={surface}
          >
            <TextField
              label="長期テーマ IDs"
              value={spaceIdsText}
              onChange={(event) => setSpaceIdsText(event.target.value)}
              helperText="カンマ区切り。空でも問題ありません。"
              fullWidth
            />
          </Section>

          <Section
            icon={<SellOutlinedIcon fontSize="small" />}
            title="Tags"
            description="検索・分類用。Projectの構造そのものはrepo / toolで表現します。"
            border={border}
            surface={surface}
          >
            <TextField
              label="タグ"
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              helperText="カンマ区切り"
              fullWidth
            />
          </Section>
        </Box>
      </Stack>

      <Paper
        elevation={0}
        sx={{
          position: 'sticky',
          bottom: 8,
          mt: 1.4,
          p: 1,
          border: `1px solid ${border}`,
          background: isDark ? alpha(theme.palette.background.paper, 0.94) : 'rgba(255,255,255,0.94)',
          backdropFilter: 'blur(16px)',
          zIndex: 2,
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.8 }}>
          <Button variant="outlined" onClick={() => navigate(projectId ? `/project/details/${projectId}` : '/project')}>
            キャンセル
          </Button>
          <Button variant="contained" onClick={handleSaveProject}>
            {projectId ? '変更を保存' : 'Projectを作成'}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}

export default ProjectForm;
