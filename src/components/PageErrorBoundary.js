import React from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';

// Catches a render error inside one page so the rest of the app (navigation, other pages)
// keeps working. Without it, one malformed record blanks the whole screen.
export default class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the stack in the console for debugging; the page shows a short message.
    // eslint-disable-next-line no-console
    console.error('Page render failed', error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <Box sx={{ maxWidth: 720, mx: 'auto', py: 4 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          <Typography fontWeight={800}>このページを表示できませんでした</Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            データの形が想定と違う可能性があります。ほかのページは使えます。
          </Typography>
          <Typography variant="caption" component="pre" sx={{ mt: 1, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
            {String(error?.message || error).slice(0, 400)}
          </Typography>
        </Alert>
        <Button variant="outlined" onClick={() => this.setState({ error: null })}>もう一度表示する</Button>
      </Box>
    );
  }
}
