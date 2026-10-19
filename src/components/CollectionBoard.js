import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Fab,
  IconButton,
  InputBase,
  Snackbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  Add as AddIcon,
  Close as CloseIcon,
  ContentCopy as ContentCopyIcon,
  DeleteOutline as DeleteIcon,
  EditOutlined as EditOutlinedIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from '../documentDbClient';

const ALL = '__all__';
const UNTAGGED = '__untagged__';
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const V = {
  bg: 'var(--p-bg)', surface: 'var(--p-surface)', sunken: 'var(--p-sunken)', ink: 'var(--p-ink)',
  muted: 'var(--p-muted)', faint: 'var(--p-faint)', rule: 'var(--p-rule)', ruleStrong: 'var(--p-rule-strong)',
  accent: 'var(--p-accent)', accentSoft: 'var(--p-accent-soft)',
};
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
const tagLabel = (tag) => (tag === UNTAGGED ? '未分類' : tag === ALL ? 'すべて' : tag);
const normalizeTag = (value) => String(value || '').replace(/^#+/, '').trim();

const tagHue = (tag) => {
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash) % 360;
};
function TagDot({ tag, size = 7 }) {
  if (!tag || tag === ALL) return <Box component="span" sx={{ width: size, height: size, flexShrink: 0 }} />;
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: tag === UNTAGGED ? V.faint : `hsl(${tagHue(tag)} 50% 52%)`,
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Composer: write first, tag with the keyboard, save with ⌘/Ctrl+Enter */
/* ------------------------------------------------------------------ */
function Composer({
  placeholder, knownTags, initialContent = '', initialTags = [], onSave, onCancel, autoFocus = false,
  inputRef: externalRef, submitLabel = '追加', compactUntilFocus = false,
}) {
  const [content, setContent] = useState(initialContent);
  const [tags, setTags] = useState(initialTags);
  const [tagDraft, setTagDraft] = useState('');
  const [tagOpen, setTagOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const localRef = useRef(null);
  const textRef = externalRef || localRef;
  const tagRef = useRef(null);
  const rootRef = useRef(null);

  const suggestions = useMemo(() => {
    const q = normalizeTag(tagDraft).toLowerCase();
    const list = knownTags.filter((tag) => !tags.includes(tag) && (!q || tag.toLowerCase().includes(q)));
    return list.slice(0, 8);
  }, [knownTags, tagDraft, tags]);
  const draft = normalizeTag(tagDraft);
  const canCreate = draft && !knownTags.includes(draft) && !tags.includes(draft);
  const options = canCreate ? [...suggestions, { create: draft }] : suggestions;

  useEffect(() => { setHighlight(0); }, [tagDraft]);

  const addTag = (tag) => {
    const value = normalizeTag(tag);
    if (!value || tags.includes(value)) return;
    setTags((prev) => [...prev, value]);
    setTagDraft('');
  };
  const removeTag = (tag) => setTags((prev) => prev.filter((t) => t !== tag));

  const submit = async () => {
    if (!content.trim() || saving) return;
    setSaving(true);
    try {
      const pending = draft && !tags.includes(draft) ? [...tags, draft] : tags;
      await onSave({ content: content.trim(), tags: pending });
      setContent('');
      setTagDraft('');
      setTagOpen(false);
      setTags(pending);
      textRef.current?.focus();
    } finally {
      setSaving(false);
    }
  };

  const onTextKey = (event) => {
    if (event.nativeEvent?.isComposing) return;
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      if (onCancel) onCancel();
      else textRef.current?.blur();
    }
  };
  const onTagKey = (event) => {
    if (event.nativeEvent?.isComposing) return;
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight((h) => Math.min(h + 1, options.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (event.key === 'Enter' || event.key === ',' || event.key === '、') {
      event.preventDefault();
      const pick = options[highlight];
      if (pick) addTag(pick.create || pick);
      else if (draft) addTag(draft);
    } else if (event.key === 'Backspace' && !tagDraft && tags.length) {
      removeTag(tags[tags.length - 1]);
    } else if (event.key === 'Escape') {
      setTagOpen(false);
      textRef.current?.focus();
    }
  };

  const expanded = !compactUntilFocus || focused || content || tags.length > 0;
  const shortcut = isMac ? '⌘↵' : 'Ctrl+↵';

  return (
    <Box
      ref={rootRef}
      onFocus={() => setFocused(true)}
      onBlur={(event) => { if (!rootRef.current?.contains(event.relatedTarget)) { setFocused(false); setTagOpen(false); } }}
      sx={{
        border: '1px solid', borderColor: focused ? V.ink : V.ruleStrong, borderRadius: 1.5, background: V.surface,
        transition: 'border-color 120ms ease, box-shadow 120ms ease',
        boxShadow: focused ? `0 0 0 3px ${V.accentSoft}` : 'none',
      }}
    >
      <InputBase
        inputRef={textRef}
        autoFocus={autoFocus}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={onTextKey}
        placeholder={placeholder}
        multiline
        minRows={expanded ? 2 : 1}
        maxRows={12}
        inputProps={{ 'aria-label': placeholder }}
        sx={{
          width: '100%', px: 2, pt: 1.6, pb: expanded ? 0.6 : 1.6, fontSize: { xs: 16, md: 15.5 }, lineHeight: 1.65, color: V.ink,
          '& textarea::placeholder': { color: V.faint, opacity: 1 },
        }}
      />
      {expanded && (
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.75, px: 1.5, pb: 1.3, pt: 0.4 }}>
          <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.6, flex: '1 1 260px', minWidth: 0 }}>
            {tags.map((tag) => (
              <Box
                key={tag}
                component="span"
                sx={{
                  display: 'inline-flex', alignItems: 'center', gap: 0.6, pl: 1, pr: 0.3, py: 0.2, borderRadius: 1,
                  background: V.sunken, fontSize: 12.5, fontWeight: 600, color: V.ink,
                }}
              >
                <TagDot tag={tag} size={6} />{tag}
                <IconButton size="small" aria-label={`タグ「${tag}」を外す`} onClick={() => removeTag(tag)}
                  sx={{ p: 0.2, minWidth: 0, minHeight: 0, color: V.faint, '&:hover': { color: V.ink } }}>
                  <CloseIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>
            ))}
            <InputBase
              inputRef={tagRef}
              value={tagDraft}
              onChange={(event) => { setTagDraft(event.target.value); setTagOpen(true); }}
              onFocus={() => setTagOpen(true)}
              onKeyDown={onTagKey}
              placeholder={tags.length ? '＋タグ' : '＋タグを付ける'}
              inputProps={{ 'aria-label': 'タグを入力', role: 'combobox', 'aria-expanded': tagOpen && options.length > 0, 'aria-autocomplete': 'list' }}
              sx={{ fontSize: 13, color: V.ink, minWidth: 110, flex: '0 1 160px', '& input': { py: 0.5 }, '& input::placeholder': { color: V.muted, opacity: 1 } }}
            />
            {tagOpen && options.length > 0 && (
              <Box
                role="listbox"
                sx={{
                  position: 'absolute', top: '100%', left: 0, mt: 0.6, zIndex: 20, minWidth: 220, maxWidth: '100%',
                  background: V.surface, border: '1px solid', borderColor: V.rule, borderRadius: 1.2, py: 0.5,
                  boxShadow: '0 12px 32px rgba(0,0,0,.14)',
                }}
              >
                {options.map((option, index) => {
                  const label = option.create ? `「${option.create}」を新しいタグとして追加` : option;
                  return (
                    <Box
                      key={option.create ? `create-${option.create}` : option}
                      role="option"
                      aria-selected={index === highlight}
                      tabIndex={-1}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => { addTag(option.create || option); tagRef.current?.focus(); }}
                      sx={{
                        display: 'flex', alignItems: 'center', gap: 1, px: 1.4, py: 0.8, cursor: 'pointer', fontSize: 13,
                        background: index === highlight ? V.sunken : 'transparent', color: option.create ? V.accent : V.ink,
                      }}
                    >
                      {option.create ? <AddIcon sx={{ fontSize: 15 }} /> : <TagDot tag={option} />}
                      {label}
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 'auto' }}>
            <Typography component="span" sx={{ display: { xs: 'none', sm: 'inline' }, fontFamily: MONO, fontSize: 11, color: V.faint }}>
              {shortcut} で{submitLabel}
            </Typography>
            {onCancel && <Button size="small" onClick={onCancel} sx={{ color: V.muted }}>キャンセル</Button>}
            <Button variant="contained" size="small" onClick={submit} disabled={!content.trim() || saving} startIcon={onCancel ? null : <AddIcon />}>
              {saving ? '保存中…' : submitLabel}
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}

/* ------------------------------------------------------------------ */
function MemoCard({ item, showTags, fresh, onEdit, onCopy, onDelete, onTag }) {
  const tags = item.tags || [];
  return (
    <Box
      component="article"
      onDoubleClick={() => onEdit(item)}
      sx={{
        breakInside: 'avoid', mb: 1.2, position: 'relative', background: V.surface, border: '1px solid', borderColor: fresh ? V.accent : V.rule,
        borderRadius: 1.4, px: 1.8, pt: 1.5, pb: 1, transition: 'border-color 600ms ease',
        '&:hover': { borderColor: V.ruleStrong }, '&:hover .memo-actions, &:focus-within .memo-actions': { opacity: 1 },
      }}
    >
      <Typography sx={{ fontSize: { xs: 15.5, sm: 15 }, fontWeight: 500, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: V.ink }}>
        {(item.content || '').trim() || '内容なし'}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.8, minHeight: 30 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8, flex: 1, minWidth: 0 }}>
          {showTags && tags.map((tag) => (
            <Box key={tag} component="button" type="button" onClick={() => onTag(tag)}
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, border: 0, background: 'none', p: 0, cursor: 'pointer',
                font: 'inherit', fontSize: 11.5, color: V.muted, '&:hover': { color: V.ink } }}>
              <TagDot tag={tag} size={6} />{tag}
            </Box>
          ))}
        </Box>
        <Box className="memo-actions" sx={{ display: 'flex', gap: 0.1, opacity: { xs: 1, md: 0 }, transition: 'opacity 120ms ease', mr: -0.8 }}>
          <Tooltip title="コピー"><IconButton size="small" aria-label="コピー" onClick={() => onCopy(item)} sx={{ color: V.faint, '&:hover': { color: V.ink } }}><ContentCopyIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
          <Tooltip title="編集"><IconButton size="small" aria-label="編集" onClick={() => onEdit(item)} sx={{ color: V.faint, '&:hover': { color: V.ink } }}><EditOutlinedIcon sx={{ fontSize: 17 }} /></IconButton></Tooltip>
          <Tooltip title="削除"><IconButton size="small" aria-label="削除" onClick={() => onDelete(item)} sx={{ color: V.faint, '&:hover': { color: 'error.main' } }}><DeleteIcon sx={{ fontSize: 17 }} /></IconButton></Tooltip>
        </Box>
      </Box>
    </Box>
  );
}

/* ------------------------------------------------------------------ */
function CollectionBoard({
  database,
  collectionName,
  tagsCollectionName,
  placeholder = '思いついたことを書く…',
  emptyMessage,
  deleteConfirmMessage,
  itemFilter,
  extraFields,
  onCount,
}) {
  const [items, setItems] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [selectedTag, setSelectedTag] = useState(ALL);
  const [searchText, setSearchText] = useState('');
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useState('');
  const [freshId, setFreshId] = useState(null);
  const composerRef = useRef(null);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  useEffect(() => {
    const q = query(collection(database, collectionName), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      setItems(snapshot.docs
        .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
        .filter((item) => (typeof itemFilter === 'function' ? itemFilter(item) : true)));
    });
  }, [database, collectionName, itemFilter]);

  useEffect(() => {
    if (!tagsCollectionName) return undefined;
    return onSnapshot(collection(database, tagsCollectionName), (snapshot) => {
      setAllTags(snapshot.docs.map((snapshotDoc) => snapshotDoc.id));
    });
  }, [database, tagsCollectionName]);

  useEffect(() => { if (onCount) onCount(items.length); }, [items.length, onCount]);

  // "n" focuses the composer from anywhere on the board.
  useEffect(() => {
    const handler = (event) => {
      const target = event.target;
      const typing = target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey && event.key === 'n' && !editing) {
        event.preventDefault();
        composerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editing]);

  const tagCounts = useMemo(() => {
    const counts = new Map();
    let untagged = 0;
    items.forEach((item) => {
      const tags = item.tags || [];
      if (!tags.length) untagged += 1;
      tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
    });
    if (untagged) counts.set(UNTAGGED, untagged);
    return counts;
  }, [items]);

  const orderedTags = useMemo(() => {
    const tags = [...tagCounts.keys()].filter((tag) => tag !== UNTAGGED);
    tags.sort((a, b) => (tagCounts.get(b) - tagCounts.get(a)) || a.localeCompare(b, 'ja'));
    if (tagCounts.get(UNTAGGED)) tags.push(UNTAGGED);
    return tags;
  }, [tagCounts]);

  // Tags for the composer: used ones first (by frequency), then registered-but-unused.
  const knownTags = useMemo(() => {
    const used = orderedTags.filter((tag) => tag !== UNTAGGED);
    const unused = allTags.filter((tag) => !tagCounts.has(tag)).sort((a, b) => a.localeCompare(b, 'ja'));
    return [...used, ...unused];
  }, [orderedTags, allTags, tagCounts]);

  useEffect(() => {
    if (selectedTag !== ALL && !tagCounts.has(selectedTag)) setSelectedTag(ALL);
  }, [tagCounts, selectedTag]);

  const visibleItems = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return items.filter((item) => {
      const tags = item.tags || [];
      if (selectedTag === UNTAGGED && tags.length) return false;
      if (selectedTag !== ALL && selectedTag !== UNTAGGED && !tags.includes(selectedTag)) return false;
      if (!keyword) return true;
      return [item.content, ...tags].filter(Boolean).join(' ').toLowerCase().includes(keyword);
    });
  }, [items, selectedTag, searchText]);

  const relatedTags = useMemo(() => {
    if (selectedTag === ALL || selectedTag === UNTAGGED) return [];
    const counts = new Map();
    items.forEach((item) => {
      const tags = item.tags || [];
      if (!tags.includes(selectedTag)) return;
      tags.forEach((tag) => { if (tag !== selectedTag) counts.set(tag, (counts.get(tag) || 0) + 1); });
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')).slice(0, 6);
  }, [items, selectedTag]);

  const ensureTags = useCallback(async (tags) => {
    if (!tagsCollectionName) return;
    const missing = tags.filter((tag) => !allTags.includes(tag));
    await Promise.all(missing.map((tag) => setDoc(doc(database, tagsCollectionName, tag), {})));
  }, [allTags, database, tagsCollectionName]);

  const create = async ({ content, tags }) => {
    await ensureTags(tags);
    const ref = await addDoc(collection(database, collectionName), {
      content, tags, ...(extraFields || {}), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    setFreshId(ref?.id || null);
    setTimeout(() => setFreshId(null), 2400);
    setToast('追加しました');
    if (searchText) setSearchText('');
  };
  const saveEdit = async ({ content, tags }) => {
    if (!editing) return;
    await ensureTags(tags);
    await updateDoc(doc(database, collectionName, editing.id), { content, tags, updatedAt: serverTimestamp() });
    setEditing(null);
    setToast('更新しました');
  };
  const copyItem = async (item) => {
    await navigator.clipboard.writeText(item.content || '');
    setToast('コピーしました');
  };
  const removeItem = async (item) => {
    if (!window.confirm(deleteConfirmMessage)) return;
    await deleteDoc(doc(database, collectionName, item.id));
    setToast('削除しました');
  };

  const composerTags = useMemo(
    () => (selectedTag === ALL || selectedTag === UNTAGGED ? [] : [selectedTag]),
    [selectedTag],
  );
  const railItems = [ALL, ...orderedTags];

  return (
    <Box>
      <Composer
        key={`composer-${selectedTag}`}
        inputRef={composerRef}
        placeholder={placeholder}
        knownTags={knownTags}
        initialTags={composerTags}
        onSave={create}
        compactUntilFocus={isMobile}
      />

      <Box sx={{
        display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: '200px minmax(0,1fr)' },
        columnGap: { md: 4 }, rowGap: 2, mt: { xs: 2.5, md: 3.5 },
      }}>
        {/* Tag rail */}
        <Box component="nav" aria-label="タグ" sx={{ position: { md: 'sticky' }, top: { md: 0 }, alignSelf: 'start', minWidth: 0 }}>
          <Typography variant="overline" sx={{ display: { xs: 'none', md: 'block' }, color: V.faint, mb: 0.6 }}>Tags</Typography>
          <Box sx={{
            display: { xs: 'flex', md: 'block' }, gap: 0.5, overflowX: { xs: 'auto', md: 'visible' },
            maxHeight: { md: 'calc(100vh - 220px)' }, overflowY: { md: 'auto' }, mx: { xs: -1, md: 0 }, px: { xs: 1, md: 0 },
            scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' },
          }}>
            {railItems.map((tag) => {
              const active = selectedTag === tag;
              const count = tag === ALL ? items.length : tagCounts.get(tag) || 0;
              return (
                <Box key={tag} component="button" type="button" aria-pressed={active}
                  onClick={() => { setSelectedTag(tag); setSearchText(''); }}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 0.9, width: { xs: 'auto', md: '100%' }, flexShrink: 0,
                    border: '1px solid', borderColor: { xs: active ? V.ink : V.rule, md: active ? V.rule : 'transparent' },
                    background: active ? V.surface : 'transparent', borderRadius: 1.2, px: 1.1, py: { xs: 0.6, md: 0.7 }, mb: { md: 0.2 },
                    font: 'inherit', textAlign: 'left', cursor: 'pointer', color: active ? V.ink : V.muted,
                    '&:hover': { color: V.ink, background: active ? V.surface : V.sunken },
                  }}>
                  <TagDot tag={tag} />
                  <Box component="span" sx={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: active ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {tagLabel(tag)}
                  </Box>
                  <Box component="span" sx={{ fontFamily: MONO, fontSize: 11, color: V.faint }}>{count}</Box>
                </Box>
              );
            })}
          </Box>
        </Box>

        {/* Items */}
        <Box component="section" aria-label="メモ一覧" sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.2, pb: 1.3, mb: 1.8, borderBottom: '1px solid', borderColor: V.ink }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
              <Typography component="h2" sx={{ fontSize: { xs: 19, md: 21 }, fontWeight: 800, lineHeight: 1.3 }} noWrap>
                {selectedTag === ALL ? 'すべて' : `#${tagLabel(selectedTag)}`}
              </Typography>
              <Typography component="span" sx={{ fontFamily: MONO, fontSize: 12, color: V.muted }}>{visibleItems.length}</Typography>
            </Box>
            {relatedTags.length > 0 && (
              <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography component="span" sx={{ fontSize: 11.5, color: V.faint }}>一緒に使われるタグ</Typography>
                {relatedTags.map(([tag, count]) => (
                  <Box key={tag} component="button" type="button" onClick={() => setSelectedTag(tag)}
                    sx={{ border: 0, background: 'none', p: 0, font: 'inherit', fontSize: 12, color: V.muted, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 0.5, '&:hover': { color: V.ink } }}>
                    <TagDot tag={tag} size={6} />{tag}<Box component="span" sx={{ fontFamily: MONO, fontSize: 10.5, color: V.faint }}>{count}</Box>
                  </Box>
                ))}
              </Box>
            )}
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 0.6, ml: 'auto', border: '1px solid', borderColor: V.ruleStrong, borderRadius: 1.2,
              background: V.surface, px: 1, height: 32, width: { xs: '100%', sm: 220 }, '&:focus-within': { borderColor: V.ink },
            }}>
              <SearchIcon sx={{ fontSize: 16, color: V.faint }} />
              <InputBase value={searchText} onChange={(event) => setSearchText(event.target.value)}
                placeholder={selectedTag === ALL ? 'すべてを検索' : 'このタグ内を検索'} inputProps={{ 'aria-label': 'メモを検索' }}
                sx={{ flex: 1, fontSize: 13, color: V.ink }} />
              {searchText && <IconButton size="small" aria-label="検索を消去" onClick={() => setSearchText('')} sx={{ p: 0.2 }}><CloseIcon sx={{ fontSize: 14 }} /></IconButton>}
            </Box>
          </Box>

          {items.length === 0 ? (
            <Box sx={{ border: '1px dashed', borderColor: V.ruleStrong, borderRadius: 1.5, py: 7, px: 2, textAlign: 'center' }}>
              <Typography sx={{ fontWeight: 700 }}>まだ何もありません</Typography>
              <Typography variant="body2" sx={{ color: V.muted, mt: 0.5 }}>{emptyMessage}</Typography>
              <Button variant="outlined" startIcon={<AddIcon />} sx={{ mt: 2 }} onClick={() => composerRef.current?.focus()}>最初の1件を書く</Button>
            </Box>
          ) : visibleItems.length === 0 ? (
            <Box sx={{ py: 7, textAlign: 'center' }}>
              <Typography sx={{ fontWeight: 700 }}>該当するメモがありません</Typography>
              <Typography variant="body2" sx={{ color: V.muted, mt: 0.5 }}>検索語を変えるか、上の欄から追加してください。</Typography>
            </Box>
          ) : (
            <Box sx={{ columnCount: { xs: 1, sm: 2, lg: 3, xl: 4 }, columnGap: '12px' }}>
              {visibleItems.map((item) => (
                <MemoCard
                  key={item.id}
                  item={item}
                  showTags={selectedTag === ALL || (item.tags || []).length > 1}
                  fresh={item.id === freshId}
                  onEdit={setEditing}
                  onCopy={copyItem}
                  onDelete={removeItem}
                  onTag={(tag) => setSelectedTag(tag)}
                />
              ))}
            </Box>
          )}
          <Typography sx={{ display: { xs: 'none', md: 'block' }, mt: 3, fontSize: 11.5, color: V.faint }}>
            <Box component="span" sx={{ fontFamily: MONO }}>N</Box> キーで入力欄へ ・ ダブルクリックで編集
          </Typography>
        </Box>
      </Box>

      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} fullWidth maxWidth="sm" fullScreen={isMobile}>
        <DialogTitle sx={{ pb: 1 }}>編集</DialogTitle>
        <DialogContent sx={{ pt: '4px !important' }}>
          {editing && (
            <Composer
              key={editing.id}
              autoFocus
              placeholder={placeholder}
              knownTags={knownTags}
              initialContent={editing.content || ''}
              initialTags={editing.tags || []}
              onSave={saveEdit}
              onCancel={() => setEditing(null)}
              submitLabel="保存"
            />
          )}
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'flex-start', px: 3, pb: 2 }}>
          {editing && (
            <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={async () => { await removeItem(editing); setEditing(null); }}>
              削除
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {isMobile && (
        <Fab
          color="primary"
          aria-label="追加"
          onClick={() => { composerRef.current?.focus(); composerRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }}
          sx={{ position: 'fixed', right: 16, bottom: 'calc(80px + env(safe-area-inset-bottom))', zIndex: 1100, boxShadow: '0 8px 22px rgba(0,0,0,.22)' }}
        >
          <AddIcon />
        </Fab>
      )}

      <Snackbar open={Boolean(toast)} autoHideDuration={1800} onClose={() => setToast('')} message={toast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} sx={{ bottom: { xs: 90, md: 24 } }} />
    </Box>
  );
}

export default CollectionBoard;
