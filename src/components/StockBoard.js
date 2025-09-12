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



import { getBackgroundStyle, getTagColor, hexToHsl, hslToHex } from '../utils/color';


function StockBoard() {
  const [stocks, setStocks] = useState([]);
  const [allTags, setAllTags] = useState([]); // All available tags from Firestore
  const [filterTag, setFilterTag] = useState(null); // New state for filtering
  const [anchorEl, setAnchorEl] = useState(null);
  const [selectedStock, setSelectedStock] = useState(null);
  const navigate = useNavigate();
  const defaultStyle = { backgroundColor: '#f0f0f0', color: '#000' };

  // Fetch stocks from Firestore
  useEffect(() => {
    const q = query(collection(db, 'stocks'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedStocks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setStocks(fetchedStocks);
    });
    return () => unsubscribe();
  }, []);

  // Fetch all tags from Firestore in real-time
  useEffect(() => {
    const tagsCollectionRef = collection(db, 'stock_tags');
    const unsubscribe = onSnapshot(tagsCollectionRef, (snapshot) => {
      const fetchedTags = snapshot.docs.map(doc => doc.id); // Strictly use doc.id for tag names
      setAllTags(fetchedTags);
    });
    return () => unsubscribe();
  }, []);

  // Filtered stocks based on filterTag
  const filteredStocks = filterTag
    ? stocks.filter(stock => stock.tags && stock.tags.includes(filterTag))
    : stocks;

  const handleCardClick = (event, stock) => {
    event.preventDefault(); // デフォルトの右クリックメニューを無効化
    setSelectedStock(stock);
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedStock(null);
  };

  const handleCopy = () => {
    if (selectedStock) {
      navigator.clipboard.writeText(selectedStock.content);
      handleMenuClose();
    }
  };

  const handleEdit = () => {
    if (selectedStock) {
      navigate(`/stock?id=${selectedStock.id}`);
      handleMenuClose();
    }
  };

  const handleDelete = async () => {
    if (selectedStock && window.confirm('本当にこのストックを削除しますか？')) {
      try {
        await deleteDoc(doc(db, 'stocks', selectedStock.id));
        handleMenuClose();
      } catch (error) {
        console.error("Error deleting stock: ", error);
      }
    }
  };

  return (
    <Box sx={{ p: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" gutterBottom>ストックボード</Typography>
        <Button
          variant="contained"
          color="primary"
          startIcon={<AddCircleOutlineIcon />}
          onClick={() => navigate('/stock', { state: { selectedTag: filterTag } })}
        >
          ストック管理
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

      <Grid container spacing={1}>
        {filteredStocks.map(stock => (
          <Grid item xs={12} sm={6} md={6} lg={6} xl={6} key={stock.id}>
            <Paper
              sx={{
                p: 1,
                position: 'relative',
                ...getBackgroundStyle(stock.tags, defaultStyle),
              }}
              onContextMenu={(event) => handleCardClick(event, stock)}
            >
              <Typography variant="body2" sx={{ fontSize: '0.75rem', mb: 0.5, whiteSpace: 'pre-wrap' }}>
                {stock.content}
              </Typography>
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

export default StockBoard;