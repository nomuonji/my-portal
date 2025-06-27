import React, { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../firebase';
import {
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  doc,
  deleteDoc
} from 'firebase/firestore';
import {
  Box,
  TextField,
  Button,
  Typography,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  IconButton,
  Chip,
  ButtonGroup,
  FormControl,
  InputLabel,
  Select,
  MenuItem
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Clear as ClearIcon,
  Search as SearchIcon,
  FormatBold as FormatBoldIcon,
  FormatItalic as FormatItalicIcon,
  FormatUnderlined as FormatUnderlinedIcon,
  FormatListBulleted as FormatListBulletedIcon,
  FormatListNumbered as FormatListNumberedIcon
} from '@mui/icons-material';
import { marked } from 'marked';

function Memo() {
  const [memoText, setMemoText] = useState('');
  const [memos, setMemos] = useState([]);
  const [filteredMemos, setFilteredMemos] = useState([]);
  const [selectedMemo, setSelectedMemo] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  // 新しい属性のstate
  const [status, setStatus] = useState('inbox');
  const [urgency, setUrgency] = useState('medium');
  const [importance, setImportance] = useState('medium');
  const [context, setContext] = useState('');
  const [projectName, setProjectName] = useState('');

  const [debounceTimer, setDebounceTimer] = useState(null);
  const memoTextFieldRef = useRef(null);

  useEffect(() => {
    const q = query(collection(db, 'memos'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedMemos = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setMemos(fetchedMemos);
      setFilteredMemos(fetchedMemos);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const lowercasedSearchTerm = searchTerm.toLowerCase();
    const results = memos.filter(memo =>
      memo.text.toLowerCase().includes(lowercasedSearchTerm) ||
      (memo.tags && memo.tags.some(tag => tag.toLowerCase().includes(lowercasedSearchTerm))) ||
      (memo.context && memo.context.toLowerCase().includes(lowercasedSearchTerm)) ||
      (memo.project_name && memo.project_name.toLowerCase().includes(lowercasedSearchTerm))
    );
    setFilteredMemos(results);
  }, [searchTerm, memos]);

  const parseTags = (text) => {
    const tagRegex = /#(\w+)/g;
    const matches = text.match(tagRegex);
    return matches ? Array.from(new Set(matches.map(tag => tag.substring(1)))) : [];
  };

  const autoSaveMemo = useCallback(async (text, currentSelectedMemo) => {
    if (!currentSelectedMemo || text.trim() === currentSelectedMemo.text.trim()) {
      return; // 新規メモの場合、またはテキストが変更されていない場合は自動保存しない
    }

    const tags = parseTags(text);
    const memoData = {
      text: text,
      tags: tags,
      updatedAt: serverTimestamp(),
      status: currentSelectedMemo.status || 'inbox',
      urgency: currentSelectedMemo.urgency || 'medium',
      importance: currentSelectedMemo.importance || 'medium',
      context: currentSelectedMemo.context || '',
      project_name: currentSelectedMemo.project_name || '',
    };

    try {
      await updateDoc(doc(db, 'memos', currentSelectedMemo.id), memoData);
      console.log('メモを自動保存しました:', currentSelectedMemo.id);
    } catch (error) {
      console.error('メモの自動保存に失敗しました:', error);
    }
  }, []);

  useEffect(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    if (selectedMemo) {
      const timer = setTimeout(() => {
        autoSaveMemo(memoText, selectedMemo);
      }, 1000); // 1秒間入力がなければ保存
      setDebounceTimer(timer);
    }
    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  }, [memoText, selectedMemo, autoSaveMemo]);

  const handleSaveMemo = async () => {
    if (memoText.trim() === '') return;

    const tags = parseTags(memoText);
    const memoData = {
      text: memoText,
      tags: tags,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      status: status,
      urgency: urgency,
      importance: importance,
      context: context,
      project_name: projectName,
    };

    try {
      if (selectedMemo) {
        await updateDoc(doc(db, 'memos', selectedMemo.id), memoData);
        console.log('メモを更新しました:', selectedMemo.id);
      } else {
        await addDoc(collection(db, 'memos'), memoData);
        console.log('新しいメモを追加しました。');
      }
      setMemoText('');
      setSelectedMemo(null);
      setStatus('inbox');
      setUrgency('medium');
      setImportance('medium');
      setContext('');
      setProjectName('');
    } catch (error) {
      console.error('メモの保存に失敗しました:', error);
    }
  };

  const handleDeleteMemo = async (id) => {
    try {
      await deleteDoc(doc(db, 'memos', id));
      console.log('メモを削除しました:', id);
      if (selectedMemo && selectedMemo.id === id) {
        setSelectedMemo(null);
        setMemoText('');
        setStatus('inbox');
        setUrgency('medium');
        setImportance('medium');
        setContext('');
        setProjectName('');
      }
    } catch (error) {
      console.error('メモの削除に失敗しました:', error);
    }
  };

  const handleSelectMemo = (memo) => {
    setSelectedMemo(memo);
    setMemoText(memo.text);
    setStatus(memo.status || 'inbox');
    setUrgency(memo.urgency || 'medium');
    setImportance(memo.importance || 'medium');
    setContext(memo.context || '');
    setProjectName(memo.project_name || '');
  };

  const handleClearSelection = () => {
    setSelectedMemo(null);
    setMemoText('');
    setStatus('inbox');
    setUrgency('medium');
    setImportance('medium');
    setContext('');
    setProjectName('');
  };

  const applyFormatting = (prefix, suffix = '') => {
    const textField = memoTextFieldRef.current;
    if (!textField) return;

    const start = textField.selectionStart;
    const end = textField.selectionEnd;
    const currentText = memoText;

    const newText = currentText.substring(0, start) +
                    prefix +
                    currentText.substring(start, end) +
                    suffix +
                    currentText.substring(end);

    setMemoText(newText);

    // カーソル位置を調整
    setTimeout(() => {
      textField.selectionStart = start + prefix.length;
      textField.selectionEnd = end + prefix.length;
      textField.focus();
    }, 0);
  };

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h4" gutterBottom>メモ</Typography>
      <Box sx={{ mb: 2 }}>
        <TextField
          label="メモを検索"
          variant="outlined"
          fullWidth
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          InputProps={{
            startAdornment: (
              <SearchIcon sx={{ mr: 1 }} />
            ),
          }}
        />
      </Box>
      <Box sx={{ display: 'flex', mb: 2, alignItems: 'flex-start' }}>
        <TextField
          label={selectedMemo ? "メモを編集" : "新しいメモ"}
          variant="outlined"
          fullWidth
          multiline
          rows={4}
          value={memoText}
          onChange={(e) => setMemoText(e.target.value)}
          sx={{ mr: 2 }}
          inputRef={memoTextFieldRef}
        />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Button
            variant="contained"
            onClick={handleSaveMemo}
          >
            {selectedMemo ? "更新" : "追加"}
          </Button>
          {selectedMemo && (
            <Button
              variant="outlined"
              onClick={handleClearSelection}
              startIcon={<ClearIcon />}
            >
              クリア
            </Button>
          )}
        </Box>
      </Box>
      <Box sx={{ mb: 2 }}>
        <ButtonGroup variant="outlined" aria-label="text formatting buttons">
          <Button onClick={() => applyFormatting('**', '**')}><FormatBoldIcon /></Button>
          <Button onClick={() => applyFormatting('*', '*')}><FormatItalicIcon /></Button>
          <Button onClick={() => applyFormatting('__', '__')}><FormatUnderlinedIcon /></Button>
          <Button onClick={() => applyFormatting('- ')}><FormatListBulletedIcon /></Button>
          <Button onClick={() => applyFormatting('1. ')}><FormatListNumberedIcon /></Button>
        </ButtonGroup>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2, mb: 2 }}>
        <FormControl fullWidth>
          <InputLabel id="status-label">ステータス</InputLabel>
          <Select
            labelId="status-label"
            id="status-select"
            value={status}
            label="ステータス"
            onChange={(e) => setStatus(e.target.value)}
          >
            <MenuItem value="inbox">受信箱</MenuItem>
            <MenuItem value="next_action">次の行動</MenuItem>
            <MenuItem value="project">プロジェクト</MenuItem>
            <MenuItem value="someday_maybe">いつかやる/多分やる</MenuItem>
            <MenuItem value="reference">参照資料</MenuItem>
            <MenuItem value="done">完了</MenuItem>
          </Select>
        </FormControl>
        <FormControl fullWidth>
          <InputLabel id="urgency-label">緊急度</InputLabel>
          <Select
            labelId="urgency-label"
            id="urgency-select"
            value={urgency}
            label="緊急度"
            onChange={(e) => setUrgency(e.target.value)}
          >
            <MenuItem value="high">高</MenuItem>
            <MenuItem value="medium">中</MenuItem>
            <MenuItem value="low">低</MenuItem>
          </Select>
        </FormControl>
        <FormControl fullWidth>
          <InputLabel id="importance-label">重要度</InputLabel>
          <Select
            labelId="importance-label"
            id="importance-select"
            value={importance}
            label="重要度"
            onChange={(e) => setImportance(e.target.value)}
          >
            <MenuItem value="high">高</MenuItem>
            <MenuItem value="medium">中</MenuItem>
            <MenuItem value="low">低</MenuItem>
          </Select>
        </FormControl>
        <TextField
          label="コンテキスト (例: 自宅, オフィス)"
          variant="outlined"
          fullWidth
          value={context}
          onChange={(e) => setContext(e.target.value)}
        />
        <TextField
          label="プロジェクト名"
          variant="outlined"
          fullWidth
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
        />
      </Box>
      <List>
        {filteredMemos.map((memo) => (
          <Paper key={memo.id} sx={{ mb: 2, p: 2 }}>
            <ListItemButton
              onClick={() => handleSelectMemo(memo)}
              secondaryAction={
                <IconButton edge="end" aria-label="delete" onClick={(e) => { e.stopPropagation(); handleDeleteMemo(memo.id); }}>
                  <DeleteIcon />
                </IconButton>
              }
            >
              <ListItemText
                primary={
                  <div dangerouslySetInnerHTML={{ __html: marked.parse(memo.text) }} />
                }
                secondary={
                  <Box>
                    <Typography variant="caption" display="block">
                      作成日時: {memo.createdAt?.toDate().toLocaleString()}
                    </Typography>
                    {memo.updatedAt && (
                      <Typography variant="caption" display="block">
                        更新日時: {memo.updatedAt?.toDate().toLocaleString()}
                      </Typography>
                    )}
                    {memo.tags && memo.tags.length > 0 && (
                      <Box sx={{ mt: 1 }}>
                        {memo.tags.map(tag => (
                          <Chip key={tag} label={`#${tag}`} size="small" sx={{ mr: 0.5, mb: 0.5 }} />
                        ))}
                      </Box>
                    )}
                    {(memo.status || memo.urgency || memo.importance || memo.context || memo.project_name) && (
                      <Box sx={{ mt: 1 }}>
                        {memo.status && <Chip label={`ステータス: ${memo.status}`} size="small" sx={{ mr: 0.5, mb: 0.5 }} />}
                        {memo.urgency && <Chip label={`緊急度: ${memo.urgency}`} size="small" sx={{ mr: 0.5, mb: 0.5 }} />}
                        {memo.importance && <Chip label={`重要度: ${memo.importance}`} size="small" sx={{ mr: 0.5, mb: 0.5 }} />}
                        {memo.context && <Chip label={`コンテキスト: ${memo.context}`} size="small" sx={{ mr: 0.5, mb: 0.5 }} />}
                        {memo.project_name && <Chip label={`プロジェクト: ${memo.project_name}`} size="small" sx={{ mr: 0.5, mb: 0.5 }} />}
                      </Box>
                    )}
                  </Box>
                }
              />
            </ListItemButton>
          </Paper>
        ))}
      </List>
    </Box>
  );
}

export default Memo;

