import { createTheme } from '@mui/material/styles';

const getAppTheme = (mode) => createTheme({
  palette: {
    mode,
    ...(mode === 'light'
      ? {
          primary: {
            main: '#5577e8',
            dark: '#405fc8',
            light: '#8ca3f0',
          },
          secondary: {
            main: '#8b62dc',
          },
          background: {
            default: '#edf4f8',
            paper: '#ffffff',
          },
          text: {
            primary: '#18324a',
            secondary: '#6e8294',
          },
          divider: 'rgba(77, 118, 145, 0.16)',
        }
      : {
          primary: {
            main: '#8ea8ff',
          },
          secondary: {
            main: '#b49af1',
          },
          background: {
            default: '#111820',
            paper: '#18222c',
          },
          text: {
            primary: '#edf4f8',
            secondary: '#9fb0be',
          },
          divider: 'rgba(255, 255, 255, 0.10)',
        }),
  },
  shape: {
    borderRadius: 12,
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
      fontWeight: 700,
      fontSize: '1.8rem',
      lineHeight: 1.2,
    },
    h5: {
      fontWeight: 700,
      fontSize: '1.5rem',
      lineHeight: 1.2,
    },
    h6: {
      fontWeight: 700,
      fontSize: '1.2rem',
      lineHeight: 1.2,
    },
    subtitle1: {
      fontWeight: 600,
    },
    button: {
      fontWeight: 700,
    },
  },
  spacing: 8,
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          ...(mode === 'light'
            ? {
                background: 'radial-gradient(circle at 12% 0%, rgba(129, 205, 236, 0.20), transparent 30%), radial-gradient(circle at 88% 4%, rgba(170, 205, 224, 0.18), transparent 32%), linear-gradient(135deg, #f4f9fc 0%, #eaf3f7 52%, #eef4f7 100%)',
                backgroundAttachment: 'fixed',
                backgroundColor: '#edf4f8',
              }
            : {
                background: 'radial-gradient(circle at 12% 0%, rgba(85, 119, 232, 0.12), transparent 30%), linear-gradient(180deg, #0f161d 0%, #111820 100%)',
                backgroundAttachment: 'fixed',
                backgroundColor: '#111820',
              }),
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: '0 2px 12px rgba(42, 82, 107, 0.07)',
          backgroundImage: 'none',
          backgroundColor: mode === 'light' ? 'rgba(248, 252, 255, 0.88)' : 'rgba(17, 24, 32, 0.90)',
          color: mode === 'light' ? '#18324a' : '#edf4f8',
          backdropFilter: 'blur(18px) saturate(145%)',
          borderBottom: mode === 'light'
            ? '1px solid rgba(77, 118, 145, 0.14)'
            : '1px solid rgba(255,255,255,0.08)',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          boxShadow: '8px 0 28px rgba(42, 82, 107, 0.07)',
          backgroundImage: 'none',
          backgroundColor: mode === 'light' ? 'rgba(248, 252, 255, 0.88)' : 'rgba(24, 34, 44, 0.94)',
          backdropFilter: 'blur(18px) saturate(135%)',
          borderRight: mode === 'light'
            ? '1px solid rgba(77, 118, 145, 0.13)'
            : '1px solid rgba(255,255,255,0.08)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          backgroundImage: 'none',
          boxShadow: mode === 'light'
            ? '0 4px 16px rgba(52, 89, 112, 0.08)'
            : '0 4px 18px rgba(0, 0, 0, 0.28)',
        },
      },
    },
    MuiCard: {
      defaultProps: {
        elevation: 0,
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
          borderRadius: 9,
          textTransform: 'none',
          boxShadow: 'none',
        },
        contained: {
          boxShadow: '0 4px 11px rgba(85, 119, 232, 0.20)',
          '&:hover': {
            boxShadow: '0 6px 14px rgba(85, 119, 232, 0.25)',
          },
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
    MuiListItemButton: {
      styleOverrides: {
        root: {
          margin: '2px 8px',
          borderRadius: 9,
          '&:hover': {
            backgroundColor: mode === 'light' ? 'rgba(85, 119, 232, 0.07)' : 'rgba(142, 168, 255, 0.09)',
          },
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        variant: 'outlined',
      },
    },
  },
});

export default getAppTheme;
