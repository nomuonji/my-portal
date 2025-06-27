import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp } from 'firebase/firestore';
import {
  Box,
  TextField,
  Button,
  Typography,
  List,
  ListItem,
  ListItemText,
  Paper,
  IconButton
} from '@mui/material';
import { Delete as DeleteIcon } from '@mui/icons-material';

function Memo() {
  const [memoText, setMemoText] = useState('');
  const [memos, setMemos] = useState([]);

  useEffect(() => {
    const q = query(collection(db, "memos"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setMemos(snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })));
    });
    return () => unsubscribe();
  }, []);

  const handleAddMemo = async () => {
    if (memoText.trim() === '') return;
    try {
      await addDoc(collection(db, "memos"), {
        text: memoText,
        createdAt: serverTimestamp()
      });
      setMemoText('');
    } catch (error) {
      console.error("メモの追加に失敗しました: ", error);
    }
  };

  const handleDeleteMemo = async (id) => {
    // TODO: Implement delete functionality
    console.log("Delete memo with ID:", id);
  };

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h4" gutterBottom>メモ</Typography>
      <Box sx={{ display: 'flex', mb: 2 }}>
        <TextField
          label="新しいメモ"
          variant="outlined"
          fullWidth
          multiline
          rows={4}
          value={memoText}
          onChange={(e) => setMemoText(e.target.value)}
        />
        <Button
          variant="contained"
          sx={{ ml: 2 }}
          onClick={handleAddMemo}
        >
          追加
        </Button>
      </Box>
      <List>
        {memos.map((memo) => (
          <Paper key={memo.id} sx={{ mb: 2, p: 2 }}>
            <ListItem
              secondaryAction={
                <IconButton edge="end" aria-label="delete" onClick={() => handleDeleteMemo(memo.id)}>
                  <DeleteIcon />
                </IconButton>
              }
            >
              <ListItemText
                primary={memo.text}
                secondary={memo.createdAt?.toDate().toLocaleString()}
              />
            </ListItem>
          </Paper>
        ))}
      </List>
    </Box>
  );
}

export default Memo;
