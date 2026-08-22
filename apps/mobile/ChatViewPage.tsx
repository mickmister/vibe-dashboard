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
    <View style={styles.headerMark}>
      <Text style={styles.headerMarkText}>V</Text>
    </View>
    <View style={styles.headerCopy}>
      <Text style={styles.headerTitle}>Vibe chat</Text>
      <Text style={styles.headerSubtitle}>Native assistant workspace</Text>
    </View>
  </View>
);

const EmptyThread = () => (
  <View style={styles.emptyState}>
    <Text style={styles.emptyEyebrow}>Local echo mode</Text>
    <Text style={styles.emptyTitle}>What should Vibe work on?</Text>
    <Text style={styles.emptyDescription}>
      Send a prompt to exercise the native assistant thread. Your message stays centered in a workspace card, and the agent response mirrors it locally for now.
    </Text>
  </View>
);

const ChatMessage = ({ message }: { message: ThreadMessage }) => {
  const isUser = message.role === 'user';

  return (
    <MessagePrimitive.Root style={styles.messageRow}>
      <View style={styles.messageColumn}>
        {isUser ? <UserMessageCard /> : <AssistantMessageBlock />}
      </View>
    </MessagePrimitive.Root>
  );
};

const UserMessageCard = () => (
  <View style={styles.userCard}>
    <View style={styles.cardHeader}>
      <Text style={styles.cardKicker}>You</Text>
      <View style={styles.userCardPill}>
        <Text style={styles.userCardPillText}>Prompt</Text>
      </View>
    </View>
    <MessagePrimitive.Content
      renderText={({ part }) => (
        <Text style={styles.userMessageText}>
          {part.text}
        </Text>
      )}
      renderReasoning={({ part }) => (
        <Text style={styles.userSecondaryMessageText}>{part.text}</Text>
      )}
      renderToolCall={({ part }) => (
        <Text style={styles.userSecondaryMessageText}>Tool call: {part.toolName}</Text>
      )}
      renderData={({ part }) => (
        <Text style={styles.userSecondaryMessageText}>Data: {part.name}</Text>
      )}
      renderFile={({ part }) => (
        <Text style={styles.userSecondaryMessageText}>File: {part.filename ?? part.mimeType}</Text>
      )}
      renderImage={() => (
        <Text style={styles.userSecondaryMessageText}>Image attachment</Text>
      )}
      renderSource={({ part }) => (
        <Text style={styles.userSecondaryMessageText}>Source: {part.title ?? part.id}</Text>
      )}
    />
  </View>
);

const AssistantMessageBlock = () => (
  <View style={styles.assistantBlock}>
    <View style={styles.assistantRule} />
    <View style={styles.assistantContent}>
      <Text style={styles.assistantLabel}>Vibe</Text>
      <MessagePrimitive.Content
        renderText={({ part }) => (
          <Text style={styles.assistantMessageText}>
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
  </View>
);

const RunningIndicator = () => {
  const isRunning = useAuiState((state) => state.thread.isRunning);

  if (!isRunning) return null;

  return (
    <View style={styles.runningIndicator}>
      <View style={styles.runningDot} />
      <Text style={styles.runningIndicatorText}>Vibe is working…</Text>
    </View>
  );
};

const ChatComposer = () => (
  <View style={styles.composerShell}>
    <ComposerPrimitive.Root style={styles.composerRoot}>
      <ComposerPrimitive.Input
        accessibilityLabel="Message input"
        multiline
        placeholder="Ask Vibe to do something…"
        placeholderTextColor="#78828f"
        returnKeyType="send"
        style={styles.composerInput}
        submitMode="none"
        textAlignVertical="top"
      />
      <SendButton />
    </ComposerPrimitive.Root>
  </View>
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
    backgroundColor: '#f4f1ea',
  },
  header: {
    minHeight: 66,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ded8ce',
    backgroundColor: '#fbfaf7',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerMark: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1c1b18',
  },
  headerMarkText: {
    color: '#f8f4ec',
    fontSize: 18,
    fontWeight: '800',
  },
  headerCopy: {
    flex: 1,
  },
  headerTitle: {
    color: '#1f2933',
    fontSize: 18,
    fontWeight: '800',
  },
  headerSubtitle: {
    color: '#69727d',
    fontSize: 13,
    marginTop: 2,
  },
  threadBody: {
    flex: 1,
    backgroundColor: '#f4f1ea',
  },
  messageList: {
    flexGrow: 1,
    paddingHorizontal: 14,
    paddingBottom: 22,
    paddingTop: 18,
    gap: 18,
  },
  messages: {
    flex: 1,
  },
  emptyState: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    marginTop: 52,
    padding: 22,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd5ca',
    backgroundColor: '#fbfaf7',
  },
  emptyEyebrow: {
    color: '#8b5f2b',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  emptyTitle: {
    color: '#20242a',
    fontSize: 25,
    fontWeight: '800',
    lineHeight: 31,
    marginTop: 10,
  },
  emptyDescription: {
    color: '#5f6873',
    fontSize: 16,
    lineHeight: 24,
    marginTop: 10,
  },
  messageRow: {
    width: '100%',
  },
  messageColumn: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  userCard: {
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d9cfc1',
    backgroundColor: '#fffdf8',
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: '#362c1f',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 2,
  },
  cardHeader: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  cardKicker: {
    color: '#7a6652',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  userCardPill: {
    minHeight: 24,
    borderRadius: 999,
    backgroundColor: '#efe7db',
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  userCardPillText: {
    color: '#72502c',
    fontSize: 12,
    fontWeight: '800',
  },
  userMessageText: {
    color: '#252a31',
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '500',
  },
  userSecondaryMessageText: {
    color: '#837568',
    fontSize: 15,
    lineHeight: 22,
  },
  assistantBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 4,
  },
  assistantRule: {
    width: 3,
    minHeight: 42,
    borderRadius: 999,
    backgroundColor: '#c7b79f',
    marginTop: 4,
  },
  assistantContent: {
    flex: 1,
    paddingRight: 4,
  },
  assistantLabel: {
    color: '#78644d',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  assistantMessageText: {
    color: '#2d333b',
    fontSize: 16,
    lineHeight: 25,
  },
  secondaryMessageText: {
    color: '#7b8794',
    fontSize: 15,
    lineHeight: 22,
  },
  runningIndicator: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 640,
    minHeight: 44,
    marginBottom: 10,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  runningDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#9b6b34',
  },
  runningIndicatorText: {
    color: '#7a6652',
    fontSize: 14,
    fontWeight: '700',
  },
  composerShell: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ded8ce',
    backgroundColor: '#fbfaf7',
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 10,
  },
  composerRoot: {
    width: '100%',
    maxWidth: 640,
    minHeight: 60,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d7cec0',
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 132,
    color: '#1f2933',
    fontSize: 16,
    lineHeight: 23,
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  sendButton: {
    minWidth: 64,
    minHeight: 44,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f2933',
    paddingHorizontal: 14,
  },
  sendButtonDisabled: {
    backgroundColor: '#d7d0c6',
  },
  sendButtonPressed: {
    opacity: 0.78,
  },
  sendButtonText: {
    color: '#fffaf0',
    fontSize: 15,
    fontWeight: '800',
  },
});
