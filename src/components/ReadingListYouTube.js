import React, { useState, useEffect } from 'react';
import { collection, addDoc, onSnapshot, deleteDoc, doc, serverTimestamp, query, orderBy, updateDoc } from 'firebase/firestore';
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

// Placeholder for YouTube API Key - User needs to replace this
// For production, consider moving this to an environment variable (e.g., .env file)
// and accessing it via process.env.REACT_APP_YOUTUBE_API_KEY
const YOUTUBE_API_KEY = 'YOUR_YOUTUBE_API_KEY'; // TODO: Replace with actual API key

// Helper to extract YouTube video ID
const getYouTubeVideoId = (url) => {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
};

// Helper to fetch YouTube video details
const fetchYouTubeVideoDetails = async (videoId, apiKey) => {
  if (!videoId || !apiKey || apiKey === 'YOUR_YOUTUBE_API_KEY') {
    console.warn('YouTube API Key is missing or invalid. Cannot fetch video details.');
    return null;
  }
  const apiUrl = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${apiKey}&part=snippet,contentDetails`;
  try {
    const response = await fetch(apiUrl);
    const data = await response.json();
    if (data.items && data.items.length > 0) {
      const item = data.items[0];
      return {
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnail: item.snippet.thumbnails.high.url,
        duration: item.contentDetails.duration, // e.g., PT1M3S
      };
    }
  } catch (error) {
    console.error('Error fetching YouTube video details:', error);
  }
  return null;
};

function ReadingListYouTube() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newUrl, setNewUrl] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [videoToDelete, setVideoToDelete] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all'); // 'all', 'read', 'unread'
  const [filterTag, setFilterTag] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'reading_list_youtube'), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const fetchedVideos = [];
        snapshot.forEach((doc) => {
          fetchedVideos.push({ id: doc.id, ...doc.data() });
        });
        setVideos(fetchedVideos);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching reading list YouTube videos:', err);
        setError('YouTube動画リストの読み込み中にエラーが発生しました。');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const handleAddVideo = async (urlToAdd, titleToAdd) => {
    if (urlToAdd.trim() === '') {
      alert('URLを入力してください。');
      return;
    }

    const videoId = getYouTubeVideoId(urlToAdd);
    if (!videoId) {
      alert('有効なYouTube動画URLを入力してください。');
      return;
    }

    let docData = {
      url: urlToAdd,
      title: titleToAdd,
      description: '',
      thumbnail: '',
      read: false,
      tags: [],
      createdAt: serverTimestamp(),
      videoId: videoId,
    };

    const videoDetails = await fetchYouTubeVideoDetails(videoId, YOUTUBE_API_KEY);
    if (videoDetails) {
      docData = {
        ...docData,
        title: videoDetails.title,
        description: videoDetails.description,
        thumbnail: videoDetails.thumbnail,
      };
    }

    try {
      await addDoc(collection(db, 'reading_list_youtube'), docData);
      if (urlToAdd === newUrl) {
        setNewUrl('');
        setNewTitle('');
      }
    } catch (e) {
      console.error('Error adding document: ', e);
      if (urlToAdd === newUrl) {
        alert('動画の追加に失敗しました。');
      }
    }
  };

  const handleManualAdd = () => {
    handleAddVideo(newUrl, newTitle);
  };

  const handleDeleteClick = (videoId) => {
    setVideoToDelete(videoId);
    setDeleteConfirmOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!videoToDelete) return;
    try {
      await deleteDoc(doc(db, 'reading_list_youtube', videoToDelete));
      console.log('動画を削除しました:', videoToDelete);
    } catch (e) {
      console.error('Error deleting document: ', e);
      alert('動画の削除に失敗しました。');
    }
    setDeleteConfirmOpen(false);
    setVideoToDelete(null);
  };

  const handleDeleteCancel = () => {
    setDeleteConfirmOpen(false);
    setVideoToDelete(null);
  };

  const handleToggleRead = async (id, currentReadStatus) => {
    const videoRef = doc(db, 'reading_list_youtube', id);
    try {
      await updateDoc(videoRef, {
        read: !currentReadStatus,
      });
    } catch (e) {
      console.error('Error updating read status: ', e);
      alert('既読ステータスの更新に失敗しました。');
    }
  };

  const handleAddTag = async (id, currentTags, newTag) => {
    if (newTag.trim() === '') return;
    const videoRef = doc(db, 'reading_list_youtube', id);
    const updatedTags = [...currentTags, newTag.trim()];
    try {
      await updateDoc(videoRef, {
        tags: updatedTags,
      });
    } catch (e) {
      console.error('Error adding tag: ', e);
      alert('タグの追加に失敗しました。');
    }
  };

  const handleDeleteTag = async (id, currentTags, tagToDelete) => {
    const videoRef = doc(db, 'reading_list_youtube', id);
    const updatedTags = currentTags.filter((tag) => tag !== tagToDelete);
    try {
      await updateDoc(videoRef, {
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

  const filteredVideos = videos.filter((item) => {
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
        後で見る (YouTube動画リスト)
      </Typography>

      <Paper sx={{ p: 2, mb: 3 }}>
        <TextField
          label="YouTube動画URL"
          variant="outlined"
          fullWidth
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          sx={{ mb: 2 }}
        />
        <TextField
          label="タイトル (任意)"
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
            視聴済み
          </ToggleButton>
          <ToggleButton value="unread" aria-label="unread">
            未視聴
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

      {filteredVideos.length === 0 ? (
        <Typography variant="body1">現在、保存されたYouTube動画はありません。</Typography>
      ) : (
        <List>
          {filteredVideos.map((item) => (
            <Paper key={item.id} sx={{ mb: 2, p: 2, display: 'flex', alignItems: 'flex-start' }}>
              <Box sx={{ mr: 2 }}>
                <iframe
                  width="160" // Smaller size for list view
                  height="90"
                  src={`https://www.youtube.com/embed/${item.videoId}`}
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  title={item.title}
                ></iframe>
              </Box>
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
                        label="視聴済み"
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
        <DialogTitle id="alert-dialog-title">{"動画を削除しますか？"}</DialogTitle>
        <DialogContent>
          <DialogContentText id="alert-dialog-description">
            この動画をリストから完全に削除します。この操作は元に戻せません。
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

export default ReadingListYouTube;
