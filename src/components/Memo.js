import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp, updateDoc, doc, getDoc, deleteDoc, getDocs } from '../documentDbClient';
import {
  Box,
  TextField,
  Button,
  Typography,
  Paper,
  IconButton,
  ButtonGroup,
  FormControl,
  InputLabel,
  Select,
  MenuItem
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Delete as DeleteIcon,
  FormatBold as FormatBoldIcon,
  FormatItalic as FormatItalicIcon,
  FormatUnderlined as FormatUnderlinedIcon,
  FormatListBulleted as FormatListBulletedIcon,
  FormatListNumbered as FormatListNumberedIcon
} from '@mui/icons-material';

function Memo() {
  const { memoId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [memoText, setMemoText] = useState('');
  const [status, setStatus] = useState('inbox');
  const [urgency, setUrgency] = useState('medium');
  const [importance, setImportance] = useState('medium');
  const [context, setContext] = useState('');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState([]);
  

  const memoTextFieldRef = useRef(null);

  useEffect(() => {
    const fetchMemo = async () => {
      if (memoId) {
        try {
          const docRef = doc(db, 'memos', memoId);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const memoData = docSnap.data();
            setMemoText(memoData.text || '');
            setStatus(memoData.status || 'inbox');
            setUrgency(memoData.urgency || 'medium');
            setImportance(memoData.importance || 'medium');
            setContext(memoData.context || '');
            setProjectId(memoData.projectId || ''); // Use projectId
          } else {
            console.log("No such document!");
            navigate('/'); // メモが存在しない場合はダッシュボードに戻る
          }
        } catch (error) {
          console.error("Error fetching document:", error);
        }
      } else {
        // 新規メモの場合、URLクエリパラメータから初期ステータスを設定
        const queryParams = new URLSearchParams(location.search);
        const initialStatus = queryParams.get('status');
        if (initialStatus) {
          setStatus(initialStatus);
        }
      }
    };

    const fetchProjects = async () => {
      try {
        const projectsCollection = collection(db, 'projects');
        const projectSnapshot = await getDocs(projectsCollection);
        const projectsList = projectSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setProjects(projectsList);
      } catch (error) {
        console.error("Error fetching projects:", error);
      }
    };

    fetchMemo();
    fetchProjects();
  }, [memoId, navigate, location.search]);

  const parseTags = (text) => {
    const tagRegex = /#(\w+)/g;
    const matches = text.match(tagRegex);
    return matches ? Array.from(new Set(matches.map(tag => tag.substring(1)))) : [];
  };

  const handleSaveMemo = async () => {
    if (memoText.trim() === '') return;

    const currentTags = parseTags(memoText);
    const memoData = {
      text: memoText,
      tags: currentTags,
      updatedAt: serverTimestamp(),
      status: status,
      urgency: urgency,
      importance: importance,
      context: context,
      projectId: projectId,
    };

    try {
      if (memoId) {
        await updateDoc(doc(db, 'memos', memoId), memoData);
        console.log('メモを更新しました:', memoId);
      } else {
        const docRef = await addDoc(collection(db, 'memos'), {
          ...memoData,
          createdAt: serverTimestamp(),
        });
        console.log('新しいメモを追加しました:', docRef.id);
      }
      navigate('/'); // 保存後にダッシュボードに戻る
    } catch (error) {
      console.error('メモの保存に失敗しました:', error);
    }
  };

  const handleDeleteMemo = async () => {
    if (!memoId) return;
    try {
      await deleteDoc(doc(db, 'memos', memoId));
      console.log('メモを削除しました:', memoId);
      navigate('/'); // 削除後にダッシュボードに戻る
    } catch (error) {
      console.error('メモの削除に失敗しました:', error);
    }
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

    setTimeout(() => {
      textField.selectionStart = start + prefix.length;
      textField.selectionEnd = end + prefix.length;
      textField.focus();
    }, 0);
  };

  return (
    <Paper sx={{ p: { xs: 2, sm: 3 }, m: { xs: 1, sm: 'auto' }, maxWidth: 800, mx: 'auto' }} elevation={3}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <IconButton onClick={() => navigate('/')} sx={{ mr: 1 }}>
            <ArrowBackIcon />
        </IconButton>
        <Typography variant="h4" component="h1" sx={{ flexGrow: 1, mb: 0, fontWeight: 'bold', color: 'primary.main' }}>
          {memoId ? "メモを編集" : "新しいメモ"}
        </Typography>
        {memoId && (
            <IconButton onClick={handleDeleteMemo} color="error">
                <DeleteIcon />
            </IconButton>
        )}
      </Box>
      
      <Box sx={{ mb: 3 }}>
        <TextField
          label="メモ内容"
          variant="outlined"
          fullWidth
          multiline
          rows={8}
          value={memoText}
          onChange={(e) => setMemoText(e.target.value)}
          inputRef={memoTextFieldRef}
        />
      </Box>
      <Box sx={{ mb: 3 }}>
        <ButtonGroup variant="outlined" aria-label="text formatting buttons">
          <Button onClick={() => applyFormatting('**', '**')}><FormatBoldIcon /></Button>
          <Button onClick={() => applyFormatting('*', '*')}><FormatItalicIcon /></Button>
          <Button onClick={() => applyFormatting('__', '__')}><FormatUnderlinedIcon /></Button>
          <Button onClick={() => applyFormatting('- ')}><FormatListBulletedIcon /></Button>
          <Button onClick={() => applyFormatting('1. ')}><FormatListNumberedIcon /></Button>
        </ButtonGroup>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2, mb: 3 }}>
        <FormControl fullWidth>
          <InputLabel id="status-label">ステータス</InputLabel>
          <Select
            labelId="status-label"
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
          label="コンテキスト (例: @自宅)"
          variant="outlined"
          fullWidth
          value={context}
          onChange={(e) => setContext(e.target.value)}
        />
        <FormControl fullWidth>
          <InputLabel id="project-label">プロジェクト</InputLabel>
          <Select
            labelId="project-label"
            value={projectId}
            label="プロジェクト"
            onChange={(e) => setProjectId(e.target.value)}
          >
            <MenuItem value="">なし</MenuItem>
            {projects.map((project) => (
              <MenuItem key={project.id} value={project.id}>
                {project.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
          <Button
            variant="outlined"
            onClick={() => navigate('/')}
          >
            キャンセル
          </Button>
          <Button
            variant="contained"
            onClick={handleSaveMemo}
          >
            {memoId ? "更新" : "追加"}
          </Button>
      </Box>
    </Paper>
  );
}

export default Memo;

