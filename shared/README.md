# @logic-gatt/theme

Shared **design tokens** (color scheme, spacing, radii, type scale) so the desktop
(Electrobun) and mobile (Expo) apps stay visually consistent. Tokens only — **no
shared components** (the two apps render to different targets: DOM vs React Native).

`tokens.ts` is the single source of truth. Edit values there and nowhere else.

## How each app consumes it

- **Mobile (Expo / Metro)** imports the values directly:
  ```ts
  import { colors, spacing } from '@logic-gatt/theme';
  ```
  Wired via `metro.config.js` (`watchFolders` + `extraNodeModules`) and a `tsconfig`
  path. See `logic-gatt-mobile-app/src/constants/theme.ts`.

- **Desktop (Electrobun / Vite)** styles with CSS custom properties, so its
  `src/mainview/theme.css` is **generated** from these tokens — run:
  ```
  bun shared/build-css.ts     # or: make gen-theme
  ```
  Every `palette` key becomes `--kebab-case` and every `aliases` entry becomes a
  `var(--target)` reference. The tokens are also importable in desktop JS via the
  `@logic-gatt/theme` Vite alias if needed.

## Wiring, not workspaces

There is no root workspace (desktop uses Bun, mobile uses npm), so each app resolves
this package via its own bundler alias — mirroring the desktop's existing
`@logic-gatt/shared` convention. `tokens.ts` has zero imports on purpose so both Metro
and Vite can treat it as plain data.

After editing `tokens.ts`, run `make gen-theme` to refresh the desktop CSS (the
generated `theme.css` is committed so the desktop builds without running the generator).
