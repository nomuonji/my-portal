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
  Tooltip,
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
  FavoriteBorder as TasteIcon,
  Logout as LogoutIcon,
  ArticleOutlined as ReadLaterIcon,
  SmartDisplayOutlined as WatchLaterIcon,
  StyleOutlined as CardsIcon,
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
import {TraktOAuthCallback} from './components/MediaTasteConnections';
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

import getAppTheme, { fonts } from './theme';

const YOUTUBE_API_KEY = 'YOUR_YOUTUBE_API_KEY';
const drawerWidth = 244;
const BOARD_PATHS = ['/boards', '/ideaboard', '/hobbyboard', '/stockboard', '/idea', '/hobby', '/stock'];

function BrandMark({ color }) {
  // A small ledger mark: a ruled page with one marked line.
  return (
    <Box component="svg" viewBox="0 0 28 28" aria-hidden="true" sx={{ width: 28, height: 28, flexShrink: 0 }}>
      <rect x="1.5" y="1.5" width="25" height="25" rx="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <line x1="7" y1="9" x2="21" y2="9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity=".45" />
      <line x1="7" y1="14" x2="21" y2="14" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
      <line x1="7" y1="19" x2="16" y2="19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity=".45" />
    </Box>
  );
}

const todayLabel = () => {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
    .formatToParts(now).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return `${parts.year}.${parts.month}.${parts.day} ${String(parts.weekday || '').toUpperCase()}`;
};

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
    if (path.startsWith('/discover')) return 'Discover';
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

  useEffect(() => {
    const t = appTheme.palette.portal;
    document.documentElement.style.background = t.bg;
    document.documentElement.style.colorScheme = mode;
  }, [appTheme, mode]);

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

  const isActive = (item) => (item.match || [item.to]).some((prefix) => (
    prefix === '/' ? location.pathname === '/' : location.pathname.startsWith(prefix)
  ));
  const tokens = appTheme.palette.portal;

  const navRow = (item, nested = false) => (
    <ListItemButton
      key={item.to}
      selected={isActive(item)}
      component={Link}
      to={item.to}
      onClick={navClick}
      title={item.hint}
      sx={nested ? { pl: 2.2 } : undefined}
    >
      <ListItemIcon>{item.icon}</ListItemIcon>
      <ListItemText
        primary={item.label}
        primaryTypographyProps={{ noWrap: true, sx: { fontSize: 14, fontWeight: 500 } }}
      />
      {item.badge > 0 && (
        <Box component="span" sx={{ fontFamily: fonts.mono, fontSize: 11, fontWeight: 600, color: tokens.accent, ml: 1 }}>
          {item.badge}
        </Box>
      )}
    </ListItemButton>
  );

  const navGroups = [
    {
      label: '入口',
      items: [{ to: '/', label: 'ホーム', hint: '全体像 / 参照先 / Skills', icon: <HomeIcon /> }],
    },
    {
      label: '自分',
      items: [
        { to: '/discover', label: 'Discover', hint: '動画・記事・作品のおすすめ', icon: <DiscoveryIcon /> },
        { to: '/boards', match: BOARD_PATHS, label: 'ボード', hint: '企画・ビジネス / 興味・趣味 / ネタ・表現 / メモ', icon: <ViewCompactIcon /> },
        { to: '/taste', label: '好みの記録', hint: '好き嫌い / 根拠 / 訂正履歴', icon: <TasteIcon /> },
        { to: '/thinking', label: '思考テーマ', hint: '長期テーマ / Context Store', icon: <PsychologyAltIcon /> },
        { to: '/social-archive', label: 'X投稿アーカイブ', hint: '過去投稿の検索・分類・見返し', icon: <ArchiveIcon /> },
      ],
    },
    {
      label: 'エージェント',
      items: [
        { to: '/dashboard', label: 'Agent HQ', hint: '実行キュー / Agents / 再開地点', icon: <DashboardIcon /> },
        { to: '/meta', label: 'プロジェクト提案', hint: '戦略・次の一手', icon: <MetaIcon /> },
        { to: '/agent-ideas', label: 'Agent Ideas', hint: 'Portalと同じ構造でAIが補充', icon: <SmartToyIcon /> },
        { to: '/curation-sources', label: '情報源ライブラリ', hint: '人間の選考で発掘した情報源', icon: <SourcesIcon /> },
      ],
    },
    {
      label: '制作・公開',
      items: [
        { to: '/ogiri', label: '大喜利ラボ', hint: '発想の拡散・センス蓄積', icon: <EmojiObjectsIcon /> },
        { to: '/public-cms', label: 'Public CMS', hint: '思考 → 公開 / 複数サイト', icon: <PublicIcon /> },
        { to: '/characters', label: 'キャラクターDB', hint: 'キャラクター設定 / 画像ライブラリ', icon: <CharacterIcon /> },
        { to: '/project', label: 'プロジェクトボード', hint: 'Project一覧', icon: <Folder /> },
      ],
    },
  ];

  const otherItems = [
    { to: '/reading-list-urls', label: '後で読む', icon: <ReadLaterIcon />, badge: unreadUrlsCount },
    { to: '/reading-list-youtube', label: '後で見る', icon: <WatchLaterIcon />, badge: unreadYoutubeCount },
    { to: '/news', label: 'ニュース', icon: <Newspaper /> },
    { to: '/decks', match: ['/deck', '/flashcards'], label: '暗記カード', icon: <CardsIcon /> },
    { to: '/feature-requests', label: '機能改善', icon: <BuildIcon /> },
    { to: '/drive', label: 'Google Drive', icon: <Folder /> },
  ];

  const groupLabel = (label) => (
    <Typography
      component="div"
      sx={{ fontFamily: fonts.mono, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.14em', color: tokens.faint, px: 2.5, pt: 2, pb: 0.6 }}
    >
      {label}
    </Typography>
  );

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
      <Box
        component={Link}
        to="/"
        onClick={navClick}
        sx={{
          flexShrink: 0, height: { xs: 56, sm: 64 }, px: 2.5, display: 'flex', alignItems: 'center', gap: 1.2,
          color: 'text.primary', textDecoration: 'none', borderBottom: `1px solid ${tokens.rule}`,
        }}
      >
        <BrandMark color={tokens.accent} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 900, fontSize: 16, letterSpacing: '-0.02em', lineHeight: 1.1 }}>My Portal</Typography>
          <Typography sx={{ fontFamily: fonts.mono, fontSize: 10, color: tokens.faint, letterSpacing: '0.06em', lineHeight: 1.4 }}>
            personal operations
          </Typography>
        </Box>
      </Box>
      <Box component="nav" aria-label="ポータルのページ" sx={{ flexGrow: 1, overflowY: 'auto', overscrollBehavior: 'contain', pb: 1.5 }}>
        {user && navGroups.map((group) => (
          <Box key={group.label}>
            {groupLabel(group.label)}
            <List disablePadding>{group.items.map((item) => navRow(item))}</List>
          </Box>
        ))}
        {user && (
          <>
            {groupLabel('ほか')}
            <List disablePadding>
              <ListItemButton onClick={() => setOpenOthers((open) => !open)} aria-expanded={openOthers}>
                <ListItemIcon><MoreHorizIcon /></ListItemIcon>
                <ListItemText primary="その他" primaryTypographyProps={{ sx: { fontSize: 14, fontWeight: 500 } }} />
                {unreadUrlsCount + unreadYoutubeCount > 0 && !openOthers && (
                  <Box component="span" sx={{ fontFamily: fonts.mono, fontSize: 11, fontWeight: 600, color: tokens.accent, mr: 0.5 }}>
                    {unreadUrlsCount + unreadYoutubeCount}
                  </Box>
                )}
                {openOthers ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
              </ListItemButton>
              <Collapse in={openOthers} timeout="auto" unmountOnExit>
                <List component="div" disablePadding>{otherItems.map((item) => navRow(item, true))}</List>
              </Collapse>
            </List>
          </>
        )}
      </Box>
      <Box sx={{ flexShrink: 0, borderTop: `1px solid ${tokens.rule}`, px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Tooltip title={mode === 'dark' ? 'ライトモードにする' : 'ダークモードにする'}>
          <IconButton size="small" onClick={handleModeChange} aria-label={mode === 'dark' ? 'ライトモードにする' : 'ダークモードにする'}>
            {mode === 'dark' ? <Brightness7Icon fontSize="small" /> : <Brightness4Icon fontSize="small" />}
          </IconButton>
        </Tooltip>
        {user && (
          <Tooltip title="ログアウト">
            <IconButton size="small" onClick={handleLogout} aria-label="ログアウト"><LogoutIcon fontSize="small" /></IconButton>
          </Tooltip>
        )}
        <Typography sx={{ ml: 'auto', fontFamily: fonts.mono, fontSize: 10.5, color: tokens.faint }}>
          {/^[\w.-]+$/.test(process.env.REACT_APP_VERSION || '') ? `v${process.env.REACT_APP_VERSION}` : ''}
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
          <Toolbar sx={{ minHeight: { xs: 56, sm: 64 }, px: { xs: 1, sm: 2.5 }, gap: 0.5 }}>
            <IconButton
              color="inherit"
              aria-label="メニューを開く"
              edge="start"
              onClick={handleDrawerToggle}
              sx={{ mr: 1, display: { md: 'none' }, width: 44, height: 44 }}
            >
              <MenuIcon />
            </IconButton>
            <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 1.2 }}>
              <Typography
                component="span"
                sx={{ display: { xs: 'none', md: 'inline' }, fontFamily: fonts.mono, fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', color: 'text.disabled' }}
              >
                MY PORTAL /
              </Typography>
              <Typography noWrap component="h1" sx={{ fontWeight: 800, fontSize: { xs: 16, md: 17 }, letterSpacing: '-0.01em', m: 0 }}>
                {pageTitle === 'My Portal' ? 'My Portal' : pageTitle}
              </Typography>
            </Box>
            <Typography
              component="span"
              sx={{ display: { xs: 'none', sm: 'inline' }, fontFamily: fonts.mono, fontSize: 11.5, color: 'text.secondary', mr: 1, letterSpacing: '0.04em' }}
            >
              {todayLabel()}
            </Typography>
            <IconButton
              color="inherit"
              aria-label="未読アイテム"
              onClick={() => setNotificationModalOpen(true)}
              sx={{ width: 40, height: 40, display: user ? 'inline-flex' : 'none' }}
            >
              <Badge badgeContent={unreadUrlsCount + unreadYoutubeCount} color="primary">
                <NotificationsIcon fontSize="small" />
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
                <Route path="/trakt/callback" element={<TraktOAuthCallback />} />
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
              <SignIn onLogin={handleLogin} />
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
              zIndex: 1200,
              '& .MuiBottomNavigationAction-root': {
                position: 'relative',
                minWidth: 0,
                px: 0.25,
                pt: 0.65,
              },
              '& .MuiBottomNavigationAction-label': {
                fontSize: '0.66rem',
                lineHeight: 1.1,
                mt: 0.2,
              },
              '& .MuiBottomNavigationAction-label.Mui-selected': {
                fontSize: '0.66rem',
              },
              '& .MuiBottomNavigationAction-root.Mui-selected::before': {
                content: '""', position: 'absolute', top: 0, left: '30%', right: '30%', height: 2, bgcolor: 'primary.main',
              },
              '& .MuiSvgIcon-root': { fontSize: 22 },
            }}
            value={mobileNavValue}
          >
            <BottomNavigationAction value="/" label="ホーム" icon={<HomeIcon />} component={Link} to="/" />
            <BottomNavigationAction value="/thinking" label="思考" icon={<PsychologyAltIcon />} component={Link} to="/thinking" />
            <BottomNavigationAction value="/discover" label="Discover" icon={<DiscoveryIcon />} component={Link} to="/discover" />
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
            <List disablePadding sx={{ minWidth: { sm: 320 } }}>
              <ListItemButton component={Link} to="/reading-list-urls" onClick={() => setNotificationModalOpen(false)} sx={{ mx: 0 }}>
                <ListItemIcon><ReadLaterIcon /></ListItemIcon>
                <ListItemText primary="後で読む（Web記事）" />
                <Typography sx={{ fontFamily: fonts.mono, fontWeight: 600 }}>{unreadUrlsCount}</Typography>
              </ListItemButton>
              <ListItemButton component={Link} to="/reading-list-youtube" onClick={() => setNotificationModalOpen(false)} sx={{ mx: 0 }}>
                <ListItemIcon><WatchLaterIcon /></ListItemIcon>
                <ListItemText primary="後で見る（YouTube）" />
                <Typography sx={{ fontFamily: fonts.mono, fontWeight: 600 }}>{unreadYoutubeCount}</Typography>
              </ListItemButton>
            </List>
          </DialogContent>
          <DialogActions sx={{ pb: { xs: 'calc(8px + env(safe-area-inset-bottom))', md: 1 } }}>
            <Button onClick={() => setNotificationModalOpen(false)}>閉じる</Button>
          </DialogActions>
        </Dialog>
      </Box>
    </ThemeProvider>
  );
}

function SignIn({ onLogin }) {
  return (
    <Box sx={{ minHeight: '70vh', display: 'grid', placeItems: 'center', px: 2 }}>
      <Box sx={{ width: '100%', maxWidth: 420 }}>
        <Typography sx={{ fontFamily: fonts.mono, fontSize: 11, letterSpacing: '0.14em', color: 'text.disabled' }}>
          {todayLabel()}
        </Typography>
        <Typography component="h2" sx={{ fontWeight: 900, fontSize: { xs: 30, sm: 36 }, letterSpacing: '-0.03em', lineHeight: 1.15, mt: 1 }}>
          My Portal
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1.5 }}>
          プロジェクト、思考テーマ、エージェントの仕事、Discoverの記録をまとめた個人用の作業台です。続けるにはログインしてください。
        </Typography>
        <Button variant="contained" size="large" onClick={onLogin} sx={{ mt: 3, minHeight: 44 }}>
          Googleでログイン
        </Button>
      </Box>
    </Box>
  );
}

export default App;
