import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import {
  Typography,
  Box,
  CircularProgress,
  Alert,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Chip,
  Divider,
  Button
} from '@mui/material';
import { AddCircleOutline as AddCircleOutlineIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

function Project() {
  const [projects, setProjects] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const q = query(collection(db, 'memos'), where('status', '==', 'project'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const fetchedProjects = {};
        snapshot.forEach((doc) => {
          const memo = { id: doc.id, ...doc.data() };
          const projectName = memo.project_name || '未分類'; // Default to '未分類' if no project name
          if (!fetchedProjects[projectName]) {
            fetchedProjects[projectName] = [];
          }
          fetchedProjects[projectName].push(memo);
        });
        setProjects(fetchedProjects);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching projects:', err);
        setError('プロジェクトの読み込み中にエラーが発生しました。');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1">
          プロジェクト一覧
        </Typography>
        <Button
          variant="contained"
          color="primary"
          startIcon={<AddCircleOutlineIcon />}
          onClick={() => navigate('/memo?status=project')}
        >
          プロジェクト追加
        </Button>
      </Box>
      {Object.keys(projects).length === 0 ? (
        <Typography variant="body1">現在、進行中のプロジェクトはありません。</Typography>
      ) : (
        <Paper sx={{ p: 2 }}>
          <List>
            {Object.keys(projects).map((projectName) => (
              <React.Fragment key={projectName}>
                <ListItemButton onClick={() => navigate(`/projects/${encodeURIComponent(projectName)}`)}>
                  <ListItemText primary={projectName} />
                </ListItemButton>
                <Divider />
              </React.Fragment>
            ))}
          </List>
        </Paper>
      )}
    </Box>
  );
}

export default Project;