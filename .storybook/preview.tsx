import type { Decorator, Preview } from '@storybook/react-vite';
import { HeroUIProvider } from '@heroui/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import '../src/styles';

if (typeof document !== 'undefined') {
  document.documentElement.classList.add('dark');
}

const withAppProviders: Decorator = (Story) => {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: Number.POSITIVE_INFINITY,
          },
          mutations: {
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <HeroUIProvider>
        <div
          className="dark min-h-screen bg-neutral-950 text-neutral-100"
          style={{ minHeight: '100vh' }}
        >
          <Story />
        </div>
      </HeroUIProvider>
    </QueryClientProvider>
  );
};

const preview: Preview = {
  decorators: [withAppProviders],
  parameters: {
    layout: 'fullscreen',
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: 'todo',
    },
  },
};

export default preview;
