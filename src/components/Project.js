import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import {
  Typography,
  Box,
  CircularProgress,
  Alert,
  Button,
  Grid,
  Card,
  CardContent,
  CardActionArea
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
        <Grid container spacing={3}>
          {projects.map((project) => (
            <Grid item xs={12} sm={6} md={4} key={project.id}>
              <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <CardActionArea onClick={() => navigate(`/project/details/${project.id}`)} sx={{ flexGrow: 1 }}>
                  <CardContent>
                    <Typography gutterBottom variant="h5" component="div">
                      {project.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{
                      display: '-webkit-box',
                      '-webkit-line-clamp': '3',
                      '-webkit-box-orient': 'vertical',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      minHeight: '4.5em', // 3 lines * 1.5em line-height
                    }}>
                      {project.description}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
}

export default Project;