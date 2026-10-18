import React, { useState, useEffect, useMemo } from 'react';
import { Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import { auth } from './firebase';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, addDoc, serverTimestamp, query, where, onSnapshot } from './documentDbClient';
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
  Collapse,
} from '@mui/material';
import useMediaQuery from '@mui/material/useMediaQuery';
import { ThemeProvider } from '@mui/material/styles';
import {
  Newspaper,
  Folder,
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  ViewCompact as ViewCompactIcon,
  HomeOutlined as HomeIcon,
  Build as BuildIcon,
  Brightness4 as Brightness4Icon,
  Brightness7 as Brightness7Icon,
  Notifications as NotificationsIcon,
  ExpandLess,
  ExpandMore,
  MoreHoriz as MoreHorizIcon,
  SmartToy as SmartToyIcon,
  AutoAwesomeOutlined as MetaIcon,
  PsychologyAlt as PsychologyAltIcon,
  EmojiObjects as EmojiObjectsIcon,
  Archive as ArchiveIcon,
  Public as PublicIcon,
  FaceRetouchingNatural as CharacterIcon,
  BookmarksOutlined as SourcesIcon,
  OndemandVideo as DiscoveryIcon,
} from '@mui/icons-material';

import Memo from './components/Memo';
import Dashboard from './components/Dashboard';
import News from './components/News';
import Idea from './components/Idea';
import AgentIdeaSpace from './components/AgentIdeaSpace';
import MetaStrategy from './components/MetaStrategy';
import PersonalFeed from './components/PersonalFeed';
import PersonalTaste from './components/PersonalTaste';
import {AniListOAuthCallback} from './components/AniListConnectPanel';
import Ogiri from './components/Ogiri';
import SocialArchive from './components/SocialArchive';
import PortalBoards from './components/PortalBoards';
import WorldHome from './components/WorldHome';
import ThinkingWorkspace from './components/ThinkingWorkspace';
import Hobby from './components/Hobby';
import FeatureRequests from './components/FeatureRequests';
import Project from './components/Project';
import ProjectDetails from './components/ProjectDetails';
import ReadingListURLs from './components/ReadingListURLs';
import ReadingListYouTube from './components/ReadingListYouTube';
import ProjectForm from './components/ProjectForm';
import FlashcardList from './components/FlashcardList';
import Flashcard from './components/Flashcard';
import FlashcardForm from './components/FlashcardForm';
import GroupAndDeckList from './components/GroupAndDeckList';
import Stock from './components/Stock';
import GlobalFlashcardManagement from './components/GlobalFlashcardManagement';
import PublicCms from './components/PublicCms';
import CharacterLibrary from './components/CharacterLibrary';
import CurationSources from './components/CurationSources';

import getAppTheme from './theme';

const YOUTUBE_API_KEY = 'YOUR_YOUTUBE_API_KEY';
const drawerWidth = 240;

const getYouTubeVideoId = (url) => {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
};

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
        duration: item.contentDetails.duration,
      };
    }
  } catch (error) {
    console.error('Error fetching YouTube video details:', error);
  }
  return null;
};

function App() {
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mode, setMode] = useState(() => {
    const savedMode = localStorage.getItem('themeMode');
    return savedMode || 'light';
  });
  const [unreadUrlsCount, setUnreadUrlsCount] = useState(0);
  const [unreadYoutubeCount, setUnreadYoutubeCount] = useState(0);
  const [notificationModalOpen, setNotificationModalOpen] = useState(false);
  const [openOthers, setOpenOthers] = useState(false);

  const appTheme = useMemo(() => getAppTheme(mode), [mode]);
  const isMobile = useMediaQuery(appTheme.breakpoints.down('md'));

  const pageTitle = useMemo(() => {
    const path = location.pathname;
    if (path === '/') return 'ホーム';
    if (path.startsWith('/boards')) return 'ボード';
    if (path.startsWith('/dashboard')) return 'Agent HQ';
    if (path.startsWith('/thinking')) return '思考テーマ';
    if (path.startsWith('/agent-ideas')) return 'Agent Ideas';
    if (path.startsWith('/meta')) return 'プロジェクト提案';
    if (path.startsWith('/taste')) return '好みの記録';
    if (path.startsWith('/discover')) return 'あなた専用の寄り道';
    if (path.startsWith('/ogiri')) return '大喜利ラボ';
    if (path.startsWith('/social-archive')) return 'X投稿アーカイブ';
    if (path.startsWith('/public-cms')) return 'Public CMS';
    if (path.startsWith('/characters')) return 'キャラクターDB';
    if (path.startsWith('/curation-sources')) return '情報源ライブラリ';
    if (path.startsWith('/ideaboard') || path.startsWith('/idea')) return 'アイデア';
    if (path.startsWith('/hobbyboard') || path.startsWith('/hobby')) return '趣味';
    if (path.startsWith('/stockboard') || path.startsWith('/stock')) return 'ストック';
    if (path.startsWith('/project')) return 'プロジェクト';
    if (path.startsWith('/news')) return 'ニュース';
    if (path.startsWith('/feature-requests')) return '機能改善';
    if (path.startsWith('/reading-list-youtube')) return '後で見る';
    if (path.startsWith('/reading-list-urls')) return '後で読む';
    if (path.startsWith('/deck') || path.startsWith('/flashcard')) return '暗記カード';
    if (path.startsWith('/memo')) return 'メモ';
    return 'My Portal';
  }, [location.pathname]);

  const mobileNavValue = useMemo(() => {
    const path = location.pathname;
    if (path === '/') return '/';
    if (path.startsWith('/boards') || path.startsWith('/ideaboard') || path.startsWith('/hobbyboard') || path.startsWith('/stockboard')) return '/boards';
    if (path.startsWith('/idea') || path.startsWith('/hobby') || path.startsWith('/stock')) return '/boards';
    if (path.startsWith('/dashboard')) return '/dashboard';
    if (path.startsWith('/thinking')) return '/thinking';
    if (path.startsWith('/agent-ideas')) return '/agent-ideas';
    if (path.startsWith('/meta')) return '/meta';
    if (path.startsWith('/taste')) return '/discover';
    if (path.startsWith('/discover')) return '/discover';
    if (path.startsWith('/ogiri')) return '/ogiri';
    return false;
  }, [location.pathname]);

  const handleDrawerToggle = () => {
    setMobileOpen((open) => !open);
  };

  const closeMobileDrawer = () => {
    setMobileOpen(false);
  };

  useEffect(() => {
    if (isMobile) closeMobileDrawer();
  }, [location.pathname, isMobile]);

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
            let docData = {
              url: sharedUrl,
              title: sharedTitle || '',
              description: '',
              thumbnail: '',
              read: false,
              tags: [],
              createdAt: serverTimestamp(),
              videoId,
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

          const cleanUrl = window.location.origin;
          window.history.replaceState(null, '', cleanUrl);
        }
      };

      handleSharedUrl();

      const unsubscribeUrls = onSnapshot(
        query(collection(db, 'reading_list_urls'), where('read', '==', false)),
        (snapshot) => setUnreadUrlsCount(snapshot.size),
      );

      const unsubscribeYoutube = onSnapshot(
        query(collection(db, 'reading_list_youtube'), where('read', '==', false)),
        (snapshot) => setUnreadYoutubeCount(snapshot.size),
      );

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
      console.error('Login failed:', error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const navClick = () => {
    if (isMobile) closeMobileDrawer();
  };

  const drawer = (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        pt: { xs: 'env(safe-area-inset-top)', md: 0 },
        pb: { xs: 'env(safe-area-inset-bottom)', md: 0 },
      }}
    >
      <Toolbar sx={{ flexShrink: 0 }} />
      <List sx={{ flexGrow: 1, overflowY: 'auto', overscrollBehavior: 'contain', py: 1 }}>
        {user && (
          <>
            <ListItemButton selected={location.pathname === '/'} component={Link} to="/" onClick={navClick}>
              <ListItemIcon><HomeIcon /></ListItemIcon>
              <ListItemText primary="ホーム" secondary="全体像 / 参照先 / Skills" />
            </ListItemButton>
            <ListItemButton selected={location.pathname.startsWith('/boards') || location.pathname.startsWith('/ideaboard') || location.pathname.startsWith('/hobbyboard') || location.pathname.startsWith('/stockboard') || location.pathname === '/idea' || location.pathname === '/hobby' || location.pathname === '/stock'} component={Link} to="/boards" onClick={navClick}>
              <ListItemIcon><ViewCompactIcon /></ListItemIcon>
              <ListItemText primary="ボード" secondary="企画・ビジネス / 興味・趣味 / ネタ・表現" />
            </ListItemButton>
            <ListItemButton selected={location.pathname.startsWith('/taste')} component={Link} to="/taste" onClick={navClick}>
               <ListItemIcon><PsychologyAltIcon /></ListItemIcon>
               <ListItemText primary="好みの記録" secondary="好き嫌い / 根拠 / 訂正履歴" />
             </ListItemButton>
             <ListItemButton selected={location.pathname.startsWith('/discover')} component={Link} to="/discover" onClick={navClick}>
              <ListItemIcon><DiscoveryIcon /></ListItemIcon>
              <ListItemText primary="あなた専用の寄り道" secondary="動画・記事・作品のおすすめ" />
            </ListItemButton>
            <ListItemButton selected={location.pathname.startsWith('/meta')} component={Link} to="/meta" onClick={navClick}>
              <ListItemIcon><MetaIcon /></ListItemIcon>
              <ListItemText primary="プロジェクト提案" secondary="戦略・次の一手" />
            </ListItemButton>
            <ListItemButton selected={location.pathname.startsWith('/dashboard')} component={Link} to="/dashboard" onClick={navClick}>
              <ListItemIcon><DashboardIcon /></ListItemIcon>
              <ListItemText primary="Agent HQ" secondary="実行キュー / Agents / 再開地点" />
            </ListItemButton>
            <ListItemButton selected={location.pathname.startsWith('/thinking')} component={Link} to="/thinking" onClick={navClick}>
              <ListItemIcon><PsychologyAltIcon /></ListItemIcon>
              <ListItemText primary="思考テーマ" secondary="長期テーマ / Context Store" />
            </ListItemButton>
            <ListItemButton selected={location.pathname.startsWith('/agent-ideas')} component={Link} to="/agent-ideas" onClick={navClick}>

              <ListItemIcon><SmartToyIcon /></ListItemIcon>
              <ListItemText primary="Agent Ideas" secondary="Portalと同じ構造でAIが補充" />
            </ListItemButton>
            <ListItemButton selected={location.pathname.startsWith('/curation-sources')} component={Link} to="/curation-sources" onClick={navClick}>
              <ListItemIcon><SourcesIcon /></ListItemIcon>
              <ListItemText primary="情報源ライブラリ" secondary="人間の選考で発掘した情報源" />
            </ListItemButton>
            <ListItemButton selected={location.pathname.startsWith('/ogiri')} component={Link} to="/ogiri" onClick={navClick}>
              <ListItemIcon><EmojiObjectsIcon /></ListItemIcon>
              <ListItemText primary="大喜利ラボ" secondary="発想の拡散・センス蓄積" />
            </ListItemButton>
            <ListItemButton selected={location.pathname.startsWith('/social-archive')} component={Link} to="/social-archive" onClick={navClick}>
              <ListItemIcon><ArchiveIcon /></ListItemIcon>
              <ListItemText primary="X投稿アーカイブ" secondary="過去投稿の検索・分類・見返し" />
            </ListItemButton>
            <ListItemButton selected={location.pathname.startsWith('/public-cms')} component={Link} to="/public-cms" onClick={navClick}>
              <ListItemIcon><PublicIcon /></ListItemIcon>
              <ListItemText primary="Public CMS" secondary="思考 → 公開 / 複数サイト" />
            </ListItemButton>
            <ListItemButton selected={location.pathname.startsWith('/characters')} component={Link} to="/characters" onClick={navClick}>
              <ListItemIcon><CharacterIcon /></ListItemIcon>
              <ListItemText primary="キャラクターDB" secondary="キャラクター設定 / 画像ライブラリ" />
            </ListItemButton>
            <ListItemButton selected={location.pathname.startsWith('/project')} component={Link} to="/project" onClick={navClick}>
              <ListItemIcon><Folder /></ListItemIcon>
              <ListItemText primary="プロジェクトボード" />
            </ListItemButton>
            <ListItemButton onClick={() => setOpenOthers((open) => !open)}>
              <ListItemIcon><MoreHorizIcon /></ListItemIcon>
              <ListItemText primary="その他" />
              {openOthers ? <ExpandLess /> : <ExpandMore />}
            </ListItemButton>
            <Collapse in={openOthers} timeout="auto" unmountOnExit>
              <List component="div" disablePadding>
                <ListItemButton sx={{ pl: 4 }} component={Link} to="/news" onClick={navClick}>
                  <ListItemIcon><Newspaper /></ListItemIcon>
                  <ListItemText primary="ニュース" />
                </ListItemButton>
                <ListItemButton sx={{ pl: 4 }} component={Link} to="/feature-requests" onClick={navClick}>
                  <ListItemIcon><BuildIcon /></ListItemIcon>
                  <ListItemText primary="機能改善" />
                </ListItemButton>
                <ListItemButton sx={{ pl: 4 }} component={Link} to="/reading-list-urls" onClick={navClick}>
                  <ListItemIcon><Newspaper /></ListItemIcon>
                  <ListItemText primary="後で読む (Web)" />
                </ListItemButton>
                <ListItemButton sx={{ pl: 4 }} component={Link} to="/reading-list-youtube" onClick={navClick}>
                  <ListItemIcon><Newspaper /></ListItemIcon>
                  <ListItemText primary="後で見る (YouTube)" />
                  {unreadYoutubeCount > 0 && <Badge badgeContent={unreadYoutubeCount} color="error" sx={{ ml: 1 }} />}
                </ListItemButton>
                <ListItemButton sx={{ pl: 4 }} component={Link} to="/drive" onClick={navClick}>
                  <ListItemIcon><Folder /></ListItemIcon>
                  <ListItemText primary="Google Drive" />
                </ListItemButton>
                <ListItemButton sx={{ pl: 4 }} component={Link} to="/decks" onClick={navClick}>
                  <ListItemIcon><i className="fas fa-layer-group"></i></ListItemIcon>
                  <ListItemText primary="暗記カード" />
                </ListItemButton>
              </List>
            </Collapse>
          </>
        )}
        <ListItemButton onClick={handleModeChange}>
          <ListItemIcon>{mode === 'dark' ? <Brightness7Icon /> : <Brightness4Icon />}</ListItemIcon>
          <ListItemText primary={mode === 'dark' ? 'ライトモード' : 'ダークモード'} />
        </ListItemButton>
        {user ? (
          <ListItemButton onClick={handleLogout}>
            <ListItemIcon><i className="fas fa-sign-out-alt"></i></ListItemIcon>
            <ListItemText primary="ログアウト" />
          </ListItemButton>
        ) : (
          <ListItemButton onClick={handleLogin}>
            <ListItemIcon><i className="fas fa-sign-in-alt"></i></ListItemIcon>
            <ListItemText primary="Googleでログイン" />
          </ListItemButton>
        )}
      </List>
      <Box sx={{ flexShrink: 0, p: 1.5, textAlign: 'center' }}>
        <Typography variant="caption" color="textSecondary">
          Version: {process.env.REACT_APP_VERSION}
        </Typography>
      </Box>
    </Box>
  );

  return (
    <ThemeProvider theme={appTheme}>
      <Box sx={{ display: 'flex', height: '100dvh', minHeight: '100vh', overflow: 'hidden' }}>
        <CssBaseline />
        <AppBar
          position="fixed"
          sx={{
            width: { md: `calc(100% - ${drawerWidth}px)` },
            ml: { md: `${drawerWidth}px` },
            pt: { xs: 'env(safe-area-inset-top)', md: 0 },
          }}
        >
          <Toolbar sx={{ minHeight: { xs: 56, sm: 64 }, px: { xs: 1, sm: 2 } }}>
            <IconButton
              color="inherit"
              aria-label="メニューを開く"
              edge="start"
              onClick={handleDrawerToggle}
              sx={{ mr: 1, display: { md: 'none' }, width: 44, height: 44 }}
            >
              <MenuIcon />
            </IconButton>
            <Typography noWrap component="div" sx={{ flexGrow: 1, fontWeight: 850, typography: { xs: 'subtitle1', md: 'h6' } }}>
              {isMobile ? pageTitle : 'My Portal'}
            </Typography>
            <IconButton
              color="inherit"
              aria-label="通知"
              onClick={() => setNotificationModalOpen(true)}
              sx={{ width: 44, height: 44 }}
            >
              <Badge badgeContent={unreadUrlsCount + unreadYoutubeCount} color="error">
                <NotificationsIcon />
              </Badge>
            </IconButton>
          </Toolbar>
        </AppBar>

        {isMobile && (
          <Box component="nav" sx={{ flexShrink: 0 }} aria-label="portal navigation">
            <Drawer
              variant="temporary"
              open={mobileOpen}
              onClose={closeMobileDrawer}
              ModalProps={{ keepMounted: true }}
              sx={{
                display: { xs: 'block', md: 'none' },
                '& .MuiDrawer-paper': {
                  boxSizing: 'border-box',
                  width: { xs: 'min(86vw, 320px)', sm: drawerWidth },
                  maxWidth: '100vw',
                },
              }}
            >
              {drawer}
            </Drawer>
          </Box>
        )}

        {!isMobile && (
          <Box component="nav" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }} aria-label="portal navigation">
            <Drawer
              variant="permanent"
              sx={{ display: { xs: 'none', md: 'block' }, '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth } }}
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
            pb: isMobile ? 'calc(64px + env(safe-area-inset-bottom))' : 0,
            minWidth: 0,
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          <Toolbar sx={{ minHeight: { xs: 'calc(56px + env(safe-area-inset-top))', sm: 64 } }} />
          <Box
            sx={{
              flexGrow: 1,
              minHeight: 0,
              p: { xs: 1, sm: 1.5, md: 3 },
              overflowY: 'auto',
              overflowX: 'hidden',
              WebkitOverflowScrolling: 'touch',
              overscrollBehavior: 'contain',
            }}
          >
            {user ? (
              <Routes>
                <Route path="/" element={new URLSearchParams(location.search).has("board") ? <Navigate to={`/boards${location.search}`} replace /> : <WorldHome />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/memo" element={<Memo />} />
                <Route path="/memo/:memoId" element={<Memo />} />
                <Route path="/news" element={<News />} />
                <Route path="/stock" element={<Stock />} />
                <Route path="/idea" element={<Idea />} />
                <Route path="/hobby" element={<Hobby />} />
                <Route path="/boards" element={<PortalBoards />} />
                <Route path="/ideaboard" element={<Navigate to="/boards?board=ideas" replace />} />
                <Route path="/hobbyboard" element={<Navigate to="/boards?board=hobbies" replace />} />
                <Route path="/stockboard" element={<Navigate to="/boards?board=stocks" replace />} />
                <Route path="/agent-ideas" element={<AgentIdeaSpace />} />
                <Route path="/meta" element={<MetaStrategy />} />
                <Route path="/discover" element={<PersonalFeed />} />
                <Route path="/taste" element={<PersonalTaste />} />
                <Route path="/anilist/callback" element={<AniListOAuthCallback />} />
                <Route path="/ogiri" element={<Ogiri />} />
                <Route path="/social-archive" element={<SocialArchive />} />
                <Route path="/public-cms" element={<PublicCms />} />
                <Route path="/characters" element={<CharacterLibrary />} />
                <Route path="/curation-sources" element={<CurationSources />} />
                <Route path="/thinking" element={<ThinkingWorkspace />} />
                <Route path="/feature-requests" element={<FeatureRequests />} />
                <Route path="/project" element={<Project />} />
                <Route path="/project/new" element={<ProjectForm />} />
                <Route path="/project/edit/:projectId" element={<ProjectForm />} />
                <Route path="/project/details/:projectId" element={<ProjectDetails />} />
                <Route path="/reading-list-urls" element={<ReadingListURLs />} />
                <Route path="/reading-list-youtube" element={<ReadingListYouTube />} />
                <Route path="/flashcards/new" element={<FlashcardForm />} />
                <Route path="/flashcards/:cardId" element={<Flashcard />} />
                <Route path="/decks" element={<GroupAndDeckList />} />
                <Route path="/deck/:deckId/flashcards" element={<FlashcardList />} />
                <Route path="/flashcards/manage" element={<GlobalFlashcardManagement />} />
                <Route path="/drive" element={<Typography variant="h4">Google Drive機能はまだ実装されていません。</Typography>} />
              </Routes>
            ) : (
              <Typography variant="h5">ポータルを利用するにはログインしてください。</Typography>
            )}
          </Box>
        </Box>

        {isMobile && user && (
          <BottomNavigation
            showLabels
            sx={{
              width: '100%',
              height: 'calc(64px + env(safe-area-inset-bottom))',
              pb: 'env(safe-area-inset-bottom)',
              position: 'fixed',
              bottom: 0,
              left: 0,
              boxShadow: '0 -5px 18px rgba(30, 62, 82, 0.10)',
              zIndex: 1200,
              '& .MuiBottomNavigationAction-root': {
                minWidth: 0,
                px: 0.25,
                pt: 0.65,
              },
              '& .MuiBottomNavigationAction-label': {
                fontSize: '0.68rem',
                lineHeight: 1.1,
                mt: 0.2,
              },
              '& .MuiBottomNavigationAction-label.Mui-selected': {
                fontSize: '0.68rem',
              },
              '& .MuiSvgIcon-root': { fontSize: 23 },
            }}
            value={mobileNavValue}
          >
            <BottomNavigationAction value="/" label="ホーム" icon={<HomeIcon />} component={Link} to="/" />
            <BottomNavigationAction value="/thinking" label="思考" icon={<PsychologyAltIcon />} component={Link} to="/thinking" />
            <BottomNavigationAction value="/discover" label="寄り道" icon={<DiscoveryIcon />} component={Link} to="/discover" />
            <BottomNavigationAction value="/boards" label="ボード" icon={<ViewCompactIcon />} component={Link} to="/boards" />
            <BottomNavigationAction value="/dashboard" label="Agent HQ" icon={<DashboardIcon />} component={Link} to="/dashboard" />
          </BottomNavigation>
        )}

        <Dialog
          open={notificationModalOpen}
          onClose={() => setNotificationModalOpen(false)}
          fullScreen={isMobile}
        >
          <DialogTitle>未読アイテム</DialogTitle>
          <DialogContent>
            <Typography>Web記事: {unreadUrlsCount}件</Typography>
            <Typography>YouTube動画: {unreadYoutubeCount}件</Typography>
          </DialogContent>
          <DialogActions sx={{ pb: { xs: 'calc(8px + env(safe-area-inset-bottom))', md: 1 } }}>
            <Button onClick={() => setNotificationModalOpen(false)}>閉じる</Button>
          </DialogActions>
        </Dialog>
      </Box>
    </ThemeProvider>
  );
}

export default App;
