import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, orderBy, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import {
  Box,
  Typography,
  Paper,
  useTheme,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  DialogActions
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { marked } from 'marked';

const listTitles = {
  now: 'すぐやる',
  later: 'あとで'
};

function FeatureRequests() {
  const [requests, setRequests] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newRequest, setNewRequest] = useState({ title: '', description: '', priority: 'later' });
  const theme = useTheme();

  useEffect(() => {
    const q = query(collection(db, 'featureRequests'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setRequests(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, []);

  const getRequestsByPriority = (priority) => requests.filter(req => req.priority === priority);

  const onDragEnd = async (result) => {
    const { source, destination, draggableId } = result;
    if (!destination || (source.droppableId === destination.droppableId && source.index === destination.index)) return;

    const draggedRequest = requests.find(req => req.id === draggableId);
    if (!draggedRequest) return;

    const updatedRequestData = {
      ...draggedRequest,
      priority: destination.droppableId
    };

    try {
      await updateDoc(doc(db, 'featureRequests', draggableId), updatedRequestData);
    } catch (error) {
      console.error('Failed to update feature request:', error);
    }
  };

  const handleOpenDialog = () => setDialogOpen(true);
  const handleCloseDialog = () => {
    setDialogOpen(false);
    setNewRequest({ title: '', description: '', priority: 'later' });
  };

  const handleAddRequest = async () => {
    if (newRequest.title.trim() === '') return;

    try {
      await addDoc(collection(db, 'featureRequests'), {
        ...newRequest,
        status: 'todo', // statusはtodoで固定
        createdAt: serverTimestamp(),
      });
      handleCloseDialog();
    } catch (error) {
      console.error('Failed to add feature request:', error);
    }
  };

  const handleDeleteRequest = async (id) => {
    if (window.confirm('このリクエストを削除してもよろしいですか？')) {
      try {
        await deleteDoc(doc(db, 'featureRequests', id));
      } catch (error) {
        console.error('Failed to delete feature request:', error);
      }
    }
  };

  const handleCopyTasksForGemini = () => {
    const tasksToCopy = requests.filter(req => req.priority === 'now')
      .map(({ id, title, description, priority, status, createdAt }) => ({
        id,
        title,
        description,
        priority,
        status,
        createdAt: createdAt ? createdAt.toDate().toISOString() : null,
      }));
    
    const jsonString = JSON.stringify(tasksToCopy, null, 2);
    const instructionText = "ここにアプリケーションからの機能改善リクエストがあります。GEMINI.mdのガイドラインに従って処理してください:\n\n";
    navigator.clipboard.writeText(instructionText + jsonString)
      .then(() => {
        alert('Gemini用タスクがクリップボードにコピーされました！');
      })
      .catch(err => {
        console.error('クリップボードへのコピーに失敗しました:', err);
        alert('クリップボードへのコピーに失敗しました。コンソールを確認してください。');
      });
  };

  const renderRequestCard = (request, index) => (
    <Draggable key={request.id} draggableId={request.id} index={index}>
      {(provided, snapshot) => (
        <Paper
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          elevation={snapshot.isDragging ? 8 : 1}
          sx={{ p: 1.5, mb: 1.5, transition: 'box-shadow 0.2s ease' }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 'bold' }}>{request.title}</Typography>
            <IconButton
              aria-label="delete"
              size="small"
              onClick={() => handleDeleteRequest(request.id)}
              sx={{ p: 0.5 }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
          <Box dangerouslySetInnerHTML={{ __html: marked.parse(request.description || '') }} sx={{ fontSize: '0.85rem', mb: 1 }} />
          <Box>
            <Typography variant="caption" sx={{
              p: '2px 6px',
              borderRadius: '4px',
              color: 'white',
              backgroundColor: request.priority === 'now' ? theme.palette.error.main : theme.palette.info.main
            }}>
              {request.priority === 'now' ? 'すぐやる' : 'あとで'}
            </Typography>
          </Box>
        </Paper>
      )}
    </Draggable>
  );

  const KanbanColumn = ({ droppableId, title, requests }) => (
    <Box sx={{ width: { xs: '100%', md: 'calc(33.33% - 12px)' }, display: 'flex', flexDirection: 'column' }}>
      <Typography variant="h6" sx={{ p: 1, mb: 1, borderBottom: `2px solid ${theme.palette.primary.main}` }}>{title}</Typography>
      <Droppable droppableId={droppableId}>
        {(provided, snapshot) => (
          <Paper
            ref={provided.innerRef}
            {...provided.droppableProps}
            elevation={snapshot.isDraggingOver ? 4 : 0}
            sx={{
              p: 1.5,
              flexGrow: 1,
              overflowY: 'auto',
              backgroundColor: snapshot.isDraggingOver ? theme.palette.action.hover : theme.palette.background.paper,
              transition: 'background-color 0.2s ease, box-shadow 0.2s ease',
              border: `1px solid ${theme.palette.divider}`,
            }}
          >
            {requests.map(renderRequestCard)}
            {provided.placeholder}
          </Paper>
        )}
      </Droppable>
    </Box>
  );

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 'bold', color: 'primary.main' }}>機能改善</Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button variant="contained" color="primary" startIcon={<AddIcon />} onClick={handleOpenDialog}>
            新しいリクエスト
          </Button>
          <Button variant="outlined" color="secondary" onClick={handleCopyTasksForGemini}>
            Gemini用タスクをコピー
          </Button>
        </Box>
      </Box>

      <DragDropContext onDragEnd={onDragEnd}>
        <Box sx={{ display: 'flex', flexGrow: 1, gap: '18px', flexDirection: { xs: 'column', md: 'row' } }}>
          <KanbanColumn droppableId="now" title="すぐやる" requests={getRequestsByPriority('now')} />
          <KanbanColumn droppableId="later" title="あとで" requests={getRequestsByPriority('later')} />
        </Box>
      </DragDropContext>

      <Dialog open={dialogOpen} onClose={handleCloseDialog} fullWidth maxWidth="sm">
        <DialogTitle>
          新しい機能リクエスト
          <IconButton aria-label="close" onClick={handleCloseDialog} sx={{ position: 'absolute', right: 8, top: 8 }}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <TextField
            autoFocus
            margin="dense"
            label="タイトル"
            fullWidth
            variant="outlined"
            value={newRequest.title}
            onChange={(e) => setNewRequest({ ...newRequest, title: e.target.value })}
            sx={{ mb: 2 }}
          />
          <TextField
            margin="dense"
            label="詳細 (Markdown対応)"
            fullWidth
            multiline
            rows={6}
            variant="outlined"
            value={newRequest.description}
            onChange={(e) => setNewRequest({ ...newRequest, description: e.target.value })}
            sx={{ mb: 2 }}
          />
          <FormControl fullWidth>
            <InputLabel>優先度</InputLabel>
            <Select
              value={newRequest.priority}
              label="優先度"
              onChange={(e) => setNewRequest({ ...newRequest, priority: e.target.value })}
            >
              <MenuItem value="now">すぐやる</MenuItem>
              <MenuItem value="later">あとで</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>キャンセル</Button>
          <Button onClick={handleAddRequest} variant="contained">追加</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default FeatureRequests;
