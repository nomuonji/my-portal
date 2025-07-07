import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import {
  collection,
  addDoc,
  serverTimestamp,
  updateDoc,
  doc,
  getDoc,
  deleteDoc
} from 'firebase/firestore';
import {
  Box,
  TextField,
  Button,
  Typography,
  Paper,
  IconButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem
} from '@mui/material';
import { ArrowBack as ArrowBackIcon, Delete as DeleteIcon } from '@mui/icons-material';

function ProjectForm() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectStatus, setProjectStatus] = useState('active'); // New field for project status

  useEffect(() => {
    const fetchProject = async () => {
      if (projectId) {
        try {
          const docRef = doc(db, 'projects', projectId);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const projectData = docSnap.data();
            setProjectName(projectData.name || '');
            setProjectDescription(projectData.description || '');
            setProjectStatus(projectData.status || 'active');
          } else {
            console.log("No such project document!");
            navigate('/project'); // Project doesn't exist, go back to project list
          }
        } catch (error) {
          console.error("Error fetching project:", error);
        }
      }
    };
    fetchProject();
  }, [projectId, navigate]);

  const handleSaveProject = async () => {
    if (projectName.trim() === '') return;

    const projectData = {
      name: projectName,
      description: projectDescription,
      status: projectStatus,
      ideaIds: [], // Initialize with an empty array for new projects
      updatedAt: serverTimestamp(),
    };

    try {
      if (projectId) {
        await updateDoc(doc(db, 'projects', projectId), projectData);
        console.log('プロジェクトを更新しました:', projectId);
      } else {
        const docRef = await addDoc(collection(db, 'projects'), {
          ...projectData,
          createdAt: serverTimestamp(),
        });
        console.log('新しいプロジェクトを追加しました:', docRef.id);
      }
      navigate('/project'); // Save and go back to project list
    } catch (error) {
      console.error('プロジェクトの保存に失敗しました:', error);
    }
  };

  const handleDeleteProject = async () => {
    if (!projectId) return;
    try {
      await deleteDoc(doc(db, 'projects', projectId));
      console.log('プロジェクトを削除しました:', projectId);
      navigate('/project'); // Delete and go back to project list
    } catch (error) {
      console.error('プロジェクトの削除に失敗しました:', error);
    }
  };

  return (
    <Paper sx={{ p: { xs: 2, sm: 3 }, m: { xs: 1, sm: 'auto' }, maxWidth: 800, mx: 'auto' }} elevation={3}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <IconButton onClick={() => navigate('/project')} sx={{ mr: 1 }}>
            <ArrowBackIcon />
        </IconButton>
        <Typography variant="h4" component="h1" sx={{ flexGrow: 1, mb: 0, fontWeight: 'bold', color: 'primary.main' }}>
          {projectId ? "プロジェクトを編集" : "新しいプロジェクト"}
        </Typography>
        {projectId && (
            <IconButton onClick={handleDeleteProject} color="error">
                <DeleteIcon />
            </IconButton>
        )}
      </Box>
      
      <Box sx={{ mb: 3 }}>
        <TextField
          label="プロジェクト名"
          variant="outlined"
          fullWidth
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          sx={{ mb: 2 }}
        />
        <TextField
          label="プロジェクト説明"
          variant="outlined"
          fullWidth
          multiline
          rows={4}
          value={projectDescription}
          onChange={(e) => setProjectDescription(e.target.value)}
          sx={{ mb: 2 }}
        />
        <FormControl fullWidth>
          <InputLabel id="project-status-label">ステータス</InputLabel>
          <Select
            labelId="project-status-label"
            value={projectStatus}
            label="ステータス"
            onChange={(e) => setProjectStatus(e.target.value)}
          >
            <MenuItem value="active">進行中</MenuItem>
            <MenuItem value="completed">完了</MenuItem>
            <MenuItem value="on_hold">保留</MenuItem>
            <MenuItem value="archived">アーカイブ済み</MenuItem>
          </Select>
        </FormControl>
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
          <Button
            variant="outlined"
            onClick={() => navigate('/project')}
          >
            キャンセル
          </Button>
          <Button
            variant="contained"
            onClick={handleSaveProject}
          >
            {projectId ? "更新" : "追加"}
          </Button>
      </Box>
    </Paper>
  );
}

export default ProjectForm;
