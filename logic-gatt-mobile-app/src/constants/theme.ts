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
