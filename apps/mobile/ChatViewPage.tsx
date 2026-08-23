import React from 'react';
import { AssistantRuntimeProvider } from '@assistant-ui/react-native';
import { Thread } from './components/assistant-ui/thread';
import { useAppRuntime } from './hooks/use-app-runtime';

export const ChatViewPage = () => {
  const runtime = useAppRuntime();

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  );
};
