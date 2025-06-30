import React, { useState, useEffect, useMemo } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { auth } from './firebase';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import {
  AppBar,
  Box,
  Button,
  CssBaseline,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme, ThemeProvider } from '@mui/material/styles';
import { Note, Newspaper, Folder, Menu as MenuIcon, Dashboard as DashboardIcon, Lightbulb as LightbulbIcon, ViewCompact as ViewCompactIcon, Build as BuildIcon, Brightness4 as Brightness4Icon, Brightness7 as Brightness7Icon } from '@mui/icons-material';
import Memo from './components/Memo';
import Dashboard from './components/Dashboard';
import News from './components/News';
import Idea from './components/Idea';
import IdeaBoard from './components/IdeaBoard';
import FeatureRequests from './components/FeatureRequests';
import Project from './components/Project';
import getAppTheme from './theme';

const drawerWidth = 240;

function App() {
  const [user, setUser] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mode, setMode] = useState('light'); // 'light' or 'dark'

  const appTheme = useMemo(() => getAppTheme(mode), [mode]);
  const isMobile = useMediaQuery(appTheme.breakpoints.down('md'));

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleModeChange = () => {
    setMode((prevMode) => (prevMode === 'light' ? 'dark' : 'light'));
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

  const drawer = (
    <Box sx={{ overflow: 'auto' }}>
      <Toolbar />
      <List>
        <ListItemButton component={Link} to="/">
          <ListItemIcon>
            <DashboardIcon />
          </ListItemIcon>
          <ListItemText primary="ダッシュボード" />
        </ListItemButton>
        <ListItemButton component={Link} to="/memo">
          <ListItemIcon>
            <Note />
          </ListItemIcon>
          <ListItemText primary="メモ" />
        </ListItemButton>
        <ListItemButton component={Link} to="/news">
          <ListItemIcon>
            <Newspaper />
          </ListItemIcon>
          <ListItemText primary="ニュース" />
        </ListItemButton>
        <ListItemButton component={Link} to="/idea">
          <ListItemIcon>
            <LightbulbIcon />
          </ListItemIcon>
          <ListItemText primary="アイデア" />
        </ListItemButton>
        <ListItemButton component={Link} to="/ideaboard">
          <ListItemIcon>
            <ViewCompactIcon />
          </ListItemIcon>
          <ListItemText primary="アイデアボード" />
        </ListItemButton>
        <ListItemButton component={Link} to="/feature-requests">
          <ListItemIcon>
            <BuildIcon />
          </ListItemIcon>
          <ListItemText primary="機能改善" />
        </ListItemButton>
        <ListItemButton component={Link} to="/project">
          <ListItemIcon>
            <Folder />
          </ListItemIcon>
          <ListItemText primary="プロジェクト" />
        </ListItemButton>
        <ListItemButton component={Link} to="/drive">
          <ListItemIcon>
            <Folder />
          </ListItemIcon>
          <ListItemText primary="Google Drive" />
        </ListItemButton>
      </List>
    </Box>
  );

  return (
    <ThemeProvider theme={appTheme}>
      <Router>
        <Box sx={{ display: 'flex', height: '100vh' }}>
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
              <IconButton color="inherit" onClick={handleModeChange}>
                {mode === 'dark' ? <Brightness7Icon /> : <Brightness4Icon />}
              </IconButton>
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
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Toolbar />
            <Box
              sx={{
                flexGrow: 1,
                p: 3,
                overflow: 'auto',
              }}
            >
              {user ? (
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/memo" element={<Memo />} />
                    <Route path="/memo/:memoId" element={<Memo />} />
                    <Route path="/news" element={<News />} />
                    <Route path="/idea" element={<Idea />} />
                    <Route path="/ideaboard" element={<IdeaBoard />} />
                    <Route path="/feature-requests" element={<FeatureRequests />} />
                    <Route path="/project" element={<Project />} />
                    <Route path="/drive" element={<Typography variant="h4">Google Drive機能はまだ実装されていません。</Typography>} />
                  </Routes>
                ) : (
                  <Typography variant="h5">ポータルを利用するにはログインしてください。</Typography>
                )}
            </Box>
          </Box>
        </Box>
      </Router>
    </ThemeProvider>
  );
}

export default App;

