import React, { useEffect, useState } from 'react';
import { db } from '../firebase';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from '../documentDbClient';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import { marked } from 'marked';

const columns = [
  { id: 'now', title: 'すぐやる', hint: '優先して取り組む', color: '#5577e8' },
  { id: 'later', title: 'あとで', hint: '次の候補', color: '#d19a39' },
  { id: 'done', title: '完了', hint: '反映済み', color: '#38a56c' },
];

function FeatureRequests() {
  const [requests, setRequests] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState(null);
  const [newRequest, setNewRequest] = useState({ title: '', description: '', priority: 'now' });
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  useEffect(() => {
    const q = query(collection(db, 'featureRequests'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      setRequests(snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() })));
    });
  }, []);

  const onDragEnd = async ({ source, destination, draggableId }) => {
    if (!destination || (source.droppableId === destination.droppableId && source.index === destination.index)) return;
    const draggedRequest = requests.find((request) => request.id === draggableId);
    if (!draggedRequest) return;

    const update = destination.droppableId === 'done'
      ? { status: 'done' }
      : { status: 'todo', priority: destination.droppableId };

    try {
      await updateDoc(doc(db, 'featureRequests', draggableId), update);
    } catch (error) {
      console.error('Failed to update feature request:', error);
    }
  };

  const handleOpenDialog = (request = null) => {
    setEditingRequest(request);
    setNewRequest(request
      ? { title: request.title, description: request.description, priority: request.priority }
      : { title: '', description: '', priority: 'now' });
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingRequest(null);
    setNewRequest({ title: '', description: '', priority: 'now' });
  };

  const handleSaveRequest = async () => {
    if (!newRequest.title.trim()) return;
    try {
      if (editingRequest) {
        await updateDoc(doc(db, 'featureRequests', editingRequest.id), newRequest);
      } else {
        await addDoc(collection(db, 'featureRequests'), {
          ...newRequest,
          status: 'todo',
          createdAt: serverTimestamp(),
        });
      }
      handleCloseDialog();
    } catch (error) {
      console.error('Failed to save feature request:', error);
    }
  };

  const handleDeleteRequest = async (id) => {
    if (!window.confirm('このリクエストを削除してもよろしいですか？')) return;
    try {
      await deleteDoc(doc(db, 'featureRequests', id));
    } catch (error) {
      console.error('Failed to delete feature request:', error);
    }
  };

  const handleCopyTasksForGemini = () => {
    const tasksToCopy = requests
      .filter((request) => request.priority === 'now' && (request.status === 'todo' || request.status === 'in_progress'))
      .map(({ id, title, description, priority, status, createdAt }) => ({
        id,
        title,
        description,
        priority,
        status,
        createdAt: createdAt ? createdAt.toDate().toISOString() : null,
      }));
    const instruction = 'ここにアプリケーションからの機能改善リクエストがあります。GEMINI.mdのガイドラインに従って処理してください:\n\n';
    navigator.clipboard.writeText(instruction + JSON.stringify(tasksToCopy, null, 2))
      .then(() => alert('Gemini用タスクがクリップボードにコピーされました！'))
      .catch((error) => {
        console.error('クリップボードへのコピーに失敗しました:', error);
        alert('クリップボードへのコピーに失敗しました。');
      });
  };

  const border = isDark
    ? alpha(theme.palette.common.white, 0.09)
    : 'rgba(83, 124, 149, 0.16)';

  const requestsForColumn = (columnId) => {
    if (columnId === 'done') return requests.filter((request) => request.status === 'done');
    return requests.filter((request) => request.priority === columnId && request.status !== 'done');
  };

  const renderRequestCard = (request, index, columnColor) => (
    <Draggable key={request.id} draggableId={request.id} index={index}>
      {(provided, snapshot) => (
        <Paper
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          elevation={0}
          sx={{
            p: 1.25,
            mb: 0.9,
            cursor: snapshot.isDragging ? 'grabbing' : 'grab',
            opacity: request.status === 'done' ? 0.68 : 1,
            border: `1px solid ${snapshot.isDragging ? alpha(columnColor, 0.6) : border}`,
            background: isDark ? alpha(theme.palette.background.paper, 0.9) : 'rgba(255,255,255,0.86)',
            boxShadow: snapshot.isDragging ? '0 16px 34px rgba(37,70,92,0.22)' : '0 3px 12px rgba(43,82,106,0.06)',
            transition: 'transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease',
            '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 8px 20px rgba(43,82,106,0.11)' },
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.8 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, lineHeight: 1.4 }}>
                {request.title}
              </Typography>
              <Box
                dangerouslySetInnerHTML={{ __html: marked.parse(request.description || '') }}
                sx={{
                  mt: 0.7,
                  color: 'text.secondary',
                  fontSize: '0.73rem',
                  lineHeight: 1.6,
                  display: '-webkit-box',
                  WebkitLineClamp: 4,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  '& p': { m: 0 },
                  '& ul, & ol': { my: 0, pl: 2.2 },
                }}
              />
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.15 }}>
              <IconButton size="small" onClick={() => handleOpenDialog(request)}><EditIcon fontSize="inherit" /></IconButton>
              <IconButton size="small" color="error" onClick={() => handleDeleteRequest(request.id)}><DeleteIcon fontSize="inherit" /></IconButton>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.55, mt: 1 }}>
            <Chip
              size="small"
              label={request.status === 'done' ? '完了' : request.priority === 'now' ? 'すぐやる' : 'あとで'}
              sx={{
                height: 20,
                fontSize: '0.58rem',
                color: columnColor,
                backgroundColor: alpha(columnColor, isDark ? 0.16 : 0.09),
              }}
            />
          </Box>
        </Paper>
      )}
    </Draggable>
  );

  const KanbanColumn = ({ definition }) => {
    const columnRequests = requestsForColumn(definition.id);
    return (
      <Box sx={{ minWidth: { xs: 260, md: 0 }, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, px: 0.4, mb: 0.8 }}>
          <Box sx={{ width: 5, height: 28, borderRadius: 999, backgroundColor: definition.color }} />
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 900, lineHeight: 1.2 }}>{definition.title}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.62rem' }}>{definition.hint}</Typography>
          </Box>
          <Chip size="small" label={columnRequests.length} sx={{ ml: 'auto', height: 21, fontSize: '0.6rem' }} />
        </Box>
        <Droppable droppableId={definition.id}>
          {(provided, snapshot) => (
            <Paper
              ref={provided.innerRef}
              {...provided.droppableProps}
              elevation={0}
              sx={{
                p: 0.85,
                minHeight: 300,
                flexGrow: 1,
                overflowY: 'auto',
                border: `1px solid ${snapshot.isDraggingOver ? alpha(definition.color, 0.45) : border}`,
                background: snapshot.isDraggingOver
                  ? alpha(definition.color, isDark ? 0.08 : 0.045)
                  : isDark ? alpha(theme.palette.background.paper, 0.55) : 'rgba(255,255,255,0.42)',
                backdropFilter: 'blur(12px)',
              }}
            >
              {columnRequests.map((request, index) => renderRequestCard(request, index, definition.color))}
              {columnRequests.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center', fontSize: '0.74rem' }}>
                  ここにはまだありません
                </Typography>
              )}
              {provided.placeholder}
            </Paper>
          )}
        </Droppable>
      </Box>
    );
  };

  return (
    <Box sx={{ minHeight: '100%', p: { xs: 0.25, sm: 0.75 }, display: 'flex', flexDirection: 'column' }}>
      <Paper
        elevation={0}
        sx={{
          mb: 1.5,
          p: { xs: 1.5, sm: 2 },
          border: `1px solid ${border}`,
          background: isDark ? alpha(theme.palette.background.paper, 0.82) : 'rgba(255,255,255,0.62)',
          backdropFilter: 'blur(18px)',
        }}
      >
        <Box sx={{ display: 'flex', gap: 2, alignItems: { xs: 'flex-start', md: 'center' }, flexDirection: { xs: 'column', md: 'row' } }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 800, letterSpacing: '0.13em' }}>PRODUCT BACKLOG</Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <Typography variant="h4">機能改善</Typography>
              <Chip size="small" label={`${requests.length} items`} sx={{ height: 23, fontSize: '0.66rem', fontWeight: 800 }} />
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.55, maxWidth: 720, lineHeight: 1.65 }}>
              改善案を優先度で並べ、実装済みまで一つのボードで追います。カードはドラッグして移動できます。
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap' }}>
            <Button variant="outlined" startIcon={<ContentCopyOutlinedIcon />} onClick={handleCopyTasksForGemini}>Gemini用にコピー</Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpenDialog()}>新しいリクエスト</Button>
          </Box>
        </Box>
      </Paper>

      <DragDropContext onDragEnd={onDragEnd}>
        <Box sx={{ display: 'flex', gap: 1.25, flexGrow: 1, overflowX: 'auto', pb: 1 }}>
          {columns.map((definition) => <KanbanColumn key={definition.id} definition={definition} />)}
        </Box>
      </DragDropContext>

      <Dialog open={dialogOpen} onClose={handleCloseDialog} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 800 }}>
          {editingRequest ? 'リクエストの編集' : '新しい機能リクエスト'}
          <IconButton aria-label="close" onClick={handleCloseDialog} sx={{ position: 'absolute', right: 8, top: 8 }}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <TextField autoFocus margin="dense" label="タイトル" fullWidth value={newRequest.title} onChange={(event) => setNewRequest({ ...newRequest, title: event.target.value })} sx={{ mb: 2 }} />
          <TextField margin="dense" label="詳細 (Markdown対応)" fullWidth multiline rows={6} value={newRequest.description} onChange={(event) => setNewRequest({ ...newRequest, description: event.target.value })} sx={{ mb: 2 }} />
          <FormControl fullWidth>
            <InputLabel>優先度</InputLabel>
            <Select value={newRequest.priority} label="優先度" onChange={(event) => setNewRequest({ ...newRequest, priority: event.target.value })}>
              <MenuItem value="now">すぐやる</MenuItem>
              <MenuItem value="later">あとで</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions sx={{ p: 1.5 }}>
          <Button onClick={handleCloseDialog}>キャンセル</Button>
          <Button onClick={handleSaveRequest} variant="contained">{editingRequest ? '更新' : '追加'}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default FeatureRequests;
