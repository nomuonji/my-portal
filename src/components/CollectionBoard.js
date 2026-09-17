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
  return `hsl(${hue} 58% ${theme.palette.mode === 'dark' ? '68%' : '43%'})`;
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

  const tagCounts = useMemo(() => {
    const counts = new Map();
    items.forEach((item) => {
      (item.tags || []).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
    });
    return counts;
  }, [items]);

  const orderedTags = useMemo(() => {
    const known = new Set(allTags);
    tagCounts.forEach((_, tag) => known.add(tag));
    return [...known].sort((a, b) => {
      const diff = (tagCounts.get(b) || 0) - (tagCounts.get(a) || 0);
      return diff || a.localeCompare(b, 'ja');
    });
  }, [allTags, tagCounts]);

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
    ? alpha(theme.palette.common.white, 0.11)
    : 'rgba(62, 96, 119, 0.18)';

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
              sx={{ height: 24, minWidth: 34, fontSize: '0.72rem', fontWeight: 800 }}
            />
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35, lineHeight: 1.55, fontSize: '0.84rem' }}>
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
          mb: 1.4,
          p: 1.15,
          border: `1px solid ${border}`,
          background: isDark ? alpha(theme.palette.background.paper, 0.78) : 'rgba(255,255,255,0.72)',
          backdropFilter: 'blur(14px)',
        }}
      >
        <Stack spacing={1.05}>
          <Box sx={{ display: 'flex', gap: 1, alignItems: { xs: 'stretch', sm: 'center' }, flexDirection: { xs: 'column', sm: 'row' } }}>
            <TextField
              size="small"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="メモ・タグを検索"
              sx={{ width: { xs: '100%', sm: 260 } }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800, letterSpacing: '0.08em' }}>
              TAGS
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.7 }}>
            <Chip
              label={`すべて ${items.length}`}
              size="small"
              onClick={() => setFilterTag(null)}
              color={!filterTag ? 'primary' : 'default'}
              variant={!filterTag ? 'filled' : 'outlined'}
              sx={{ height: 30, fontWeight: 800, fontSize: '0.74rem' }}
            />
            {orderedTags.map((tag) => {
              const selected = filterTag === tag;
              const tagColor = colorFromTag(tag, theme);
              return (
                <Chip
                  key={tag}
                  label={`${tag} ${tagCounts.get(tag) || 0}`}
                  size="small"
                  onClick={() => setFilterTag(selected ? null : tag)}
                  variant={selected ? 'filled' : 'outlined'}
                  sx={{
                    height: 30,
                    fontSize: '0.74rem',
                    fontWeight: 800,
                    borderColor: alpha(tagColor, selected ? 0.75 : 0.45),
                    backgroundColor: selected ? alpha(tagColor, isDark ? 0.28 : 0.14) : 'transparent',
                    color: selected ? tagColor : 'text.primary',
                    '& .MuiChip-label': { px: 1.15 },
                    '&::before': {
                      content: '""',
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      backgroundColor: tagColor,
                      marginLeft: '9px',
                      marginRight: '-5px',
                    },
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
            background: isDark ? alpha(theme.palette.background.paper, 0.5) : 'rgba(255,255,255,0.58)',
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
              xs: '1fr',
              sm: 'repeat(2, minmax(0, 1fr))',
              md: 'repeat(auto-fill, minmax(220px, 1fr))',
            },
            gap: 1,
            alignItems: 'stretch',
          }}
        >
          {filteredItems.map((item) => {
            const content = compactText(item.content) || '内容なし';
            const tags = item.tags || [];
            const primaryTag = tags[0] || '未分類';
            const accent = colorFromTag(tags[0], theme);
            const date = formatDate(item.updatedAt || item.createdAt);

            return (
              <Paper
                key={item.id}
                elevation={0}
                onContextMenu={(event) => openMenu(event, item)}
                onDoubleClick={() => navigate(`${manageRoute}?id=${item.id}`)}
                sx={{
                  position: 'relative',
                  minHeight: 128,
                  p: 1.35,
                  pt: 1.15,
                  overflow: 'hidden',
                  border: `1px solid ${border}`,
                  backgroundColor: isDark ? alpha(theme.palette.background.paper, 0.94) : 'rgba(255,255,255,0.94)',
                  boxShadow: isDark ? '0 6px 18px rgba(0,0,0,.18)' : '0 5px 16px rgba(43,82,106,.07)',
                  transition: 'transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease',
                  '&::before': {
                    content: '""',
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: 0,
                    height: 4,
                    backgroundColor: accent,
                  },
                  '&:hover': {
                    transform: 'translateY(-1px)',
                    borderColor: alpha(accent, 0.48),
                    boxShadow: isDark ? '0 10px 24px rgba(0,0,0,.24)' : '0 10px 24px rgba(43,82,106,.12)',
                    '& .memo-actions': { opacity: 1 },
                  },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.65, pr: 3.3, mb: 1.05, minWidth: 0 }}>
                  <Chip
                    label={primaryTag}
                    size="small"
                    onClick={() => tags[0] && setFilterTag(primaryTag)}
                    sx={{
                      height: 26,
                      maxWidth: '72%',
                      fontSize: '0.7rem',
                      fontWeight: 850,
                      backgroundColor: alpha(accent, isDark ? 0.22 : 0.11),
                      color: accent,
                      border: `1px solid ${alpha(accent, 0.28)}`,
                      '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' },
                    }}
                  />
                  {tags.length > 1 && (
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.66rem', fontWeight: 800 }}>
                      +{tags.length - 1}
                    </Typography>
                  )}
                </Box>

                <Tooltip title="操作">
                  <IconButton
                    className="memo-actions"
                    size="small"
                    onClick={(event) => openMenu(event, item)}
                    sx={{
                      position: 'absolute',
                      top: 8,
                      right: 7,
                      width: 29,
                      height: 29,
                      color: 'text.secondary',
                      opacity: { xs: 1, md: 0.32 },
                    }}
                  >
                    <MoreHorizIcon fontSize="small" />
                  </IconButton>
                </Tooltip>

                <Typography
                  sx={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: 'text.primary',
                    lineHeight: 1.55,
                    fontSize: '0.96rem',
                    fontWeight: 750,
                    letterSpacing: '0.005em',
                    display: '-webkit-box',
                    WebkitLineClamp: 4,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {content}
                </Typography>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.55, flexWrap: 'wrap', mt: 1.2, minHeight: 22 }}>
                  {tags.slice(1, 4).map((tag) => {
                    const tagColor = colorFromTag(tag, theme);
                    return (
                      <Chip
                        key={tag}
                        label={tag}
                        size="small"
                        onClick={() => setFilterTag(tag)}
                        variant="outlined"
                        sx={{
                          height: 22,
                          fontSize: '0.64rem',
                          fontWeight: 750,
                          borderColor: alpha(tagColor, 0.35),
                          color: 'text.secondary',
                        }}
                      />
                    );
                  })}
                  {tags.length > 4 && (
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.62rem', fontWeight: 700 }}>
                      +{tags.length - 4}
                    </Typography>
                  )}
                  {date && (
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', fontSize: '0.64rem', fontWeight: 650 }}>
                      {date}
                    </Typography>
                  )}
                </Box>
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
