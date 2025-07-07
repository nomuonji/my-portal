import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot, doc, getDoc, getDocs, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from '../firebase';
import {
  Typography,
  Box,
  CircularProgress,
  Alert,
  Button,
  Paper,
  Chip,
  Grid,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  List,
  ListItem,
  ListItemText,
  ListItemButton
} from '@mui/material';
import { ArrowBack as ArrowBackIcon, AddCircleOutline as AddCircleOutlineIcon, Link as LinkIcon, LinkOff as LinkOffIcon, ContentCopy as ContentCopyIcon, Edit as EditIcon, Delete as DeleteIcon, Clear as ClearIcon } from '@mui/icons-material';
import { getContrastRatio, useTheme } from '@mui/material/styles';

// Helper to convert hex to HSL
function hexToHsl(hex) {
  let r = 0, g = 0, b = 0;
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else if (hex.length === 7) {
    r = parseInt(hex.substring(1, 3), 16);
    g = parseInt(hex.substring(3, 5), 16);
    b = parseInt(hex.substring(5, 7), 16);
  }
  r /= 255; g /= 255; b /= 255;

  let max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) { h = s = 0; } else {
    let d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

// Helper to convert HSL to hex
function hslToHex(h, s, l) {
  l /= 100;
  const a = s * Math.min(l, 1 - l) / 100;
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Function to generate a consistent color from a string (tag)
const getTagColor = (tag) => {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  let color = '#';
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xFF;
    color += ('00' + value.toString(16)).substr(-2);
  }
  return color;
};

// IdeaCard Component
const IdeaCard = ({ idea, onLink, onUnlink, onEdit, onDelete, isLinked }) => {
  const theme = useTheme();
  const cardColor = idea.tags && idea.tags.length > 0
    ? hslToHex(...hexToHsl(getTagColor(idea.tags[0])).map((val, i) => i === 2 ? Math.max(20, val - 30) : val))
    : theme.palette.background.paper;
  const textColor = getContrastRatio(cardColor, '#fff') > 4.5 ? '#fff' : '#000';

  return (
    <Paper
      sx={{
        p: 2,
        height: '100%',
        backgroundColor: cardColor,
        color: textColor,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Typography variant="body2" sx={{ my: 1, whiteSpace: 'pre-wrap', flexGrow: 1 }}>
          {idea.content}
        </Typography>
        <Box sx={{ flexShrink: 0, ml: 1 }}>
          {isLinked ? (
            <IconButton size="small" onClick={() => onUnlink(idea.id)} sx={{ color: textColor }}>
              <LinkOffIcon />
            </IconButton>
          ) : (
            <IconButton size="small" onClick={() => onLink(idea.id)} sx={{ color: textColor }}>
              <LinkIcon />
            </IconButton>
          )}
        </Box>
      </Box>
      <Box sx={{ mb: 1 }}>
        {idea.tags && idea.tags.map(tag => (
          <Chip
            key={tag}
            label={tag}
            size="small"
            sx={{
              mr: 0.5,
              backgroundColor: hslToHex(...hexToHsl(getTagColor(tag)).map((val, i) => i === 2 ? Math.min(100, val + 10) : val)),
              color: getContrastRatio(hslToHex(...hexToHsl(getTagColor(tag)).map((val, i) => i === 2 ? Math.min(100, val + 10) : val)), '#fff') > 4.5 ? '#fff' : '#000',
            }}
          />
        ))}
      </Box>
    </Paper>
  );
};

function ProjectDetails() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState(null);
  const [linkedIdeas, setLinkedIdeas] = useState([]);
  const [availableIdeas, setAvailableIdeas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openLinkDialog, setOpenLinkDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [allTags, setAllTags] = useState([]);
  const [filterTag, setFilterTag] = useState(null);

  useEffect(() => {
    const tagsCollectionRef = collection(db, 'tags');
    const unsubscribe = onSnapshot(tagsCollectionRef, (snapshot) => {
      const fetchedTags = snapshot.docs.map(doc => doc.id);
      setAllTags(fetchedTags);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const fetchProjectDetails = async () => {
      if (!projectId) {
        setError("プロジェクトIDが指定されていません。");
        setLoading(false);
        return;
      }

      try {
        const projectDocRef = doc(db, 'projects', projectId);
        const projectDocSnap = await getDoc(projectDocRef);
        if (projectDocSnap.exists()) {
          setProject({ id: projectDocSnap.id, ...projectDocSnap.data() });
        } else {
          setError("プロジェクトが見つかりませんでした。");
        }
      } catch (err) {
        console.error("Error fetching project details:", err);
        setError('プロジェクト詳細の読み込み中にエラーが発生しました。');
      } finally {
        setLoading(false);
      }
    };

    fetchProjectDetails();
  }, [projectId]);

  useEffect(() => {
    if (!project?.ideaIds) {
      setLinkedIdeas([]);
      return;
    }

    if (project.ideaIds.length === 0) {
      setLinkedIdeas([]);
      return;
    }

    const q = query(collection(db, 'ideas'), where('__name__', 'in', project.ideaIds));
    const unsubscribeLinkedIdeas = onSnapshot(q, (snapshot) => {
      const fetchedIdeas = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setLinkedIdeas(fetchedIdeas);
    }, (err) => {
      console.error("Error fetching linked ideas:", err);
      setError('関連アイデアの読み込み中にエラーが発生しました。');
    });

    return () => unsubscribeLinkedIdeas();
  }, [project?.ideaIds]);

  const fetchAvailableIdeas = async () => {
    try {
      const allIdeasSnapshot = await getDocs(collection(db, 'ideas'));
      const allIdeas = allIdeasSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const currentLinkedIdeaIds = project?.ideaIds || [];
      const unlinkedIdeas = allIdeas.filter(idea => !currentLinkedIdeaIds.includes(idea.id));
      setAvailableIdeas(unlinkedIdeas);
    } catch (err) {
      console.error("Error fetching available ideas:", err);
      setError('利用可能なアイデアの読み込み中にエラーが発生しました。');
    }
  };

  const handleLinkIdea = async (ideaId) => {
    if (project) {
      try {
        const projectRef = doc(db, 'projects', projectId);
        await updateDoc(projectRef, {
          ideaIds: arrayUnion(ideaId)
        });

        // Fetch the newly linked idea and update local state immediately
        const ideaDocRef = doc(db, 'ideas', ideaId);
        const ideaDocSnap = await getDoc(ideaDocRef);
        if (ideaDocSnap.exists()) {
          const newIdea = { id: ideaDocSnap.id, ...ideaDocSnap.data() };
          setLinkedIdeas(prevLinkedIdeas => [...prevLinkedIdeas, newIdea]);
        }

        setProject(prevProject => ({
          ...prevProject,
          ideaIds: [...(prevProject.ideaIds || []), ideaId]
        }));
        console.log(`Idea ${ideaId} linked to project ${projectId}`);
        setOpenLinkDialog(false); // Close dialog after linking
      } catch (error) {
        console.error("Error linking idea:", error);
        setError('アイデアの紐付けに失敗しました。');
      }
    }
  };

  const handleUnlinkIdea = async (ideaId) => {
    if (project && window.confirm('本当にこのアイデアの紐付けを解除しますか？')) {
      try {
        const projectRef = doc(db, 'projects', projectId);
        await updateDoc(projectRef, {
          ideaIds: arrayRemove(ideaId)
        });
        // Update local state immediately
        setLinkedIdeas(prevLinkedIdeas => prevLinkedIdeas.filter(idea => idea.id !== ideaId));
        setProject(prevProject => ({
          ...prevProject,
          ideaIds: (prevProject.ideaIds || []).filter(id => id !== ideaId)
        }));
        console.log(`Idea ${ideaId} unlinked from project ${projectId}`);
      } catch (error) {
        console.error("Error unlinking idea:", error);
        setError('アイデアの紐付け解除に失敗しました。');
      }
    }
  };

  const handleEditIdea = (ideaId) => {
    navigate(`/idea?id=${ideaId}`);
  };

  const handleDeleteIdea = (ideaId) => {
    // This should ideally be handled in the Idea component or a dedicated idea management page
    // For now, we'll just log a message.
    console.log(`Delete idea with ID: ${ideaId}`);
    alert('アイデアの削除はアイデア管理画面から行ってください。');
  };

  const handleOpenLinkDialog = () => {
    fetchAvailableIdeas();
    setOpenLinkDialog(true);
  };

  const handleCloseLinkDialog = () => {
    setOpenLinkDialog(false);
    setSearchQuery('');
  };

  const filteredAvailableIdeas = availableIdeas.filter(idea =>
    (idea.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (idea.tags && idea.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase())))) &&
    (!filterTag || (idea.tags && idea.tags.includes(filterTag)))
  );

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  return (
    <Box sx={{ p: 3 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/project')} sx={{ mb: 2 }}>
        プロジェクト一覧に戻る
      </Button>
      <Typography variant="h4" component="h1" gutterBottom>
        {project ? project.name : 'プロジェクト詳細'}
      </Typography>
      {project && project.description && (
        <Typography variant="body1" color="text.secondary" gutterBottom>
          {project.description}
        </Typography>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 4, mb: 2 }}>
        <Typography variant="h5" component="h2">
          関連アイデア
        </Typography>
        <Box>
          <Button
            variant="outlined"
            startIcon={<LinkIcon />}
            onClick={handleOpenLinkDialog}
            sx={{ mr: 1 }}
          >
            アイデアを紐付ける
          </Button>
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddCircleOutlineIcon />}
            onClick={() => navigate('/idea')}
          >
            新しいアイデア
          </Button>
        </Box>
      </Box>

      {linkedIdeas.length === 0 ? (
        <Typography variant="body1">このプロジェクトにはまだアイデアが紐付けられていません。</Typography>
      ) : (
        <Grid container spacing={3}>
          {linkedIdeas.map((idea) => (
            <Grid item xs={12} sm={6} md={4} key={idea.id}>
              <IdeaCard
                idea={idea}
                onLink={handleLinkIdea}
                onUnlink={handleUnlinkIdea}
                onEdit={handleEditIdea}
                onDelete={handleDeleteIdea}
                isLinked={true}
              />
            </Grid>
          ))}
        </Grid>
      )}

      {/* Link Idea Dialog */}
      <Dialog open={openLinkDialog} onClose={handleCloseLinkDialog} fullWidth maxWidth="md">
        <DialogTitle>アイデアを紐付ける</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="アイデアを検索"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            sx={{ mb: 2 }}
          />
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
            {allTags.map(tag => (
              <Chip
                key={`filter-${tag}`}
                label={tag}
                onClick={() => setFilterTag(filterTag === tag ? null : tag)}
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
          <Grid container spacing={2}>
            {filteredAvailableIdeas.length === 0 ? (
              <Grid item xs={12}>
                <Typography>利用可能なアイデアはありません。</Typography>
              </Grid>
            ) : (
              filteredAvailableIdeas.map((idea) => (
                <Grid item xs={12} sm={6} md={4} key={idea.id}>
                  <IdeaCard
                    idea={idea}
                    onLink={handleLinkIdea}
                    onUnlink={handleUnlinkIdea}
                    onEdit={handleEditIdea}
                    onDelete={handleDeleteIdea}
                    isLinked={false} // This is for available ideas, so they are not linked yet
                  />
                </Grid>
              ))
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseLinkDialog}>キャンセル</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default ProjectDetails;