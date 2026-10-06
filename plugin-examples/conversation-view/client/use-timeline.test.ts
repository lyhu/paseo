import { describe, expect, it } from "vitest";
import type { PaseoAgentTimelineHandle, PaseoAgentTimelineEvent } from "@getpaseo/client";
import { createTimelineReader } from "./use-timeline";

type Page = Awaited<ReturnType<PaseoAgentTimelineHandle["refetch"]>>;
type Options = Parameters<PaseoAgentTimelineHandle["refetch"]>[0];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
// A typed in-memory transport gives explicit control of observation/page ordering.
class Timeline implements Pick<PaseoAgentTimelineHandle, "refetch" | "subscribe"> {
  requests: { options: Options; result: ReturnType<typeof deferred<Page>> }[] = [];
  observations: {
    handler: (update: PaseoAgentTimelineEvent) => void;
    ready: ReturnType<typeof deferred<void>>;
    active: boolean;
  }[] = [];
  refetch(options?: Options) {
    const result = deferred<Page>();
    this.requests.push({ options, result });
    return result.promise;
  }
  subscribe(handler: (update: PaseoAgentTimelineEvent) => void) {
    const observation = { handler, ready: deferred<void>(), active: true };
    this.observations.push(observation);
    return Object.assign(
      () => {
        observation.active = false;
      },
      {
        ready: observation.ready.promise,
        subscriptionId: "subscription",
        release: async () => {
          observation.active = false;
        },
      },
    );
  }
  emit(update: PaseoAgentTimelineEvent) {
    for (const observation of this.observations)
      if (observation.active) observation.handler(update);
  }
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function page(seqs: number[], overrides: Partial<Page> = {}): Page {
  return {
    requestId: "request",
    agentId: "agent",
    agent: null,
    reset: false,
    staleCursor: false,
    gap: false,
    error: null,
    window: { minSeq: 1, maxSeq: 12, nextSeq: 13 },
    epoch: "epoch-1",
    projection: "canonical",
    direction: "tail",
    entries: seqs.map((seq) => ({
      provider: "codex",
      sourceSeqRanges: [{ startSeq: seq, endSeq: seq }],
      collapsed: ["identity"],
      seqStart: seq,
      seqEnd: seq,
      timestamp: "2026-10-06T00:00:00Z",
      turnId: "turn-1",
      item: { type: "assistant_message", messageId: "answer", text: String(seq) },
    })),
    hasOlder: true,
    hasNewer: false,
    startCursor: seqs.length ? { epoch: "epoch-1", seq: seqs[0]! } : null,
    endCursor: seqs.length ? { epoch: "epoch-1", seq: seqs.at(-1)! } : null,
    ...overrides,
  };
}
function live(seq: number, epoch = "epoch-1"): PaseoAgentTimelineEvent {
  return {
    agentId: "agent",
    epoch,
    seq,
    timestamp: "2026-10-06T00:00:00Z",
    event: {
      type: "timeline",
      provider: "codex",
      turnId: "turn-1",
      item: { type: "assistant_message", text: String(seq), messageId: "answer" },
    },
  };
}
function reader() {
  const transport = new Timeline();
  let state: Parameters<Parameters<typeof createTimelineReader>[1]>[0];
  const controller = createTimelineReader(transport, (next) => {
    state = next;
  });
  return {
    transport,
    controller,
    get state() {
      return state;
    },
  };
}
async function start(context: ReturnType<typeof reader>, seqs = [10]) {
  context.transport.observations[0]!.ready.resolve();
  await flush();
  context.transport.requests[0]!.result.resolve(page(seqs));
  await flush();
}

describe("timeline reader", () => {
  it("observes before fetching and keeps live entries arriving before ready or snapshot", async () => {
    const context = reader();
    try {
      expect(context.transport.requests).toEqual([]);
      context.transport.emit(live(11));
      context.transport.observations[0]!.ready.resolve();
      await flush();
      context.transport.emit(live(12));
      context.transport.requests[0]!.result.resolve(page([10, 11]));
      await flush();
      expect(context.state.rows.map((r) => r.seq)).toEqual([10, 11, 12]);
      expect(context.state.loading).toBe(false);
    } finally {
      context.controller.dispose();
    }
  });
  it("retains loaded history across restored subscriptions and explicit reconnect", async () => {
    const context = reader();
    try {
      await start(context);
      const older = context.controller.loadOlder();
      context.transport.requests[1]!.result.resolve(page([1, 2], { hasOlder: false }));
      expect(await older).toBe(true);
      context.transport.emit({
        agentId: "agent",
        subscriptionId: "subscription",
        event: { type: "subscription_restored" },
      });
      expect(context.transport.requests[2]!.options?.cursor).toEqual({ epoch: "epoch-1", seq: 10 });
      context.transport.requests[2]!.result.resolve(page([11]));
      await flush();
      expect(context.state.rows.map((r) => r.seq)).toEqual([1, 2, 10, 11]);
      expect(context.state.hasOlder).toBe(false);
      context.controller.reconnect();
      context.transport.observations[1]!.ready.resolve();
      await flush();
      expect(context.transport.requests[3]!.options?.cursor).toEqual({ epoch: "epoch-1", seq: 11 });
      context.transport.requests[3]!.result.resolve(page([12]));
      await flush();
      expect(context.state.rows.map((r) => r.seq)).toEqual([1, 2, 10, 11, 12]);
      expect(context.transport.observations.map((o) => o.active)).toEqual([false, true]);
    } finally {
      context.controller.dispose();
    }
  });
  it("keeps the oldest-page pagination flag while draining more recent pages", async () => {
    const context = reader();
    try {
      context.transport.observations[0]!.ready.resolve();
      await flush();
      context.transport.requests[0]!.result.resolve(page([1], { hasOlder: false, hasNewer: true }));
      await flush();
      context.transport.emit(live(3));
      context.transport.requests[1]!.result.resolve(page([2]));
      await flush();
      expect(context.state.rows.map((r) => r.seq)).toEqual([1, 2, 3]);
      expect(context.state.hasOlder).toBe(false);
    } finally {
      context.controller.dispose();
    }
  });
  it("discards replaced history and ignores an older fetch that finishes afterward", async () => {
    const context = reader();
    try {
      await start(context);
      const older = context.controller.loadOlder();
      context.transport.emit({
        agentId: "agent",
        event: { type: "replacement", epoch: "epoch-2" },
      });
      expect(context.state.rows).toEqual([]);
      context.transport.emit(live(2, "epoch-2"));
      context.transport.requests[2]!.result.resolve(
        page([1], { epoch: "epoch-2", hasOlder: false }),
      );
      await flush();
      context.transport.requests[1]!.result.resolve(page([1, 2]));
      expect(await older).toBe(false);
      expect(context.state.rows.map((r) => r.seq)).toEqual([1, 2]);
      expect(context.state.hasOlder).toBe(false);
    } finally {
      context.controller.dispose();
    }
  });
  it("refetches when a live new epoch races an old initial snapshot", async () => {
    const context = reader();
    try {
      context.transport.observations[0]!.ready.resolve();
      await flush();
      context.transport.emit(live(2, "epoch-2"));
      context.transport.requests[0]!.result.resolve(page([10]));
      await flush();
      context.transport.requests[1]!.result.resolve(page([1], { epoch: "epoch-2" }));
      await flush();
      expect(context.state.rows.map((r) => r.seq)).toEqual([1, 2]);
    } finally {
      context.controller.dispose();
    }
  });
  it("keeps the first live entry that reveals a new epoch", async () => {
    const context = reader();
    try {
      await start(context);
      context.transport.emit(live(2, "epoch-2"));
      context.transport.requests[1]!.result.resolve(
        page([1], { epoch: "epoch-2", hasOlder: false }),
      );
      await flush();
      expect(context.state.rows.map((r) => r.seq)).toEqual([1, 2]);
    } finally {
      context.controller.dispose();
    }
  });
  it("exposes failed pagination and allows retry without losing the visible rows", async () => {
    const context = reader();
    try {
      await start(context);
      const failed = context.controller.loadOlder();
      expect(context.state.loadingOlder).toBe(true);
      context.transport.requests[1]!.result.reject(new Error("host disconnected"));
      expect(await failed).toBe(false);
      expect(context.state.error).toBe("host disconnected");
      expect(context.state.loadingOlder).toBe(false);
      expect(context.state.rows.map((r) => r.seq)).toEqual([10]);
      const retry = context.controller.loadOlder();
      context.transport.requests[2]!.result.resolve(page([1]));
      expect(await retry).toBe(true);
      expect(context.state.error).toBe(null);
      expect(context.state.rows.map((r) => r.seq)).toEqual([1, 10]);
    } finally {
      context.controller.dispose();
    }
  });
});
