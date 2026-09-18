import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  getDocs,
  setDoc,
  where
} from 'firebase/firestore';
import {
  Box,
  Typography,
  TextField,
  Button,
  Paper,
  Chip,
  IconButton,
  Grid
} from '@mui/material';
import { getContrastRatio } from '@mui/material/styles';
import { Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon, Clear as ClearIcon, Cancel as CancelIcon, ContentCopy as ContentCopyIcon } from '@mui/icons-material';
import { useLocation } from 'react-router-dom';



// Helper to convert hex to HSL
function hexToHsl(hex) {
  let r = 0, g = 0, b = 0;
  // handle 3-digit hex
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else if (hex.length === 7) {
    r = parseInt(hex.substring(1, 3), 16);
    g = parseInt(hex.substring(3, 5), 16);
    b = parseInt(hex.substring(5, 7), 16);
  }
  r /= 255;
  g /= 255;
  b /= 255;

  let max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // achromatic
  } else {
    let d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
      default: break; // Add default case
    }
    h /= 6;
  }

  return [h * 360, s * 100, l * 100];
}

// Helper to convert HSL to hex
function hslToHex(h, s, l) {
  l /= 100;
  const a = s * Math.min(l, 1 - l) / 100;
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const isPortalIdea = (idea) => (
  idea?.owner === 'portal'
  || (Boolean(idea?.content) && !idea?.createdBy && !idea?.maturity && !idea?.spaceId)
);

// Function to generate a consistent color from a string (tag)
const getTagColor = (tag) => {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  let color = '#';
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xFF;
    color += ('00' + value.toString(16)).substr(-2);
  }
  return color;
};

function Idea() {
  const [ideas, setIdeas] = useState([]);
  const [content, setContent] = useState(''); // Renamed from description
  const [allTags, setAllTags] = useState([]); // All available tags from Firestore
  const [selectedTags, setSelectedTags] = useState([]); // Tags for the current idea
  const [newTagInput, setNewTagInput] = useState(''); // For adding new tags
  const [editingIdea, setEditingIdea] = useState(null);
  const [filterTag, setFilterTag] = useState(null); // New state for filtering
  const location = useLocation();

  // Fetch ideas from Firestore
  useEffect(() => {
    const q = query(collection(db, 'ideas'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedIdeas = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(isPortalIdea);
      setIdeas(fetchedIdeas);
    });
    return () => unsubscribe();
  }, []);

  // Effect to check for idea ID in URL and set form for editing
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ideaId = params.get('id');
    if (ideaId && ideas.length > 0) {
      const ideaToEdit = ideas.find(idea => idea.id === ideaId);
      if (ideaToEdit) {
        handleEdit(ideaToEdit);
      }
    } else if (location.state && location.state.selectedTag) {
      setSelectedTags([location.state.selectedTag]);
    }
  }, [location.search, location.state, ideas]);

  // Fetch all tags from Firestore in real-time
  useEffect(() => {
    const tagsCollectionRef = collection(db, 'tags');
    const unsubscribe = onSnapshot(tagsCollectionRef, (snapshot) => {
      const fetchedTags = snapshot.docs.map(doc => doc.id); // Strictly use doc.id for tag names
      setAllTags(fetchedTags);
    });
    return () => unsubscribe();
  }, []);

  const handleSaveIdea = async () => {
    if (content.trim() === '') return;

    const ideaData = {
      content,
      tags: selectedTags, // Use selectedTags directly
      owner: 'portal',
      updatedAt: serverTimestamp(),
    };

    try {
      if (editingIdea) {
        // Update existing idea
        const ideaRef = doc(db, 'ideas', editingIdea.id);
        await updateDoc(ideaRef, ideaData);
      } else {
        // Add new idea
        await addDoc(collection(db, 'ideas'), {
          ...ideaData,
          createdAt: serverTimestamp(),
        });
      }

      // Reset form
      setContent('');
      setSelectedTags([]);
      setNewTagInput('');
      setEditingIdea(null);
    } catch (error) {
      console.error("Error saving idea: ", error);
    }
  };

  const handleEdit = (idea) => {
    setEditingIdea(idea);
    setContent(idea.content);
    setSelectedTags(idea.tags || []);
  };

  const handleDelete = async (id) => {
    if (window.confirm('本当にこのアイデアを削除しますか？')) {
        try {
            await deleteDoc(doc(db, 'ideas', id));
        } catch (error) {
            console.error("Error deleting idea: ", error);
        }
    }
  };

  const cancelEdit = () => {
    setEditingIdea(null);
    setContent('');
    setSelectedTags([]);
    setNewTagInput('');
  };

  const handleTagClick = (tag) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter(t => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const handleAddNewTag = async () => {
    const trimmedTag = newTagInput.trim();
    if (trimmedTag && !allTags.includes(trimmedTag)) {
      console.log(`Attempting to save new tag to Firestore: ${trimmedTag}`);
      try {
        await setDoc(doc(db, 'tags', trimmedTag), {}); // Use tag name as document ID
        console.log(`Successfully saved tag to Firestore: ${trimmedTag}`);
        setSelectedTags(prevTags => [...prevTags, trimmedTag]); // Add to selectedTags after successful save
        setNewTagInput('');
      } catch (tagError) {
        console.error(`Error saving tag ${trimmedTag} to Firestore:`, tagError);
      }
    } else if (trimmedTag && allTags.includes(trimmedTag) && !selectedTags.includes(trimmedTag)) {
      // If tag already exists in Firestore and not yet selected for current idea
      setSelectedTags(prevTags => [...prevTags, trimmedTag]);
      setNewTagInput('');
    }
  };

  const handleDeleteTag = async (tagToDelete) => {
    if (window.confirm(`本当にタグ「${tagToDelete}」を削除しますか？このタグが使われているアイデアからも削除されます。`)) {
      try {
        // Check if the tag is used by any idea
        const ideasUsingTagQuery = query(collection(db, 'ideas'), where('tags', 'array-contains', tagToDelete));
        const ideasUsingTagSnapshot = await getDocs(ideasUsingTagQuery);

        const portalIdeasUsingTag = ideasUsingTagSnapshot.docs
          .map(snapshotDoc => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
          .filter(isPortalIdea);
        if (portalIdeasUsingTag.length > 0) {
          alert(`タグ「${tagToDelete}」は${portalIdeasUsingTag.length}件のアイデアで使用されているため削除できません。`);
          return;
        }

        // If not used, delete the tag from Firestore
        await deleteDoc(doc(db, 'tags', tagToDelete));
        console.log(`Successfully deleted tag: ${tagToDelete}`);
        // allTags will be updated by the onSnapshot listener
      } catch (error) {
        console.error(`Error deleting tag ${tagToDelete}:`, error);
      }
    }
  };

  // Filtered ideas based on filterTag
  const filteredIdeas = filterTag
    ? ideas.filter(idea => idea.tags && idea.tags.includes(filterTag))
    : ideas;

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>アイデア管理</Typography>

      {/* Input Form */}
      <Paper sx={{ p: 2, mb: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">{editingIdea ? 'アイデアを編集' : '新しいアイデアを追加'}</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
              <Button variant="contained" onClick={handleSaveIdea} startIcon={<AddIcon />}>
                {editingIdea ? '更新' : '保存'}
              </Button>
              {editingIdea && (
                  <Button variant="outlined" onClick={cancelEdit} startIcon={<ClearIcon />}>
                      キャンセル
                  </Button>
              )}
          </Box>
        </Box>
        <TextField
          label="アイデア内容"
          fullWidth
          multiline
          rows={4}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          sx={{ mb: 2 }}
        />

        <Typography variant="subtitle1" gutterBottom>タグ</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
          {allTags.map(tag => (
            <Chip
              key={tag}
              label={tag}
              onClick={() => handleTagClick(tag)}
              onDelete={() => handleDeleteTag(tag)} // Add onDelete handler
              sx={{
                backgroundColor: selectedTags.includes(tag) ? hslToHex(...hexToHsl(getTagColor(tag)).map((val, i) => i === 2 ? Math.min(100, val + 30) : val)) : 'transparent', // 選択時は背景色あり
                color: selectedTags.includes(tag) ? (getContrastRatio(hslToHex(...hexToHsl(getTagColor(tag)).map((val, i) => i === 2 ? Math.min(100, val + 30) : val)), '#fff') > 4.5 ? '#fff' : '#000') : 'inherit', // 選択時はコントラスト調整、非選択時はデフォルト
                fontWeight: 'bold',
                borderColor: getTagColor(tag), // アウトラインの色をタグの色に合わせる
                '&:hover': {
                  backgroundColor: selectedTags.includes(tag) ? hslToHex(...hexToHsl(getTagColor(tag)).map((val, i) => i === 2 ? Math.min(100, val + 20) : val)) : 'rgba(0, 0, 0, 0.04)', // ホバー時は少し濃く、非選択時はデフォルトのホバー
                  opacity: 0.9,
                },
              }}
              variant="outlined" // 常にアウトライン
              deleteIcon={<CancelIcon />}
            />
          ))}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <TextField
            label="新しいタグ"
            value={newTagInput}
            onChange={(e) => setNewTagInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAddNewTag()}
            size="small"
            variant="outlined"
          />
          <Button onClick={handleAddNewTag} variant="contained" size="small">
            追加
          </Button>
        </Box>
      </Paper>

      {/* Filter Tags */}
      <Typography variant="subtitle1" gutterBottom>タグでフィルタ</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 4 }}>
        {allTags.map(tag => (
          <Chip
            key={`filter-${tag}`}
            label={tag}
            onClick={() => setFilterTag(filterTag === tag ? null : tag)} // Toggle filter
            sx={{
              backgroundColor: filterTag === tag ? hslToHex(...hexToHsl(getTagColor(tag)).map((val, i) => i === 2 ? Math.min(100, val + 30) : val)) : 'transparent', // 選択時は背景色あり
              color: filterTag === tag ? (getContrastRatio(hslToHex(...hexToHsl(getTagColor(tag)).map((val, i) => i === 2 ? Math.min(100, val + 30) : val)), '#fff') > 4.5 ? '#fff' : '#000') : 'inherit', // 選択時はコントラスト調整、非選択時はデフォルト
              fontWeight: 'bold',
              borderColor: getTagColor(tag), // アウトラインの色をタグの色に合わせる
              '&:hover': {
                                backgroundColor: filterTag === tag ? hslToHex(...hexToHsl(getTagColor(tag)).map((val, i) => i === 2 ? Math.min(100, val + 20) : val)) : 'rgba(0, 0, 0, 0.04)', // ホバー時は少し濃く、非選択時はデフォルトのホバー
                opacity: 0.9,
              },
            }}
            variant="outlined" // 常にアウトライン
          />
        ))}
        {filterTag && (
          <Chip
            label="クリア"
            onClick={() => setFilterTag(null)}
            onDelete={() => setFilterTag(null)}
            color="info"
            variant="outlined"
            deleteIcon={<ClearIcon />}
            sx={{ fontWeight: 'bold' }}
          />
        )}
      </Box>

      {/* Idea Cards */}
      <Grid container spacing={3}>
        {filteredIdeas.map(idea => (
          <Grid item xs={12} sm={6} md={4} key={idea.id}>
            <Paper
              sx={{
                p: 2,
                height: '100%',
                // transform: getRandomRotation(), // 回転を無効化
                // transition: 'transform 0.2s ease-in-out', // トランジションを無効化
                // '&:hover': { transform: 'scale(1.05)' }, // ホバー時の拡大を無効化
                backgroundColor: idea.tags && idea.tags.length > 0 ? hslToHex(...hexToHsl(getTagColor(idea.tags[0])).map((val, i) => i === 2 ? Math.max(20, val - 30) : val)) : '#f0f0f0', // Apply subdued color based on first tag
                color: idea.tags && idea.tags.length > 0 ? (getContrastRatio(hslToHex(...hexToHsl(getTagColor(idea.tags[0])).map((val, i) => i === 2 ? Math.max(20, val - 30) : val)), '#fff') > 4.5 ? '#fff' : '#000') : '#000', // Adjust text color for contrast
              }}
            >
              <Typography variant="body2" sx={{ my: 2, whiteSpace: 'pre-wrap' }}>{idea.content}</Typography>
              <Box sx={{ mb: 1 }}>
                {idea.tags && idea.tags.map(tag => <Chip key={tag} label={tag} size="small" sx={{ mr: 0.5 }} />)}
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
                <IconButton size="small" onClick={() => navigator.clipboard.writeText(idea.content)}><ContentCopyIcon /></IconButton>
                <IconButton size="small" onClick={() => handleEdit(idea)}><EditIcon /></IconButton>
                <IconButton size="small" onClick={() => handleDelete(idea.id)}><DeleteIcon /></IconButton>
              </Box>
            </Paper>
          </Grid>
        ))}
      </Grid>

      </Box>
  );
}

export default Idea;
