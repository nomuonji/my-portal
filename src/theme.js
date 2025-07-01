import { createTheme } from '@mui/material/styles';

const getAppTheme = (mode) => createTheme({
  palette: {
    mode,
    ...(mode === 'light'
      ? { // Light Mode Palette (Subdued)
          primary: {
            main: '#546E7A', // Blue Grey 700
          },
          secondary: {
            main: '#78909C', // Blue Grey 500
          },
          background: {
            default: '#ECEFF1', // Blue Grey 50
            paper: '#FFFFFF', // White
          },
          text: {
            primary: '#263238', // Blue Grey 900
            secondary: '#546E7A', // Blue Grey 700
          },
          divider: 'rgba(0, 0, 0, 0.12)',
        }
      : { // Dark Mode Palette (Subdued)
          primary: {
            main: '#90A4AE', // Blue Grey 300
          },
          secondary: {
            main: '#B0BEC5', // Blue Grey 200
          },
          background: {
            default: '#263238', // Blue Grey 900
            paper: '#37474F', // Blue Grey 800
          },
          text: {
            primary: '#ECEFF1', // Blue Grey 50
            secondary: '#B0BEC5', // Blue Grey 200
          },
          divider: 'rgba(255, 255, 255, 0.12)',
        }),
  },
  typography: {
    fontFamily: ['Noto Sans JP', 'Roboto', 'Arial', 'sans-serif'].join(','),
    h4: {
      fontWeight: 600,
      fontSize: '1.8rem',
      lineHeight: 1.2,
    },
    h5: {
      fontWeight: 600,
      fontSize: '1.5rem',
      lineHeight: 1.2,
    },
    h6: {
      fontWeight: 600,
      fontSize: '1.2rem',
      lineHeight: 1.2,
    },
    subtitle1: {
      fontWeight: 500,
    },
  },
  spacing: 8, // Default spacing unit
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: '0px 2px 4px -1px rgba(0,0,0,0.05), 0px 4px 5px 0px rgba(0,0,0,0.03), 0px 1px 10px 0px rgba(0,0,0,0.02)',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          boxShadow: '0px 8px 10px -5px rgba(0,0,0,0.1), 0px 16px 24px 2px rgba(0,0,0,0.07), 0px 6px 30px 5px rgba(0,0,0,0.06)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 8, // Slightly rounded corners for cards/papers
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          textTransform: 'none', // Keep button text as is
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 4,
        },
      },
    },
  },
});

export default getAppTheme;
