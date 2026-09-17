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

const UNTAGGED = '__untagged__';

const compactText = (value = '') => String(value).trim();

const colorFromTag = (tag, theme) => {
  if (!tag || tag === UNTAGGED) return theme.palette.text.secondary;
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 58% ${theme.palette.mode === 'dark' ? '68%' : '44%'})`;
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
  const [selectedTag, setSelectedTag] = useState(null);
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
    let untaggedCount = 0;
    items.forEach((item) => {
      const tags = item.tags || [];
      if (!tags.length) untaggedCount += 1;
      tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
    });
    if (untaggedCount) counts.set(UNTAGGED, untaggedCount);
    return counts;
  }, [items]);

  const orderedTags = useMemo(() => {
    const known = new Set(allTags);
    items.forEach((item) => (item.tags || []).forEach((tag) => known.add(tag)));
    const tags = [...known].filter((tag) => (tagCounts.get(tag) || 0) > 0);
    tags.sort((a, b) => {
      const diff = (tagCounts.get(b) || 0) - (tagCounts.get(a) || 0);
      return diff || a.localeCompare(b, 'ja');
    });
    if ((tagCounts.get(UNTAGGED) || 0) > 0) tags.push(UNTAGGED);
    return tags;
  }, [allTags, items, tagCounts]);

  useEffect(() => {
    if (!orderedTags.length) {
      setSelectedTag(null);
      return;
    }
    if (!selectedTag || !orderedTags.includes(selectedTag)) {
      setSelectedTag(orderedTags[0]);
    }
  }, [orderedTags, selectedTag]);

  const selectedItems = useMemo(() => {
    if (!selectedTag) return [];
    const keyword = searchText.trim().toLowerCase();
    return items.filter((item) => {
      const tags = item.tags || [];
      const inTag = selectedTag === UNTAGGED ? tags.length === 0 : tags.includes(selectedTag);
      if (!inTag) return false;
      if (!keyword) return true;
      return [item.content, ...tags]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    });
  }, [items, selectedTag, searchText]);

  const relatedTags = useMemo(() => {
    if (!selectedTag || selectedTag === UNTAGGED) return [];
    const counts = new Map();
    items.forEach((item) => {
      const tags = item.tags || [];
      if (!tags.includes(selectedTag)) return;
      tags.forEach((tag) => {
        if (tag !== selectedTag) counts.set(tag, (counts.get(tag) || 0) + 1);
      });
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
      .slice(0, 8);
  }, [items, selectedTag]);

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
    ? alpha(theme.palette.common.white, 0.10)
    : 'rgba(62, 96, 119, 0.16)';
  const selectedColor = colorFromTag(selectedTag, theme);
  const selectedLabel = selectedTag === UNTAGGED ? '未分類' : selectedTag || 'タグなし';

  return (
    <Box sx={{ minHeight: '100%', p: { xs: 0, sm: 0.5 } }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          gap: 1.25,
          mb: 1.2,
          px: 0.25,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 800, letterSpacing: '0.12em' }}>
            {eyebrow}
          </Typography>
          <Typography variant="h4">{title}</Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.25, lineHeight: 1.45, fontSize: '0.8rem', display: { xs: 'none', md: 'block' } }}
          >
            {description}
          </Typography>
        </Box>
        <Button
          variant="contained"
          size="small"
          startIcon={<AddIcon />}
          onClick={() => navigate(manageRoute, { state: { selectedTag: selectedTag === UNTAGGED ? null : selectedTag } })}
          sx={{ flexShrink: 0, minWidth: { xs: 40, sm: 'auto' } }}
        >
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{manageLabel}</Box>
        </Button>
      </Box>

      {orderedTags.length === 0 ? (
        <Paper
          elevation={0}
          sx={{ py: 7, px: 2, textAlign: 'center', border: `1px dashed ${border}`, background: 'transparent' }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>メモがありません</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{emptyMessage}</Typography>
        </Paper>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '210px minmax(0, 1fr)' },
            gap: 1.2,
            minHeight: { md: 'calc(100vh - 180px)' },
          }}
        >
          <Paper
            elevation={0}
            sx={{
              border: `1px solid ${border}`,
              backgroundColor: isDark ? alpha(theme.palette.background.paper, 0.90) : 'rgba(255,255,255,0.78)',
              overflow: 'hidden',
              alignSelf: 'start',
              position: { md: 'sticky' },
              top: { md: 76 },
            }}
          >
            <Box sx={{ px: 1.2, pt: 1.2, pb: 0.8 }}>
              <Typography sx={{ fontWeight: 850, fontSize: '0.9rem' }}>タグ一覧</Typography>
              <Typography variant="caption" color="text.secondary">
                {orderedTags.length}タグ / {items.length}件
              </Typography>
            </Box>

            <Box
              sx={{
                px: { xs: 0.8, md: 0.7 },
                pb: 0.8,
                display: { xs: 'flex', md: 'block' },
                gap: 0.55,
                overflowX: { xs: 'auto', md: 'visible' },
                maxHeight: { md: 'calc(100vh - 260px)' },
                overflowY: { md: 'auto' },
              }}
            >
              {orderedTags.map((tag) => {
                const active = selectedTag === tag;
                const tagColor = colorFromTag(tag, theme);
                const label = tag === UNTAGGED ? '未分類' : tag;
                return (
                  <Box
                    key={tag}
                    component="button"
                    type="button"
                    onClick={() => {
                      setSelectedTag(tag);
                      setSearchText('');
                    }}
                    sx={{
                      width: { xs: 'auto', md: '100%' },
                      minWidth: { xs: 128, md: 0 },
                      border: 0,
                      borderRadius: 1.7,
                      px: 1,
                      py: 0.9,
                      mb: { md: 0.35 },
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.8,
                      textAlign: 'left',
                      cursor: 'pointer',
                      color: 'text.primary',
                      backgroundColor: active
                        ? alpha(tagColor, isDark ? 0.20 : 0.11)
                        : 'transparent',
                      transition: 'background-color 120ms ease',
                      '&:hover': {
                        backgroundColor: alpha(tagColor, isDark ? 0.13 : 0.07),
                      },
                    }}
                  >
                    <Box sx={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: tagColor, flexShrink: 0 }} />
                    <Typography
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: '0.84rem',
                        fontWeight: active ? 850 : 700,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>
                      {tagCounts.get(tag) || 0}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          </Paper>

          <Paper
            elevation={0}
            sx={{
              border: `1px solid ${border}`,
              backgroundColor: isDark ? alpha(theme.palette.background.paper, 0.88) : 'rgba(255,255,255,0.76)',
              overflow: 'hidden',
              minWidth: 0,
            }}
          >
            <Box sx={{ p: { xs: 1.2, sm: 1.5 }, borderBottom: `1px solid ${border}` }}>
              <Box sx={{ display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                <Box sx={{ minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, flexWrap: 'wrap' }}>
                    <Typography sx={{ fontSize: { xs: '1.35rem', sm: '1.7rem' }, fontWeight: 900, lineHeight: 1.1 }}>
                      #{selectedLabel}
                    </Typography>
                    <Chip
                      size="small"
                      label={`${selectedItems.length}件`}
                      sx={{ height: 24, fontWeight: 800, backgroundColor: alpha(selectedColor, isDark ? 0.17 : 0.09), color: selectedColor }}
                    />
                  </Box>
                  {relatedTags.length > 0 && (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, mt: 0.85 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800, mr: 0.15 }}>
                        関連タグ
                      </Typography>
                      {relatedTags.map(([tag, count]) => (
                        <Chip
                          key={tag}
                          label={`${tag} ${count}`}
                          size="small"
                          variant="outlined"
                          onClick={() => {
                            setSelectedTag(tag);
                            setSearchText('');
                          }}
                          sx={{ height: 24, fontSize: '0.66rem', fontWeight: 750 }}
                        />
                      ))}
                    </Box>
                  )}
                </Box>

                <TextField
                  size="small"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="このタグ内を検索"
                  sx={{ width: { xs: '100%', sm: 235 } }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  }}
                />
              </Box>
            </Box>

            {selectedItems.length === 0 ? (
              <Box sx={{ py: 8, px: 2, textAlign: 'center' }}>
                <Typography sx={{ fontWeight: 800 }}>該当するメモがありません</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4 }}>
                  検索語を変えるか、新しいメモを追加してください。
                </Typography>
              </Box>
            ) : (
              <Box
                sx={{
                  p: { xs: 1, sm: 1.3 },
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: '1fr',
                    sm: 'repeat(2, minmax(0, 1fr))',
                    lg: 'repeat(3, minmax(0, 1fr))',
                    xl: 'repeat(4, minmax(0, 1fr))',
                  },
                  gap: 0.75,
                  alignItems: 'start',
                }}
              >
                {selectedItems.map((item) => {
                  const content = compactText(item.content) || '内容なし';
                  return (
                    <Paper
                      key={item.id}
                      elevation={0}
                      onContextMenu={(event) => openMenu(event, item)}
                      onDoubleClick={() => navigate(`${manageRoute}?id=${item.id}`)}
                      sx={{
                        position: 'relative',
                        minHeight: 54,
                        px: 1.15,
                        py: 0.95,
                        pr: 3.2,
                        border: `1px solid ${border}`,
                        borderRadius: 2,
                        backgroundColor: isDark ? alpha(theme.palette.background.paper, 0.96) : '#fff',
                        boxShadow: isDark ? '0 2px 7px rgba(0,0,0,.14)' : '0 2px 7px rgba(43,82,106,.05)',
                        transition: 'border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease',
                        '&:hover': {
                          transform: 'translateY(-1px)',
                          borderColor: alpha(selectedColor, 0.42),
                          boxShadow: isDark ? '0 5px 12px rgba(0,0,0,.19)' : '0 5px 12px rgba(43,82,106,.09)',
                          '& .memo-actions': { opacity: 1 },
                        },
                      }}
                    >
                      <Typography
                        sx={{
                          color: 'text.primary',
                          fontSize: '0.93rem',
                          fontWeight: 700,
                          lineHeight: 1.42,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {content}
                      </Typography>

                      <Tooltip title="操作">
                        <IconButton
                          className="memo-actions"
                          size="small"
                          onClick={(event) => openMenu(event, item)}
                          sx={{
                            position: 'absolute',
                            top: 6,
                            right: 4,
                            width: 27,
                            height: 27,
                            color: 'text.secondary',
                            opacity: { xs: 0.72, md: 0.12 },
                          }}
                        >
                          <MoreHorizIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Paper>
                  );
                })}
              </Box>
            )}
          </Paper>
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
