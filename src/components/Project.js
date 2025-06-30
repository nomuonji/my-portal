import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import {
  Typography,
  Box,
  CircularProgress,
  Alert,
  List,
  ListItem,
  ListItemText,
  Paper,
  Chip,
  Divider,
} from '@mui/material';

function Project() {
  const [projects, setProjects] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
      <Typography variant="h4" component="h1" gutterBottom>
        プロジェクト一覧
      </Typography>
      {Object.keys(projects).length === 0 ? (
        <Typography variant="body1">現在、進行中のプロジェクトはありません。</Typography>
      ) : (
        Object.keys(projects).map((projectName) => (
          <Paper key={projectName} sx={{ mb: 4, p: 3 }}>
            <Typography variant="h5" component="h2" gutterBottom>
              {projectName}
            </Typography>
            <List>
              {projects[projectName].map((memo) => (
                <React.Fragment key={memo.id}>
                  <ListItem alignItems="flex-start">
                    <ListItemText
                      primary={memo.text}
                      secondary={
                        <Box sx={{ mt: 1 }}>
                          {memo.tags && memo.tags.map((tag) => (
                            <Chip key={tag} label={`#${tag}`} size="small" sx={{ mr: 0.5, mb: 0.5 }} />
                          ))}
                          {memo.context && (
                            <Chip label={`@${memo.context}`} size="small" sx={{ mr: 0.5, mb: 0.5 }} />
                          )}
                          {memo.urgency && (
                            <Chip label={`緊急度: ${memo.urgency}`} size="small" sx={{ mr: 0.5, mb: 0.5 }} />
                          )}
                          {memo.importance && (
                            <Chip label={`重要度: ${memo.importance}`} size="small" sx={{ mr: 0.5, mb: 0.5 }} />
                          )}
                        </Box>
                      }
                    />
                  </ListItem>
                  <Divider component="li" />
                </React.Fragment>
              ))}
            </List>
          </Paper>
        ))
      )}
    </Box>
  );
}

export default Project;