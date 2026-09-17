import { createTheme } from '@mui/material/styles';

const getAppTheme = (mode) => createTheme({
  palette: {
    mode,
    ...(mode === 'light'
      ? {
          primary: { main: '#5577e8', dark: '#405fc8', light: '#8ca3f0' },
          secondary: { main: '#8b62dc' },
          background: { default: '#edf4f8', paper: '#ffffff' },
          text: { primary: '#18324a', secondary: '#6e8294' },
          divider: 'rgba(77, 118, 145, 0.16)',
        }
      : {
          primary: { main: '#8ea8ff' },
          secondary: { main: '#b49af1' },
          background: { default: '#111820', paper: '#18222c' },
          text: { primary: '#edf4f8', secondary: '#9fb0be' },
          divider: 'rgba(255, 255, 255, 0.10)',
        }),
  },
  shape: { borderRadius: 12 },
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
      fontWeight: 800,
      fontSize: '1.75rem',
      lineHeight: 1.2,
      letterSpacing: '-0.025em',
      '@media (max-width:600px)': { fontSize: '1.48rem' },
    },
    h5: {
      fontWeight: 800,
      fontSize: '1.45rem',
      lineHeight: 1.25,
      letterSpacing: '-0.02em',
      '@media (max-width:600px)': { fontSize: '1.26rem' },
    },
    h6: { fontWeight: 800, fontSize: '1.15rem', lineHeight: 1.3 },
    subtitle1: { fontWeight: 700 },
    body1: { lineHeight: 1.65 },
    body2: { lineHeight: 1.58 },
    button: { fontWeight: 800 },
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
          WebkitFontSmoothing: 'antialiased',
        },
        '::selection': {
          backgroundColor: mode === 'light' ? 'rgba(85,119,232,0.18)' : 'rgba(142,168,255,0.28)',
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
          borderBottom: mode === 'light' ? '1px solid rgba(77, 118, 145, 0.14)' : '1px solid rgba(255,255,255,0.08)',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          boxShadow: '8px 0 28px rgba(42, 82, 107, 0.07)',
          backgroundImage: 'none',
          backgroundColor: mode === 'light' ? 'rgba(248, 252, 255, 0.96)' : 'rgba(24, 34, 44, 0.97)',
          backdropFilter: 'blur(18px) saturate(135%)',
          borderRight: mode === 'light' ? '1px solid rgba(77, 118, 145, 0.13)' : '1px solid rgba(255,255,255,0.08)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          backgroundImage: 'none',
          boxShadow: mode === 'light' ? '0 4px 16px rgba(52, 89, 112, 0.08)' : '0 4px 18px rgba(0, 0, 0, 0.28)',
        },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { borderRadius: 12, backgroundImage: 'none' },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 10,
          minHeight: 36,
          textTransform: 'none',
          boxShadow: 'none',
          letterSpacing: 0,
          '@media (max-width:899px)': { minHeight: 42 },
        },
        contained: {
          boxShadow: '0 4px 11px rgba(85, 119, 232, 0.20)',
          '&:hover': { boxShadow: '0 7px 17px rgba(85, 119, 232, 0.24)' },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          transition: 'background-color 150ms ease, transform 150ms ease',
          '&:hover': { transform: 'translateY(-1px)' },
          '@media (max-width:899px)': { minWidth: 40, minHeight: 40 },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 7 },
        label: { fontWeight: 650 },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          margin: '2px 8px',
          borderRadius: 10,
          minHeight: 40,
          '&:hover': { backgroundColor: mode === 'light' ? 'rgba(85, 119, 232, 0.07)' : 'rgba(142, 168, 255, 0.09)' },
          '&.Mui-selected': {
            backgroundColor: mode === 'light' ? 'rgba(85, 119, 232, 0.11)' : 'rgba(142, 168, 255, 0.13)',
            '& .MuiListItemIcon-root': { color: mode === 'light' ? '#5577e8' : '#8ea8ff' },
          },
          '@media (max-width:899px)': {
            minHeight: 46,
            margin: '3px 8px',
          },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          backgroundColor: mode === 'light' ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.025)',
          transition: 'box-shadow 150ms ease, background-color 150ms ease',
          '&:hover': { backgroundColor: mode === 'light' ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.045)' },
          '&.Mui-focused': {
            boxShadow: mode === 'light' ? '0 0 0 3px rgba(85,119,232,0.08)' : '0 0 0 3px rgba(142,168,255,0.08)',
          },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 18,
          border: mode === 'light' ? '1px solid rgba(77,118,145,0.14)' : '1px solid rgba(255,255,255,0.08)',
          backgroundImage: 'none',
          backgroundColor: mode === 'light' ? 'rgba(252,254,255,0.98)' : 'rgba(24,34,44,0.99)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 28px 90px rgba(28,58,78,.24)',
          '@media (max-width:599px)': {
            maxWidth: 'calc(100vw - 20px)',
            margin: 10,
            borderRadius: 14,
          },
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          borderRadius: 12,
          border: mode === 'light' ? '1px solid rgba(77,118,145,0.14)' : '1px solid rgba(255,255,255,0.08)',
          backgroundImage: 'none',
          boxShadow: '0 14px 38px rgba(37,70,92,0.16)',
          maxWidth: 'calc(100vw - 16px)',
        },
      },
    },
    MuiBottomNavigation: {
      styleOverrides: {
        root: {
          backgroundColor: mode === 'light' ? 'rgba(248,252,255,0.96)' : 'rgba(17,24,32,0.97)',
          backdropFilter: 'blur(18px) saturate(140%)',
          borderTop: mode === 'light' ? '1px solid rgba(77,118,145,0.14)' : '1px solid rgba(255,255,255,0.08)',
        },
      },
    },
    MuiBottomNavigationAction: {
      styleOverrides: {
        root: { minWidth: 0 },
        label: { fontWeight: 750 },
      },
    },
    MuiTooltip: {
      defaultProps: { arrow: true },
    },
  },
});

export default getAppTheme;
