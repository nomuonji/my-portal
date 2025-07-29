import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { collection, query, onSnapshot, orderBy, where, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Button, List, ListItem, ListItemText, Typography, Box } from '@mui/material';

const FlashcardList = () => {
  const [flashcards, setFlashcards] = useState([]);
  const [deckName, setDeckName] = useState('');
  const [loading, setLoading] = useState(true);
  const { deckId } = useParams();

  useEffect(() => {
    if (!deckId) {
      console.log("FlashcardList: deckId is undefined or null. Setting loading to false.");
      setLoading(false);
      return;
    }

    console.log("FlashcardList: Starting fetch for deckId:", deckId);

    // Fetch deck name
    const fetchDeckName = async () => {
      const deckRef = doc(db, 'decks', deckId);
      try {
        const deckSnap = await getDoc(deckRef);
        if (deckSnap.exists()) {
          setDeckName(deckSnap.data().name);
          console.log("FlashcardList: Deck name fetched:", deckSnap.data().name);
        } else {
          console.log("FlashcardList: Deck not found for deckId:", deckId);
          setDeckName("不明なデッキ");
        }
      } catch (error) {
        console.error("FlashcardList: Error fetching deck name:", error);
        setDeckName("エラー");
      }
    };
    fetchDeckName();

    // Fetch flashcards for the deck
    console.log("FlashcardList: Setting up snapshot listener for flashcards with deckId:", deckId);
    const q = query(
      collection(db, 'flashcards'),
      where('deckId', '==', deckId)
    );

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      console.log("FlashcardList: Snapshot received. Number of documents:", querySnapshot.size);
      const cards = [];
      querySnapshot.forEach((doc) => {
        cards.push({ id: doc.id, ...doc.data() });
      });
      console.log("FlashcardList: Fetched cards:", cards);
      setFlashcards(cards);
      setLoading(false);
    }, (error) => {
      console.error("FlashcardList: Error fetching flashcards:", error);
      setLoading(false);
    });

    return () => {
      console.log("FlashcardList: Unsubscribing from flashcards snapshot listener.");
      unsubscribe();
    };
  }, [deckId]);

  console.log("FlashcardList: Render - Current flashcards state:", flashcards);
  console.log("FlashcardList: Render - Current loading state:", loading);

  if (loading) {
    return <Typography>読み込み中...</Typography>;
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        デッキ: {deckName}
      </Typography>
      <Button 
        component={Link} 
        to={`/flashcards/new?deckId=${deckId}`} 
        variant="contained" 
        color="primary" 
        sx={{ mb: 2 }}
      >
        新しいカードを追加
      </Button>
      <List>
        {flashcards.map((card) => (
          <ListItem key={card.id} component={Link} to={`/flashcards/${card.id}`}>
            <ListItemText primary={card.front} secondary={card.back} />
          </ListItem>
        ))}
      </List>
    </Box>
  );
};

export default FlashcardList;
