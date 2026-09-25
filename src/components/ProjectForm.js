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
} from 'firebase/firestore';
import {
  Alert,
  Box,
  Button,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  ArrowBack as ArrowBackIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';

const blankRepo = () => ({ fullName: '', url: '', role: '' });
const blankTool = () => ({ name: '', purpose: '' });

function ProjectForm() {
  const { projectId } = useParams();
  const navigate = useNavigate();

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
      navigate('/project');
    } catch (saveError) {
      console.error('Failed to save project:', saveError);
      setError('プロジェクトの保存に失敗しました。');
    }
  };

  const handleDeleteProject = async () => {
    if (!projectId || !window.confirm('このプロジェクトを削除しますか？')) return;
    try {
      await deleteDoc(doc(db, 'projects', projectId));
      navigate('/project');
    } catch (deleteError) {
      console.error('Failed to delete project:', deleteError);
      setError('プロジェクトの削除に失敗しました。');
    }
  };

  return (
    <Paper sx={{ p: { xs: 2, sm: 3 }, maxWidth: 960, mx: 'auto' }} elevation={0}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <IconButton onClick={() => navigate('/project')} sx={{ mr: 1 }}>
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ flex: 1 }}>
          <Typography variant="overline" color="text.secondary">IMPLEMENTATION WORKSPACE</Typography>
          <Typography variant="h4" sx={{ fontWeight: 900 }}>
            {projectId ? 'プロジェクトを編集' : '新しいプロジェクト'}
          </Typography>
        </Box>
        {projectId && (
          <IconButton onClick={handleDeleteProject} color="error">
            <DeleteIcon />
          </IconButton>
        )}
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5, lineHeight: 1.7 }}>
        Projectはアイデア置き場ではなく、1つ以上のGitHub repo・MCP・Space・Work Itemを束ねる実装単位です。
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Stack spacing={2.2}>
        <TextField label="プロジェクト名" value={projectName} onChange={(e) => setProjectName(e.target.value)} fullWidth />
        <TextField
          label="目的 / スコープ"
          value={projectDescription}
          onChange={(e) => setProjectDescription(e.target.value)}
          fullWidth
          multiline
          minRows={4}
          placeholder="何をまとめるProjectなのか、境界や目的を書く"
        />

        <FormControl fullWidth>
          <InputLabel id="project-status-label">ステータス</InputLabel>
          <Select labelId="project-status-label" value={projectStatus} label="ステータス" onChange={(e) => setProjectStatus(e.target.value)}>
            <MenuItem value="active">進行中</MenuItem>
            <MenuItem value="paused">一時停止</MenuItem>
            <MenuItem value="completed">完了</MenuItem>
            <MenuItem value="archived">アーカイブ</MenuItem>
          </Select>
        </FormControl>

        <Divider />

        <Box>
          <Typography variant="h6" sx={{ fontWeight: 900, mb: 0.5 }}>GitHub repositories</Typography>
          <Typography variant="caption" color="text.secondary">
            単一repoでも複数repoでも可。Projectを開けば実装対象が分かる状態にします。
          </Typography>
          <Stack spacing={1.2} sx={{ mt: 1.2 }}>
            {repositories.map((item, index) => (
              <Box key={index} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1.25fr 1fr auto' }, gap: 1 }}>
                <TextField size="small" label="owner/repo" value={item.fullName} onChange={(e) => updateRepo(index, 'fullName', e.target.value)} />
                <TextField size="small" label="GitHub URL" value={item.url} onChange={(e) => updateRepo(index, 'url', e.target.value)} />
                <TextField size="small" label="役割" placeholder="frontend / operator / infra..." value={item.role} onChange={(e) => updateRepo(index, 'role', e.target.value)} />
                <IconButton aria-label="repositoryを削除" onClick={() => setRepositories((items) => items.filter((_, i) => i !== index))}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
            <Button startIcon={<AddIcon />} onClick={() => setRepositories((items) => [...items, blankRepo()])} sx={{ alignSelf: 'flex-start' }}>
              repoを追加
            </Button>
          </Stack>
        </Box>

        <Divider />

        <Box>
          <Typography variant="h6" sx={{ fontWeight: 900, mb: 0.5 }}>Related MCP tools</Typography>
          <Typography variant="caption" color="text.secondary">
            このProjectを進めるときに使うMCP/connector/tool名と用途を保存します。
          </Typography>
          <Stack spacing={1.2} sx={{ mt: 1.2 }}>
            {mcpTools.map((item, index) => (
              <Box key={index} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '0.9fr 2fr auto' }, gap: 1 }}>
                <TextField size="small" label="MCP / tool" placeholder="GitHub / my_portal / Tweets Operator..." value={item.name} onChange={(e) => updateTool(index, 'name', e.target.value)} />
                <TextField size="small" label="用途" value={item.purpose} onChange={(e) => updateTool(index, 'purpose', e.target.value)} />
                <IconButton aria-label="MCP toolを削除" onClick={() => setMcpTools((items) => items.filter((_, i) => i !== index))}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
            <Button startIcon={<AddIcon />} onClick={() => setMcpTools((items) => [...items, blankTool()])} sx={{ alignSelf: 'flex-start' }}>
              MCP toolを追加
            </Button>
          </Stack>
        </Box>

        <Divider />

        <TextField
          label="関連Space IDs"
          value={spaceIdsText}
          onChange={(e) => setSpaceIdsText(e.target.value)}
          helperText="カンマ区切り。長期的な思考テーマをProjectへ関連付けたい場合のみ。"
          fullWidth
        />
        <TextField
          label="タグ"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          helperText="カンマ区切り"
          fullWidth
        />
      </Stack>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 3 }}>
        <Button variant="outlined" onClick={() => navigate('/project')}>キャンセル</Button>
        <Button variant="contained" onClick={handleSaveProject}>{projectId ? '更新' : '作成'}</Button>
      </Box>
    </Paper>
  );
}

export default ProjectForm;
