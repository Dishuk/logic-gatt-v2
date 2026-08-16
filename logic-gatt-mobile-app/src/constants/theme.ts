import '@/global.css';

import { Platform } from 'react-native';

import { colors, spacing } from '@logic-gatt/theme';

/**
 * Colors come from the shared @logic-gatt/theme package (single source of truth,
 * shared with the desktop app). A few friendlier aliases are added on top for
 * this app's use. Desktop is dark-only, so the mobile app follows suit.
 */
export const theme = {
  ...colors,
  green: colors.accentGreenDark,
  greenBright: colors.statusGreen,
  amber: colors.statusAmber,
  red: colors.accentRed,
  redLight: colors.accentRedLight,
  purple: colors.accentPurple,
  borderError: colors.accentRed,
} as const;

export const Spacing = spacing;

export const Fonts = Platform.select({
  ios: { sans: 'system-ui', mono: 'ui-monospace' },
  default: { sans: 'normal', mono: 'monospace' },
  web: { sans: 'var(--font-display)', mono: 'var(--font-mono)' },
})!;
