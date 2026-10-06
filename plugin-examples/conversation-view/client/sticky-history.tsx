import { useEffect, type RefObject } from "react";
import { Platform } from "react-native";
import { usePaseo } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PaseoApi, PaseoAgentTimelineHandle } from "@getpaseo/client";
import { PromptHistory } from "../shared/sticky-history";
import { getStickyViewport, installStickyMessages } from "./web";

type Page = Awaited<ReturnType<PaseoAgentTimelineHandle["refetch"]>>;
type Cursor = NonNullable<Page["startCursor"]>;

function createSession(timeline: PaseoAgentTimelineHandle) {
  const history = new PromptHistory();
  const listeners = new Set<() => void>();
  let cursor: Cursor | null = null;
  let older = true;
  let fetching = false;
  let disposed = false;
  let generation = 0;
  let epoch: string | undefined;
  const emit = () => listeners.forEach((listener) => listener());
  const fetchPage = async (tail = false) => {
    if (fetching || disposed || (!tail && !older)) return;
    fetching = true;
    const currentGeneration = generation;
    const pageCursor = tail ? null : cursor;
    let changed = false;
    try {
      const page = await timeline.refetch({
        direction: pageCursor ? "before" : "tail",
        ...(pageCursor ? { cursor: pageCursor } : {}),
        projection: "projected",
        limit: 200,
      });
      if (disposed || currentGeneration !== generation || page.error) return;
      if (epoch !== undefined && epoch !== page.epoch) history.clear();
      epoch = page.epoch;
      for (const entry of page.entries) history.add(entry.item, entry.timestamp, entry.seqStart);
      cursor = page.startCursor;
      older = page.hasOlder && cursor !== null;
      changed = true;
    } catch {
      // Leave the native chat usable when its connection is temporarily unavailable.
    } finally {
      fetching = false;
      if (!disposed && (changed || currentGeneration !== generation)) emit();
    }
  };
  const subscription = timeline.subscribe(({ event, ...update }) => {
    if (event.type === "replacement" || event.type === "subscription_restored") {
      generation += 1;
      epoch = event.type === "replacement" ? event.epoch : undefined;
      history.clear();
      cursor = null;
      older = true;
      void fetchPage(true);
      emit();
    } else if (event.type === "timeline" && "timestamp" in update && update.seq !== undefined) {
      if (update.epoch !== undefined && epoch !== undefined && update.epoch !== epoch) {
        generation += 1;
        history.clear();
        cursor = null;
        older = true;
      }
      epoch = update.epoch ?? epoch;
      history.add(event.item, update.timestamp, update.seq);
      // Only prompts change what the bar displays; don't repaint on every token.
      if (event.item.type === "user_message") emit();
    }
  });
  void subscription.ready.then(() => fetchPage(true)).catch(() => {});
  return {
    refs: 0,
    latest() {
      return history.latest();
    },
    resolve(rowId: string, messageId: string | null) {
      const prompt = history.resolve(rowId, messageId);
      if (!prompt) void fetchPage();
      return prompt;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      subscription();
      listeners.clear();
      history.clear();
    },
  };
}

const sessions = new WeakMap<PaseoApi, Map<string, ReturnType<typeof createSession>>>();
const viewports = new Map<unknown, { agentId: string; theme: PluginTheme; cleanup: () => void }>();

export function cleanupStickyMessages() {
  for (const viewport of viewports.values()) viewport.cleanup();
  viewports.clear();
}

export function useStickyMessage(anchor: RefObject<unknown>, agentId: string, theme: PluginTheme) {
  const paseo = usePaseo();
  useEffect(() => {
    if (Platform.OS !== "web" || !anchor.current) return;
    const viewport = getStickyViewport(anchor.current);
    if (!viewport) return;
    const existing = viewports.get(viewport);
    if (
      existing?.agentId === agentId &&
      existing.theme.colors.surface0 === theme.colors.surface0 &&
      existing.theme.colors.foreground === theme.colors.foreground &&
      existing.theme.colors.foregroundMuted === theme.colors.foregroundMuted &&
      existing.theme.colors.border === theme.colors.border
    )
      return;
    existing?.cleanup();
    let agents = sessions.get(paseo);
    if (!agents) {
      agents = new Map();
      sessions.set(paseo, agents);
    }
    let session = agents.get(agentId);
    if (!session) {
      session = createSession(paseo.agents.ref(agentId).timeline);
      agents.set(agentId, session);
    }
    session.refs += 1;
    const uninstall = installStickyMessages(
      anchor.current,
      session.resolve,
      {
        background: theme.colors.surface0,
        foreground: theme.colors.foreground,
        muted: theme.colors.foregroundMuted,
        border: theme.colors.border,
      },
      session.subscribe,
      () => {
        cleanup();
        viewports.delete(viewport);
      },
      session.latest,
    );
    let released = false;
    const cleanup = () => {
      if (released) return;
      released = true;
      uninstall();
      session.refs -= 1;
      if (session.refs === 0) {
        session.dispose();
        agents.delete(agentId);
      }
    };
    viewports.set(viewport, { agentId, theme, cleanup });
    // The viewport, not a virtualized answer row, owns the decoration and history.
  }, [anchor, agentId, paseo, theme]);
}
