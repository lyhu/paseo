import { useEffect, useRef, useState, useCallback } from "react";
import { usePaseo } from "@getpaseo/plugin/client";
import type { PaseoAgentTimelineHandle, PaseoAgentTimelineEvent } from "@getpaseo/client";
import { mergeRows, type ReaderRow } from "../shared/model";

interface ReaderState {
  rows: ReaderRow[];
  loading: boolean;
  loadingOlder: boolean;
  hasOlder: boolean;
  error: string | null;
}
const emptyState: ReaderState = {
  rows: [],
  loading: true,
  loadingOlder: false,
  hasOlder: false,
  error: null,
};

// The SDK is the transport port; React only subscribes to the reader's snapshots.
export function createTimelineReader(
  timeline: Pick<PaseoAgentTimelineHandle, "refetch" | "subscribe">,
  onChange: (state: ReaderState) => void,
) {
  let disposed = false;
  let generation = 0;
  let epoch: string | null = null;
  let observedEpoch: string | null = null;
  let state: ReaderState = { ...emptyState };
  const buffered = new Map<string, ReaderRow[]>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let initialPending = true;
  let unsubscribe: ReturnType<PaseoAgentTimelineHandle["subscribe"]> | null = null;
  const publishState = (changes: Partial<ReaderState>) => {
    if (disposed) return;
    state = { ...state, ...changes };
    onChange(state);
  };
  const fail = (error: unknown) =>
    publishState({ error: error instanceof Error ? error.message : String(error) });
  const publish = () => {
    timer = null;
    if (disposed || initialPending || epoch === null) return;
    const incoming = buffered.get(epoch) ?? [];
    buffered.delete(epoch);
    if (incoming.length) publishState({ rows: mergeRows(state.rows, incoming) });
  };
  const isCurrent = (request: number) => !disposed && request === generation;
  const sameEpoch = (
    page: Awaited<ReturnType<PaseoAgentTimelineHandle["refetch"]>>,
    expected: string | null,
  ) => page.epoch === expected && !page.reset && !page.staleCursor;
  const resumeCursor = () =>
    epoch !== null && state.rows.length ? { epoch, seq: state.rows.at(-1)!.seq } : undefined;
  const crossedEpoch = (expected: string) =>
    observedEpoch !== null && buffered.has(observedEpoch) && observedEpoch !== expected;
  const loadTail = async (resume = false) => {
    const request = ++generation;
    initialPending = true;
    publishState({ loading: true, error: null });
    try {
      const cursor = resume ? resumeCursor() : undefined;
      let page = await timeline.refetch({
        projection: "canonical",
        limit: 300,
        ...(cursor ? { direction: "after", cursor } : {}),
      });
      if (!isCurrent(request)) return;
      if (page.error) throw new Error(page.error);
      const fetchedEpoch = page.epoch;
      const hasOlder = page.hasOlder;
      const retain = resume && sameEpoch(page, epoch);
      if (resume && !retain) {
        epoch = null;
        publishState({ rows: [], hasOlder: false });
      }
      const toRows = (entries: typeof page.entries): ReaderRow[] =>
        entries.map((entry) => ({
          seq: entry.seqStart,
          item: entry.item,
          timestamp: entry.timestamp,
          turnId: entry.turnId,
        }));
      let fetched = toRows(page.entries);
      while (page.hasNewer && page.endCursor) {
        page = await timeline.refetch({
          direction: "after",
          projection: "canonical",
          limit: 300,
          cursor: page.endCursor,
        });
        if (!isCurrent(request)) return;
        if (page.error) throw new Error(page.error);
        if (!sameEpoch(page, fetchedEpoch)) {
          void loadTail();
          return;
        }
        fetched = mergeRows(fetched, toRows(page.entries));
      }
      if (crossedEpoch(fetchedEpoch)) {
        void loadTail();
        return;
      }
      epoch = fetchedEpoch;
      const rows = mergeRows(
        retain ? state.rows : [],
        mergeRows(fetched, buffered.get(epoch) ?? []),
      );
      buffered.clear();
      observedEpoch = null;
      initialPending = false;
      publishState({
        rows,
        hasOlder: retain ? state.hasOlder : hasOlder,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (isCurrent(request)) {
        initialPending = false;
        fail(error);
        publishState({ loading: false });
        publish();
      }
    }
  };
  const receive = (update: PaseoAgentTimelineEvent) => {
    if (disposed) return;
    const event = update.event;
    if (event.type === "replacement") {
      observedEpoch = event.epoch;
      buffered.clear();
      epoch = null;
      // A replacement invalidates the old timeline even if the next fetch fails.
      updateStateForReplacement();
      void loadTail();
      return;
    }
    if (event.type === "subscription_restored") {
      void loadTail(true);
      return;
    }
    if (event.type === "error") {
      fail(event.error);
      return;
    }
    if (
      event.type !== "timeline" ||
      !("seq" in update) ||
      update.seq === undefined ||
      !("epoch" in update) ||
      update.epoch === undefined
    )
      return;
    observedEpoch = update.epoch;
    const incoming = buffered.get(update.epoch) ?? [];
    incoming.push({
      seq: update.seq,
      item: event.item,
      timestamp: update.timestamp,
      turnId: event.turnId,
    });
    buffered.set(update.epoch, incoming);
    if (!initialPending && update.epoch !== epoch) {
      epoch = null;
      updateStateForReplacement();
      void loadTail();
    } else if (!initialPending && timer === null) timer = setTimeout(publish, 80);
  };
  const updateStateForReplacement = () => publishState({ rows: [], hasOlder: false });
  const reconnect = () => {
    if (disposed) return;
    // Cancel outstanding pages before establishing the new observation.
    generation += 1;
    initialPending = true;
    unsubscribe?.();
    publishState({ loading: true, error: null });
    const subscription = timeline.subscribe(receive);
    unsubscribe = subscription;
    void subscription.ready
      .then(() => {
        if (!disposed && unsubscribe === subscription) return loadTail(epoch !== null);
        return undefined;
      })
      .catch((error) => {
        if (!disposed && unsubscribe === subscription) {
          initialPending = false;
          fail(error);
          publishState({ loading: false });
        }
      });
  };
  const loadOlder = async () => {
    if (disposed || state.loadingOlder || initialPending || epoch === null || !state.rows.length)
      return false;
    const request = generation;
    publishState({ loadingOlder: true, error: null });
    try {
      const page = await timeline.refetch({
        direction: "before",
        projection: "canonical",
        cursor: { epoch, seq: state.rows[0]!.seq },
        limit: 300,
      });
      if (disposed || request !== generation) return false;
      if (page.error) throw new Error(page.error);
      if (!sameEpoch(page, epoch)) {
        epoch = null;
        publishState({ rows: [], hasOlder: false });
        await loadTail();
        return false;
      }
      publishState({
        rows: mergeRows(
          state.rows,
          page.entries.map((entry) => ({
            seq: entry.seqStart,
            item: entry.item,
            timestamp: entry.timestamp,
            turnId: entry.turnId,
          })),
        ),
        hasOlder: page.hasOlder,
      });
      return page.entries.length > 0;
    } catch (error) {
      if (request === generation) fail(error);
      return false;
    } finally {
      publishState({ loadingOlder: false });
    }
  };
  reconnect();
  return {
    loadOlder,
    reconnect,
    dispose() {
      disposed = true;
      generation += 1;
      unsubscribe?.();
      if (timer !== null) clearTimeout(timer);
    },
  };
}

export function useTimeline(agentId: string) {
  const paseo = usePaseo();
  const [state, setState] = useState<ReaderState>(emptyState);
  const reader = useRef<ReturnType<typeof createTimelineReader> | null>(null);
  useEffect(() => {
    setState({ ...emptyState });
    const current = createTimelineReader(paseo.agents.ref(agentId).timeline, setState);
    reader.current = current;
    return () => {
      current.dispose();
      reader.current = null;
    };
  }, [agentId, paseo]);
  const loadOlder = useCallback(() => reader.current?.loadOlder() ?? Promise.resolve(false), []);
  const reconnect = useCallback(() => reader.current?.reconnect(), []);
  return { ...state, loadOlder, reconnect };
}
