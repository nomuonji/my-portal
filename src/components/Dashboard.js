import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import {
  Box,
  Typography,
  Grid,
  Paper,
  Chip
} from '@mui/material';
import { marked } from 'marked';

function Dashboard() {
  const [memos, setMemos] = useState([]);

  useEffect(() => {
    const q = query(collection(db, 'memos'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setMemos(snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })));
    });
    return () => unsubscribe();
  }, []);

  const getMemosByStatus = (status) => {
    return memos.filter(memo => memo.status === status);
  };

  const getMemosByEisenhower = (urgency, importance) => {
    return memos.filter(memo => memo.urgency === urgency && memo.importance === importance);
  };

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h4" gutterBottom>ダッシュボード</Typography>

      <Grid container spacing={3}>
        {/* GTD Inbox */}
        <Grid item xs={12} md={6} lg={4}>
          <Paper sx={{ p: 2, height: '100%', backgroundColor: '#f5f5f5' }}>
            <Typography variant="h5" gutterBottom>受信箱</Typography>
            {getMemosByStatus('inbox').map(memo => (
              <Paper key={memo.id} sx={{ p: 1.5, mb: 1, borderLeft: '4px solid #2196f3' }}>
                <Typography variant="body1" dangerouslySetInnerHTML={{ __html: marked.parse(memo.text) }} />
                {memo.tags && memo.tags.length > 0 && (
                  <Box sx={{ mt: 0.5 }}>
                    {memo.tags.map(tag => (
                      <Chip key={tag} label={`#${tag}`} size="small" sx={{ mr: 0.5 }} />
                    ))}
                  </Box>
                )}
              </Paper>
            ))}
          </Paper>
        </Grid>

        {/* Eisenhower Matrix */}
        <Grid item xs={12} md={6} lg={8}>
          <Grid container spacing={2}>
            {/* 緊急かつ重要 */}
            <Grid item xs={12} sm={6}>
              <Paper sx={{ p: 2, height: '100%', backgroundColor: '#ffebee' }}>
                <Typography variant="h6" gutterBottom>緊急かつ重要 (今すぐやる)</Typography>
                {getMemosByEisenhower('high', 'high').map(memo => (
                  <Paper key={memo.id} sx={{ p: 1.5, mb: 1, borderLeft: '4px solid #f44336' }}>
                    <Typography variant="body1" dangerouslySetInnerHTML={{ __html: marked.parse(memo.text) }} />
                    {memo.tags && memo.tags.length > 0 && (
                      <Box sx={{ mt: 0.5 }}>
                        {memo.tags.map(tag => (
                          <Chip key={tag} label={`#${tag}`} size="small" sx={{ mr: 0.5 }} />
                        ))}
                      </Box>
                    )}
                  </Paper>
                ))}
              </Paper>
            </Grid>

            {/* 緊急ではないが重要 */}
            <Grid item xs={12} sm={6}>
              <Paper sx={{ p: 2, height: '100%', backgroundColor: '#e8f5e9' }}>
                <Typography variant="h6" gutterBottom>緊急ではないが重要 (計画してやる)</Typography>
                {getMemosByEisenhower('low', 'high').map(memo => (
                  <Paper key={memo.id} sx={{ p: 1.5, mb: 1, borderLeft: '4px solid #4caf50' }}>
                    <Typography variant="body1" dangerouslySetInnerHTML={{ __html: marked.parse(memo.text) }} />
                    {memo.tags && memo.tags.length > 0 && (
                      <Box sx={{ mt: 0.5 }}>
                        {memo.tags.map(tag => (
                          <Chip key={tag} label={`#${tag}`} size="small" sx={{ mr: 0.5 }} />
                        ))}
                      </Box>
                    )}
                  </Paper>
                ))}
              </Paper>
            </Grid>

            {/* 緊急だが重要ではない */}
            <Grid item xs={12} sm={6}>
              <Paper sx={{ p: 2, height: '100%', backgroundColor: '#fffde7' }}>
                <Typography variant="h6" gutterBottom>緊急だが重要ではない (人に任せる)</Typography>
                {getMemosByEisenhower('high', 'low').map(memo => (
                  <Paper key={memo.id} sx={{ p: 1.5, mb: 1, borderLeft: '4px solid #ffeb3b' }}>
                    <Typography variant="body1" dangerouslySetInnerHTML={{ __html: marked.parse(memo.text) }} />
                    {memo.tags && memo.tags.length > 0 && (
                      <Box sx={{ mt: 0.5 }}>
                        {memo.tags.map(tag => (
                          <Chip key={tag} label={`#${tag}`} size="small" sx={{ mr: 0.5 }} />
                        ))}
                      </Box>
                    )}
                  </Paper>
                ))}
              </Paper>
            </Grid>

            {/* 緊急でも重要でもない */}
            <Grid item xs={12} sm={6}>
              <Paper sx={{ p: 2, height: '100%', backgroundColor: '#e0f2f7' }}>
                <Typography variant="h6" gutterBottom>緊急でも重要でもない (やらない)</Typography>
                {getMemosByEisenhower('low', 'low').map(memo => (
                  <Paper key={memo.id} sx={{ p: 1.5, mb: 1, borderLeft: '4px solid #03a9f4' }}>
                    <Typography variant="body1" dangerouslySetInnerHTML={{ __html: marked.parse(memo.text) }} />
                    {memo.tags && memo.tags.length > 0 && (
                      <Box sx={{ mt: 0.5 }}>
                        {memo.tags.map(tag => (
                          <Chip key={tag} label={`#${tag}`} size="small" sx={{ mr: 0.5 }} />
                        ))}
                      </Box>
                    )}
                  </Paper>
                ))}
              </Paper>
            </Grid>
          </Grid>
        </Grid>

        {/* GTD Next Actions, Projects, Someday/Maybe, Reference, Done */}
        <Grid item xs={12}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={4}>
              <Paper sx={{ p: 2, height: '100%', backgroundColor: '#e3f2fd' }}>
                <Typography variant="h6" gutterBottom>次の行動</Typography>
                {getMemosByStatus('next_action').map(memo => (
                  <Paper key={memo.id} sx={{ p: 1.5, mb: 1, borderLeft: '4px solid #2196f3' }}>
                    <Typography variant="body1" dangerouslySetInnerHTML={{ __html: marked.parse(memo.text) }} />
                  </Paper>
                ))}
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6} md={4}>
              <Paper sx={{ p: 2, height: '100%', backgroundColor: '#e8f5e9' }}>
                <Typography variant="h6" gutterBottom>プロジェクト</Typography>
                {getMemosByStatus('project').map(memo => (
                  <Paper key={memo.id} sx={{ p: 1.5, mb: 1, borderLeft: '4px solid #4caf50' }}>
                    <Typography variant="body1" dangerouslySetInnerHTML={{ __html: marked.parse(memo.text) }} />
                  </Paper>
                ))}
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6} md={4}>
              <Paper sx={{ p: 2, height: '100%', backgroundColor: '#fff3e0' }}>
                <Typography variant="h6" gutterBottom>いつかやる/多分やる</Typography>
                {getMemosByStatus('someday_maybe').map(memo => (
                  <Paper key={memo.id} sx={{ p: 1.5, mb: 1, borderLeft: '4px solid #ff9800' }}>
                    <Typography variant="body1" dangerouslySetInnerHTML={{ __html: marked.parse(memo.text) }} />
                  </Paper>
                ))}
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6} md={4}>
              <Paper sx={{ p: 2, height: '100%', backgroundColor: '#fce4ec' }}>
                <Typography variant="h6" gutterBottom>参照資料</Typography>
                {getMemosByStatus('reference').map(memo => (
                  <Paper key={memo.id} sx={{ p: 1.5, mb: 1, borderLeft: '4px solid #e91e63' }}>
                    <Typography variant="body1" dangerouslySetInnerHTML={{ __html: marked.parse(memo.text) }} />
                  </Paper>
                ))}
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6} md={4}>
              <Paper sx={{ p: 2, height: '100%', backgroundColor: '#eceff1' }}>
                <Typography variant="h6" gutterBottom>完了</Typography>
                {getMemosByStatus('done').map(memo => (
                  <Paper key={memo.id} sx={{ p: 1.5, mb: 1, borderLeft: '4px solid #9e9e9e' }}>
                    <Typography variant="body1" dangerouslySetInnerHTML={{ __html: marked.parse(memo.text) }} />
                  </Paper>
                ))}
              </Paper>
            </Grid>
          </Grid>
        </Grid>
      </Grid>
    </Box>
  );
}

export default Dashboard;
