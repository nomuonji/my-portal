import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, addDoc, doc, getDoc, updateDoc, serverTimestamp, query, where, getDocs, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { Button, TextField, Typography, Box, Select, MenuItem, InputLabel, FormControl } from '@mui/material';

const FlashcardForm = () => {
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [selectedDeckId, setSelectedDeckId] = useState('');
  const [newDeckName, setNewDeckName] = useState('');
  const [decks, setDecks] = useState([]);
  const navigate = useNavigate();
  const { cardId } = useParams();

  useEffect(() => {
    // Fetch decks
    const unsubscribeDecks = onSnapshot(query(collection(db, 'decks'), orderBy('order')), (snapshot) => {
      const deckData = [];
      snapshot.forEach((doc) => deckData.push({ id: doc.id, ...doc.data() }));
      setDecks(deckData);
    });

    if (cardId) {
      const fetchCard = async () => {
        const docRef = doc(db, 'flashcards', cardId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setFront(data.front);
          setBack(data.back);
          setSelectedDeckId(data.deckId);
        }
      };
      fetchCard();
    }

    return () => {
      unsubscribeDecks();
    };
  }, [cardId]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    let finalDeckId = selectedDeckId;

    // Create new deck if newDeckName is provided
    if (newDeckName) {
      const newDeckRef = await addDoc(collection(db, 'decks'), {
        name: newDeckName,
        order: decks.length, // Simple ordering for now
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      finalDeckId = newDeckRef.id;
    }

    if (!finalDeckId) {
      alert('デッキを選択または新規作成してください。');
      return;
    }

    // Get the current count of flashcards in the deck to set the order
    const q = query(collection(db, 'flashcards'), where('deckId', '==', finalDeckId));
    const querySnapshot = await getDocs(q);
    const newOrder = querySnapshot.size;

    const cardData = { 
      front, 
      back, 
      deckId: finalDeckId, 
      lastReviewed: null,
      nextReview: new Date(),
      easeFactor: 2.5,
      order: newOrder, // Add order field
      updatedAt: serverTimestamp()
    };

    if (cardId) {
      const docRef = doc(db, 'flashcards', cardId);
      await updateDoc(docRef, cardData);
    } else {
      await addDoc(collection(db, 'flashcards'), { ...cardData, createdAt: serverTimestamp() });
    }
    navigate(`/decks`);
  };

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ mt: 3 }}>
      <Typography variant="h4" gutterBottom>
        {cardId ? 'カードを編集' : '新しいカードを追加'}
      </Typography>
      <TextField
        label="表面 (Front)"
        value={front}
        onChange={(e) => setFront(e.target.value)}
        fullWidth
        required
        margin="normal"
      />
      <TextField
        label="裏面 (Back)"
        value={back}
        onChange={(e) => setBack(e.target.value)}
        fullWidth
        required
        multiline
        rows={4}
        margin="normal"
      />

      <FormControl fullWidth margin="normal">
        <InputLabel>デッキ</InputLabel>
        <Select
          value={selectedDeckId}
          label="デッキ"
          onChange={(e) => {
            setSelectedDeckId(e.target.value);
            setNewDeckName(''); // Clear new deck name when selecting existing deck
          }}
          disabled={!!newDeckName} // Disable if new deck name is entered
        >
          {decks.map((deck) => (
            <MenuItem key={deck.id} value={deck.id}>
              {deck.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <TextField
        label="新しいデッキ名 (任意)"
        value={newDeckName}
        onChange={(e) => {
          setNewDeckName(e.target.value);
          setSelectedDeckId(''); // Clear selected deck when new deck name is entered
        }}
        fullWidth
        margin="normal"
        disabled={!!selectedDeckId} // Disable if existing deck is selected
      />

      <Button type="submit" variant="contained" color="primary">
        {cardId ? '更新' : '追加'}
      </Button>
    </Box>
  );
};

export default FlashcardForm;
