import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, orderBy, onSnapshot, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import {
  Box,
  Typography,
  Paper,
  Chip,
  useTheme,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { marked } from 'marked';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { useNavigate } from 'react-router-dom';
import EditIcon from '@mui/icons-material/Edit';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import LightbulbIcon from '@mui/icons-material/Lightbulb';

// quadrantの背景色を定義
const quadrantColors = {
  'high-high': '#FF7043', // 緊急かつ重要 (ディープオレンジ)
  'high-low': '#FFCA28', // 緊急だが重要ではない (アンバー)
  'low-high': '#4DB6AC', // 緊急ではないが重要 (ミディアムアクア)
  'low-low': '#90A4AE', // 緊急でも重要でもない (ブルースグレー)
};

function Dashboard() {
  const [memos, setMemos] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedList, setSelectedList] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [memoToDelete, setMemoToDelete] = useState(null);
  const theme = useTheme();
  const navigate = useNavigate();

  useEffect(() => {
    const q = query(collection(db, 'memos'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setMemos(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, []);

  const getMemosByStatus = (status) => memos.filter(memo => memo.status === status);
  const getMemosByEisenhower = (urgency, importance) => memos.filter(memo => memo.urgency === urgency && memo.importance === importance);

  const onDragEnd = async (result) => {
    const { source, destination, draggableId } = result;
    if (!destination || (source.droppableId === destination.droppableId && source.index === destination.index)) return;

    const draggedMemo = memos.find(memo => memo.id === draggableId);
    if (!draggedMemo) return;

    let updatedMemoData = { ...draggedMemo };

    if (destination.droppableId.startsWith('eisenhower-')) {
      const [urgency, importance] = destination.droppableId.replace('eisenhower-', '').split('-');
      updatedMemoData.urgency = urgency;
      updatedMemoData.importance = importance;
      if (updatedMemoData.status === 'inbox') {
        updatedMemoData.status = 'next_action';
      }
    } else if (destination.droppableId === 'inbox') {
        updatedMemoData.status = 'inbox';
        updatedMemoData.urgency = 'medium';
        updatedMemoData.importance = 'medium';
    } else {
        updatedMemoData.status = destination.droppableId.replace('gtd-','');
    }

    try {
      await updateDoc(doc(db, 'memos', draggableId), updatedMemoData);
    } catch (error) {
      console.error('Failed to update memo:', error);
    }
  };

  const handleOpenDialog = (list) => {
    setSelectedList(list);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setSelectedList('');
  };

  const openDeleteConfirm = (id) => {
    setMemoToDelete(id);
    setDeleteConfirmOpen(true);
  };

  const closeDeleteConfirm = () => {
    setMemoToDelete(null);
    setDeleteConfirmOpen(false);
  };

  const handleDeleteMemo = async () => {
    if (!memoToDelete) return;
    try {
      await deleteDoc(doc(db, 'memos', memoToDelete));
      console.log('Memo deleted:', memoToDelete);
      closeDeleteConfirm();
    } catch (error) {
      console.error('Failed to delete memo:', error);
    }
  };

  const handleEditMemo = (id) => {
    navigate(`/memo/${id}`);
  };

  const renderMemoContent = (memo) => (
    <>
      <Typography variant="body2" sx={{ fontSize: '0.75rem', lineHeight: 1.4, mb: 0.5 }} dangerouslySetInnerHTML={{ __html: marked.parse(memo.text) }} />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {memo.tags && memo.tags.map(tag => <Chip key={tag} label={`#${tag}`} size="small" sx={{ fontSize: '0.6rem', height: '16px' }} />)}
        {memo.context && <Chip label={`@${memo.context}`} size="small" variant="outlined" sx={{ fontSize: '0.6rem', height: '16px' }} />}
        {memo.project_name && <Chip label={`P: ${memo.project_name}`} size="small" variant="outlined" color="secondary" sx={{ fontSize: '0.6rem', height: '16px' }} />}
      </Box>
    </>
  );

  const renderVerticalMemoCard = (memo, index) => (
    <Draggable key={memo.id} draggableId={memo.id} index={index}>
      {(provided, snapshot) => (
        <Paper
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          elevation={snapshot.isDragging ? 8 : 1}
          sx={{
            p: 0.8, mb: 0.8, position: 'relative',
            transition: 'box-shadow 0.2s ease',
            '&:hover .memo-actions': { opacity: 1 }
          }}
        >
          {renderMemoContent(memo)}
          <Box className="memo-actions" sx={{ position: 'absolute', top: 2, right: 2, display: 'flex', opacity: 0, transition: 'opacity 0.2s ease' }}>
            <IconButton size="small" onClick={() => handleEditMemo(memo.id)} sx={{ p: 0.2 }}><EditIcon sx={{ fontSize: '0.9rem' }} /></IconButton>
            <IconButton size="small" onClick={() => openDeleteConfirm(memo.id)} sx={{ p: 0.2 }}><CloseIcon sx={{ fontSize: '0.9rem' }} /></IconButton>
          </Box>
        </Paper>
      )}
    </Draggable>
  );

  const renderHorizontalMemoCard = (memo, index) => (
    <Draggable key={memo.id} draggableId={memo.id} index={index}>
        {(provided, snapshot) => (
            <Box ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps} sx={{ mr: 1, flexShrink: 0, width: 200 }}>
                <Paper
                  elevation={snapshot.isDragging ? 8 : 1}
                  sx={{
                    p: 0.8, position: 'relative',
                    transition: 'box-shadow 0.2s ease',
                    '&:hover .memo-actions': { opacity: 1 }
                  }}
                >
                    {renderMemoContent(memo)}
                    <Box className="memo-actions" sx={{ position: 'absolute', top: 2, right: 2, display: 'flex', opacity: 0, transition: 'opacity 0.2s ease' }}>
                      <IconButton size="small" onClick={() => handleEditMemo(memo.id)} sx={{ p: 0.2 }}><EditIcon sx={{ fontSize: '0.9rem' }} /></IconButton>
                      <IconButton size="small" onClick={() => openDeleteConfirm(memo.id)} sx={{ p: 0.2 }}><CloseIcon sx={{ fontSize: '0.9rem' }} /></IconButton>
                    </Box>
                </Paper>
            </Box>
        )}
    </Draggable>
  );

  const listTitles = {
    project: 'プロジェクト',
    someday_maybe: 'いつかやる/多分やる',
    reference: '参照資料',
    done: '完了'
  };

  const Quadrant = ({ droppableId, title, bgColor, memos }) => (
    <Box sx={{ width: { xs: '100%', sm: 'calc(50% - 8px)' }, height: { xs: '250px', sm: 'calc(50% - 8px)' }, m: { xs: '4px 0', sm: '4px' } }}>
        <Droppable droppableId={droppableId}>
            {(provided, snapshot) => (
                <Paper
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    elevation={snapshot.isDraggingOver ? 4 : 0}
                    sx={{
                      p: 1.5, height: '100%', overflowY: 'auto',
                      backgroundColor: snapshot.isDraggingOver ? theme.palette.action.hover : bgColor,
                      transition: 'background-color 0.3s ease, box-shadow 0.2s ease',
                      border: `1px solid ${theme.palette.divider}`,
                    }}
                >
                    <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 1, textAlign: 'center', color: theme.palette.getContrastText(bgColor) }}>{title}</Typography>
                    {memos.map(renderVerticalMemoCard)}
                    {provided.placeholder}
                </Paper>
            )}
        </Droppable>
    </Box>
  );

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', mb: 3 }}>
            <Box>
              <Button
                variant="contained"
                color="primary"
                startIcon={<AddCircleOutlineIcon />}
                onClick={() => navigate('/memo')}
                sx={{ mr: 1, transform: 'scale(1.2)' }}
              >
                メモ追加
              </Button>
              <Button
                variant="contained"
                color="secondary"
                startIcon={<LightbulbIcon />}
                onClick={() => navigate('/idea')}
                sx={{ transform: 'scale(1.2)' }}
              >
                アイデア追加
              </Button>
            </Box>
        </Box>

      <DragDropContext onDragEnd={onDragEnd}>
        <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
            {/* Inbox Top Bar */}
            <Box sx={{ mb: 3 }}>
                <Droppable droppableId="inbox" direction="horizontal">
                    {(provided, snapshot) => (
                        <Paper
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          elevation={snapshot.isDraggingOver ? 4 : 0}
                          sx={{
                            p: 1.5, backgroundColor: snapshot.isDraggingOver ? theme.palette.action.hover : theme.palette.background.paper,
                            display: 'flex', alignItems: 'center', overflowX: 'auto', minHeight: 130,
                            border: `1px solid ${theme.palette.divider}`,
                          }}
                        >
                            <Typography variant="h6" sx={{ p: 1, mr: 1, fontWeight: 'bold', color: 'text.secondary', flexShrink: 0 }}>受信箱</Typography>
                            <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
                                {getMemosByStatus('inbox').map(renderHorizontalMemoCard)}
                                {provided.placeholder}
                            </Box>
                        </Paper>
                    )}
                </Droppable>
            </Box>

            {/* Main Quadrants Area */}
            <Box sx={{ flexGrow: 1, display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
              <Quadrant droppableId="eisenhower-high-high" title="緊急かつ重要" bgColor={quadrantColors['high-high']} memos={getMemosByEisenhower('high', 'high')} />
              <Quadrant droppableId="eisenhower-high-low" title="緊急だが重要ではない" bgColor={quadrantColors['high-low']} memos={getMemosByEisenhower('high', 'low')} />
              <Quadrant droppableId="eisenhower-low-high" title="緊急ではないが重要" bgColor={quadrantColors['low-high']} memos={getMemosByEisenhower('low', 'high')} />
              <Quadrant droppableId="eisenhower-low-low" title="緊急でも重要でもない" bgColor={quadrantColors['low-low']} memos={getMemosByEisenhower('low', 'low')} />
            </Box>
        </Box>
      </DragDropContext>

      <Dialog open={dialogOpen} onClose={handleCloseDialog} fullWidth maxWidth="md">
        <DialogTitle>
          {listTitles[selectedList]}
          <IconButton aria-label="close" onClick={handleCloseDialog} sx={{ position: 'absolute', right: 8, top: 8 }}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent dividers>
            <Box sx={{ minHeight: '400px', p:1 }}>
                {selectedList && getMemosByStatus(selectedList).map((memo, index) => (
                    <Paper key={memo.id} sx={{ p: 1, mb: 1 }}>{renderMemoContent(memo)}</Paper>
                ))}
            </Box>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onClose={closeDeleteConfirm}>
        <DialogTitle>メモの削除</DialogTitle>
        <DialogContent>
          <Typography>本当にこのメモを削除しますか？</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDeleteConfirm}>キャンセル</Button>
          <Button onClick={handleDeleteMemo} color="error">削除</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default Dashboard;