import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';

function ProjectDetails() {
  const { projectName: encodedProjectName } = useParams();
  const projectName = decodeURIComponent(encodedProjectName);
  const [memos, setMemos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const q = query(collection(db, 'memos'), where('project_name', '==', projectName));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const fetchedMemos = [];
        snapshot.forEach((doc) => {
          fetchedMemos.push({ id: doc.id, ...doc.data() });
        });
        setMemos(fetchedMemos);
        setLoading(false);
      },
      (err) => {
        console.error(`Error fetching memos for project ${projectName}:`, err);
        setError('メモの読み込み中にエラーが発生しました。');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [projectName]);

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
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/project')} sx={{ mb: 2 }}>
        プロジェクト一覧に戻る
      </Button>
      <Typography variant="h4" component="h1" gutterBottom>
        {projectName}
      </Typography>
      {memos.length === 0 ? (
        <Typography variant="body1">このプロジェクトにはまだメモがありません。</Typography>
      ) : (
        <Paper sx={{ p: 2 }}>
          <List>
            {memos.map((memo) => (
              <React.Fragment key={memo.id}>
                <ListItemButton onClick={() => navigate(`/memo/${memo.id}`)}>
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
                </ListItemButton>
                <Divider component="li" />
              </React.Fragment>
            ))}
          </List>
        </Paper>
      )}
    </Box>
  );
}

export default ProjectDetails;