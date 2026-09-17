import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  AddCircleOutline as AddCircleOutlineIcon,
  ContentCopy as ContentCopyIcon,
  EditOutlined as EditOutlinedIcon,
  MoreHoriz as MoreHorizIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';

const formatDate = (value) => {
  if (!value) return '';
  try {
    const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ja-JP', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return '';
  }
};

const colorFromTag = (tag, theme) => {
  if (!tag) return theme.palette.primary.main;
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 55% ${theme.palette.mode === 'dark' ? '66%' : '48%'})`;
};

function CollectionBoard({
  database,
  collectionName,
  tagsCollectionName,
  title,
  eyebrow,
  description,
  manageLabel,
  manageRoute,
  emptyMessage,
  deleteConfirmMessage,
}) {
  const [items, setItems] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [filterTag, setFilterTag] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [anchorEl, setAnchorEl] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const navigate = useNavigate();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  useEffect(() => {
    const q = query(collection(database, collectionName), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      setItems(snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() })));
    });
  }, [database, collectionName]);

  useEffect(() => {
    if (!tagsCollectionName) return undefined;
    return onSnapshot(collection(database, tagsCollectionName), (snapshot) => {
      setAllTags(snapshot.docs.map((snapshotDoc) => snapshotDoc.id));
    });
  }, [database, tagsCollectionName]);

  const filteredItems = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return items.filter((item) => {
      if (filterTag && !(item.tags || []).includes(filterTag)) return false;
      if (!keyword) return true;
      return [item.content, ...(item.tags || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    });
  }, [items, filterTag, searchText]);

  const openMenu = (event, item) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedItem(item);
    setAnchorEl(event.currentTarget);
  };

  const closeMenu = () => {
    setAnchorEl(null);
    setSelectedItem(null);
  };

  const copyItem = async () => {
    if (!selectedItem) return;
    await navigator.clipboard.writeText(selectedItem.content || '');
    closeMenu();
  };

  const editItem = () => {
    if (!selectedItem) return;
    navigate(`${manageRoute}?id=${selectedItem.id}`);
    closeMenu();
  };

  const removeItem = async () => {
    if (!selectedItem || !window.confirm(deleteConfirmMessage)) return;
    await deleteDoc(doc(database, collectionName, selectedItem.id));
    closeMenu();
  };

  const border = isDark
    ? alpha(theme.palette.common.white, 0.09)
    : 'rgba(83, 124, 149, 0.16)';

  return (
    <Box sx={{ minHeight: '100%', p: { xs: 0.25, sm: 0.75 } }}>
      <Paper
        elevation={0}
        sx={{
          mb: 1.5,
          px: { xs: 1.5, sm: 2 },
          py: { xs: 1.5, sm: 1.75 },
          border: `1px solid ${border}`,
          background: isDark ? alpha(theme.palette.background.paper, 0.82) : 'rgba(255,255,255,0.62)',
          backdropFilter: 'blur(18px) saturate(135%)',
        }}
      >
        <Box sx={{ display: 'flex', gap: 2, alignItems: { xs: 'flex-start', md: 'center' }, flexDirection: { xs: 'column', md: 'row' } }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 800, letterSpacing: '0.13em' }}>
              {eyebrow}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.1, flexWrap: 'wrap' }}>
              <Typography variant="h4">{title}</Typography>
              <Chip
                size="small"
                label={`${filteredItems.length} / ${items.length}`}
                sx={{ height: 23, fontSize: '0.66rem', fontWeight: 800 }}
              />
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.55, maxWidth: 720, lineHeight: 1.65 }}>
              {description}
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<AddCircleOutlineIcon />}
            onClick={() => navigate(manageRoute, { state: { selectedTag: filterTag } })}
            sx={{ flexShrink: 0 }}
          >
            {manageLabel}
          </Button>
        </Box>
      </Paper>

      <Paper
        elevation={0}
        sx={{
          mb: 1.5,
          p: 1.25,
          border: `1px solid ${border}`,
          background: isDark ? alpha(theme.palette.background.paper, 0.70) : 'rgba(255,255,255,0.48)',
          backdropFilter: 'blur(14px)',
        }}
      >
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'stretch', md: 'center' }}>
          <TextField
            size="small"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="内容・タグを検索"
            sx={{ width: { xs: '100%', md: 320 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.7, minWidth: 0 }}>
            <Chip
              label="すべて"
              size="small"
              onClick={() => setFilterTag(null)}
              color={!filterTag ? 'primary' : 'default'}
              variant={!filterTag ? 'filled' : 'outlined'}
              sx={{ fontWeight: 700 }}
            />
            {allTags.map((tag) => {
              const selected = filterTag === tag;
              const tagColor = colorFromTag(tag, theme);
              return (
                <Chip
                  key={tag}
                  label={`#${tag}`}
                  size="small"
                  onClick={() => setFilterTag(selected ? null : tag)}
                  variant={selected ? 'filled' : 'outlined'}
                  sx={{
                    fontWeight: 700,
                    borderColor: alpha(tagColor, 0.55),
                    backgroundColor: selected ? alpha(tagColor, isDark ? 0.24 : 0.13) : 'transparent',
                    color: selected ? tagColor : 'text.secondary',
                  }}
                />
              );
            })}
          </Box>
        </Stack>
      </Paper>

      {filteredItems.length === 0 ? (
        <Paper
          elevation={0}
          sx={{
            py: 8,
            px: 2,
            textAlign: 'center',
            border: `1px dashed ${border}`,
            background: isDark ? alpha(theme.palette.background.paper, 0.42) : 'rgba(255,255,255,0.34)',
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>表示できる項目がありません</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.6 }}>{emptyMessage}</Typography>
        </Paper>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 270px), 1fr))',
            gap: 1.25,
          }}
        >
          {filteredItems.map((item) => {
            const tags = item.tags || [];
            const accent = colorFromTag(tags[0], theme);
            return (
              <Paper
                key={item.id}
                elevation={0}
                onContextMenu={(event) => openMenu(event, item)}
                sx={{
                  position: 'relative',
                  minHeight: 150,
                  p: 1.45,
                  pl: 1.7,
                  overflow: 'hidden',
                  border: `1px solid ${border}`,
                  background: isDark ? alpha(theme.palette.background.paper, 0.88) : 'rgba(255,255,255,0.82)',
                  backdropFilter: 'blur(14px)',
                  transition: 'transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease',
                  '&::before': {
                    content: '""',
                    position: 'absolute',
                    inset: '0 auto 0 0',
                    width: 4,
                    background: accent,
                    opacity: 0.85,
                  },
                  '&:hover': {
                    transform: 'translateY(-2px)',
                    borderColor: alpha(accent, 0.38),
                    boxShadow: '0 12px 28px rgba(43, 82, 106, 0.12)',
                  },
                }}
              >
                <Tooltip title="操作">
                  <IconButton
                    size="small"
                    onClick={(event) => openMenu(event, item)}
                    sx={{ position: 'absolute', top: 7, right: 7, width: 28, height: 28, color: 'text.secondary' }}
                  >
                    <MoreHorizIcon fontSize="small" />
                  </IconButton>
                </Tooltip>

                <Typography
                  variant="body2"
                  sx={{
                    pr: 3.5,
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.7,
                    fontSize: '0.79rem',
                    fontWeight: 600,
                    display: '-webkit-box',
                    WebkitLineClamp: 6,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    minHeight: 82,
                  }}
                >
                  {item.content || '内容なし'}
                </Typography>

                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.55, mt: 1.2, minHeight: 22 }}>
                  {tags.slice(0, 3).map((tag) => (
                    <Chip
                      key={tag}
                      label={`#${tag}`}
                      size="small"
                      sx={{
                        height: 21,
                        fontSize: '0.6rem',
                        backgroundColor: alpha(colorFromTag(tag, theme), isDark ? 0.18 : 0.09),
                        color: 'text.secondary',
                      }}
                    />
                  ))}
                  {tags.length > 3 && <Chip label={`+${tags.length - 3}`} size="small" sx={{ height: 21, fontSize: '0.6rem' }} />}
                </Box>

                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, fontSize: '0.62rem' }}>
                  {formatDate(item.updatedAt || item.createdAt)}
                </Typography>
              </Paper>
            );
          })}
        </Box>
      )}

      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={closeMenu}>
        <MenuItem onClick={copyItem}>
          <ContentCopyIcon fontSize="small" sx={{ mr: 1 }} />コピー
        </MenuItem>
        <MenuItem onClick={editItem}>
          <EditOutlinedIcon fontSize="small" sx={{ mr: 1 }} />編集
        </MenuItem>
        <MenuItem onClick={removeItem} sx={{ color: 'error.main' }}>削除</MenuItem>
      </Menu>
    </Box>
  );
}

export default CollectionBoard;
