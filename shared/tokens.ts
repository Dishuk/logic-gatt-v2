// Canonical design tokens shared by the desktop (Electrobun) and mobile (Expo) apps.
// SINGLE SOURCE OF TRUTH — edit color/scale values here only.
//
//  - Desktop consumes these as CSS custom properties: `theme.css` is GENERATED
//    from this file (run `bun shared/build-css.ts`, or `make gen-theme`).
//  - Mobile imports the values directly (see logic-gatt-mobile-app constants/theme.ts).
//
// This module has NO imports on purpose, so both Metro and Vite can consume it as data.

/**
 * Raw color values. Each camelCase key maps 1:1 to a CSS custom property
 * (`bgButtonHover` -> `--bg-button-hover`).
 *
 * One cool-slate neutral ramp (GitHub Primer dark) — elevation ascends with
 * lightness: inset < canvas < surface < raised. The accent/syntax hues are the
 * only saturated colors.
 */
export const palette = {
  // Backgrounds (elevation ascending)
  bgDarkest: '#010409', // inset wells: inputs, terminal, code blocks
  bgBody: '#0d1117', // app canvas / panel background
  bgSurface: '#161b22', // raised surfaces: cards, top bar
  bgDark: '#1c2128', // headers, nested rows, menus, modals, hover
  bgButton: '#21262d',
  bgButtonHover: '#2d333b',
  bgTopbar: '#161b22',
  bgError: '#1c0c0c',
  bgErrorBtn: '#3d1117',
  bgErrorBtnHover: '#4d1a1f',

  // Borders
  borderPrimary: '#30363d',
  borderFocus: '#484f58',
  borderTopbar: '#30363d',
  borderErrorTransparent: '#f8514950',

  // Text
  textPrimary: '#e6edf3',
  textSecondary: '#8b949e',
  textContent: '#c9d1d9',
  textMuted: '#6e7681', // real muted text (≈4.6:1 on canvas) — not a border color

  // Accents
  accentBlue: '#58a6ff',
  accentBlueLight: '#79c0ff',
  accentBlueTransparent: '#388bfd26', // selected-item tint
  accentGreenDark: '#238636',
  accentRed: '#f85149',
  accentRedLight: '#ff7b72',
  accentPurple: '#d2a8ff',

  // Status (connection/liveness states — used inline on desktop, per-status on mobile)
  statusGreen: '#34d399',
  statusAmber: '#f59e0b',

  // Overlays
  overlayBg: 'rgba(0, 0, 0, 0.7)',
  modalShadow: 'rgba(0, 0, 0, 0.5)',
} as const;

/** Semantic roles that alias a `palette` key. Emitted as `var(--target)` in CSS. */
export const aliases = {
  colorSuccess: 'accentGreenDark',
  colorError: 'accentRed',
  colorLink: 'accentBlue',
  colorAccent: 'accentBlue',
  colorKeyword: 'accentRedLight',
  colorFunction: 'accentPurple',
  colorType: 'accentBlueLight',
  bgMedium: 'bgSurface',
  bgHover: 'bgDark',
  scrollbarThumb: 'borderPrimary',
  scrollbarThumbHover: 'borderFocus',
  toggleBg: 'borderPrimary',
  toggleBgActive: 'accentGreenDark',
  toggleKnob: 'borderFocus',
  toggleKnobActive: 'textPrimary',
} as const;

export type PaletteKey = keyof typeof palette;
export type AliasKey = keyof typeof aliases;

/** Flat, fully-resolved color map (aliases resolved to hex) for JS / React Native consumers. */
export const colors = {
  ...palette,
  ...(Object.fromEntries(
    Object.entries(aliases).map(([key, target]) => [key, palette[target as PaletteKey]]),
  ) as { [K in AliasKey]: string }),
} as const;

/** Spacing scale (px / RN density-independent units). */
export const spacing = { half: 2, one: 4, two: 8, three: 16, four: 24, five: 32, six: 64 } as const;

/** Corner radii. */
export const radius = { sm: 4, md: 6, lg: 10 } as const;

/** Font size scale. */
export const fontSize = { xs: 11, sm: 12, base: 13, md: 14, lg: 16, xl: 22 } as const;

export type Colors = typeof colors;
