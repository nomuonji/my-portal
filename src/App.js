import React, { useState, useEffect, useMemo } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { auth } from './firebase';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, addDoc, serverTimestamp, query, where, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
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
  Badge,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  BottomNavigation,
  BottomNavigationAction,
} from '@mui/material';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme, ThemeProvider } from '@mui/material/styles';
import { useSwipeable } from 'react-swipeable';
import { Note, Newspaper, Folder, Menu as MenuIcon, Dashboard as DashboardIcon, Lightbulb as LightbulbIcon, ViewCompact as ViewCompactIcon, Build as BuildIcon, Brightness4 as Brightness4Icon, Brightness7 as Brightness7Icon, Notifications as NotificationsIcon } from '@mui/icons-material';
import Memo from './components/Memo';
import Dashboard from './components/Dashboard';
import News from './components/News';
import Idea from './components/Idea';
import IdeaBoard from './components/IdeaBoard';
import FeatureRequests from './components/FeatureRequests';
import Project from './components/Project';
import ProjectDetails from './components/ProjectDetails';
import ReadingListURLs from './components/ReadingListURLs';
import ReadingListYouTube from './components/ReadingListYouTube';

import getAppTheme from './theme';

// Placeholder for YouTube API Key - User needs to replace this
// For production, consider moving this to an environment variable (e.g., .env file)
// and accessing it via process.env.REACT_APP_YOUTUBE_API_KEY
const YOUTUBE_API_KEY = 'YOUR_YOUTUBE_API_KEY'; // TODO: Replace with actual API key

// Helper to extract YouTube video ID
const getYouTubeVideoId = (url) => {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
};

// Helper to fetch YouTube video details
const fetchYouTubeVideoDetails = async (videoId, apiKey) => {
  if (!videoId || !apiKey || apiKey === 'YOUR_YOUTUBE_API_KEY') {
    console.warn('YouTube API Key is missing or invalid. Cannot fetch video details.');
    return null;
  }
  const apiUrl = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${apiKey}&part=snippet,contentDetails`;
  try {
    const response = await fetch(apiUrl);
    const data = await response.json();
    if (data.items && data.items.length > 0) {
      const item = data.items[0];
      return {
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnail: item.snippet.thumbnails.high.url,
        duration: item.contentDetails.duration, // e.g., PT1M3S
      };
    }
  } catch (error) {
    console.error('Error fetching YouTube video details:', error);
  }
  return null;
};

const drawerWidth = 240;

function App() {
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mode, setMode] = useState(() => {
    const savedMode = localStorage.getItem('themeMode');
    return savedMode || 'light';
  }); // 'light' or 'dark'
  const [unreadUrlsCount, setUnreadUrlsCount] = useState(0);
  const [unreadYoutubeCount, setUnreadYoutubeCount] = useState(0);
  const [notificationModalOpen, setNotificationModalOpen] = useState(false);

  const appTheme = useMemo(() => getAppTheme(mode), [mode]);
  const isMobile = useMediaQuery(appTheme.breakpoints.down('md'));

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handlers = useSwipeable({
    onSwipedRight: () => {
      if (isMobile) {
        setMobileOpen(true);
      }
    },
    onSwipedLeft: () => {
      if (isMobile) {
        setMobileOpen(false);
      }
    },
    preventScrollOnSwipe: true,
    trackMouse: true
  });

  const handleModeChange = () => {
    setMode((prevMode) => {
      const newMode = prevMode === 'light' ? 'dark' : 'light';
      localStorage.setItem('themeMode', newMode);
      return newMode;
    });
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });

    if (user) {
      const urlParams = new URLSearchParams(window.location.search);
      const sharedUrl = urlParams.get('url');
      const sharedTitle = urlParams.get('title') || urlParams.get('text');

      const handleSharedUrl = async () => {
        if (sharedUrl) {
          const videoId = getYouTubeVideoId(sharedUrl);
          if (videoId) {
            // YouTube動画の場合
            let docData = {
              url: sharedUrl,
              title: sharedTitle || '',
              description: '',
              thumbnail: '',
              read: false,
              tags: [],
              createdAt: serverTimestamp(),
              videoId: videoId,
            };

            const videoDetails = await fetchYouTubeVideoDetails(videoId, YOUTUBE_API_KEY);
            if (videoDetails) {
              docData = {
                ...docData,
                title: videoDetails.title,
                description: videoDetails.description,
                thumbnail: videoDetails.thumbnail,
              };
            }
            try {
              await addDoc(collection(db, 'reading_list_youtube'), docData);
              console.log('YouTube動画をリストに追加しました。');
            } catch (e) {
              console.error('YouTube動画の追加に失敗しました。', e);
            }
          } else {
            // 通常のURLの場合
            try {
              await addDoc(collection(db, 'reading_list_urls'), {
                url: sharedUrl,
                title: sharedTitle || '',
                description: '',
                image: '',
                read: false,
                tags: [],
                createdAt: serverTimestamp(),
              });
              console.log('URLをリストに追加しました。');
            } catch (e) {
              console.error('URLの追加に失敗しました。', e);
            }
          }

          // URLパラメータをクリアして、リフレッシュ時に再度追加されないようにする
          const cleanUrl = window.location.origin;
          window.history.replaceState(null, '', cleanUrl);
        }
      };

      handleSharedUrl();

      // 未読数をリアルタイムで取得
      const unsubscribeUrls = onSnapshot(query(collection(db, 'reading_list_urls'), where('read', '==', false)), (snapshot) => {
        setUnreadUrlsCount(snapshot.size);
      });

      const unsubscribeYoutube = onSnapshot(query(collection(db, 'reading_list_youtube'), where('read', '==', false)), (snapshot) => {
        setUnreadYoutubeCount(snapshot.size);
      });

      return () => {
        unsubscribeUrls();
        unsubscribeYoutube();
      };
    }

    return () => unsubscribe();
  }, [user]);

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
        <ListItemButton component={Link} to="/" onClick={() => isMobile && handleDrawerToggle()}>
          <ListItemIcon>
            <DashboardIcon />
          </ListItemIcon>
          <ListItemText primary="ダッシュボード" />
        </ListItemButton>
        <ListItemButton component={Link} to="/ideaboard" onClick={() => isMobile && handleDrawerToggle()}>
          <ListItemIcon>
            <ViewCompactIcon />
          </ListItemIcon>
          <ListItemText primary="アイデアボード" />
        </ListItemButton>
        <ListItemButton component={Link} to="/project" onClick={() => isMobile && handleDrawerToggle()}>
          <ListItemIcon>
            <Folder />
          </ListItemIcon>
          <ListItemText primary="プロジェクトボード" />
        </ListItemButton>
        <ListItemButton component={Link} to="/news" onClick={() => isMobile && handleDrawerToggle()}>
          <ListItemIcon>
            <Newspaper />
          </ListItemIcon>
          <ListItemText primary="ニュース" />
        </ListItemButton>
        <ListItemButton component={Link} to="/feature-requests" onClick={() => isMobile && handleDrawerToggle()}>
          <ListItemIcon>
            <BuildIcon />
          </ListItemIcon>
          <ListItemText primary="機能改善" />
        </ListItemButton>
        <ListItemButton component={Link} to="/reading-list-urls" onClick={() => isMobile && handleDrawerToggle()}>
          <ListItemIcon>
            <Newspaper />
          </ListItemIcon>
          <ListItemText primary="後で読む (Web)" />
        </ListItemButton>
        <ListItemButton component={Link} to="/reading-list-youtube" onClick={() => isMobile && handleDrawerToggle()}>
          <ListItemIcon>
            <Newspaper />
          </ListItemIcon>
          <ListItemText primary="後で見る (YouTube)" />
        </ListItemButton>
        <ListItemButton component={Link} to="/drive" onClick={() => isMobile && handleDrawerToggle()}>
          <ListItemIcon>
            <Folder />
          </ListItemIcon>
          <ListItemText primary="Google Drive" />
        </ListItemButton>
        <ListItemButton onClick={handleModeChange}>
          <ListItemIcon>
            {mode === 'dark' ? <Brightness7Icon /> : <Brightness4Icon />}
          </ListItemIcon>
          <ListItemText primary={mode === 'dark' ? 'ライトモード' : 'ダークモード'} />
        </ListItemButton>
        {user ? (
          <ListItemButton onClick={handleLogout}>
            <ListItemIcon>
              <i className="fas fa-sign-out-alt"></i>
            </ListItemIcon>
            <ListItemText primary="ログアウト" />
          </ListItemButton>
        ) : (
          <ListItemButton onClick={handleLogin}>
            <ListItemIcon>
              <i className="fas fa-sign-in-alt"></i>
            </ListItemIcon>
            <ListItemText primary="Googleでログイン" />
          </ListItemButton>
        )}
      </List>
      <Box sx={{ position: 'absolute', bottom: 0, width: '100%', p: 2, textAlign: 'center' }}>
        <Typography variant="caption" color="textSecondary">
          Version: {process.env.REACT_APP_VERSION}
        </Typography>
      </Box>
    </Box>
  );

  return (
    <ThemeProvider theme={appTheme}>
        <Box sx={{ display: 'flex', height: '100vh' }}>
          <CssBaseline />
          <AppBar
            position="fixed"
            sx={{
              width: { md: `calc(100% - ${drawerWidth}px)` },
              ml: { md: `${drawerWidth}px` },
            }}
          >
            <Toolbar sx={{ minHeight: { xs: 56, sm: 64 } }}>
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
              <Typography noWrap component="div" sx={{ flexGrow: 1, typography: { xs: 'subtitle1', md: 'h6' } }}>
                My Portal
              </Typography>
              <IconButton color="inherit" onClick={() => setNotificationModalOpen(true)}>
                <Badge badgeContent={unreadUrlsCount + unreadYoutubeCount} color="error">
                  <NotificationsIcon />
                </Badge>
              </IconButton>
            </Toolbar>
          </AppBar>

          {/* Mobile Drawer: Rendered on mobile devices regardless of login state. */}
          {isMobile && (
            <Box
              component="nav"
              sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}
              aria-label="mailbox folders"
            >
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
            </Box>
          )}

          {/* Desktop Drawer: Rendered on desktop only when logged in. */}
          {!isMobile && user && (
            <Box
              component="nav"
              sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}
              aria-label="mailbox folders"
            >
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
            </Box>
          )}

          <Box
            component="main"
            sx={{
              flexGrow: 1,
              display: 'flex',
              flexDirection: 'column',
              pb: isMobile ? '56px' : '0', // フッターの高さ分だけパディングを追加
            }}
            {...handlers}
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
                    <Route path="/projects/:projectName" element={<ProjectDetails />} />
                    <Route path="/reading-list-urls" element={<ReadingListURLs />} />
                    <Route path="/reading-list-youtube" element={<ReadingListYouTube />} />
                    <Route path="/drive" element={<Typography variant="h4">Google Drive機能はまだ実装されていません。</Typography>} />
                  </Routes>
                ) : (
                  <Typography variant="h5">ポータルを利用するにはログインしてください。</Typography>
                )}
            </Box>
          </Box>
        {isMobile && user && (
          <>
            <BottomNavigation
              showLabels
              sx={{
              width: '100%',
              position: 'fixed',
              bottom: 0,
              left: 0,
              boxShadow: '0px -2px 4px rgba(0, 0, 0, 0.1)',
              zIndex: 1200, // AppBarより少し高く設定
            }}
            value={location.pathname} // 現在のパスに基づいて選択状態を管理
          >
            <BottomNavigationAction
              label="ダッシュボード"
              icon={<DashboardIcon />}
              component={Link}
              to="/"
              sx={{ '& .MuiBottomNavigationAction-label': { fontSize: '0.5rem' } }}
            />
            <BottomNavigationAction
              label="アイデアボード"
              icon={<LightbulbIcon />}
              component={Link}
              to="/ideaboard"
              sx={{ '& .MuiBottomNavigationAction-label': { fontSize: '0.5rem' } }}
            />
            <BottomNavigationAction
              label="プロジェクト"
              icon={<Folder />}
              component={Link}
              to="/project"
              sx={{ '& .MuiBottomNavigationAction-label': { fontSize: '0.5rem' } }}
            />
            <BottomNavigationAction
              label="機能改善"
              icon={<BuildIcon />}
              component={Link}
              to="/feature-requests"
              sx={{ '& .MuiBottomNavigationAction-label': { fontSize: '0.5rem' } }}
            />
          </BottomNavigation>
          </>
        )}
        <Dialog open={notificationModalOpen} onClose={() => setNotificationModalOpen(false)}>
          <DialogTitle>未読アイテム</DialogTitle>
          <DialogContent>
            <Typography>Web記事: {unreadUrlsCount}件</Typography>
            <Typography>YouTube動画: {unreadYoutubeCount}件</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setNotificationModalOpen(false)}>閉じる</Button>
          </DialogActions>
        </Dialog>
      </Box>
    </ThemeProvider>
  );
}

export default App;
              