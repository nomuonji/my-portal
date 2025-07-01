import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  deleteDoc,
  doc
} from 'firebase/firestore';
import {
  Box,
  Typography,
  Grid,
  Paper,
  Chip,
  Button,
  IconButton,
  Menu,
  MenuItem
} from '@mui/material';
import { Clear as ClearIcon, AddCircleOutline as AddCircleOutlineIcon, ContentCopy as ContentCopyIcon, Edit as EditIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

// Function to generate a random rotation angle
const getRandomRotation = () => `rotate(${(Math.random() - 0.5) * 4}deg)`;

function IdeaBoard() {
  const [ideas, setIdeas] = useState([]);
  const [allTags, setAllTags] = useState([]); // All available tags from Firestore
  const [filterTag, setFilterTag] = useState(null); // New state for filtering
  const [anchorEl, setAnchorEl] = useState(null);
  const [selectedIdea, setSelectedIdea] = useState(null);
  const navigate = useNavigate();

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

  // Filtered ideas based on filterTag
  const filteredIdeas = filterTag
    ? ideas.filter(idea => idea.tags && idea.tags.includes(filterTag))
    : ideas;

  const handleCardClick = (event, idea) => {
    setSelectedIdea(idea);
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedIdea(null);
  };

  const handleCopy = () => {
    if (selectedIdea) {
      navigator.clipboard.writeText(selectedIdea.content);
      handleMenuClose();
    }
  };

  const handleEdit = () => {
    if (selectedIdea) {
      navigate(`/idea?id=${selectedIdea.id}`);
      handleMenuClose();
    }
  };

  const handleDelete = async () => {
    if (selectedIdea && window.confirm('本当にこのアイデアを削除しますか？')) {
      try {
        await deleteDoc(doc(db, 'ideas', selectedIdea.id));
        handleMenuClose();
      } catch (error) {
        console.error("Error deleting idea: ", error);
      }
    }
  };

  return (
    <Box sx={{ p: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" gutterBottom>アイデアボード</Typography>
        <Button
          variant="contained"
          color="primary"
          startIcon={<AddCircleOutlineIcon />}
          onClick={() => navigate('/idea')}
        >
          アイデア管理
        </Button>
      </Box>

      {/* Filter Tags */}
      <Typography variant="subtitle1" gutterBottom>タグでフィルタ</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
        {allTags.map(tag => (
          <Chip
            key={`filter-${tag}`}
            label={tag}
            onClick={() => setFilterTag(filterTag === tag ? null : tag)} // Toggle filter
            color={filterTag === tag ? 'primary' : 'default'}
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

      <Grid container spacing={1}>
        {filteredIdeas.map(idea => (
          <Grid item xs={12} sm={6} md={4} lg={3} xl={2} key={idea.id}>
            <Paper
              sx={{
                p: 1,
                height: '100%',
                transform: getRandomRotation(),
                transition: 'transform 0.2s ease-in-out',
                '&:hover': { transform: 'scale(1.05)' },
                overflow: 'hidden', // Hide overflow text
                position: 'relative', // For positioning the copy button
              }}
              onClick={(event) => handleCardClick(event, idea)}
            >
              <Typography variant="body2" sx={{ fontSize: '0.75rem', mb: 0.5, whiteSpace: 'pre-wrap', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical' }}>
                {idea.content}
              </Typography>
              {/* Tags are removed from here */}
            </Paper>
          </Grid>
        ))}
      </Grid>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={handleCopy}>コピー</MenuItem>
        <MenuItem onClick={handleEdit}>編集</MenuItem>
        <MenuItem onClick={handleDelete}>削除</MenuItem>
      </Menu>
    </Box>
  );
}

export default IdeaBoard;