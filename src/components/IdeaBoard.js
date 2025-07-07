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
  Menu,
  MenuItem
} from '@mui/material';
import { getContrastRatio } from '@mui/material/styles';
import { Clear as ClearIcon, AddCircleOutline as AddCircleOutlineIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';



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
    event.preventDefault(); // デフォルトの右クリックメニューを無効化
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

      <Grid container spacing={1}>
        {filteredIdeas.map(idea => (
          <Grid item xs={12} sm={6} md={6} lg={6} xl={6} key={idea.id}>
            <Paper
              sx={{
                p: 1,
                // height: '100%', // 削除
                // transform: getRandomRotation(), // 回転を無効化
                // transition: 'transform 0.2s ease-in-out', // トランジションを無効化
                // '&:hover': { transform: 'scale(1.05)' }, // ホバー時の拡大を無効化
                // overflow: 'hidden', // Hide overflow text // 削除
                position: 'relative', // For positioning the copy button
                backgroundColor: idea.tags && idea.tags.length > 0 ? hslToHex(...hexToHsl(getTagColor(idea.tags[0])).map((val, i) => i === 2 ? Math.max(20, val - 30) : val)) : '#f0f0f0', // Apply subdued color based on first tag
                color: idea.tags && idea.tags.length > 0 ? (getContrastRatio(hslToHex(...hexToHsl(getTagColor(idea.tags[0])).map((val, i) => i === 2 ? Math.max(20, val - 30) : val)), '#fff') > 4.5 ? '#fff' : '#000') : '#000', // Adjust text color for contrast
              }}
              onContextMenu={(event) => handleCardClick(event, idea)} // 右クリックイベントを処理
            >
              <Typography variant="body2" sx={{ fontSize: '0.75rem', mb: 0.5, whiteSpace: 'pre-wrap' }}>
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