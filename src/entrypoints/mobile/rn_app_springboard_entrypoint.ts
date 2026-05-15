import springboard from 'springboard';

export default springboard.entrypoint(async () => {
  // The native host owns only the React Native <-> WebView transport for Vibe.
  // Browser/WebView modules are registered by app_springboard_entrypoint and are
  // bundled separately into apps/mobile/assets/web. Keeping this entrypoint
  // native-only prevents Metro/Hermes from parsing browser/Vite-only modules
  // such as import.meta.hot during release builds.
});
