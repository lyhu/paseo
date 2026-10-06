import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ConversationPanel } from "./client/panel";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "reader",
    title: "对话视图",
    icon: "BookOpenText",
    context: "agent",
    Component: ConversationPanel,
  });
  client.addCommandCenterItem({
    id: "open-reader",
    title: "打开对话视图",
    icon: "BookOpenText",
    context: "agent",
    onSelect({ openPanel }) {
      openPanel("reader");
    },
  });
  client.addSlashCommand({
    name: "reader",
    description: "打开当前 agent 的对话视图",
    argumentHint: "",
    context: "agent",
    onSubmit({ openPanel }) {
      openPanel("reader");
    },
  });
  return () => {};
}
