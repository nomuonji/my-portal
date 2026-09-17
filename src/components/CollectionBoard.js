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

const colorFromTag = (tag, theme) => {
  if (!tag) return theme.palette.text.secondary;
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 56% ${theme.palette.mode === 'dark' ? '68%' : '43%'})`;
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

  const searchFilteredItems = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) => (
      [item.content, ...(item.tags || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    ));
  }, [items, searchText]);

  const tagCounts = useMemo(() => {
    const counts = new Map();
    searchFilteredItems.forEach((item) => {
      (item.tags || []).forEach((tag) => {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      });
    });
    return counts;
  }, [searchFilteredItems]);

  const orderedTags = useMemo(() => {
    const known = new Set(allTags);
    searchFilteredItems.forEach((item) => {
      (item.tags || []).forEach((tag) => known.add(tag));
    });
    return [...known]
      .filter((tag) => (tagCounts.get(tag) || 0) > 0)
      .sort((a, b) => {
        const countDiff = (tagCounts.get(b) || 0) - (tagCounts.get(a) || 0);
        return countDiff || a.localeCompare(b, 'ja');
      });
  }, [allTags, searchFilteredItems, tagCounts]);

  const groups = useMemo(() => {
    if (filterTag) {
      return [{
        tag: filterTag,
        items: searchFilteredItems.filter((item) => (item.tags || []).includes(filterTag)),
      }];
    }

    const taggedGroups = orderedTags.map((tag) => ({
      tag,
      items: searchFilteredItems.filter((item) => (item.tags || []).includes(tag)),
    }));

    const untaggedItems = searchFilteredItems.filter((item) => !(item.tags || []).length);
    if (untaggedItems.length > 0) taggedGroups.push({ tag: null, items: untaggedItems });
    return taggedGroups;
  }, [filterTag, orderedTags, searchFilteredItems]);

  const visibleCount = filterTag
    ? searchFilteredItems.filter((item) => (item.tags || []).includes(filterTag)).length
    : searchFilteredItems.length;

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

  const renderMemo = (item, tag) => {
    const content = compactText(item.content) || '内容なし';
    const accent = colorFromTag(tag || (item.tags || [])[0], theme);

    return (
      <Paper
        key={`${tag || 'untagged'}-${item.id}`}
        elevation={0}
        onContextMenu={(event) => openMenu(event, item)}
        onDoubleClick={() => navigate(`${manageRoute}?id=${item.id}`)}
        sx={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          maxWidth: { xs: '100%', sm: 360 },
          minWidth: 86,
          px: 1.15,
          py: 0.8,
          pr: 3.3,
          border: `1px solid ${border}`,
          borderLeft: `3px solid ${alpha(accent, 0.82)}`,
          borderRadius: 2,
          backgroundColor: isDark
            ? alpha(theme.palette.background.paper, 0.90)
            : 'rgba(255,255,255,0.90)',
          boxShadow: isDark
            ? '0 2px 8px rgba(0,0,0,.14)'
            : '0 2px 8px rgba(43,82,106,.055)',
          cursor: 'default',
          transition: 'border-color 130ms ease, box-shadow 130ms ease, transform 130ms ease',
          '&:hover': {
            transform: 'translateY(-1px)',
            borderColor: alpha(accent, 0.42),
            boxShadow: isDark
              ? '0 5px 13px rgba(0,0,0,.19)'
              : '0 5px 13px rgba(43,82,106,.09)',
            '& .memo-actions': { opacity: 1 },
          },
        }}
      >
        <Typography
          sx={{
            color: 'text.primary',
            fontSize: '0.96rem',
            fontWeight: 700,
            lineHeight: 1.4,
            letterSpacing: 0,
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
              top: '50%',
              right: 4,
              transform: 'translateY(-50%)',
              width: 27,
              height: 27,
              color: 'text.secondary',
              opacity: { xs: 0.72, md: 0.12 },
              '&:hover': { transform: 'translateY(-50%)' },
            }}
          >
            <MoreHorizIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Paper>
    );
  };

  return (
    <Box sx={{ minHeight: '100%', p: { xs: 0, sm: 0.5 } }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          gap: 1.5,
          mb: 1.2,
          px: 0.25,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 800, letterSpacing: '0.12em' }}>
            {eyebrow}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            <Typography variant="h4">{title}</Typography>
            <Chip size="small" label={visibleCount} sx={{ height: 22, minWidth: 30, fontSize: '0.68rem', fontWeight: 800 }} />
          </Box>
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
          onClick={() => navigate(manageRoute, { state: { selectedTag: filterTag } })}
          sx={{ flexShrink: 0, minWidth: { xs: 40, sm: 'auto' } }}
        >
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{manageLabel}</Box>
        </Button>
      </Box>

      <Box
        sx={{
          display: 'flex',
          alignItems: { xs: 'stretch', md: 'center' },
          gap: 0.8,
          mb: 1.5,
          flexDirection: { xs: 'column', md: 'row' },
        }}
      >
        <TextField
          size="small"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="メモ・タグを検索"
          sx={{ width: { xs: '100%', md: 230 } }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, minWidth: 0 }}>
          <Chip
            label="すべて"
            size="small"
            onClick={() => setFilterTag(null)}
            color={!filterTag ? 'primary' : 'default'}
            variant={!filterTag ? 'filled' : 'outlined'}
            sx={{ height: 27, fontWeight: 800, fontSize: '0.7rem' }}
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
                  height: 27,
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  borderColor: alpha(tagColor, selected ? 0.72 : 0.38),
                  backgroundColor: selected ? alpha(tagColor, isDark ? 0.26 : 0.12) : 'transparent',
                  color: selected ? tagColor : 'text.primary',
                }}
              />
            );
          })}
        </Box>
      </Box>

      {visibleCount === 0 ? (
        <Paper
          elevation={0}
          sx={{
            py: 5,
            px: 2,
            textAlign: 'center',
            border: `1px dashed ${border}`,
            background: isDark ? alpha(theme.palette.background.paper, 0.44) : 'rgba(255,255,255,0.46)',
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>メモがありません</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4 }}>{emptyMessage}</Typography>
        </Paper>
      ) : (
        <Box sx={{ display: 'grid', gap: 1.55 }}>
          {groups.map((group) => {
            const groupColor = colorFromTag(group.tag, theme);
            const label = group.tag || '未分類';
            return (
              <Box key={label}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, mb: 0.65 }}>
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: groupColor,
                      flexShrink: 0,
                    }}
                  />
                  <Typography
                    sx={{
                      fontSize: '0.82rem',
                      fontWeight: 850,
                      color: 'text.primary',
                      lineHeight: 1,
                    }}
                  >
                    {label}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.66rem', fontWeight: 700 }}>
                    {group.items.length}
                  </Typography>
                  <Box sx={{ height: 1, flex: 1, backgroundColor: alpha(groupColor, 0.15) }} />
                </Box>

                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6, alignItems: 'flex-start' }}>
                  {group.items.map((item) => renderMemo(item, group.tag))}
                </Box>
              </Box>
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
