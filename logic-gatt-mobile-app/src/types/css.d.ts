// CSS imports are handled by the Metro/Expo bundler (NativeWind), not tsc. Declare
// them so `tsc --noEmit` stays clean.
declare module '*.css';
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
