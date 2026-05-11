import { useEffect } from 'react';
import { recordUserActivity } from '../lib/inactivity-client';

export function useInactivityActivity() {
  useEffect(() => {
    void recordUserActivity('window_focus', 'window', { force: true });

    const handleFocus = () => {
      void recordUserActivity('window_focus', 'window', { force: true });
    };

    const handlePointerDown = () => {
      void recordUserActivity('pointer_down', 'window');
    };

    const handleKeyDown = () => {
      void recordUserActivity('key_down', 'window');
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('pointerdown', handlePointerDown, {
      capture: true,
      passive: true,
    });
    window.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, []);
}
