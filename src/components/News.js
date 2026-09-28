import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  Card,
  CardContent,
  CardMedia,
  Link,
  Button,
  TextField,
  Grid,
  Chip,
  Container
} from '@mui/material';
import { Shuffle as ShuffleIcon } from '@mui/icons-material';
import { collection, getDocs, addDoc, deleteDoc, doc } from '../documentDbClient';
import { db } from '../firebase';

const PAGE_SIZE = 21; // 3列でも7列でも割り切れる数

function News() {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [keywords, setKeywords] = useState([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [currentQuery, setCurrentQuery] = useState('');

  const observer = useRef();
  const lastArticleElementRef = useCallback(node => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        setPage(prevPage => prevPage + 1);
      }
    });
    if (node) observer.current.observe(node);
  }, [loading, hasMore]);

  const fetchNews = useCallback(async (searchQuery, pageNum) => {
    if (!searchQuery) return;
    setLoading(true);
    setError(null);

    const apiKey = process.env.REACT_APP_NEWS_API_KEY;
    if (!apiKey) {
      console.error("News API Key is not defined. Please set REACT_APP_NEWS_API_KEY in your .env file.");
      setError("News API Key is missing.");
      setLoading(false);
      return;
    }

    try {
      const apiUrl = `https://newsapi.org/v2/everything?q=${encodeURIComponent(searchQuery)}&apiKey=${apiKey}&page=${pageNum}&pageSize=${PAGE_SIZE}`;
      console.log("Fetching news from:", apiUrl);
      const response = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'My-Portal/1.0' // Some APIs require a User-Agent header
        }
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      if (data.articles) {
        setArticles(prevArticles => {
          const newArticles = [...prevArticles, ...data.articles];
          // 重複を除去
          const uniqueArticles = newArticles.filter((v,i,a)=>a.findIndex(t=>(t.url === v.url))===i);
          return uniqueArticles;
        });
        setHasMore(data.articles.length > 0);
      }
    } catch (e) {
      setError(e.message);
      setHasMore(false); // Stop further requests on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const fetchKeywords = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'keywords'));
        const keywordsData = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        setKeywords(keywordsData);
        const initialQuery = keywordsData.length > 0
          ? keywordsData.map(k => `"${k.name}"`).join(' OR ')
          : 'technology';
        setCurrentQuery(initialQuery);
      } catch (err) {
        console.error("Error fetching keywords: ", err);
        setError('キーワードの取得に失敗しました。');
      }
    };
    fetchKeywords();
  }, []);

  useEffect(() => {
    if (currentQuery) {
        setArticles([]);
        setPage(1);
        setHasMore(true);
        fetchNews(currentQuery, 1);
    }
  }, [currentQuery, fetchNews]);

  useEffect(() => {
    if (page > 1) {
      fetchNews(currentQuery, page);
    }
  }, [page, currentQuery, fetchNews]);

  const handleSearch = () => {
    setQuery(query);
    setCurrentQuery(query);
  };

  const handleShuffle = () => {
    setArticles(prev => [...prev].sort(() => 0.5 - Math.random()));
  };

  const handleAddKeyword = async () => {
    if (newKeyword.trim() === '') return;
    try {
      const docRef = await addDoc(collection(db, 'keywords'), { name: newKeyword });
      const addedKeyword = { id: docRef.id, name: newKeyword };
      setKeywords(prev => [...prev, addedKeyword]);
      setNewKeyword('');
      const newQuery = [...keywords, addedKeyword].map(k => `"${k.name}"`).join(' OR ');
      setCurrentQuery(newQuery);
    } catch (err) {
      console.error("Error adding keyword: ", err);
      setError('キーワードの追加に失敗しました。');
    }
  };

  const handleDeleteKeyword = async (id) => {
    try {
      await deleteDoc(doc(db, 'keywords', id));
      const updatedKeywords = keywords.filter(k => k.id !== id);
      setKeywords(updatedKeywords);
      const newQuery = updatedKeywords.length > 0
        ? updatedKeywords.map(k => `"${k.name}"`).join(' OR ')
        : 'technology';
      setCurrentQuery(newQuery);
    } catch (err) {
      console.error("Error deleting keyword: ", err);
      setError('キーワードの削除に失敗しました。');
    }
  };
  
  const handleKeywordClick = (keywordName) => {
    setQuery(keywordName);
    setCurrentQuery(`"${keywordName}"`);
  }

  return (
    <Container>
      <Box sx={{ p: 2 }}>
        <Typography variant="h4" gutterBottom>ニュース</Typography>

      <Box sx={{ mb: 3 }}>
        <Typography variant="h6">関心キーワード</Typography>
        <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
          <TextField
            label="キーワードを追加"
            variant="outlined"
            size="small"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAddKeyword()}
          />
          <Button variant="contained" onClick={handleAddKeyword}>追加</Button>
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {keywords.map(keyword => (
            <Chip
              key={keyword.id}
              label={keyword.name}
              onDelete={() => handleDeleteKeyword(keyword.id)}
              onClick={() => handleKeywordClick(keyword.name)}
              color="primary"
            />
          ))}
        </Box>
      </Box>

      <Box sx={{ display: 'flex', gap: 2, mb: 3, position: 'sticky', top: 0, zIndex: 100, bgcolor: 'background.paper', py: 2 }}>
        <TextField
          label="一時的な検索"
          variant="outlined"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          fullWidth
        />
        <Button variant="contained" onClick={handleSearch}>検索</Button>
        <Button variant="outlined" onClick={handleShuffle} startIcon={<ShuffleIcon />}>シャッフル</Button>
      </Box>

      <Grid container spacing={3}>
        {articles.map((article, index) => {
          const isLastElement = articles.length === index + 1;
          return (
            <Grid item xs={12} sm={6} md={4} key={`${article.url}-${index}`} ref={isLastElement ? lastArticleElementRef : null}>
              <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <CardMedia
                  component="img"
                  height="140"
                  image={article.urlToImage || 'https://via.placeholder.com/300x140.png?text=No+Image'}
                  alt={article.title}
                />
                <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', p: 2 }}>
                  <Typography
                    title={article.title}
                    variant="subtitle1"
                    component="div"
                    sx={{
                      fontWeight: 'bold',
                      lineHeight: 1.4,
                      height: '2.8em', // 2 lines * 1.4em/line
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      mb: 1,
                    }}
                  >
                    {article.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{
                    flexGrow: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    lineHeight: 1.5,
                    height: '4.5em', // 3 lines * 1.5em/line
                  }}>
                    {article.description}
                  </Typography>
                </CardContent>
                <Box sx={{ p: 2, pt: 0 }}>
                  <Link href={article.url} target="_blank" rel="noopener" variant="body2">
                    記事を読む
                  </Link>
                </Box>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}><CircularProgress /></Box>}
      {error && <Alert severity="error" sx={{ mt: 2 }}>エラー: {error}</Alert>}
      {!hasMore && !loading && <Typography sx={{ textAlign: 'center', my: 2 }}>これ以上ニュースはありません。</Typography>}
    </Box>
    </Container>
  );
}

export default News;