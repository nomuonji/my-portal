import React, { useState, useEffect } from 'react';
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
  TextField
} from '@mui/material';
import { Shuffle as ShuffleIcon } from '@mui/icons-material';

function News() {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('technology'); // デフォルトの検索クエリ
  const [shuffledArticles, setShuffledArticles] = useState([]);

  const fetchNews = async (searchQuery) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `https://newsapi.org/v2/everything?q=${searchQuery}&apiKey=${process.env.REACT_APP_NEWS_API_KEY}`
      );
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      if (data.articles) {
        setArticles(data.articles);
        setShuffledArticles(data.articles);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews(query);
  }, [query]);

  const handleSearch = () => {
    fetchNews(query);
  };

  const handleShuffle = () => {
    const shuffled = [...articles].sort(() => 0.5 - Math.random());
    setShuffledArticles(shuffled);
  };

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h4" gutterBottom>ニュース</Typography>

      <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
        <TextField
          label="検索キーワード"
          variant="outlined"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyPress={(e) => {
            if (e.key === 'Enter') {
              handleSearch();
            }
          }}
          fullWidth
        />
        <Button variant="contained" onClick={handleSearch}>検索</Button>
        <Button variant="outlined" onClick={handleShuffle} startIcon={<ShuffleIcon />}>シャッフル</Button>
      </Box>

      {loading && <CircularProgress />}
      {error && <Alert severity="error">ニュースの取得に失敗しました: {error}</Alert>}

      <Grid container spacing={2}>
        {shuffledArticles.map((article, index) => (
          <Grid item xs={12} sm={6} md={4} key={index}>
            <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              {article.urlToImage && (
                <CardMedia
                  component="img"
                  height="140"
                  image={article.urlToImage}
                  alt={article.title}
                />
              )}
              <CardContent sx={{ flexGrow: 1 }}>
                <Typography gutterBottom variant="h6" component="div">
                  {article.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {article.description}
                </Typography>
              </CardContent>
              <Box sx={{ p: 2 }}>
                <Link href={article.url} target="_blank" rel="noopener" variant="body2">
                  記事を読む
                </Link>
              </Box>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}

export default News;
