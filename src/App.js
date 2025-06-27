import React, { useState, useEffect } from 'react';
import { auth } from './firebase';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import {
  AppBar,
  Box,
  Button,
  Container,
  CssBaseline,
  Drawer,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography
} from '@mui/material';
import { Note, Newspaper, Folder } from '@mui/icons-material';

const drawerWidth = 240;

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
    <Box sx={{ display: 'flex' }}>
      <CssBaseline />
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
        <Toolbar>
          <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
            My Portal
          </Typography>
          {user ? (
            <Button color="inherit" onClick={handleLogout}>Logout</Button>
          ) : (
            <Button color="inherit" onClick={handleLogin}>Login with Google</Button>
          )}
        </Toolbar>
      </AppBar>
      
      {user && (
        <Drawer
          variant="permanent"
          sx={{
            width: drawerWidth,
            flexShrink: 0,
            [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: 'border-box' },
          }}
        >
          <Toolbar />
          <Box sx={{ overflow: 'auto' }}>
            <List>
              <ListItem button key="Memo">
                <ListItemIcon>
                  <Note />
                </ListItemIcon>
                <ListItemText primary="Memo" />
              </ListItem>
              <ListItem button key="News">
                <ListItemIcon>
                  <Newspaper />
                </ListItemIcon>
                <ListItemText primary="News" />
              </ListItem>
              <ListItem button key="Drive">
                <ListItemIcon>
                  <Folder />
                </ListItemIcon>
                <ListItemText primary="Google Drive" />
              </ListItem>
            </List>
          </Box>
        </Drawer>
      )}

      <Box component="main" sx={{ flexGrow: 1, p: 3 }}>
        <Toolbar />
        <Container>
          {user ? (
            <Typography variant="h4">Welcome, {user.displayName}!</Typography>
          ) : (
            <Typography variant="h5">Please log in to use the portal.</Typography>
          )}
        </Container>
      </Box>
    </Box>
  );
}

export default App;

