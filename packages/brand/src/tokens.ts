/**
 * Covi design tokens. One restrained system for the video compositions, docs, and generated assets:
 * cobalt carries identity, charcoal carries text, the warm accent is reserved for small highlights.
 */
export const palette = {
  cobalt: '#3B5BFF',
  cobaltDeep: '#2A43D1',
  /** Cobalt lifted for dark backgrounds. */
  cobaltLight: '#6B84FF',
  sky: '#EAF0FF',
  charcoal: '#1F2430',
  graphite: '#4A5163',
  line: '#D9DEEA',
  paper: '#F8F9FB',
  white: '#FFFFFF',
  accent: '#FF9A4A',
  success: '#16A06A',
  danger: '#E5484D',
  addBg: '#E6F6EE',
  addFg: '#127A4B',
  delBg: '#FDECEC',
} as const;

export type ThemeName = 'light' | 'dark';

/** Token colors for highlighted code. */
export interface SyntaxColors {
  keyword: string;
  string: string;
  number: string;
  comment: string;
  fn: string;
  type: string;
  prop: string;
}

/** For code on the dark code panel (both themes). */
const darkSurfaceSyntax: SyntaxColors = {
  keyword: '#C792EA',
  string: '#A5E075',
  number: '#F9AE58',
  comment: '#7D8599',
  fn: '#82AAFF',
  type: '#FFCB6B',
  prop: '#89DDFF',
};

/** For code on light cards (API responses in the light theme): at least 4.5:1 on the diff tints. */
const lightSurfaceSyntax: SyntaxColors = {
  keyword: '#7A3FD1',
  string: palette.addFg,
  number: '#A1520B',
  comment: palette.graphite,
  fn: palette.cobaltDeep,
  type: '#8A6100',
  prop: palette.cobaltDeep,
};

export interface Theme {
  name: ThemeName;
  background: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  line: string;
  primary: string;
  primarySoft: string;
  accent: string;
  success: string;
  danger: string;
  codeBackground: string;
  codeText: string;
  codeMuted: string;
  addBackground: string;
  addText: string;
  delBackground: string;
  delText: string;
  captionBackground: string;
  captionText: string;
  shadow: string;
  /** Code on the code panel. */
  syntax: SyntaxColors;
  /** Code on the theme's own surfaces (cards). */
  surfaceSyntax: SyntaxColors;
  /** Added and removed lines on the theme's own surfaces. */
  surfaceAdd: string;
  surfaceDel: string;
}

export const themes: Record<ThemeName, Theme> = {
  light: {
    name: 'light',
    background: palette.paper,
    surface: palette.white,
    surfaceAlt: palette.sky,
    text: palette.charcoal,
    textMuted: palette.graphite,
    line: palette.line,
    primary: palette.cobalt,
    primarySoft: palette.sky,
    accent: palette.accent,
    success: palette.success,
    danger: palette.danger,
    codeBackground: '#161A23',
    codeText: '#E6E9F2',
    codeMuted: '#7D8599',
    addBackground: 'rgba(22, 160, 106, 0.18)',
    addText: '#7EE2B3',
    delBackground: 'rgba(229, 72, 77, 0.18)',
    delText: '#FF9EA1',
    captionBackground: 'rgba(31, 36, 48, 0.92)',
    captionText: palette.paper,
    shadow: '0 18px 48px rgba(31, 36, 48, 0.16), 0 2px 6px rgba(31, 36, 48, 0.08)',
    syntax: darkSurfaceSyntax,
    surfaceSyntax: lightSurfaceSyntax,
    surfaceAdd: palette.addBg,
    surfaceDel: palette.delBg,
  },
  dark: {
    name: 'dark',
    background: '#12151C',
    surface: '#1C212C',
    surfaceAlt: '#242B3A',
    text: '#EEF1F8',
    textMuted: '#A3AAB9',
    line: '#2F3646',
    primary: palette.cobaltLight,
    primarySoft: '#242B4A',
    accent: palette.accent,
    success: '#2CC489',
    danger: '#FF6B70',
    codeBackground: '#0D1016',
    codeText: '#E6E9F2',
    codeMuted: '#6E7689',
    addBackground: 'rgba(44, 196, 137, 0.16)',
    addText: '#7EE2B3',
    delBackground: 'rgba(255, 107, 112, 0.16)',
    delText: '#FF9EA1',
    captionBackground: 'rgba(8, 10, 14, 0.9)',
    captionText: '#F8F9FB',
    shadow: '0 18px 48px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.3)',
    syntax: darkSurfaceSyntax,
    surfaceSyntax: darkSurfaceSyntax,
    surfaceAdd: 'rgba(44, 196, 137, 0.16)',
    surfaceDel: 'rgba(255, 107, 112, 0.14)',
  },
};

export const typography = {
  sans: "'Inter Variable', Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
  mono: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as const;

export const motion = {
  /** The default scene transition (a fade) in seconds; consecutive scenes overlap by it. */
  transition: 0.45,
  /**
   * Each scene transition's length in seconds; a cut has none. All stay under 0.625 s, so the
   * scene before a transition ends at most 0.6 s after its line (see the video timeline).
   */
  transitions: { fade: 0.45, cut: 0, push: 0.5, wipe: 0.55, 'zoom-through': 0.6 },
  /** A capture's camera drift through its scene: a slow push-in of at most 2%, eased in and out. */
  drift: 0.02,
  /** The push-in once a visual has finished while its line continues, so it never holds still. */
  linger: 0.02,
  /** The hero's camera punch. */
  punch: 0.06,
  /** The hero's flash: how long it lasts (s) and its peak opacity. */
  flash: { seconds: 0.18, opacity: 0.35 },
} as const;
