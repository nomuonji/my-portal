import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, orderBy, onSnapshot, updateDoc, doc } from 'firebase/firestore';
import {
  Box,
  Typography,
  Grid,
  Paper,
  Chip
} from '@mui/material';
import { marked } from 'marked';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

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

  const onDragEnd = async (result) => {
    const { source, destination, draggableId } = result;

    // ドロップ先がない場合
    if (!destination) {
      return;
    }

    // 同じ場所へのドロップの場合
    if (source.droppableId === destination.droppableId && source.index === destination.index) {
      return;
    }

    const draggedMemo = memos.find(memo => memo.id === draggableId);
    if (!draggedMemo) return;

    let updatedMemoData = { ...draggedMemo };

    // GTDステータスの変更
    if (destination.droppableId.startsWith('gtd-')) {
      updatedMemoData.status = destination.droppableId.replace('gtd-', '');
    }
    // アイゼンハワーマトリクスの変更
    else if (destination.droppableId.startsWith('eisenhower-')) {
      const [urgency, importance] = destination.droppableId.replace('eisenhower-', '').split('-');
      updatedMemoData.urgency = urgency;
      updatedMemoData.importance = importance;
    }

    try {
      await updateDoc(doc(db, 'memos', draggableId), updatedMemoData);
      console.log('メモを更新しました:', draggableId, updatedMemoData);
    } catch (error) {
      console.error('メモの更新に失敗しました:', error);
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h4" gutterBottom>ダッシュボード</Typography>
      <DragDropContext onDragEnd={onDragEnd}>
        <Grid container spacing={3}>
          {/* GTD Inbox */}
          <Grid item xs={12} md={6} lg={4}>
            <Droppable droppableId="gtd-inbox">
              {(provided) => (
                <Paper
                  sx={{ p: 2, height: '100%', backgroundColor: '#f5f5f5' }}
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                >
                  <Typography variant="h5" gutterBottom>受信箱</Typography>
                  {getMemosByStatus('inbox').map((memo, index) => (
                    <Draggable key={memo.id} draggableId={memo.id} index={index}>
                      {(provided) => (
                        <Paper
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                          sx={{ p: 1.5, mb: 1, borderLeft: '4px solid #2196f3' }}
                        >
                          <Typography variant="body1" dangerouslySetInnerHTML={{ __html: marked.parse(memo.text) }} />
                          {memo.tags && memo.tags.length > 0 && (
                            <Box sx={{ mt: 0.5 }}>
                              {memo.tags.map(tag => (
                                <Chip key={tag} label={`#${tag}`} size="small" sx={{ mr: 0.5 }} />
                              ))}
                            </Box>
                          )}
                        </Paper>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </Paper>
              )}
            </Droppable>
          </Grid>

          {/* Eisenhower Matrix */}
          <Grid item xs={12} md={6} lg={8}>
            <Grid container spacing={2}>
              {/* 緊急かつ重要 */}
              <Grid item xs={12} sm={6}>
                <Droppable droppableId="eisenhower-high-high">
                  {(provided) => (
                    <Paper
                      sx={{ p: 2, height: '100%', backgroundColor: '#ffebee' }}
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                    >
                      <Typography variant="h6" gutterBottom>緊急かつ重要 (今すぐやる)</Typography>
                      {getMemosByEisenhower('high', 'high').map((memo, index) => (
                        <Draggable key={memo.id} draggableId={memo.id} index={index}>
                          {(provided) => (
                            <Paper
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              sx={{ p: 1.5, mb: 1, borderLeft: '4px solid #f44336' }}
                            >
                              <Typography variant="body1" dangerouslySetInnerHTML={{ __html: marked.parse(memo.text) }} />
                              {memo.tags && memo.tags.length > 0 && (
                                <Box sx={{ mt: 0.5 }}>
                                  {memo.tags.map(tag => (
                                    <Chip key={tag} label={`#${tag}`} size="small" sx={{ mr: 0.5 }} />
                                  ))}
                                </Box>
                              )}
                            </Paper>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </Paper>
                  )}
                </Droppable>
              </Grid>

              {/* 緊急ではないが重要 */}
              <Grid item xs={12} sm={6}>
                <Droppable droppableId="eisenhower-low-high">
                  {(provided) => (
                    <Paper
                      sx={{ p: 2, height: '100%', backgroundColor: '#e8f5e9' }}
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                    >
                      <Typography variant="h6" gutterBottom>緊急ではないが重要 (計画してやる)</Typography>
                      {getMemosByEisenhower('low', 'high').map((memo, index) => (
                        <Draggable key={memo.id} draggableId={memo.id} index={index}>
                          {(provided) => (
                            <Paper
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              sx={{ p: 1.5, mb: 1, borderLeft: '4px solid #4caf50' }}
                            >
                              <Typography variant="body1" dangerouslySetInnerHTML={{ __html: marked.parse(memo.text) }} />
                              {memo.tags && memo.tags.length > 0 && (
                                <Box sx={{ mt: 0.5 }}>
                                  {memo.tags.map(tag => (
                                    <Chip key={tag} label={`#${tag}`} size="small" sx={{ mr: 0.5 }} />
                                  ))}
                                </Box>
                              )}
                            </Paper>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </Paper>
                  )}
                </Droppable>
              </Grid>

              {/* 緊急だが重要ではない */}
              <Grid item xs={12} sm={6}>
                <Droppable droppableId="eisenhower-high-low">
                  {(provided) => (
                    <Paper
                      sx={{ p: 2, height: '100%', backgroundColor: '#fffde7' }}
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                    >
                      <Typography variant="h6" gutterBottom>緊急だが重要ではない (人に任せる)</Typography>
                      {getMemosByEisenhower('high', 'low').map((memo, index) => (
                        <Draggable key={memo.id} draggableId={memo.id} index={index}>
                          {(provided) => (
                            <Paper
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              sx={{ p: 1.5, mb: 1, borderLeft: '4px solid #ffeb3b' }}
                            >
                              <Typography variant="body1" dangerouslySetInnerHTML={{ __html: marked.parse(memo.text) }} />
                              {memo.tags && memo.tags.length > 0 && (
                                <Box sx={{ mt: 0.5 }}>
                                  {memo.tags.map(tag => (
                                    <Chip key={tag} label={`#${tag}`} size="small" sx={{ mr: 0.5 }} />
                                  ))}
                                </Box>
                              )}
                            </Paper>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </Paper>
                  )}
                </Droppable>
              </Grid>

              {/* 緊急でも重要でもない */}
              <Grid item xs={12} sm={6}>
                <Droppable droppableId="eisenhower-low-low">
                  {(provided) => (
                    <Paper
                      sx={{ p: 2, height: '100%', backgroundColor: '#e0f2f7' }}
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                    >
                      <Typography variant="h6" gutterBottom>緊急でも重要でもない (やらない)</Typography>
                      {getMemosByEisenhower('low', 'low').map((memo, index) => (
                        <Draggable key={memo.id} draggableId={memo.id} index={index}>
                          {(provided) => (
                            <Paper
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              sx={{ p: 1.5, mb: 1, borderLeft: '4px solid #03a9f4' }}
                            >
                              <Typography variant="body1" dangerouslySetInnerHTML={{ __html: marked.parse(memo.text) }} />
                              {memo.tags && memo.tags.length > 0 && (
                                <Box sx={{ mt: 0.5 }}>
                                  {memo.tags.map(tag => (
                                    <Chip key={tag} label={`#${tag}`} size="small" sx={{ mr: 0.5 }} />
                                  ))}
                                </Box>
                              )}
                            </Paper>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </Paper>
                  )}
                </Droppable>
              </Grid>
            </Grid>
          </Grid>

          {/* GTD Next Actions, Projects, Someday/Maybe, Reference, Done */}
          <Grid item xs={12}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6} md={4}>
                <Droppable droppableId="gtd-next_action">
                  {(provided) => (
                    <Paper
                      sx={{ p: 2, height: '100%', backgroundColor: '#e3f2fd' }}
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                    >
                      <Typography variant="h6" gutterBottom>次の行動</Typography>
                      {getMemosByStatus('next_action').map((memo, index) => (
                        <Draggable key={memo.id} draggableId={memo.id} index={index}>
                          {(provided) => (
                            <Paper
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              sx={{ p: 1.5, mb: 1, borderLeft: '4px solid #2196f3' }}
                            >
                              <Typography variant="body1" dangerouslySetInnerHTML={{ __html: marked.parse(memo.text) }} />
                            </Paper>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </Paper>
                  )}
                </Droppable>
              </Grid>
              <Grid item xs={12} sm={6} md={4}>
                <Droppable droppableId="gtd-project">
                  {(provided) => (
                    <Paper
                      sx={{ p: 2, height: '100%', backgroundColor: '#e8f5e9' }}
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                    >
                      <Typography variant="h6" gutterBottom>プロジェクト</Typography>
                      {getMemosByStatus('project').map((memo, index) => (
                        <Draggable key={memo.id} draggableId={memo.id} index={index}>
                          {(provided) => (
                            <Paper
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              sx={{ p: 1.5, mb: 1, borderLeft: '4px solid #4caf50' }}
                            >
                              <Typography variant="body1" dangerouslySetInnerHTML={{ __html: marked.parse(memo.text) }} />
                            </Paper>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </Paper>
                  )}
                </Droppable>
              </Grid>
              <Grid item xs={12} sm={6} md={4}>
                <Droppable droppableId="gtd-someday_maybe">
                  {(provided) => (
                    <Paper
                      sx={{ p: 2, height: '100%', backgroundColor: '#fff3e0' }}
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                    >
                      <Typography variant="h6" gutterBottom>いつかやる/多分やる</Typography>
                      {getMemosByStatus('someday_maybe').map((memo, index) => (
                        <Draggable key={memo.id} draggableId={memo.id} index={index}>
                          {(provided) => (
                            <Paper
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              sx={{ p: 1.5, mb: 1, borderLeft: '4px solid #ff9800' }}
                            >
                              <Typography variant="body1" dangerouslySetInnerHTML={{ __html: marked.parse(memo.text) }} />
                            </Paper>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </Paper>
                  )}
                </Droppable>
              </Grid>
              <Grid item xs={12} sm={6} md={4}>
                <Droppable droppableId="gtd-reference">
                  {(provided) => (
                    <Paper
                      sx={{ p: 2, height: '100%', backgroundColor: '#fce4ec' }}
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                    >
                      <Typography variant="h6" gutterBottom>参照資料</Typography>
                      {getMemosByStatus('reference').map((memo, index) => (
                        <Draggable key={memo.id} draggableId={memo.id} index={index}>
                          {(provided) => (
                            <Paper
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              sx={{ p: 1.5, mb: 1, borderLeft: '4px solid #e91e63' }}
                            >
                              <Typography variant="body1" dangerouslySetInnerHTML={{ __html: marked.parse(memo.text) }} />
                            </Paper>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </Paper>
                  )}
                </Droppable>
              </Grid>
              <Grid item xs={12} sm={6} md={4}>
                <Droppable droppableId="gtd-done">
                  {(provided) => (
                    <Paper
                      sx={{ p: 2, height: '100%', backgroundColor: '#eceff1' }}
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                    >
                      <Typography variant="h6" gutterBottom>完了</Typography>
                      {getMemosByStatus('done').map((memo, index) => (
                        <Draggable key={memo.id} draggableId={memo.id} index={index}>
                          {(provided) => (
                            <Paper
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              sx={{ p: 1.5, mb: 1, borderLeft: '4px solid #9e9e9e' }}
                            >
                              <Typography variant="body1" dangerouslySetInnerHTML={{ __html: marked.parse(memo.text) }} />
                            </Paper>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </Paper>
                  )}
                </Droppable>
              </Grid>
            </Grid>
          </Grid>
        </Grid>
      </DragDropContext>
    </Box>
  );
}

export default Dashboard;
