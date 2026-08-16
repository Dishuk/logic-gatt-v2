// Generates the desktop app's theme.css from the canonical tokens.
// Run with Bun:  bun shared/build-css.ts   (or `make gen-theme`).
//
// The desktop app styles with CSS custom properties (var(--bg-body)); this keeps
// those variables in lockstep with tokens.ts so the two apps can't drift.

import { writeFileSync } from 'node:fs';

import { aliases, palette, radius } from './tokens.ts';

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

const lines: string[] = [
  '/* AUTO-GENERATED from shared/tokens.ts — do not edit by hand.',
  '   Regenerate with:  bun shared/build-css.ts   (or `make gen-theme`) */',
  ':root {',
  '  /* Base palette */',
];

for (const [key, value] of Object.entries(palette)) {
  lines.push(`  --${kebab(key)}: ${value};`);
}

lines.push('', '  /* Semantic roles */');
for (const [key, target] of Object.entries(aliases)) {
  lines.push(`  --${kebab(key)}: var(--${kebab(target)});`);
}

lines.push('', '  /* Radius scale */');
for (const [key, value] of Object.entries(radius)) {
  lines.push(`  --radius-${key}: ${value}px;`);
}

// Tell the OS to render native controls (selects, checkboxes, scrollbars) dark.
lines.push('', '  color-scheme: dark;');

lines.push('}', '');

const out = new URL('../logic-gatt-desktop-app/src/mainview/theme.css', import.meta.url);
writeFileSync(out, lines.join('\n'));
console.log(`Wrote ${Object.keys(palette).length + Object.keys(aliases).length} variables to ${out.pathname}`);
