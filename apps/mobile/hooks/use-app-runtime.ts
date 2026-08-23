import {
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadMessage,
} from "@assistant-ui/react-native";

const getTextFromMessage = (message: ThreadMessage | undefined) => {
  if (!message) return "";

  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
};

const mockChatModel: ChatModelAdapter = {
  async run({ messages }) {
    const lastUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === "user");
    const text = getTextFromMessage(lastUserMessage) || "What would you like help with?";

    return {
      content: [
        {
          type: "text",
          text: [
            `Mock response for: ${text}`,
            "",
            "This is a local stand-in for the real assistant backend. Once the backend is connected, this example UI can keep the same assistant-ui runtime boundary.",
          ].join("\n"),
        },
      ],
      status: { type: "complete", reason: "stop" },
    };
  },
};

export function useAppRuntime() {
  return useLocalRuntime(mockChatModel);
}
