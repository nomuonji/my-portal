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
} from '../documentDbClient';
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

function Stock() {
  const [stocks, setStocks] = useState([]);
  const [content, setContent] = useState('');
  const [allTags, setAllTags] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [editingStock, setEditingStock] = useState(null);
  const [filterTag, setFilterTag] = useState(null);
  const location = useLocation();

  // Fetch stocks from Firestore
  useEffect(() => {
    const q = query(collection(db, 'stocks'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedStocks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setStocks(fetchedStocks);
    });
    return () => unsubscribe();
  }, []);

  // Effect to check for stock ID in URL and set form for editing
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const stockId = params.get('id');
    if (stockId && stocks.length > 0) {
      const stockToEdit = stocks.find(stock => stock.id === stockId);
      if (stockToEdit) {
        handleEdit(stockToEdit);
      }
    } else if (location.state && location.state.selectedTag) {
      setSelectedTags([location.state.selectedTag]);
    }
  }, [location.search, location.state, stocks]);

  // Fetch all tags from Firestore in real-time
  useEffect(() => {
    const tagsCollectionRef = collection(db, 'stock_tags');
    const unsubscribe = onSnapshot(tagsCollectionRef, (snapshot) => {
      const fetchedTags = snapshot.docs.map(doc => doc.id);
      setAllTags(fetchedTags);
    });
    return () => unsubscribe();
  }, []);

  const handleSaveStock = async () => {
    if (content.trim() === '') return;

    const stockData = {
      content,
      tags: selectedTags,
      updatedAt: serverTimestamp(),
    };

    try {
      if (editingStock) {
        const stockRef = doc(db, 'stocks', editingStock.id);
        await updateDoc(stockRef, stockData);
      } else {
        await addDoc(collection(db, 'stocks'), {
          ...stockData,
          createdAt: serverTimestamp(),
        });
      }

      setContent('');
      setSelectedTags([]);
      setNewTagInput('');
      setEditingStock(null);
    } catch (error) {
      console.error("Error saving stock: ", error);
    }
  };

  const handleEdit = (stock) => {
    setEditingStock(stock);
    setContent(stock.content);
    setSelectedTags(stock.tags || []);
  };

  const handleDelete = async (id) => {
    if (window.confirm('本当にこのストックを削除しますか？')) {
        try {
            await deleteDoc(doc(db, 'stocks', id));
        } catch (error) {
            console.error("Error deleting stock: ", error);
        }
    }
  };

  const cancelEdit = () => {
    setEditingStock(null);
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
      try {
        await setDoc(doc(db, 'stock_tags', trimmedTag), {});
        setSelectedTags(prevTags => [...prevTags, trimmedTag]);
        setNewTagInput('');
      } catch (tagError) {
        console.error(`Error saving tag ${trimmedTag} to Firestore:`, tagError);
      }
    } else if (trimmedTag && allTags.includes(trimmedTag) && !selectedTags.includes(trimmedTag)) {
      setSelectedTags(prevTags => [...prevTags, trimmedTag]);
      setNewTagInput('');
    }
  };

  const handleDeleteTag = async (tagToDelete) => {
    if (window.confirm(`本当にタグ「${tagToDelete}」を削除しますか？このタグが使われているストックからも削除されます。`)) {
      try {
        const stocksUsingTagQuery = query(collection(db, 'stocks'), where('tags', 'array-contains', tagToDelete));
        const stocksUsingTagSnapshot = await getDocs(stocksUsingTagQuery);

        if (!stocksUsingTagSnapshot.empty) {
          alert(`タグ「${tagToDelete}」は${stocksUsingTagSnapshot.size}件のストックで使用されているため削除できません。`);
          return;
        }

        await deleteDoc(doc(db, 'stock_tags', tagToDelete));
      } catch (error) {
        console.error(`Error deleting tag ${tagToDelete}:`, error);
      }
    }
  };

  const filteredStocks = filterTag
    ? stocks.filter(stock => stock.tags && stock.tags.includes(filterTag))
    : stocks;

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>ストック管理</Typography>

      <Paper sx={{ p: 2, mb: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">{editingStock ? 'ストックを編集' : '新しいストックを追加'}</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
              <Button variant="contained" onClick={handleSaveStock} startIcon={<AddIcon />}>
                {editingStock ? '更新' : '保存'}
              </Button>
              {editingStock && (
                  <Button variant="outlined" onClick={cancelEdit} startIcon={<ClearIcon />}>
                      キャンセル
                  </Button>
              )}
          </Box>
        </Box>
        <TextField
          label="ストック内容"
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
              onDelete={() => handleDeleteTag(tag)}
              sx={{
                backgroundColor: selectedTags.includes(tag) ? hslToHex(...hexToHsl(getTagColor(tag)).map((val, i) => i === 2 ? Math.min(100, val + 30) : val)) : 'transparent',
                color: selectedTags.includes(tag) ? (getContrastRatio(hslToHex(...hexToHsl(getTagColor(tag)).map((val, i) => i === 2 ? Math.min(100, val + 30) : val)), '#fff') > 4.5 ? '#fff' : '#000') : 'inherit',
                fontWeight: 'bold',
                borderColor: getTagColor(tag),
                '&:hover': {
                  backgroundColor: selectedTags.includes(tag) ? hslToHex(...hexToHsl(getTagColor(tag)).map((val, i) => i === 2 ? Math.min(100, val + 20) : val)) : 'rgba(0, 0, 0, 0.04)',
                  opacity: 0.9,
                },
              }}
              variant="outlined"
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

      <Typography variant="subtitle1" gutterBottom>タグでフィルタ</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 4 }}>
        {allTags.map(tag => (
          <Chip
            key={`filter-${tag}`}
            label={tag}
            onClick={() => setFilterTag(filterTag === tag ? null : tag)}
            sx={{
              backgroundColor: filterTag === tag ? hslToHex(...hexToHsl(getTagColor(tag)).map((val, i) => i === 2 ? Math.min(100, val + 30) : val)) : 'transparent',
              color: filterTag === tag ? (getContrastRatio(hslToHex(...hexToHsl(getTagColor(tag)).map((val, i) => i === 2 ? Math.min(100, val + 30) : val)), '#fff') > 4.5 ? '#fff' : '#000') : 'inherit',
              fontWeight: 'bold',
              borderColor: getTagColor(tag),
              '&:hover': {
                                backgroundColor: filterTag === tag ? hslToHex(...hexToHsl(getTagColor(tag)).map((val, i) => i === 2 ? Math.min(100, val + 20) : val)) : 'rgba(0, 0, 0, 0.04)',
                opacity: 0.9,
              },
            }}
            variant="outlined"
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

      <Grid container spacing={3}>
        {filteredStocks.map(stock => (
          <Grid item xs={12} sm={6} md={4} key={stock.id}>
            <Paper
              sx={{
                p: 2,
                height: '100%',
                backgroundColor: stock.tags && stock.tags.length > 0 ? hslToHex(...hexToHsl(getTagColor(stock.tags[0])).map((val, i) => i === 2 ? Math.max(20, val - 30) : val)) : '#f0f0f0',
                color: stock.tags && stock.tags.length > 0 ? (getContrastRatio(hslToHex(...hexToHsl(getTagColor(stock.tags[0])).map((val, i) => i === 2 ? Math.max(20, val - 30) : val)), '#fff') > 4.5 ? '#fff' : '#000') : '#000',
              }}
            >
              <Typography variant="body2" sx={{ my: 2, whiteSpace: 'pre-wrap' }}>{stock.content}</Typography>
              <Box sx={{ mb: 1 }}>
                {stock.tags && stock.tags.map(tag => <Chip key={tag} label={tag} size="small" sx={{ mr: 0.5 }} />)}
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
                <IconButton size="small" onClick={() => navigator.clipboard.writeText(stock.content)}><ContentCopyIcon /></IconButton>
                <IconButton size="small" onClick={() => handleEdit(stock)}><EditIcon /></IconButton>
                <IconButton size="small" onClick={() => handleDelete(stock.id)}><DeleteIcon /></IconButton>
              </Box>
            </Paper>
          </Grid>
        ))}
      </Grid>

      </Box>
  );
}

export default Stock;