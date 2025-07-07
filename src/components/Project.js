import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot } from 'firebase/firestore';
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
    const q = query(collection(db, 'projects'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const fetchedProjects = [];
        snapshot.forEach((doc) => {
          fetchedProjects.push({ id: doc.id, ...doc.data() });
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
          onClick={() => navigate('/project/new')}
        >
          新しいプロジェクト
        </Button>
      </Box>
      {projects.length === 0 ? (
        <Typography variant="body1">現在、進行中のプロジェクトはありません。</Typography>
      ) : (
        <Paper sx={{ p: 2 }}>
          <List>
            {projects.map((project) => (
              <React.Fragment key={project.id}>
                <ListItemButton onClick={() => navigate(`/project/details/${project.id}`)}>
                  <ListItemText primary={project.name} secondary={project.description} />
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