// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// The @logic-gatt/theme design tokens live at <repo>/shared/tokens.ts — OUTSIDE
// this app's root. Metro can't hash files outside its server root when producing
// a release bundle (export:embed), and this repo is NOT an npm workspace (each
// app installs its own node_modules), so the standard monorepo config doesn't
// apply. Instead, mirror the tokens into an in-root generated file on every Metro
// run and resolve the package to it. shared/tokens.ts stays the single source of
// truth (it has no imports on purpose); the copy is disposable + git-ignored.
const sharedTokens = path.resolve(projectRoot, '..', 'shared', 'tokens.ts');
const generatedTokens = path.join(projectRoot, 'src', 'constants', 'theme-tokens.generated.ts');
fs.mkdirSync(path.dirname(generatedTokens), { recursive: true });
fs.writeFileSync(
  generatedTokens,
  '// AUTO-GENERATED from the repo-root shared/tokens.ts on every Metro run — do not edit.\n' +
    fs.readFileSync(sharedTokens, 'utf8'),
);

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@logic-gatt/theme') {
    return { type: 'sourceFile', filePath: generatedTokens };
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
