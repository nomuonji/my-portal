import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, onSnapshot, query, orderBy, updateDoc, writeBatch, where } from 'firebase/firestore';
import { db } from '../firebase';
import { Link as RouterLink } from 'react-router-dom';
import { List, ListItem, ListItemText, Typography, Box, IconButton, ListItemIcon, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { Folder, FolderOpen, Edit, Delete } from '@mui/icons-material';


const GroupAndDeckList = () => {
  const [groups, setGroups] = useState([]);
  const [decks, setDecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openGroupEditDialog, setOpenGroupEditDialog] = useState(false);
  const [currentGroup, setCurrentGroup] = useState(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [openDeckEditDialog, setOpenDeckEditDialog] = useState(false);
  const [currentDeck, setCurrentDeck] = useState(null);
  const [newDeckName, setNewDeckName] = useState('');
  const [newDeckGroupId, setNewDeckGroupId] = useState('');

  useEffect(() => {
    const unsubscribeGroups = onSnapshot(query(collection(db, 'groups'), orderBy('order')), (snapshot) => {
      const groupData = [];
      snapshot.forEach((doc) => groupData.push({ id: doc.id, ...doc.data() }));
      setGroups(groupData);
    });

    const unsubscribeDecks = onSnapshot(query(collection(db, 'decks'), orderBy('order')), (snapshot) => {
      const deckData = [];
      snapshot.forEach((doc) => deckData.push({ id: doc.id, ...doc.data() }));
      setDecks(deckData);
    });

    setLoading(false);

    return () => { 
      unsubscribeGroups();
      unsubscribeDecks();
    };
  }, []);

  const renderGroupTree = () => {
    const unassignedDecks = decks.filter(deck => !deck.groupId);

    return (
      <List>
        {unassignedDecks.length > 0 && (
          <React.Fragment>
            <ListItem>
              <ListItemIcon>
                <FolderOpen />
              </ListItemIcon>
              <ListItemText primary="グループなし" primaryTypographyProps={{ variant: 'h6' }} />
            </ListItem>
            <List sx={{ pl: 4 }}>
              {unassignedDecks.map(deck => (
                <ListItem button component={RouterLink} to={`/deck/${deck.id}/flashcards`} key={deck.id}
                  secondaryAction={
                    <>
                      <IconButton edge="end" aria-label="edit" onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleEditDeck(e, deck); }}>
                        <Edit />
                      </IconButton>
                      <IconButton edge="end" aria-label="delete" onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleDeleteDeck(e, deck.id); }}>
                        <Delete />
                      </IconButton>
                    </>
                  }
                >
                  <ListItemIcon>
                    <Folder />
                  </ListItemIcon>
                  <ListItemText primary={deck.name} />
                </ListItem>
              ))}
            </List>
          </React.Fragment>
        )}

        {groups.map(group => (
          <React.Fragment key={group.id}>
            <ListItem
              secondaryAction={
                <>
                  <IconButton edge="end" aria-label="edit" onClick={() => handleEditGroup(group)}>
                    <Edit />
                  </IconButton>
                  <IconButton edge="end" aria-label="delete" onClick={() => handleDeleteGroup(group.id)}>
                    <Delete />
                  </IconButton>
                </>
              }
            >
              <ListItemIcon>
                <FolderOpen />
              </ListItemIcon>
              <ListItemText primary={group.name} primaryTypographyProps={{ variant: 'h6' }} />
            </ListItem>
            <List sx={{ pl: 4 }}>
              {decks.filter(deck => deck.groupId === group.id).map(deck => (
                <ListItem button component={RouterLink} to={`/deck/${deck.id}/flashcards`} key={deck.id}
                  secondaryAction={
                    <>
                      <IconButton edge="end" aria-label="edit" onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleEditDeck(e, deck); }}>
                        <Edit />
                      </IconButton>
                      <IconButton edge="end" aria-label="delete" onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleDeleteDeck(e, deck.id); }}>
                        <Delete />
                      </IconButton>
                    </>
                  }
                >
                  <ListItemIcon>
                    <Folder />
                  </ListItemIcon>
                  <ListItemText primary={deck.name} />
                </ListItem>
              ))}
            </List>
          </React.Fragment>
        ))}
      </List>
    );
  };

  const handleEditGroup = (group) => {
    setCurrentGroup(group);
    setNewGroupName(group.name);
    setOpenGroupEditDialog(true);
  };

  const handleSaveGroup = async () => {
    if (currentGroup && newGroupName) {
      const groupRef = doc(db, 'groups', currentGroup.id);
      await updateDoc(groupRef, { name: newGroupName });
      setOpenGroupEditDialog(false);
      setCurrentGroup(null);
      setNewGroupName('');
    }
  };

  const handleDeleteGroup = async (groupId) => {
    if (window.confirm('このグループを削除すると、このグループに属するすべてのデッキとカードも削除されます。本当に削除しますか？')) {
      const batch = writeBatch(db);

      const decksToDelete = decks.filter(deck => deck.groupId === groupId);
      for (const deck of decksToDelete) {
        batch.delete(doc(db, 'decks', deck.id));
        const flashcardsToDelete = await getDocs(query(collection(db, 'flashcards'), where('deckId', '==', deck.id)));
        flashcardsToDelete.forEach(cardDoc => {
          batch.delete(doc(db, 'flashcards', cardDoc.id));
        });
      }
      batch.delete(doc(db, 'groups', groupId));
      await batch.commit();
    }
  };

  const handleEditDeck = (e, deck) => {
    e.stopPropagation(); // Prevent ListItem click
    setCurrentDeck(deck);
    setNewDeckName(deck.name);
    setNewDeckGroupId(deck.groupId);
    setOpenDeckEditDialog(true);
  };

  const handleSaveDeck = async () => {
    if (currentDeck && newDeckName && newDeckGroupId) {
      const deckRef = doc(db, 'decks', currentDeck.id);
      await updateDoc(deckRef, { name: newDeckName, groupId: newDeckGroupId });
      setOpenDeckEditDialog(false);
      setCurrentDeck(null);
      setNewDeckName('');
      setNewDeckGroupId('');
    }
  };

  const handleDeleteDeck = async (e, deckId) => {
    e.stopPropagation(); // Prevent ListItem click
    if (window.confirm('このデッキを削除すると、このデッキに属するすべてのカードも削除されます。本当に削除しますか？')) {
      const batch = writeBatch(db);

      batch.delete(doc(db, 'decks', deckId));
      const flashcardsToDelete = await getDocs(query(collection(db, 'flashcards'), where('deckId', '==', deckId)));
      flashcardsToDelete.forEach(cardDoc => {
        batch.delete(doc(db, 'flashcards', cardDoc.id));
      });
      await batch.commit();
    }
  };

  if (loading) {
    return <Typography>読み込み中...</Typography>;
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        グループとデッキ一覧
      </Typography>
      <Button 
        component={RouterLink} 
        to="/flashcards/new" 
        variant="contained" 
        color="primary" 
        sx={{ mr: 2 }}
      >
        新しいカードを追加
      </Button>
      <Button 
        component={RouterLink} 
        to="/flashcards/manage" 
        variant="outlined" 
        color="secondary" 
        sx={{ mb: 2 }}
      >
        すべてのカードを管理
      </Button>
      {renderGroupTree()}

      <Dialog open={openGroupEditDialog} onClose={() => setOpenGroupEditDialog(false)}>
        <DialogTitle>グループ名を変更</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="グループ名"
            type="text"
            fullWidth
            variant="standard"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenGroupEditDialog(false)}>キャンセル</Button>
          <Button onClick={handleSaveGroup}>保存</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={openDeckEditDialog} onClose={() => setOpenDeckEditDialog(false)}>
        <DialogTitle>デッキを編集</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="デッキ名"
            type="text"
            fullWidth
            variant="standard"
            value={newDeckName}
            onChange={(e) => setNewDeckName(e.target.value)}
            sx={{ mb: 2 }}
          />
          <FormControl fullWidth variant="standard">
            <InputLabel>グループ</InputLabel>
            <Select
              value={newDeckGroupId}
              onChange={(e) => setNewDeckGroupId(e.target.value)}
              label="グループ"
            >
              {groups.map((group) => (
                <MenuItem key={group.id} value={group.id}>
                  {group.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDeckEditDialog(false)}>キャンセル</Button>
          <Button onClick={handleSaveDeck}>保存</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default GroupAndDeckList;
