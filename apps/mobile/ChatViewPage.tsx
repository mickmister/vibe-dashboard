import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadMessage,
} from '@assistant-ui/react-native';

const getTextFromMessage = (message: ThreadMessage | undefined) => {
  if (!message) return '';

  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
};

const echoChatModel: ChatModelAdapter = {
  async run({ messages }) {
    const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
    const text = getTextFromMessage(lastUserMessage) || 'Send a message and I will echo it back.';

    return {
      content: [{ type: 'text', text }],
      status: { type: 'complete', reason: 'stop' },
    };
  },
};

export const ChatViewPage = () => {
  const runtime = useLocalRuntime(echoChatModel);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoidingView}
      >
        <ThreadPrimitive.Root style={styles.page}>
          <ChatHeader />
          <View style={styles.threadBody}>
            <ThreadPrimitive.Empty>
              <EmptyThread />
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.MessagesFlatList
              autoScroll
              contentContainerStyle={styles.messageList}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.messages}
            >
              {({ message }) => <ChatMessage message={message} />}
            </ThreadPrimitive.MessagesFlatList>
            <RunningIndicator />
          </View>
          <ChatComposer />
        </ThreadPrimitive.Root>
      </KeyboardAvoidingView>
    </AssistantRuntimeProvider>
  );
};

const ChatHeader = () => (
  <View style={styles.header}>
    <View style={styles.headerStatusDot} />
    <View style={styles.headerCopy}>
      <Text style={styles.headerTitle}>Vibe chat</Text>
      <Text style={styles.headerSubtitle}>Local echo mode</Text>
    </View>
  </View>
);

const EmptyThread = () => (
  <View style={styles.emptyState}>
    <Text style={styles.emptyEyebrow}>Ready when you are</Text>
    <Text style={styles.emptyTitle}>Start a native chat</Text>
    <Text style={styles.emptyDescription}>
      This screen is powered by assistant-ui React Native primitives. For now, the assistant repeats your message back locally.
    </Text>
  </View>
);

const ChatMessage = ({ message }: { message: ThreadMessage }) => {
  const isUser = message.role === 'user';

  return (
    <MessagePrimitive.Root
      style={[
        styles.messageRow,
        isUser ? styles.userMessageRow : styles.assistantMessageRow,
      ]}
    >
      <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        <Text style={[styles.messageLabel, isUser ? styles.userLabel : styles.assistantLabel]}>
          {isUser ? 'You' : 'Assistant'}
        </Text>
        <MessagePrimitive.Content
          renderText={({ part }) => (
            <Text style={[styles.messageText, isUser ? styles.userMessageText : styles.assistantMessageText]}>
              {part.text}
            </Text>
          )}
          renderReasoning={({ part }) => (
            <Text style={styles.secondaryMessageText}>{part.text}</Text>
          )}
          renderToolCall={({ part }) => (
            <Text style={styles.secondaryMessageText}>Tool call: {part.toolName}</Text>
          )}
          renderData={({ part }) => (
            <Text style={styles.secondaryMessageText}>Data: {part.name}</Text>
          )}
          renderFile={({ part }) => (
            <Text style={styles.secondaryMessageText}>File: {part.filename ?? part.mimeType}</Text>
          )}
          renderImage={() => (
            <Text style={styles.secondaryMessageText}>Image attachment</Text>
          )}
          renderSource={({ part }) => (
            <Text style={styles.secondaryMessageText}>Source: {part.title ?? part.id}</Text>
          )}
        />
      </View>
    </MessagePrimitive.Root>
  );
};

const RunningIndicator = () => {
  const isRunning = useAuiState((state) => state.thread.isRunning);

  if (!isRunning) return null;

  return (
    <View style={styles.runningIndicator}>
      <Text style={styles.runningIndicatorText}>Assistant is responding…</Text>
    </View>
  );
};

const ChatComposer = () => (
  <ComposerPrimitive.Root style={styles.composerRoot}>
    <ComposerPrimitive.Input
      accessibilityLabel="Message input"
      multiline
      placeholder="Message Vibe…"
      placeholderTextColor="#7c8798"
      returnKeyType="send"
      style={styles.composerInput}
      submitMode="none"
      textAlignVertical="top"
    />
    <SendButton />
  </ComposerPrimitive.Root>
);

const SendButton = () => {
  const canSend = useAuiState((state) => state.thread.composer.canSend);

  return (
    <ComposerPrimitive.Send
      accessibilityLabel="Send message"
      disabled={!canSend}
      style={({ pressed }) => [
        styles.sendButton,
        !canSend && styles.sendButtonDisabled,
        pressed && canSend && styles.sendButtonPressed,
      ]}
    >
      <Text style={styles.sendButtonText}>Send</Text>
    </ComposerPrimitive.Send>
  );
};

const styles = StyleSheet.create({
  keyboardAvoidingView: {
    flex: 1,
  },
  page: {
    flex: 1,
    backgroundColor: '#0d1117',
  },
  header: {
    minHeight: 64,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#202938',
    backgroundColor: '#111827',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerStatusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#35d07f',
  },
  headerCopy: {
    flex: 1,
  },
  headerTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 2,
  },
  threadBody: {
    flex: 1,
    backgroundColor: '#0d1117',
  },
  messageList: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 20,
    gap: 12,
  },
  messages: {
    flex: 1,
  },
  emptyState: {
    marginHorizontal: 20,
    marginTop: 56,
    padding: 20,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#263142',
    backgroundColor: '#131a25',
  },
  emptyEyebrow: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  emptyTitle: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '800',
    marginTop: 10,
  },
  emptyDescription: {
    color: '#a7b1c2',
    fontSize: 16,
    lineHeight: 23,
    marginTop: 10,
  },
  messageRow: {
    width: '100%',
  },
  userMessageRow: {
    alignItems: 'flex-end',
  },
  assistantMessageRow: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '86%',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  userBubble: {
    backgroundColor: '#2563eb',
    borderBottomRightRadius: 8,
  },
  assistantBubble: {
    backgroundColor: '#182231',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#263142',
    borderBottomLeftRadius: 8,
  },
  messageLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  userLabel: {
    color: '#bfdbfe',
  },
  assistantLabel: {
    color: '#7dd3fc',
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
  },
  userMessageText: {
    color: '#ffffff',
  },
  assistantMessageText: {
    color: '#e5edf7',
  },
  secondaryMessageText: {
    color: '#a7b1c2',
    fontSize: 15,
    lineHeight: 21,
  },
  runningIndicator: {
    alignSelf: 'flex-start',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 999,
    backgroundColor: '#172033',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  runningIndicatorText: {
    color: '#9fb0c7',
    fontSize: 13,
  },
  composerRoot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#202938',
    backgroundColor: '#111827',
  },
  composerInput: {
    flex: 1,
    minHeight: 48,
    maxHeight: 132,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2a3547',
    backgroundColor: '#0d1117',
    color: '#f8fafc',
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  sendButton: {
    minWidth: 64,
    minHeight: 48,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#38bdf8',
    paddingHorizontal: 14,
  },
  sendButtonDisabled: {
    opacity: 0.42,
  },
  sendButtonPressed: {
    opacity: 0.78,
  },
  sendButtonText: {
    color: '#06111f',
    fontSize: 16,
    fontWeight: '800',
  },
});
