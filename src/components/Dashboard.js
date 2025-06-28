import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, orderBy, onSnapshot, updateDoc, doc } from 'firebase/firestore';
import {
  Box,
  Typography,
  Grid,
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
  IconButton
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { marked } from 'marked';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

function Dashboard() {
  const [memos, setMemos] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedList, setSelectedList] = useState('');
  const theme = useTheme();

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

  const renderMemoContent = (memo) => (
    <>
      <Typography variant="body2" sx={{ fontSize: '0.8rem' }} dangerouslySetInnerHTML={{ __html: marked.parse(memo.text) }} />
      <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {memo.tags && memo.tags.map(tag => <Chip key={tag} label={`#${tag}`} size="small" sx={{ fontSize: '0.65rem', height: '18px' }} />)}
        {memo.context && <Chip label={`@${memo.context}`} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: '18px' }} />}
        {memo.project_name && <Chip label={`P: ${memo.project_name}`} size="small" variant="outlined" color="secondary" sx={{ fontSize: '0.65rem', height: '18px' }} />}
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
          sx={{ p: 1, mb: 1, boxShadow: snapshot.isDragging ? '0px 5px 15px rgba(0,0,0,0.3)' : '0px 1px 2px rgba(0,0,0,0.1)', transition: 'box-shadow 0.2s ease' }}
        >
          {renderMemoContent(memo)}
        </Paper>
      )}
    </Draggable>
  );

  const renderHorizontalMemoCard = (memo, index) => (
    <Draggable key={memo.id} draggableId={memo.id} index={index}>
        {(provided, snapshot) => (
            <Box ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps} sx={{ mr: 1, flexShrink: 0, width: 220 }}>
                <Paper sx={{ p: 1, boxShadow: snapshot.isDragging ? '0px 5px 15px rgba(0,0,0,0.3)' : '0px 1px 2px rgba(0,0,0,0.1)' }}>
                    {renderMemoContent(memo)}
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
    <Box sx={{ width: 'calc(50% - 4px)', height: 'calc(50% - 4px)', m: '2px' }}>
        <Droppable droppableId={droppableId}>
            {(provided, snapshot) => (
                <Paper
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    sx={{ p: 1.5, height: '100%', overflowY: 'auto', backgroundColor: snapshot.isDraggingOver ? theme.palette.action.hover : bgColor, transition: 'background-color 0.2s ease' }}
                >
                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }} gutterBottom>{title}</Typography>
                    {memos.map(renderVerticalMemoCard)}
                    {provided.placeholder}
                </Paper>
            )}
        </Droppable>
    </Box>
  );

  return (
    <Box sx={{ p: 1, height: 'calc(100vh - 56px)', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="h5" gutterBottom sx={{ mb: 0 }}>ダッシュボード</Typography>
            <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel>他のリストを表示</InputLabel>
                <Select value={selectedList} label="他のリストを表示" onChange={(e) => { e.target.value && handleOpenDialog(e.target.value) }}>
                    <MenuItem value=""><em>選択解除</em></MenuItem>
                    <MenuItem value="project">プロジェクト</MenuItem>
                    <MenuItem value="someday_maybe">いつかやる/多分やる</MenuItem>
                    <MenuItem value="reference">参照資料</MenuItem>
                    <MenuItem value="done">完了</MenuItem>
                </Select>
            </FormControl>
        </Box>

      <DragDropContext onDragEnd={onDragEnd}>
        <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, height: '100%' }}>
            {/* Inbox Top Bar */}
            <Box sx={{ mb: 1 }}>
                <Droppable droppableId="inbox" direction="horizontal">
                    {(provided, snapshot) => (
                        <Paper ref={provided.innerRef} {...provided.droppableProps} sx={{ p: 1, backgroundColor: snapshot.isDraggingOver ? theme.palette.action.hover : '#f5f5f5', display: 'flex', alignItems: 'flex-start', overflowX: 'auto', minHeight: 120 }}>
                            <Typography variant="h6" sx={{ p: 1, mr: 1, alignSelf: 'center' }}>受信箱</Typography>
                            <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
                                {getMemosByStatus('inbox').map(renderHorizontalMemoCard)}
                                {provided.placeholder}
                            </Box>
                        </Paper>
                    )}
                </Droppable>
            </Box>

            {/* Main Quadrants Area */}
            <Box sx={{ flexGrow: 1, display: 'flex', flexWrap: 'wrap' }}>
              <Quadrant droppableId="eisenhower-high-high" title="緊急かつ重要" bgColor="#ffebee" memos={getMemosByEisenhower('high', 'high')} />
              <Quadrant droppableId="eisenhower-low-high" title="緊急ではないが重要" bgColor="#e8f5e9" memos={getMemosByEisenhower('low', 'high')} />
              <Quadrant droppableId="eisenhower-high-low" title="緊急だが重要ではない" bgColor="#fffde7" memos={getMemosByEisenhower('high', 'low')} />
              <Quadrant droppableId="eisenhower-low-low" title="緊急でも重要でもない" bgColor="#e0f2f7" memos={getMemosByEisenhower('low', 'low')} />
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
    </Box>
  );
}

export default Dashboard;