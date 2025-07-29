import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { doc, getDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Button, Card, CardContent, Typography, Box, IconButton } from '@mui/material';
import { Edit, Delete } from '@mui/icons-material';

const Flashcard = () => {
  const [flashcard, setFlashcard] = useState(null);
  const [deck, setDeck] = useState(null);
  const [group, setGroup] = useState(null);
  const [isFlipped, setIsFlipped] = useState(false);
  const { cardId } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    const fetchCardAndDetails = async () => {
      const cardDocRef = doc(db, 'flashcards', cardId);
      const cardDocSnap = await getDoc(cardDocRef);

      if (cardDocSnap.exists()) {
        const cardData = { id: cardDocSnap.id, ...cardDocSnap.data() };
        setFlashcard(cardData);

        if (cardData.deckId) {
          const deckDocRef = doc(db, 'decks', cardData.deckId);
          const deckDocSnap = await getDoc(deckDocRef);
          if (deckDocSnap.exists()) {
            const deckData = { id: deckDocSnap.id, ...deckDocSnap.data() };
            setDeck(deckData);

            if (deckData.groupId) {
              const groupDocRef = doc(db, 'groups', deckData.groupId);
              const groupDocSnap = await getDoc(groupDocRef);
              if (groupDocSnap.exists()) {
                setGroup({ id: groupDocSnap.id, ...groupDocSnap.data() });
              }
            }
          }
        }
      } else {
        // handle not found
      }
    };
    fetchCardAndDetails();
  }, [cardId]);

  const handleDelete = async () => {
    if (window.confirm('本当にこのカードを削除しますか？')) {
      await deleteDoc(doc(db, 'flashcards', cardId));
      navigate('/decks'); // Navigate back to decks list after deletion
    }
  };

  if (!flashcard) {
    return <Typography>カードが見つかりません。</Typography>;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5">
          {group && `${group.name} > `}{deck && deck.name}
        </Typography>
        <Box>
          <IconButton component={Link} to={`/flashcards/edit/${cardId}`}>
            <Edit />
          </IconButton>
          <IconButton onClick={handleDelete}>
            <Delete />
          </IconButton>
        </Box>
      </Box>
      <Card 
        onClick={() => setIsFlipped(!isFlipped)}
        sx={{ minHeight: 200, cursor: 'pointer' }}
      >
        <CardContent>
          <Typography variant="h4" align="center">
            {isFlipped ? flashcard.back : flashcard.front}
          </Typography>
        </CardContent>
      </Card>
      <Button onClick={() => navigate(`/deck/${flashcard.deckId}/flashcards`)} sx={{ mt: 2 }}>
        デッキに戻る
      </Button>
    </Box>
  );
};

export default Flashcard;
