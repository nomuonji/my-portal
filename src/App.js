import React, { useState, useEffect } from 'react';
import { auth } from './firebase';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import { Button, AppBar, Toolbar, Typography, Container, Box } from '@mui/material';

function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  return (
    <div>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            My Portal
          </Typography>
          {user ? (
            <Button color="inherit" onClick={handleLogout}>Logout</Button>
          ) : (
            <Button color="inherit" onClick={handleLogin}>Login with Google</Button>
          )}
        </Toolbar>
      </AppBar>
      <Container>
        <Box sx={{ mt: 4 }}>
          {user ? (
            <Typography variant="h4">Welcome, {user.displayName}!</Typography>
          ) : (
            <Typography variant="h5">Please log in to use the portal.</Typography>
          )}
        </Box>
      </Container>
    </div>
  );
}

export default App;

