import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../firebase';
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import { useNavigate } from 'react-router-dom';
import { marked } from 'marked';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import SearchIcon from '@mui/icons-material/Search';

const laneDefinitions = [
  { id: 'next_action', title: '進行中', hint: '次の行動', color: '#5577e8', icon: PlayCircleOutlineIcon },
  { id: 'inbox', title: '受信箱', hint: '未整理', color: '#e6a33b', icon: InboxOutlinedIcon },
  { id: 'project', title: 'プロジェクト', hint: '複数ステップ', color: '#8b62dc', icon: FolderOutlinedIcon },
  { id: 'someday_maybe', title: '保留', hint: 'いつか / 多分', color: '#77869a', icon: PauseCircleOutlineIcon },
  { id: 'reference', title: '参照資料', hint: 'あとで参照', color: '#2f9ba7', icon: BookmarkBorderIcon },
  { id: 'done', title: '完了', hint: '完了済み', color: '#38a56c', icon: CheckCircleOutlineIcon },
];

const cleanText = (text = '') => text
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/[`*_>#\[\]()~-]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const formatDate = (value) => {
  if (!value) return '—';
  try {
    const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch (error) {
    return '—';
  }
};

function Dashboard() {
  const [memos, setMemos] = useState([]);
  const [selectedMemoId, setSelectedMemoId] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [memoToDelete, setMemoToDelete] = useState(null);
  const theme = useTheme();
  const navigate = useNavigate();
  const isDark = theme.palette.mode === 'dark';

  useEffect(() => {
    const q = query(collection(db, 'memos'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setMemos(snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() })));
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (memos.length === 0) {
      setSelectedMemoId(null);
      return;
    }
    if (!selectedMemoId || !memos.some((memo) => memo.id === selectedMemoId)) {
      setSelectedMemoId(memos[0].id);
    }
  }, [memos, selectedMemoId]);

  const filteredMemos = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) return memos;
    return memos.filter((memo) => {
      const haystack = [
        memo.text,
        memo.context,
        memo.project_name,
        ...(memo.tags || []),
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(keyword);
    });
  }, [memos, searchText]);

  const selectedMemo = useMemo(
    () => memos.find((memo) => memo.id === selectedMemoId) || null,
    [memos, selectedMemoId],
  );

  const onDragEnd = async ({ destination, draggableId, source }) => {
    if (!destination || destination.droppableId === source.droppableId) return;
    if (!destination.droppableId.startsWith('status-')) return;

    const status = destination.droppableId.replace('status-', '');
    try {
      await updateDoc(doc(db, 'memos', draggableId), { status });
    } catch (error) {
      console.error('Failed to update memo status:', error);
    }
  };

  const openDeleteConfirm = (memoId) => {
    setMemoToDelete(memoId);
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
      closeDeleteConfirm();
    } catch (error) {
      console.error('Failed to delete memo:', error);
    }
  };

  const getLaneMemos = (status) => filteredMemos.filter((memo) => memo.status === status);

  const laneBackground = isDark
    ? alpha(theme.palette.background.paper, 0.76)
    : 'rgba(255, 255, 255, 0.54)';

  const boardBorder = isDark
    ? alpha(theme.palette.common.white, 0.09)
    : 'rgba(89, 129, 154, 0.18)';

  const renderCard = (memo, index, laneColor) => {
    const title = cleanText(memo.text) || '無題のメモ';
    const selected = memo.id === selectedMemoId;

    return (
      <Draggable key={memo.id} draggableId={memo.id} index={index}>
        {(provided, snapshot) => (
          <Paper
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            onClick={() => setSelectedMemoId(memo.id)}
            elevation={0}
            sx={{
              width: 228,
              minHeight: 86,
              flexShrink: 0,
              px: 1.25,
              py: 1.1,
              cursor: snapshot.isDragging ? 'grabbing' : 'pointer',
              border: selected
                ? `1px solid ${alpha(laneColor, 0.9)}`
                : `1px solid ${boardBorder}`,
              background: selected
                ? alpha(laneColor, isDark ? 0.15 : 0.08)
                : isDark
                  ? alpha(theme.palette.background.paper, 0.92)
                  : 'rgba(255,255,255,0.88)',
              boxShadow: snapshot.isDragging
                ? '0 14px 30px rgba(26, 67, 92, 0.22)'
                : selected
                  ? `0 5px 16px ${alpha(laneColor, 0.16)}`
                  : '0 3px 10px rgba(50, 88, 110, 0.08)',
              transition: 'border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease',
              '&:hover': {
                transform: 'translateY(-1px)',
                boxShadow: '0 7px 18px rgba(50, 88, 110, 0.14)',
              },
            }}
          >
            <Typography
              variant="body2"
              sx={{
                fontWeight: 700,
                fontSize: '0.76rem',
                lineHeight: 1.45,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                minHeight: 34,
              }}
            >
              {title}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.55, mt: 0.9, minWidth: 0 }}>
              {memo.project_name && (
                <Chip
                  label={memo.project_name}
                  size="small"
                  sx={{
                    maxWidth: 106,
                    height: 19,
                    fontSize: '0.58rem',
                    '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' },
                  }}
                />
              )}
              {(memo.tags || []).slice(0, 1).map((tag) => (
                <Chip
                  key={tag}
                  label={`#${tag}`}
                  size="small"
                  variant="outlined"
                  sx={{ height: 19, fontSize: '0.58rem', maxWidth: 92 }}
                />
              ))}
              {(memo.tags || []).length > 1 && (
                <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', fontSize: '0.62rem' }}>
                  +{memo.tags.length - 1}
                </Typography>
              )}
            </Box>
          </Paper>
        )}
      </Draggable>
    );
  };

  const DetailPanel = () => (
    <Paper
      elevation={0}
      sx={{
        width: 305,
        flexShrink: 0,
        alignSelf: 'stretch',
        display: { xs: 'none', lg: 'flex' },
        flexDirection: 'column',
        overflow: 'hidden',
        border: `1px solid ${boardBorder}`,
        background: isDark ? alpha(theme.palette.background.paper, 0.92) : 'rgba(255,255,255,0.72)',
        backdropFilter: 'blur(18px) saturate(135%)',
        boxShadow: '0 10px 32px rgba(61, 101, 126, 0.10)',
      }}
    >
      <Box sx={{ px: 2, py: 1.55, borderBottom: `1px solid ${boardBorder}` }}>
        <Typography variant="overline" sx={{ fontWeight: 800, letterSpacing: '0.12em', color: 'text.secondary' }}>
          SELECTED NOTE
        </Typography>
        <Typography variant="subtitle1" sx={{ mt: -0.25, fontWeight: 800 }}>
          {selectedMemo ? cleanText(selectedMemo.text).slice(0, 72) || '無題のメモ' : 'メモを選択'}
        </Typography>
      </Box>

      {selectedMemo ? (
        <>
          <Box sx={{ px: 2, py: 1.5, display: 'grid', gap: 1.05 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="caption" color="text.secondary">状態</Typography>
              <Chip
                size="small"
                label={laneDefinitions.find((lane) => lane.id === selectedMemo.status)?.title || selectedMemo.status || '未設定'}
                sx={{ height: 22, fontSize: '0.66rem', fontWeight: 700 }}
              />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="caption" color="text.secondary">更新</Typography>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>{formatDate(selectedMemo.updatedAt || selectedMemo.createdAt)}</Typography>
            </Box>
            {selectedMemo.context && (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                <Typography variant="caption" color="text.secondary">コンテキスト</Typography>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>@{selectedMemo.context}</Typography>
              </Box>
            )}
            {selectedMemo.project_name && (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                <Typography variant="caption" color="text.secondary">プロジェクト</Typography>
                <Typography variant="caption" sx={{ fontWeight: 700, textAlign: 'right' }}>{selectedMemo.project_name}</Typography>
              </Box>
            )}
          </Box>

          <Box sx={{ px: 2, py: 1.35, borderTop: `1px solid ${boardBorder}`, borderBottom: `1px solid ${boardBorder}` }}>
            <Typography variant="caption" sx={{ display: 'block', mb: 0.8, color: 'text.secondary', fontWeight: 800 }}>
              タグ
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
              {(selectedMemo.tags || []).length > 0
                ? selectedMemo.tags.map((tag) => <Chip key={tag} size="small" label={`#${tag}`} sx={{ height: 22, fontSize: '0.64rem' }} />)
                : <Typography variant="caption" color="text.secondary">タグなし</Typography>}
            </Box>
          </Box>

          <Box
            sx={{
              px: 2,
              py: 1.6,
              flexGrow: 1,
              overflowY: 'auto',
              '& p': { mt: 0, mb: 1.1, fontSize: '0.78rem', lineHeight: 1.65 },
              '& ul, & ol': { pl: 2.4, fontSize: '0.78rem' },
              '& h1, & h2, & h3': { fontSize: '0.95rem', mb: 1 },
              '& pre': { overflowX: 'auto', p: 1, borderRadius: 1.5, backgroundColor: alpha(theme.palette.text.primary, 0.06) },
            }}
            dangerouslySetInnerHTML={{ __html: marked.parse(selectedMemo.text || '') }}
          />

          <Box sx={{ p: 1.5, display: 'grid', gridTemplateColumns: '1fr auto', gap: 1, borderTop: `1px solid ${boardBorder}` }}>
            <Button variant="contained" startIcon={<EditOutlinedIcon />} onClick={() => navigate(`/memo/${selectedMemo.id}`)}>
              編集
            </Button>
            <Tooltip title="削除">
              <IconButton color="error" onClick={() => openDeleteConfirm(selectedMemo.id)}>
                <DeleteOutlineIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </>
      ) : (
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" color="text.secondary">右側のカードを選択すると詳細を表示します。</Typography>
        </Box>
      )}
    </Paper>
  );

  return (
    <Box sx={{ minHeight: '100%', p: { xs: 0.5, sm: 1 }, position: 'relative' }}>
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          borderRadius: 4,
          background: isDark
            ? 'radial-gradient(circle at 12% 8%, rgba(91,115,232,0.12), transparent 31%), radial-gradient(circle at 88% 10%, rgba(75,179,190,0.10), transparent 34%)'
            : 'radial-gradient(circle at 10% 8%, rgba(115,190,231,0.18), transparent 30%), radial-gradient(circle at 88% 0%, rgba(145,190,218,0.16), transparent 34%)',
        }}
      />

      <Box sx={{ position: 'relative', display: 'flex', gap: 1.25, alignItems: 'stretch', minHeight: { lg: 'calc(100vh - 104px)' } }}>
        <DetailPanel />

        <Box sx={{ minWidth: 0, flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 1.1 }}>
          <Paper
            elevation={0}
            sx={{
              px: { xs: 1.25, sm: 1.7 },
              py: 1.15,
              display: 'flex',
              alignItems: { xs: 'stretch', sm: 'center' },
              flexDirection: { xs: 'column', sm: 'row' },
              gap: 1,
              border: `1px solid ${boardBorder}`,
              background: laneBackground,
              backdropFilter: 'blur(14px) saturate(130%)',
            }}
          >
            <Box sx={{ minWidth: 155 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 900, letterSpacing: '-0.02em' }}>作業ボード</Typography>
              <Typography variant="caption" color="text.secondary">ドラッグして状態を変更</Typography>
            </Box>
            <TextField
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="メモ・タグ・プロジェクトを検索…"
              size="small"
              fullWidth
              InputProps={{ startAdornment: <SearchIcon sx={{ mr: 0.8, fontSize: 19, color: 'text.secondary' }} /> }}
              sx={{
                maxWidth: 520,
                '& .MuiOutlinedInput-root': {
                  height: 36,
                  backgroundColor: isDark ? alpha(theme.palette.common.black, 0.12) : 'rgba(255,255,255,0.58)',
                },
              }}
            />
            <Box sx={{ ml: { sm: 'auto' }, display: 'flex', gap: 0.75 }}>
              <Button size="small" variant="outlined" startIcon={<LightbulbOutlinedIcon />} onClick={() => navigate('/idea')}>
                アイデア
              </Button>
              <Button size="small" variant="contained" startIcon={<AddCircleOutlineIcon />} onClick={() => navigate('/memo')}>
                メモ追加
              </Button>
            </Box>
          </Paper>

          <DragDropContext onDragEnd={onDragEnd}>
            <Box sx={{ display: 'grid', gap: 0.9, pb: 1.5 }}>
              {laneDefinitions.map((lane) => {
                const laneMemos = getLaneMemos(lane.id);
                const LaneIcon = lane.icon;
                return (
                  <Droppable key={lane.id} droppableId={`status-${lane.id}`} direction="horizontal">
                    {(provided, snapshot) => (
                      <Paper
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        elevation={0}
                        sx={{
                          position: 'relative',
                          minHeight: 116,
                          pl: 1.05,
                          pr: 0.75,
                          py: 0.8,
                          display: 'grid',
                          gridTemplateColumns: { xs: '88px minmax(0, 1fr)', sm: '130px minmax(0, 1fr)' },
                          gap: 0.8,
                          alignItems: 'stretch',
                          overflow: 'hidden',
                          border: `1px solid ${snapshot.isDraggingOver ? alpha(lane.color, 0.65) : boardBorder}`,
                          background: snapshot.isDraggingOver ? alpha(lane.color, isDark ? 0.12 : 0.08) : laneBackground,
                          backdropFilter: 'blur(14px) saturate(130%)',
                          boxShadow: snapshot.isDraggingOver ? `0 0 0 2px ${alpha(lane.color, 0.08)}` : 'none',
                          transition: 'background-color 160ms ease, border-color 160ms ease',
                          '&::before': {
                            content: '""',
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            bottom: 0,
                            width: 4,
                            backgroundColor: lane.color,
                          },
                        }}
                      >
                        <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', pl: 0.55, minWidth: 0 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.65 }}>
                            <LaneIcon sx={{ fontSize: 18, color: lane.color }} />
                            <Typography sx={{ fontSize: { xs: '0.73rem', sm: '0.82rem' }, fontWeight: 900, whiteSpace: 'nowrap' }}>
                              {lane.title}
                            </Typography>
                          </Box>
                          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.3, fontSize: '0.62rem' }}>
                            {lane.hint}
                          </Typography>
                          <Chip
                            label={`${laneMemos.length}件`}
                            size="small"
                            sx={{ mt: 0.7, width: 'fit-content', height: 19, fontSize: '0.6rem', fontWeight: 800 }}
                          />
                        </Box>

                        <Box sx={{ minWidth: 0, overflowX: 'auto', overflowY: 'hidden', py: 0.25 }}>
                          <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 0.75, minWidth: 'min-content', minHeight: 88 }}>
                            {laneMemos.map((memo, index) => renderCard(memo, index, lane.color))}
                            {laneMemos.length === 0 && (
                              <Box
                                sx={{
                                  width: 210,
                                  minHeight: 84,
                                  borderRadius: 2,
                                  border: `1px dashed ${alpha(lane.color, 0.32)}`,
                                  display: 'grid',
                                  placeItems: 'center',
                                  color: 'text.secondary',
                                  fontSize: '0.7rem',
                                }}
                              >
                                ここへドロップ
                              </Box>
                            )}
                            {provided.placeholder}
                          </Box>
                        </Box>
                      </Paper>
                    )}
                  </Droppable>
                );
              })}
            </Box>
          </DragDropContext>
        </Box>
      </Box>

      <Dialog open={deleteConfirmOpen} onClose={closeDeleteConfirm}>
        <DialogTitle>メモを削除</DialogTitle>
        <DialogContent>
          <Typography>このメモを削除しますか？この操作は元に戻せません。</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDeleteConfirm}>キャンセル</Button>
          <Button onClick={handleDeleteMemo} color="error" variant="contained">削除</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default Dashboard;
