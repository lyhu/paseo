import type { PluginServerContext } from "@getpaseo/plugin/server";
import { stopAgent } from "./server/stop";
import { stopConversation } from "./shared/stop";

export default function contribute(server: PluginServerContext) {
  server.handle(stopConversation, ({ agentId }, { paseo }) => stopAgent(agentId, paseo));
  return () => {};
}
