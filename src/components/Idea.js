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
  Grid,
  useTheme
} from '@mui/material';
import { getContrastRatio } from '@mui/material/styles';
import { Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon, Clear as ClearIcon, Cancel as CancelIcon, ContentCopy as ContentCopyIcon } from '@mui/icons-material';

// Function to generate a random rotation angle
const getRandomRotation = () => `rotate(${(Math.random() - 0.5) * 4}deg)`;

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
  const theme = useTheme();

  // Fetch ideas from Firestore
  useEffect(() => {
    const q = query(collection(db, 'ideas'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedIdeas = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setIdeas(fetchedIdeas);
    });
    return () => unsubscribe();
  }, []);

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

        if (!ideasUsingTagSnapshot.empty) {
          alert(`タグ「${tagToDelete}」は${ideasUsingTagSnapshot.size}件のアイデアで使用されているため削除できません。`);
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
        <Typography variant="h6">{editingIdea ? 'アイデアを編集' : '新しいアイデアを追加'}</Typography>
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
              color={selectedTags.includes(tag) ? 'primary' : 'default'}
              variant={selectedTags.includes(tag) ? 'filled' : 'outlined'}
              deleteIcon={<CancelIcon />}
            />
          ))}
        </Box>

        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <TextField
            label="新しいタグを追加"
            fullWidth
            value={newTagInput}
            onChange={(e) => setNewTagInput(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleAddNewTag();
              }
            }}
          />
          <Button variant="outlined" onClick={handleAddNewTag}>
            追加
          </Button>
        </Box>

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
      </Paper>

      {/* Filter Tags */}
      <Typography variant="subtitle1" gutterBottom>タグでフィルタ</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 4 }}>
        {allTags.map(tag => (
          <Chip
            key={`filter-${tag}`}
            label={tag}
            onClick={() => setFilterTag(filterTag === tag ? null : tag)} // Toggle filter
            color={filterTag === tag ? 'secondary' : 'default'}
            variant={filterTag === tag ? 'filled' : 'outlined'}
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
                transform: getRandomRotation(),
                transition: 'transform 0.2s ease-in-out',
                '&:hover': { transform: 'scale(1.05)' },
                backgroundColor: idea.tags && idea.tags.length > 0 ? getTagColor(idea.tags[0]) : '#f0f0f0', // Apply color based on first tag
                color: idea.tags && idea.tags.length > 0 ? (getContrastRatio(getTagColor(idea.tags[0]), '#fff') > 4.5 ? '#fff' : '#000') : '#000', // Adjust text color for contrast
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
