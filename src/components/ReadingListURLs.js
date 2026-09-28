import React, { useState, useEffect } from 'react';
import { collection, addDoc, onSnapshot, deleteDoc, doc, serverTimestamp, query, orderBy, updateDoc } from '../documentDbClient';
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
  IconButton,
  TextField,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Checkbox,
  Chip,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import { Delete as DeleteIcon, OpenInNew as OpenInNewIcon } from '@mui/icons-material';

function ReadingListURLs() {
  const [urls, setUrls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newUrl, setNewUrl] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [urlToDelete, setUrlToDelete] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all'); // 'all', 'read', 'unread'
  const [filterTag, setFilterTag] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'reading_list_urls'), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const fetchedUrls = [];
        snapshot.forEach((doc) => {
          fetchedUrls.push({ id: doc.id, ...doc.data() });
        });
        setUrls(fetchedUrls);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching reading list URLs:', err);
        setError('URLリストの読み込み中にエラーが発生しました。');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const handleAddUrl = async (urlToAdd, titleToAdd) => {
    if (urlToAdd.trim() === '') {
      alert('URLを入力してください。');
      return;
    }

    try {
      await addDoc(collection(db, 'reading_list_urls'), {
        url: urlToAdd,
        title: titleToAdd,
        description: '',
        image: '',
        read: false,
        tags: [],
        createdAt: serverTimestamp(),
      });
      if (urlToAdd === newUrl) {
        setNewUrl('');
        setNewTitle('');
      }
    } catch (e) {
      console.error('Error adding document: ', e);
      if (urlToAdd === newUrl) {
        alert('URLの追加に失敗しました。');
      }
    }
  };

  const handleManualAdd = () => {
    handleAddUrl(newUrl, newTitle);
  };

  const handleDeleteClick = (urlId) => {
    setUrlToDelete(urlId);
    setDeleteConfirmOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!urlToDelete) return;
    try {
      await deleteDoc(doc(db, 'reading_list_urls', urlToDelete));
      console.log('URLを削除しました:', urlToDelete);
    } catch (e) {
      console.error('Error deleting document: ', e);
      alert('URLの削除に失敗しました。');
    }
    setDeleteConfirmOpen(false);
    setUrlToDelete(null);
  };

  const handleDeleteCancel = () => {
    setDeleteConfirmOpen(false);
    setUrlToDelete(null);
  };

  const handleToggleRead = async (id, currentReadStatus) => {
    const urlRef = doc(db, 'reading_list_urls', id);
    try {
      await updateDoc(urlRef, {
        read: !currentReadStatus,
      });
    } catch (e) {
      console.error('Error updating read status: ', e);
      alert('既読ステータスの更新に失敗しました。');
    }
  };

  const handleAddTag = async (id, currentTags, newTag) => {
    if (newTag.trim() === '') return;
    const urlRef = doc(db, 'reading_list_urls', id);
    const updatedTags = [...currentTags, newTag.trim()];
    try {
      await updateDoc(urlRef, {
        tags: updatedTags,
      });
    } catch (e) {
      console.error('Error adding tag: ', e);
      alert('タグの追加に失敗しました。');
    }
  };

  const handleDeleteTag = async (id, currentTags, tagToDelete) => {
    const urlRef = doc(db, 'reading_list_urls', id);
    const updatedTags = currentTags.filter((tag) => tag !== tagToDelete);
    try {
      await updateDoc(urlRef, {
        tags: updatedTags,
      });
    } catch (e) {
      console.error('Error deleting tag: ', e);
      alert('タグの削除に失敗しました。');
    }
  };

  const handleTagInputKeyPress = (event, id, currentTags) => {
    if (event.key === 'Enter') {
      handleAddTag(id, currentTags, event.target.value);
      event.target.value = ''; // Clear the input field
    }
  };

  const filteredUrls = urls.filter((item) => {
    // Filter by read status
    if (filterStatus === 'read' && !item.read) {
      return false;
    }
    if (filterStatus === 'unread' && item.read) {
      return false;
    }

    // Filter by tag
    if (filterTag && (!item.tags || !item.tags.some(tag => tag.toLowerCase().includes(filterTag.toLowerCase())))) {
      return false;
    }

    return true;
  });

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
        後で読む (URLリスト)
      </Typography>

      <Paper sx={{ p: 2, mb: 3 }}>
        <TextField
          label="URL"
          variant="outlined"
          fullWidth
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          sx={{ mb: 2 }}
        />
        <TextField
          label="タイトル"
          variant="outlined"
          fullWidth
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          sx={{ mb: 2 }}
        />
        <Button variant="contained" onClick={handleManualAdd}>
          追加
        </Button>
      </Paper>

      <Box sx={{ mb: 3 }}>
        <ToggleButtonGroup
          value={filterStatus}
          exclusive
          onChange={(event, newStatus) => setFilterStatus(newStatus)}
          aria-label="text alignment"
          sx={{ mr: 2 }}
        >
          <ToggleButton value="all" aria-label="all">
            すべて
          </ToggleButton>
          <ToggleButton value="read" aria-label="read">
            既読
          </ToggleButton>
          <ToggleButton value="unread" aria-label="unread">
            未読
          </ToggleButton>
        </ToggleButtonGroup>
        <TextField
          label="タグで絞り込み"
          variant="outlined"
          size="small"
          value={filterTag}
          onChange={(e) => setFilterTag(e.target.value)}
        />
      </Box>

      {filteredUrls.length === 0 ? (
        <Typography variant="body1">現在、保存されたURLはありません。</Typography>
      ) : (
        <List>
          {filteredUrls.map((item) => (
            <Paper key={item.id} sx={{ mb: 2, p: 2, display: 'flex', alignItems: 'flex-start' }}>
              {item.image && (
                <Box
                  component="img"
                  src={item.image}
                  alt="Thumbnail"
                  sx={{
                    width: 100,
                    height: 100,
                    objectFit: 'cover',
                    mr: 2,
                    borderRadius: 1,
                  }}
                />
              )}
              <ListItem
                sx={{ flexGrow: 1, p: 0, alignItems: 'flex-start' }} // Adjust padding to fit within Paper
                secondaryAction={
                  <Box>
                    <IconButton edge="end" aria-label="open" onClick={() => {
                      window.open(item.url, '_blank');
                      handleToggleRead(item.id, item.read);
                    }}>
                      <OpenInNewIcon />
                    </IconButton>
                    <IconButton edge="end" aria-label="delete" onClick={() => handleDeleteClick(item.id)}>
                      <DeleteIcon />
                    </IconButton>
                  </Box>
                }
              >
                <ListItemText
                  primary={item.title}
                  secondary={
                    <>
                      <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                        {item.url}
                      </Typography>
                      {item.description && (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                          {item.description}
                        </Typography>
                      )}
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={item.read || false}
                            onChange={() => handleToggleRead(item.id, item.read)}
                            name="readStatus"
                            color="primary"
                          />
                        }
                        label="既読"
                      />
                      <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {item.tags && item.tags.map((tag) => (
                          <Chip
                            key={tag}
                            label={tag}
                            onDelete={() => handleDeleteTag(item.id, item.tags, tag)}
                            size="small"
                          />
                        ))}
                      </Box>
                      <TextField
                        label="タグを追加"
                        variant="standard"
                        size="small"
                        onKeyPress={(e) => handleTagInputKeyPress(e, item.id, item.tags || [])}
                        sx={{ mt: 1 }}
                      />
                    </>
                  }
                />
              </ListItem>
            </Paper>
          ))}
        </List>
      )}

      <Dialog
        open={deleteConfirmOpen}
        onClose={handleDeleteCancel}
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
      >
        <DialogTitle id="alert-dialog-title">{"URLを削除しますか？"}</DialogTitle>
        <DialogContent>
          <DialogContentText id="alert-dialog-description">
            このURLをリストから完全に削除します。この操作は元に戻せません。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel}>キャンセル</Button>
          <Button onClick={handleDeleteConfirm} autoFocus color="error">
            削除
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default ReadingListURLs;
