import { createTheme } from '@mui/material/styles';

const getAppTheme = (mode) => createTheme({
  palette: {
    mode,
    ...(mode === 'light'
      ? { // Light Mode Palette (calmer, neutral)
          primary: {
            main: '#3f51b5', // Indigo 500
          },
          secondary: {
            main: '#26a69a', // Teal 400
          },
          background: {
            default: '#f6f7fb', // soft neutral
            paper: '#ffffff',
          },
          text: {
            primary: '#1f2937', // slate-800
            secondary: '#6b7280', // slate-500
          },
          divider: 'rgba(0, 0, 0, 0.12)',
        }
      : { // Dark Mode Palette (calmer, neutral)
          primary: {
            main: '#8ab4f8', // soft blue
          },
          secondary: {
            main: '#7fd1c9', // soft teal
          },
          background: {
            default: '#0f1115',
            paper: '#141821',
          },
          text: {
            primary: '#e5e7eb',
            secondary: '#9ca3af',
          },
          divider: 'rgba(255, 255, 255, 0.12)',
        }),
  },
  typography: {
    fontFamily: [
      'M PLUS Rounded 1c',
      'Zen Maru Gothic',
      'Nunito',
      'Noto Sans JP',
      'Roboto',
      'Hiragino Kaku Gothic ProN',
      'Meiryo',
      'Yu Gothic',
      'YuGothic',
      'Arial',
      'sans-serif',
    ].join(','),
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
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          ...(mode === 'light'
            ? {
                background: 'linear-gradient(180deg, #fafbff 0%, #f6f7fb 100%)',
                backgroundAttachment: 'fixed',
                backgroundColor: '#f6f7fb',
              }
            : {
                background: 'linear-gradient(180deg, #0d1117 0%, #0f1115 100%)',
                backgroundAttachment: 'fixed',
                backgroundColor: '#0f1115',
              }),
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: '0px 2px 8px rgba(0,0,0,0.06)',
          backgroundColor: mode === 'light' ? '#ffffffcc' : '#0f1115cc',
          backdropFilter: 'saturate(180%) blur(8px)',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          boxShadow: '0px 8px 24px rgba(0,0,0,0.08)',
          backgroundColor: mode === 'light' ? '#ffffff' : '#141821',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          backgroundImage: 'none',
          backgroundColor: mode === 'light' ? '#ffffff' : '#141821',
          boxShadow: mode === 'light'
            ? '0 2px 8px rgba(0,0,0,0.06)'
            : '0 2px 12px rgba(0,0,0,0.5)',
        },
      },
    },
    MuiCard: {
      defaultProps: {
        elevation: 1,
      },
      styleOverrides: {
        root: {
          borderRadius: 12,
          backgroundImage: 'none',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          textTransform: 'none', // Keep button text as is
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 6,
        },
      },
    },
  },
});

export default getAppTheme;
