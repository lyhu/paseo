import type { PluginClientContext } from "@getpaseo/plugin/client";
import { NativeAnswer, NativeThinking, NativeTool } from "./client/native-renderers";
import {
  answerSchema,
  thinkingSchema,
  toolSchema,
  transformAnswer,
  transformThinking,
  transformTool,
} from "./shared/native";

export default function contribute(client: PluginClientContext) {
  client.addTimelineTransformer({
    id: "native-answer",
    query: { itemType: "assistant_message" },
    transform: transformAnswer,
  });
  client.addTimelineTransformer({
    id: "native-thinking",
    query: { itemType: "reasoning" },
    transform: transformThinking,
  });
  client.addTimelineTransformer({
    id: "native-tool",
    query: { itemType: "tool_call" },
    transform: transformTool,
  });
  client.addTimelineRenderer({
    kind: "conversation-answer",
    version: 1,
    schema: answerSchema,
    Component: NativeAnswer,
  });
  client.addTimelineRenderer({
    kind: "conversation-thinking",
    version: 1,
    schema: thinkingSchema,
    Component: NativeThinking,
  });
  client.addTimelineRenderer({
    kind: "conversation-tool",
    version: 1,
    schema: toolSchema,
    Component: NativeTool,
  });
  return () => {};
}
