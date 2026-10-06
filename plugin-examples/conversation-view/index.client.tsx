import type { PluginClientContext, PluginButtonRegistration } from "@getpaseo/plugin/client";
import type { PaseoAgent } from "@getpaseo/client";
import { StickyIcon, toggleSticky } from "./client/sticky-pill";
import { cleanupStickyMessages } from "./client/sticky-history";

export default function contribute(client: PluginClientContext) {
  const pills = new Map<string, PluginButtonRegistration>();
  let stopped = false;
  function register(agent: PaseoAgent) {
    if (!agent.workspaceId || agent.archivedAt) {
      pills.get(agent.id)?.remove();
      pills.delete(agent.id);
      return;
    }
    if (pills.has(agent.id)) return;
    pills.set(
      agent.id,
      client.addComposerPill({
        id: `sticky-${agent.id}`,
        workspaceId: agent.workspaceId,
        agentId: agent.id,
        button: {
          title: "吸顶提问",
          label: "吸顶提问",
          icon: StickyIcon,
          behavior: { kind: "action", onPress: () => toggleSticky(agent.id) },
        },
      }),
    );
  }
  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (stopped) return;
    if (update.kind === "upsert") register(update.agent);
    else {
      pills.get(update.agentId)?.remove();
      pills.delete(update.agentId);
    }
  });
  const listing = client.paseo.agents.list({ subscribe: {} });
  void listing
    .then((result) => {
      if (!stopped) for (const entry of result.entries) register(entry.agent);
      return undefined;
    })
    .catch((error: unknown) => console.warn("[Sticky message] Failed to list agents", error));
  return async () => {
    stopped = true;
    unsubscribe();
    for (const pill of pills.values()) pill.remove();
    cleanupStickyMessages();
    await listing.then((result) => result.subscription.release()).catch(() => {});
  };
}
