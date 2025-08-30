import { createTheme } from '@mui/material/styles';

const getAppTheme = (mode) => createTheme({
  palette: {
    mode,
    ...(mode === 'light'
      ? { // Light Mode Palette (Vibrant)
          primary: {
            main: '#673ab7', // Deep Purple 500
          },
          secondary: {
            main: '#00bcd4', // Cyan 500
          },
          background: {
            default: '#f3e5f5', // Deep Purple 50
            paper: '#ffffff', // White
          },
          text: {
            primary: '#212121', // Grey 900
            secondary: '#5e35b1', // Deep Purple 600
          },
          divider: 'rgba(0, 0, 0, 0.12)',
        }
      : { // Dark Mode Palette (Vibrant)
          primary: {
            main: '#b39ddb', // Deep Purple 200
          },
          secondary: {
            main: '#80deea', // Cyan 200
          },
          background: {
            default: '#121212', // Dark background
            paper: '#1e1e1e',
          },
          text: {
            primary: '#e0e0e0', // Grey 300
            secondary: '#b39ddb', // Deep Purple 200
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
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          ...(mode === 'light'
            ? {
                background: 'linear-gradient(135deg, #e0f7fa 0%, #e1bee7 100%)',
                backgroundAttachment: 'fixed',
                backgroundColor: '#f3e5f5',
              }
            : {
                background: 'linear-gradient(135deg, #311b92 0%, #006064 100%)',
                backgroundAttachment: 'fixed',
                backgroundColor: '#121212',
              }),
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: '0px 2px 4px -1px rgba(0,0,0,0.05), 0px 4px 5px 0px rgba(0,0,0,0.03), 0px 1px 10px 0px rgba(0,0,0,0.02)',
          ...(mode === 'light'
            ? { background: 'linear-gradient(90deg, #673ab7 0%, #00bcd4 100%)' }
            : { background: 'linear-gradient(90deg, #311b92 0%, #006064 100%)' }),
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
