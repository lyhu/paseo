import { describe, expect, it, vi } from "vitest";
import { createSubmission } from "./submission";

describe("conversation composer submission", () => {
  it("sends a trimmed prompt once and clears only after acknowledgement", async () => {
    let acknowledge!: () => void;
    const send = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          acknowledge = resolve;
        }),
    );
    const draft = createSubmission({ send, stop: null });
    draft.setText("  hello\nworld  ");
    const first = draft.send();
    expect(draft.getSnapshot()).toEqual({ phase: "sending", text: "  hello\nworld  " });
    expect(await draft.send()).toBe(false);
    draft.setText("unexpected edit");
    expect(send).toHaveBeenCalledExactlyOnceWith("hello\nworld", expect.any(String));
    acknowledge();
    expect(await first).toBe(true);
    expect(draft.getSnapshot()).toEqual({ phase: "idle", text: "" });
  });
  it("keeps a failed draft and permits an explicit retry", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValue(undefined);
    const draft = createSubmission({ send, stop: null });
    draft.setText("Keep this draft");
    expect(await draft.send()).toBe(false);
    expect(draft.getSnapshot()).toEqual({
      phase: "error",
      text: "Keep this draft",
      message: "connection lost",
    });
    expect(await draft.send()).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![1]).toBe(send.mock.calls[1]![1]);
    expect(draft.getSnapshot()).toEqual({ phase: "idle", text: "" });
  });
  it("does not send whitespace or stop when no stop capability is supplied", async () => {
    const send = vi.fn();
    const draft = createSubmission({ send, stop: null });
    draft.setText(" \n ");
    expect(await draft.send()).toBe(false);
    expect(await draft.stop()).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  it("preserves the draft when stopping and blocks competing actions", async () => {
    let finish!: () => void;
    const stop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const send = vi.fn();
    const draft = createSubmission({ send, stop });
    draft.setText("Next task");
    const stopped = draft.stop();
    expect(await draft.send()).toBe(false);
    expect(await draft.stop()).toBe(false);
    expect(send).not.toHaveBeenCalled();
    finish();
    expect(await stopped).toBe(true);
    expect(stop).toHaveBeenCalledOnce();
    expect(draft.getSnapshot()).toEqual({ phase: "idle", text: "Next task" });
  });
  it("shows stop failures without losing the next prompt", async () => {
    const draft = createSubmission({
      send: vi.fn(),
      stop: async () => {
        throw new Error("stop rejected");
      },
    });
    draft.setText("Next prompt");
    expect(await draft.stop()).toBe(false);
    expect(draft.getSnapshot()).toEqual({
      phase: "error",
      text: "Next prompt",
      message: "stop rejected",
    });
    draft.setText("Edited prompt");
    expect(draft.getSnapshot()).toEqual({ phase: "idle", text: "Edited prompt" });
  });
});
