import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from '../documentDbClient';
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
  IconButton,
} from '@mui/material';
import { Launch as LaunchIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

function ReadingList() {
  const [readingListMemos, setReadingListMemos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const q = query(collection(db, 'memos'), where('status', '==', 'read_later'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const memos = [];
        snapshot.forEach((doc) => {
          memos.push({ id: doc.id, ...doc.data() });
        });
        setReadingListMemos(memos);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching reading list memos:', err);
        setError('「後で読む」リストの読み込み中にエラーが発生しました。');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const handleMemoClick = (memoId) => {
    navigate(`/memo/${memoId}`);
  };

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
        後で読む
      </Typography>
      {readingListMemos.length === 0 ? (
        <Typography variant="body1">「後で読む」に登録されたメモはありません。</Typography>
      ) : (
        <List>
          {readingListMemos.map((memo) => (
            <Paper key={memo.id} sx={{ mb: 2, p: 2 }}>
              <ListItem
                secondaryAction={
                  <IconButton edge="end" aria-label="edit" onClick={() => handleMemoClick(memo.id)}>
                    <LaunchIcon />
                  </IconButton>
                }
              >
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
                      {memo.project_name && (
                        <Chip label={`P: ${memo.project_name}`} size="small" sx={{ mr: 0.5, mb: 0.5 }} />
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
            </Paper>
          ))}
        </List>
      )}
    </Box>
  );
}

export default ReadingList;
