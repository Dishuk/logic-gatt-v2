// Electrobun's published source imports an optional `three` (WebGPU) dependency
// without bundled type declarations. We don't use that feature; silence the
// implicit-any TS7016 it raises when tsc walks electrobun's .ts source.
declare module "three";
