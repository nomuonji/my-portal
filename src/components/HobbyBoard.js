import React, { useState, useEffect } from 'react';
import { hobbyDb as db } from '../firebase';
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


function HobbyBoard() {
  const [hobbies, setHobbies] = useState([]);
  const [allTags, setAllTags] = useState([]); // All available tags from Firestore
  const [filterTag, setFilterTag] = useState(null); // New state for filtering
  const [anchorEl, setAnchorEl] = useState(null);
  const [selectedHobby, setSelectedHobby] = useState(null);
  const navigate = useNavigate();
  const defaultStyle = { backgroundColor: '#f0f0f0', color: '#000' };

  // Fetch hobbies from Firestore
  useEffect(() => {
    const q = query(collection(db, 'hobbies'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedHobbies = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setHobbies(fetchedHobbies);
    });
    return () => unsubscribe();
  }, []);

  // Fetch all tags from Firestore in real-time
  useEffect(() => {
    const tagsCollectionRef = collection(db, 'hobby_tags');
    const unsubscribe = onSnapshot(tagsCollectionRef, (snapshot) => {
      const fetchedTags = snapshot.docs.map(doc => doc.id); // Strictly use doc.id for tag names
      setAllTags(fetchedTags);
    });
    return () => unsubscribe();
  }, []);

  // Filtered hobbies based on filterTag
  const filteredHobbies = filterTag
    ? hobbies.filter(hobby => hobby.tags && hobby.tags.includes(filterTag))
    : hobbies;

  const handleCardClick = (event, hobby) => {
    event.preventDefault(); // デフォルトの右クリックメニューを無効化
    setSelectedHobby(hobby);
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedHobby(null);
  };

  const handleCopy = () => {
    if (selectedHobby) {
      navigator.clipboard.writeText(selectedHobby.content);
      handleMenuClose();
    }
  };

  const handleEdit = () => {
    if (selectedHobby) {
      navigate(`/hobby?id=${selectedHobby.id}`);
      handleMenuClose();
    }
  };

  const handleDelete = async () => {
    if (selectedHobby && window.confirm('本当にこの趣味を削除しますか？')) {
      try {
        await deleteDoc(doc(db, 'hobbies', selectedHobby.id));
        handleMenuClose();
      } catch (error) {
        console.error("Error deleting hobby: ", error);
      }
    }
  };

  return (
    <Box sx={{ p: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" gutterBottom>趣味ボード</Typography>
        <Button
          variant="contained"
          color="primary"
          startIcon={<AddCircleOutlineIcon />}
          onClick={() => navigate('/hobby', { state: { selectedTag: filterTag } })}
        >
          趣味管理
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
        {filteredHobbies.map(hobby => (
          <Grid item xs={12} sm={6} md={6} lg={6} xl={6} key={hobby.id}>
            <Paper
              sx={{
                p: 1,
                position: 'relative',
                ...getBackgroundStyle(hobby.tags, defaultStyle),
              }}
              onContextMenu={(event) => handleCardClick(event, hobby)} // 右クリックイベントを処理
            >
              <Typography variant="body2" sx={{ fontSize: '0.75rem', mb: 0.5, whiteSpace: 'pre-wrap' }}>
                {hobby.content}
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

export default HobbyBoard;
