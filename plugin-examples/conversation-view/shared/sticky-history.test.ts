import { expect, it } from "vitest";
import { PromptHistory } from "./sticky-history";

const time = "2026-10-06T10:00:00.000Z";

it("associates virtualized native and plugin rows with their own prompt, not the latest prompt", () => {
  const history = new PromptHistory();
  history.add(
    { type: "user_message", text: "first", messageId: "u1", clientMessageId: "local1" },
    time,
    1,
  );
  history.add({ type: "assistant_message", text: "answer", messageId: "a1" }, time, 2);
  history.add({ type: "user_message", text: "second", messageId: "u2" }, time, 3);
  history.add({ type: "assistant_message", text: "answer", messageId: "a2" }, time, 4);
  history.add({ type: "assistant_message", text: "answer delta", messageId: "a1" }, time, 5);
  expect(history.resolve("conversation-view/a1/0", "conversation-view/a1/0")).toEqual({
    id: "local1",
    text: "first",
    aliases: ["local1", "u1"],
  });
  expect(history.resolve("a2:segment:abc", "a2")).toMatchObject({ id: "u2", text: "second" });
  expect(history.resolve("u2", "u2")).toMatchObject({ id: "u2", text: "second" });
});

it("waits for an older page instead of borrowing a newer prompt", () => {
  const history = new PromptHistory();
  const earlier = Date.parse(time) - 1000;
  history.add({ type: "assistant_message", text: "tail", messageId: "a2" }, time, 20);
  expect(history.resolve(`assistant_${earlier}_hash_0`, null)).toBeUndefined();
  expect(history.resolve("a2", null)).toBeUndefined();
  history.add(
    { type: "user_message", text: "earlier question", messageId: "u1" },
    new Date(earlier - 1000).toISOString(),
    1,
  );
  history.add({ type: "reasoning", text: "thinking" }, new Date(earlier).toISOString(), 2);
  expect(history.resolve(`conversation-view/thought_${earlier}_hash_0/0`, null)).toMatchObject({
    id: "u1",
    text: "earlier question",
  });
});

it("keeps tool ownership across lifecycle updates and clears stale history after replacement", () => {
  const history = new PromptHistory();
  history.add({ type: "user_message", text: "first", messageId: "u1" }, time, 1);
  history.add(
    {
      type: "tool_call",
      callId: "tool1",
      name: "read",
      status: "running",
      error: null,
      detail: { type: "read", filePath: "a.ts" },
    },
    time,
    2,
  );
  history.add({ type: "user_message", text: "second", messageId: "u2" }, time, 3);
  history.add(
    {
      type: "tool_call",
      callId: "tool1",
      name: "read",
      status: "completed",
      error: null,
      detail: { type: "read", filePath: "a.ts" },
    },
    time,
    4,
  );
  expect(history.resolve("compact-agent-activity/agent_tool_tool1/0", null)).toMatchObject({
    id: "u1",
    text: "first",
  });
  history.clear();
  expect(history.resolve("agent_tool_tool1", null)).toBeUndefined();
});
