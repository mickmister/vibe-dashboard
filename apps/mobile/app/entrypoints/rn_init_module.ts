import springboard from 'springboard';

export default springboard.entrypoint(async () => {
  // The native host owns only the React Native <-> WebView transport for Vibe.
  // Browser/WebView modules are registered by app_springboard_entrypoint and are
  // either bundled into apps/mobile/assets/web or loaded remotely from the site.
});
