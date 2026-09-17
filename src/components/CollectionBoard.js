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
  Add as AddIcon,
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

const compactText = (value = '') => String(value).trim();

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
    : 'rgba(83, 124, 149, 0.15)';

  return (
    <Box sx={{ minHeight: '100%', p: { xs: 0, sm: 0.5 } }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          gap: 1.5,
          mb: 1.4,
          px: 0.3,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 800, letterSpacing: '0.13em' }}>
            {eyebrow}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, flexWrap: 'wrap' }}>
            <Typography variant="h4">{title}</Typography>
            <Chip
              size="small"
              label={`${filteredItems.length}`}
              sx={{ height: 22, minWidth: 32, fontSize: '0.65rem', fontWeight: 800 }}
            />
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35, lineHeight: 1.5 }}>
            {description}
          </Typography>
        </Box>
        <Button
          variant="contained"
          size="small"
          startIcon={<AddIcon />}
          onClick={() => navigate(manageRoute, { state: { selectedTag: filterTag } })}
          sx={{ flexShrink: 0, minWidth: { xs: 40, sm: 'auto' } }}
        >
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{manageLabel}</Box>
        </Button>
      </Box>

      <Paper
        elevation={0}
        sx={{
          mb: 1.2,
          p: 0.9,
          border: `1px solid ${border}`,
          background: isDark ? alpha(theme.palette.background.paper, 0.68) : 'rgba(255,255,255,0.45)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.8} alignItems={{ xs: 'stretch', md: 'center' }}>
          <TextField
            size="small"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="メモを検索"
            sx={{ width: { xs: '100%', md: 240 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <Box
            sx={{
              display: 'flex',
              gap: 0.55,
              overflowX: 'auto',
              minWidth: 0,
              pb: 0.15,
              '&::-webkit-scrollbar': { height: 4 },
            }}
          >
            <Chip
              label="すべて"
              size="small"
              onClick={() => setFilterTag(null)}
              color={!filterTag ? 'primary' : 'default'}
              variant={!filterTag ? 'filled' : 'outlined'}
              sx={{ flexShrink: 0, height: 25, fontWeight: 700 }}
            />
            {allTags.map((tag) => {
              const selected = filterTag === tag;
              const tagColor = colorFromTag(tag, theme);
              return (
                <Chip
                  key={tag}
                  label={tag}
                  size="small"
                  onClick={() => setFilterTag(selected ? null : tag)}
                  variant={selected ? 'filled' : 'outlined'}
                  sx={{
                    flexShrink: 0,
                    height: 25,
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    borderColor: alpha(tagColor, 0.5),
                    backgroundColor: selected ? alpha(tagColor, isDark ? 0.25 : 0.12) : 'transparent',
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
            py: 6,
            px: 2,
            textAlign: 'center',
            border: `1px dashed ${border}`,
            background: isDark ? alpha(theme.palette.background.paper, 0.4) : 'rgba(255,255,255,0.30)',
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>メモがありません</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{emptyMessage}</Typography>
        </Paper>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, minmax(0, 1fr))',
              sm: 'repeat(auto-fill, minmax(150px, 1fr))',
              lg: 'repeat(auto-fill, minmax(165px, 1fr))',
            },
            gap: { xs: 0.7, sm: 0.85 },
            alignItems: 'stretch',
          }}
        >
          {filteredItems.map((item) => {
            const content = compactText(item.content) || '内容なし';
            const tags = item.tags || [];
            const accent = colorFromTag(tags[0], theme);
            const veryShort = content.length <= 24;
            const short = content.length <= 60;
            const date = formatDate(item.updatedAt || item.createdAt);

            return (
              <Paper
                key={item.id}
                elevation={0}
                onContextMenu={(event) => openMenu(event, item)}
                onDoubleClick={() => navigate(`${manageRoute}?id=${item.id}`)}
                sx={{
                  position: 'relative',
                  minHeight: veryShort ? 88 : short ? 104 : 126,
                  p: 1.1,
                  pr: 3.2,
                  overflow: 'hidden',
                  cursor: 'default',
                  border: `1px solid ${alpha(accent, isDark ? 0.22 : 0.17)}`,
                  background: isDark
                    ? `linear-gradient(145deg, ${alpha(accent, 0.10)}, ${alpha(theme.palette.background.paper, 0.90)} 42%)`
                    : `linear-gradient(145deg, ${alpha(accent, 0.07)}, rgba(255,255,255,0.88) 44%)`,
                  transition: 'transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease',
                  '&:hover': {
                    transform: 'translateY(-1px)',
                    borderColor: alpha(accent, 0.38),
                    boxShadow: '0 8px 20px rgba(43, 82, 106, 0.10)',
                    '& .memo-actions': { opacity: 1 },
                  },
                }}
              >
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: accent,
                    boxShadow: `0 0 0 3px ${alpha(accent, 0.10)}`,
                    mb: 0.9,
                  }}
                />

                <Tooltip title="操作">
                  <IconButton
                    className="memo-actions"
                    size="small"
                    onClick={(event) => openMenu(event, item)}
                    sx={{
                      position: 'absolute',
                      top: 5,
                      right: 5,
                      width: 27,
                      height: 27,
                      color: 'text.secondary',
                      opacity: { xs: 1, md: 0.16 },
                    }}
                  >
                    <MoreHorizIcon fontSize="small" />
                  </IconButton>
                </Tooltip>

                <Typography
                  sx={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    lineHeight: veryShort ? 1.35 : 1.5,
                    fontSize: veryShort ? '0.98rem' : short ? '0.86rem' : '0.76rem',
                    fontWeight: veryShort ? 800 : 700,
                    letterSpacing: veryShort ? '0.01em' : 0,
                    display: '-webkit-box',
                    WebkitLineClamp: veryShort ? 3 : short ? 4 : 6,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {content}
                </Typography>

                {(tags.length > 0 || date) && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.45, flexWrap: 'wrap', mt: 1 }}>
                    {tags.slice(0, 2).map((tag) => (
                      <Typography
                        key={tag}
                        variant="caption"
                        sx={{
                          fontSize: '0.58rem',
                          fontWeight: 700,
                          color: colorFromTag(tag, theme),
                          opacity: 0.88,
                        }}
                      >
                        #{tag}
                      </Typography>
                    ))}
                    {tags.length > 2 && (
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.56rem' }}>
                        +{tags.length - 2}
                      </Typography>
                    )}
                    {date && (
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', fontSize: '0.55rem', opacity: 0.72 }}>
                        {date}
                      </Typography>
                    )}
                  </Box>
                )}
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
