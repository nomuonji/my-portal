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
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme
} from '@mui/material';
import { Note, Newspaper, Folder, Menu as MenuIcon } from '@mui/icons-material';
import Memo from './components/Memo';

const drawerWidth = 240;

function App() {
  const [user, setUser] = useState(null);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [selectedMenuItem, setSelectedMenuItem] = useState('Memo'); // デフォルトでメモを選択

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleMenuItemClick = (menuItem) => {
    setSelectedMenuItem(menuItem);
    if (isMobile) {
      setMobileOpen(false); // モバイルの場合はメニューを閉じる
    }
  };

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

  const renderContent = () => {
    switch (selectedMenuItem) {
      case 'Memo':
        return <Memo />;
      case 'News':
        return <Typography variant="h4">ニュース機能はまだ実装されていません。</Typography>;
      case 'Drive':
        return <Typography variant="h4">Google Drive機能はまだ実装されていません。</Typography>;
      default:
        return <Typography variant="h4">ようこそ、{user.displayName}さん！</Typography>;
    }
  };

  const drawer = (
    <Box sx={{ overflow: 'auto' }}>
      <Toolbar />
      <List>
        <ListItem button key="Memo" onClick={() => handleMenuItemClick('Memo')}>
          <ListItemIcon>
            <Note />
          </ListItemIcon>
          <ListItemText primary="メモ" />
        </ListItem>
        <ListItem button key="News" onClick={() => handleMenuItemClick('News')}>
          <ListItemIcon>
            <Newspaper />
          </ListItemIcon>
          <ListItemText primary="ニュース" />
        </ListItem>
        <ListItem button key="Drive" onClick={() => handleMenuItemClick('Drive')}>
          <ListItemIcon>
            <Folder />
          </ListItemIcon>
          <ListItemText primary="Google Drive" />
        </ListItem>
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex' }}>
      <CssBaseline />
      <AppBar
        position="fixed"
        sx={{
          width: { md: `calc(100% - ${drawerWidth}px)` },
          ml: { md: `${drawerWidth}px` },
        }}
      >
        <Toolbar>
          {isMobile && (
            <IconButton
              color="inherit"
              aria-label="open drawer"
              edge="start"
              onClick={handleDrawerToggle}
              sx={{ mr: 2 }}
            >
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
            My Portal
          </Typography>
          {user ? (
            <Button color="inherit" onClick={handleLogout}>ログアウト</Button>
          ) : (
            <Button color="inherit" onClick={handleLogin}>Googleでログイン</Button>
          )}
        </Toolbar>
      </AppBar>
      
      {user && (
        <Box
          component="nav"
          sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}
          aria-label="mailbox folders"
        >
          {isMobile ? (
            <Drawer
              variant="temporary"
              open={mobileOpen}
              onClose={handleDrawerToggle}
              ModalProps={{
                keepMounted: true, // Better open performance on mobile.
              }}
              sx={{
                display: { xs: 'block', md: 'none' },
                '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
              }}
            >
              {drawer}
            </Drawer>
          ) : (
            <Drawer
              variant="permanent"
              sx={{
                display: { xs: 'none', md: 'block' },
                '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
              }}
              open
            >
              {drawer}
            </Drawer>
          )}
        </Box>
      )}

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { md: `calc(100% - ${drawerWidth}px)` },
        }}
      >
        <Toolbar />
        <Container>
          {user ? (
            renderContent()
          ) : (
            <Typography variant="h5">ポータルを利用するにはログインしてください。</Typography>
          )}
        </Container>
      </Box>
    </Box>
  );
}

export default App;

