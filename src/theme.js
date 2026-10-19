import { createTheme, alpha } from '@mui/material/styles';

/*
 * My Portal design tokens — "operations ledger".
 * Paper-like neutral surfaces, ink text, hairline rules instead of floating
 * shadows, one vermilion accent for state/selection, and a monospace face for
 * metadata (dates, counts, IDs). See docs/DESIGN_SYSTEM.md.
 */
export const tokens = {
  light: {
    bg: '#f4f2ed',
    surface: '#fffdf9',
    sunken: '#ece9e2',
    ink: '#1c1d1f',
    muted: '#66645e',
    faint: '#8e8b83',
    rule: 'rgba(28, 29, 31, 0.13)',
    ruleStrong: 'rgba(28, 29, 31, 0.26)',
    accent: '#c4422a',
    accentSoft: 'rgba(196, 66, 42, 0.09)',
    teal: '#2e6b66',
  },
  dark: {
    bg: '#121315',
    surface: '#1a1b1e',
    sunken: '#0d0e10',
    ink: '#ecebe6',
    muted: '#a4a29b',
    faint: '#7b7972',
    rule: 'rgba(236, 235, 230, 0.11)',
    ruleStrong: 'rgba(236, 235, 230, 0.24)',
    accent: '#ff7d5c',
    accentSoft: 'rgba(255, 125, 92, 0.12)',
    teal: '#7cc4bc',
  },
};

export const fonts = {
  sans: ['"Noto Sans JP"', '"Hiragino Kaku Gothic ProN"', '"Hiragino Sans"', 'Meiryo', '"Yu Gothic"', 'YuGothic', 'system-ui', 'sans-serif'].join(','),
  mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'].join(','),
};

const getAppTheme = (mode) => {
  const t = tokens[mode === 'dark' ? 'dark' : 'light'];
  const dark = mode === 'dark';
  const focusRing = `0 0 0 3px ${alpha(t.accent, dark ? 0.32 : 0.22)}`;

  return createTheme({
    palette: {
      mode,
      primary: dark
        ? { main: t.accent, contrastText: '#1a0d08' }
        : { main: t.accent, dark: '#a33620', light: '#de6a52', contrastText: '#ffffff' },
      secondary: { main: t.teal },
      success: { main: dark ? '#7fc98f' : '#2f7d4a' },
      warning: { main: dark ? '#e8b44f' : '#a8650c' },
      error: { main: dark ? '#ff8a80' : '#b3261e' },
      info: { main: dark ? '#8cb4e0' : '#2f5f8f' },
      background: { default: t.bg, paper: t.surface },
      text: { primary: t.ink, secondary: t.muted, disabled: t.faint },
      divider: t.rule,
      action: {
        hover: alpha(t.ink, dark ? 0.06 : 0.045),
        selected: alpha(t.accent, dark ? 0.14 : 0.09),
      },
      portal: t,
    },
    shape: { borderRadius: 6 },
    typography: {
      fontFamily: fonts.sans,
      fontWeightBold: 700,
      h1: { fontWeight: 900, letterSpacing: '-0.03em' },
      h2: { fontWeight: 900, letterSpacing: '-0.03em' },
      h3: { fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1.12 },
      h4: {
        fontWeight: 800,
        fontSize: '1.7rem',
        lineHeight: 1.22,
        letterSpacing: '-0.02em',
        '@media (max-width:600px)': { fontSize: '1.42rem' },
      },
      h5: {
        fontWeight: 800,
        fontSize: '1.38rem',
        lineHeight: 1.3,
        letterSpacing: '-0.015em',
        '@media (max-width:600px)': { fontSize: '1.2rem' },
      },
      h6: { fontWeight: 800, fontSize: '1.08rem', lineHeight: 1.4, letterSpacing: '-0.01em' },
      subtitle1: { fontWeight: 700, lineHeight: 1.5 },
      subtitle2: { fontWeight: 700 },
      body1: { lineHeight: 1.7 },
      body2: { lineHeight: 1.65 },
      button: { fontWeight: 700, textTransform: 'none', letterSpacing: 0 },
      caption: { lineHeight: 1.55 },
      overline: {
        fontFamily: fonts.mono,
        fontWeight: 600,
        fontSize: '0.68rem',
        letterSpacing: '0.12em',
        lineHeight: 1.6,
        textTransform: 'uppercase',
      },
    },
    spacing: 8,
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: t.bg,
            color: t.ink,
            WebkitFontSmoothing: 'antialiased',
            fontFeatureSettings: '"palt" 1',
          },
          '::selection': { backgroundColor: alpha(t.accent, dark ? 0.32 : 0.2) },
          'a:focus-visible, button:focus-visible, [role="button"]:focus-visible, [tabindex]:focus-visible': {
            outline: 'none',
            boxShadow: focusRing,
          },
          '@media (prefers-reduced-motion: reduce)': {
            '*, *::before, *::after': { transitionDuration: '0.01ms !important', animationDuration: '0.01ms !important' },
          },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            backgroundColor: alpha(t.bg, 0.92),
            color: t.ink,
            backdropFilter: 'blur(10px)',
            border: 0,
            borderBottom: `1px solid ${t.rule}`,
            boxShadow: 'none',
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundImage: 'none',
            backgroundColor: dark ? t.sunken : '#efece5',
            border: 0,
            borderRight: `1px solid ${t.rule}`,
            boxShadow: 'none',
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: { backgroundImage: 'none' },
          rounded: { borderRadius: 6 },
          elevation0: { border: `1px solid ${t.rule}` },
          outlined: { borderColor: t.rule },
        },
      },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { borderRadius: 6, backgroundImage: 'none' } },
      },
      MuiCardActionArea: {
        styleOverrides: { focusHighlight: { backgroundColor: t.ink } },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 6,
            minHeight: 34,
            paddingInline: 14,
            boxShadow: 'none',
            '@media (max-width:899px)': { minHeight: 40 },
          },
          contained: { '&:hover': { boxShadow: 'none' } },
          containedPrimary: dark ? {} : { backgroundColor: t.ink, color: '#fffdf9', '&:hover': { backgroundColor: '#000' } },
          outlined: { borderColor: t.ruleStrong, '&:hover': { borderColor: t.ink, backgroundColor: alpha(t.ink, 0.04) } },
          outlinedPrimary: { color: t.ink },
          textPrimary: { color: dark ? t.accent : t.accent },
          sizeSmall: { minHeight: 30, paddingInline: 10 },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            borderRadius: 6,
            transition: 'background-color 120ms ease',
            '@media (max-width:899px)': { minWidth: 40, minHeight: 40 },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 4, height: 24 },
          label: { fontWeight: 600, fontSize: '0.74rem', paddingInline: 8 },
          outlined: { borderColor: t.rule, backgroundColor: 'transparent' },
          sizeSmall: { height: 22 },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            margin: '1px 8px',
            borderRadius: 5,
            minHeight: 36,
            paddingTop: 4,
            paddingBottom: 4,
            '&:hover': { backgroundColor: alpha(t.ink, dark ? 0.06 : 0.05) },
            '&.Mui-selected': {
              backgroundColor: dark ? alpha(t.ink, 0.08) : t.surface,
              boxShadow: `inset 0 0 0 1px ${t.rule}`,
              '& .MuiListItemIcon-root': { color: t.accent },
              '& .MuiListItemText-primary': { fontWeight: 800 },
              '&:hover': { backgroundColor: dark ? alpha(t.ink, 0.1) : t.surface },
            },
            '@media (max-width:899px)': { minHeight: 44 },
          },
        },
      },
      MuiListItemIcon: {
        styleOverrides: { root: { minWidth: 34, color: t.muted, '& .MuiSvgIcon-root': { fontSize: 19 } } },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 6,
            backgroundColor: t.surface,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: t.ruleStrong },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: t.ink },
            '&.Mui-focused': { boxShadow: focusRing },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: t.accent, borderWidth: 1 },
          },
        },
      },
      MuiTabs: {
        styleOverrides: {
          root: { minHeight: 40 },
          indicator: { height: 2, backgroundColor: t.accent },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 700,
            minHeight: 40,
            color: t.muted,
            '&.Mui-selected': { color: t.ink },
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: { borderRadius: 6, border: `1px solid ${t.rule}`, alignItems: 'flex-start' },
          standardInfo: { backgroundColor: dark ? alpha('#8cb4e0', 0.08) : '#eef2f4' },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 8,
            border: `1px solid ${t.rule}`,
            backgroundImage: 'none',
            backgroundColor: t.surface,
            boxShadow: dark ? '0 24px 80px rgba(0,0,0,.6)' : '0 24px 80px rgba(28,29,31,.22)',
            '@media (max-width:599px)': { maxWidth: 'calc(100vw - 20px)', margin: 10 },
          },
        },
      },
      MuiDialogTitle: { styleOverrides: { root: { fontWeight: 800 } } },
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: 6,
            border: `1px solid ${t.rule}`,
            boxShadow: dark ? '0 12px 36px rgba(0,0,0,.5)' : '0 12px 36px rgba(28,29,31,0.14)',
            maxWidth: 'calc(100vw - 16px)',
          },
        },
      },
      MuiPopover: {
        styleOverrides: { paper: { border: `1px solid ${t.rule}` } },
      },
      MuiBottomNavigation: {
        styleOverrides: {
          root: {
            backgroundColor: alpha(t.bg, 0.97),
            backdropFilter: 'blur(10px)',
            borderTop: `1px solid ${t.rule}`,
          },
        },
      },
      MuiBottomNavigationAction: {
        styleOverrides: {
          root: { minWidth: 0, color: t.faint, '&.Mui-selected': { color: t.ink } },
          label: { fontWeight: 700 },
        },
      },
      MuiLink: {
        defaultProps: { underline: 'hover' },
        styleOverrides: {
          root: {
            color: t.ink,
            textDecorationColor: t.ruleStrong,
            textUnderlineOffset: '0.18em',
            '&:hover': { color: t.accent, textDecorationColor: t.accent },
          },
        },
      },
      MuiDivider: { styleOverrides: { root: { borderColor: t.rule } } },
      MuiTooltip: {
        defaultProps: { arrow: true },
        styleOverrides: {
          tooltip: { backgroundColor: t.ink, color: t.bg, fontSize: 12, borderRadius: 4 },
          arrow: { color: t.ink },
        },
      },
      MuiLinearProgress: {
        styleOverrides: { root: { borderRadius: 2, backgroundColor: t.sunken } },
      },
    },
  });
};

export default getAppTheme;
