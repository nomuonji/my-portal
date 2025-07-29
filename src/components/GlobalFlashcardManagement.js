import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { collection, doc, deleteDoc, onSnapshot, orderBy, writeBatch, query } from 'firebase/firestore';
import { db } from '../firebase';
import { Button, List, ListItem, ListItemText, Typography, Box, IconButton, Checkbox, FormControl, InputLabel, Select, MenuItem, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import { Edit, Delete } from '@mui/icons-material';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

const GlobalFlashcardManagement = () => {
  const [allFlashcards, setAllFlashcards] = useState([]);
  const [filteredFlashcards, setFilteredFlashcards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState([]);
  const [decks, setDecks] = useState([]);
  const [selectedGroupFilter, setSelectedGroupFilter] = useState('');
  const [selectedDeckFilter, setSelectedDeckFilter] = useState('');
  const [selectedCards, setSelectedCards] = useState([]);
  const [openMoveDialog, setOpenMoveDialog] = useState(false);
  const [targetDeckId, setTargetDeckId] = useState('');

  useEffect(() => {
    // Fetch all flashcards
    const unsubscribeFlashcards = onSnapshot(collection(db, 'flashcards'), (snapshot) => {
      console.log("GlobalFlashcardManagement: Flashcards snapshot received. Number of documents:", snapshot.size);
      const cards = [];
      snapshot.forEach((doc) => cards.push({ id: doc.id, ...doc.data() }));
      setAllFlashcards(cards);
      setLoading(false);
    }, (error) => {
      console.error("GlobalFlashcardManagement: Error fetching flashcards:", error);
      setLoading(false);
    });

    // Fetch groups
    const unsubscribeGroups = onSnapshot(query(collection(db, 'groups'), orderBy('order')), (snapshot) => {
      const groupData = [];
      snapshot.forEach((doc) => groupData.push({ id: doc.id, ...doc.data() }));
      setGroups(groupData);
    });

    // Fetch decks
    const unsubscribeDecks = onSnapshot(query(collection(db, 'decks'), orderBy('order')), (snapshot) => {
      const deckData = [];
      snapshot.forEach((doc) => deckData.push({ id: doc.id, ...doc.data() }));
      setDecks(deckData);
    });

    return () => {
      unsubscribeFlashcards();
      unsubscribeGroups();
      unsubscribeDecks();
    };
  }, []);

  useEffect(() => {
    let currentFiltered = allFlashcards;

    if (selectedGroupFilter) {
      const decksInGroup = decks.filter(deck => deck.groupId === selectedGroupFilter).map(deck => deck.id);
      currentFiltered = currentFiltered.filter(card => decksInGroup.includes(card.deckId));
    }

    if (selectedDeckFilter) {
      currentFiltered = currentFiltered.filter(card => card.deckId === selectedDeckFilter);
    }

    setFilteredFlashcards(currentFiltered);
  }, [allFlashcards, selectedGroupFilter, selectedDeckFilter, decks]);

  const handleDelete = async (cardId) => {
    if (window.confirm('本当にこのカードを削除しますか？')) {
      await deleteDoc(doc(db, 'flashcards', cardId));
      setSelectedCards(prev => prev.filter(id => id !== cardId));
    }
  };

  const handleBulkDelete = async () => {
    if (window.confirm(`${selectedCards.length}件のカードを本当に削除しますか？`)) {
      const batch = writeBatch(db);
      selectedCards.forEach(cardId => {
        batch.delete(doc(db, 'flashcards', cardId));
      });
      await batch.commit();
      setSelectedCards([]);
    }
  };

  const handleBulkMove = async () => {
    if (!targetDeckId) {
      alert('移動先のデッキを選択してください。');
      return;
    }
    if (window.confirm(`${selectedCards.length}件のカードを移動しますか？`)) {
      const batch = writeBatch(db);
      selectedCards.forEach(cardId => {
        batch.update(doc(db, 'flashcards', cardId), { deckId: targetDeckId });
      });
      await batch.commit();
      setSelectedCards([]);
      setOpenMoveDialog(false);
      setTargetDeckId('');
    }
  };

  const onDragEnd = async (result) => {
    if (!result.destination) return;

    const reorderedCards = Array.from(filteredFlashcards);
    const [removed] = reorderedCards.splice(result.source.index, 1);
    reorderedCards.splice(result.destination.index, 0, removed);

    setFilteredFlashcards(reorderedCards);

    // Update order in Firestore
    const batch = writeBatch(db);
    reorderedCards.forEach((card, index) => {
      const cardRef = doc(db, 'flashcards', card.id);
      batch.update(cardRef, { order: index });
    });
    await batch.commit();
  };

  const handleSelectCard = (cardId) => {
    setSelectedCards(prev => 
      prev.includes(cardId) ? prev.filter(id => id !== cardId) : [...prev, cardId]
    );
  };

  const handleSelectAllCards = () => {
    if (selectedCards.length === filteredFlashcards.length) {
      setSelectedCards([]);
    } else {
      setSelectedCards(filteredFlashcards.map(card => card.id));
    }
  };

  if (loading) {
    return <Typography>読み込み中...</Typography>;
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        すべてのカード管理
      </Typography>
      <Box sx={{ mb: 2 }}>
        <Button 
          component={Link} 
          to="/flashcards/new" 
          variant="contained" 
          color="primary" 
          sx={{ mr: 2 }}
        >
          新しいカードを追加
        </Button>
        <Button 
          variant="outlined" 
          onClick={() => setOpenMoveDialog(true)} 
          disabled={selectedCards.length === 0}
          sx={{ mr: 2 }}
        >
          選択したカードを移動 ({selectedCards.length})
        </Button>
        <Button 
          variant="outlined" 
          color="error" 
          onClick={handleBulkDelete} 
          disabled={selectedCards.length === 0}
        >
          選択したカードを削除 ({selectedCards.length})
        </Button>
      </Box>

      <Box sx={{ mb: 2, display: 'flex', gap: 2 }}>
        <FormControl sx={{ minWidth: 120 }}>
          <InputLabel>グループでフィルタ</InputLabel>
          <Select
            value={selectedGroupFilter}
            label="グループでフィルタ"
            onChange={(e) => {
              setSelectedGroupFilter(e.target.value);
              setSelectedDeckFilter(''); // Reset deck filter when group changes
            }}
          >
            <MenuItem value="">すべて</MenuItem>
            {groups.map((group) => (
              <MenuItem key={group.id} value={group.id}>
                {group.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl sx={{ minWidth: 120 }} disabled={!selectedGroupFilter && decks.filter(d => !d.groupId).length === 0}> {/* Disable if no group selected and no unassigned decks */}
          <InputLabel>デッキでフィルタ</InputLabel>
          <Select
            value={selectedDeckFilter}
            label="デッキでフィルタ"
            onChange={(e) => setSelectedDeckFilter(e.target.value)}
          >
            <MenuItem value="">すべて</MenuItem>
            {selectedGroupFilter ? (
              decks.filter(deck => deck.groupId === selectedGroupFilter).map((deck) => (
                <MenuItem key={deck.id} value={deck.id}>
                  {deck.name}
                </MenuItem>
              ))
            ) : (
              decks.filter(deck => !deck.groupId).map((deck) => (
                <MenuItem key={deck.id} value={deck.id}>
                  {deck.name}
                </MenuItem>
              ))
            )}
          </Select>
        </FormControl>
      </Box>

      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="flashcards">
          {(provided) => (
            <List {...provided.droppableProps} ref={provided.innerRef}>
              <ListItem>
                <Checkbox 
                  onChange={handleSelectAllCards}
                  checked={selectedCards.length === filteredFlashcards.length && filteredFlashcards.length > 0}
                  indeterminate={selectedCards.length > 0 && selectedCards.length < filteredFlashcards.length}
                />
                <ListItemText primary="すべて選択" />
              </ListItem>
              {filteredFlashcards.map((card, index) => (
                <Draggable key={card.id} draggableId={card.id} index={index}>
                  {(provided) => (
                    <ListItem
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                      secondaryAction={
                        <>
                          <IconButton component={Link} to={`/flashcards/${card.id}`}>
                            <Edit />
                          </IconButton>
                          <IconButton onClick={() => handleDelete(card.id)}>
                            <Delete />
                          </IconButton>
                        </>
                      }
                    >
                      <Checkbox 
                        checked={selectedCards.includes(card.id)}
                        onChange={() => handleSelectCard(card.id)}
                      />
                      <ListItemText primary={card.front} secondary={card.back} />
                    </ListItem>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </List>
          )}
        </Droppable>
      </DragDropContext>

      <Dialog open={openMoveDialog} onClose={() => setOpenMoveDialog(false)}>
        <DialogTitle>選択したカードを移動</DialogTitle>
        <DialogContent>
          <FormControl fullWidth margin="normal">
            <InputLabel>移動先のデッキ</InputLabel>
            <Select
              value={targetDeckId}
              onChange={(e) => setTargetDeckId(e.target.value)}
              label="移動先のデッキ"
            >
              {decks.map((deck) => (
                <MenuItem key={deck.id} value={deck.id}>
                  {deck.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenMoveDialog(false)}>キャンセル</Button>
          <Button onClick={handleBulkMove}>移動</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default GlobalFlashcardManagement;
