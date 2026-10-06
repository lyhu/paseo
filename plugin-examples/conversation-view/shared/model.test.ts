import { describe, expect, it } from "vitest";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { buildTurns, mergeRows, readingTurn, type ReaderRow } from "./model";

const row = (seq: number, item: AgentTimelineItem, turnId = "turn-1"): ReaderRow => ({
  seq,
  item,
  timestamp: "2026-10-06T00:00:00Z",
  turnId,
});
const assistant = (text: string, messageId = "answer"): AgentTimelineItem => ({
  type: "assistant_message",
  text,
  messageId,
});
const tool = (status: "running" | "completed"): AgentTimelineItem => ({
  type: "tool_call",
  callId: "read",
  name: "read_file",
  status,
  error: null,
  detail: { type: "unknown", input: {}, output: status },
});

describe("conversation rows", () => {
  it("deduplicates canonical sequence identities across history and live delivery", () => {
    expect(
      mergeRows(
        [row(2, assistant("old")), row(1, assistant("first"))],
        [row(2, assistant("replacement")), row(3, assistant("last"))],
      ),
    ).toEqual([
      row(1, assistant("first")),
      row(2, assistant("replacement")),
      row(3, assistant("last")),
    ]);
  });
  it("joins three or more adjacent stream chunks while keeping the first identity", () => {
    expect(
      buildTurns([
        row(1, { type: "user_message", text: "question" }),
        row(2, assistant("one")),
        row(3, assistant(" two")),
        row(4, assistant(" three")),
        row(5, assistant(" four")),
      ])[0]!.rows,
    ).toEqual([{ ...row(2, assistant("one two three four")), endSeq: 5 }]);
  });
  it("does not merge chunks across gaps, messages, or provider turns", () => {
    const rows = [
      row(1, assistant("one")),
      row(3, assistant("two")),
      row(4, assistant("three", "next")),
      row(5, assistant("four", "next"), "turn-2"),
    ];
    expect(buildTurns(rows)[0]!.rows).toEqual(rows);
  });
  it("keeps later questions and their reasoning separate", () => {
    const turns = buildTurns([
      row(1, { type: "user_message", text: "first" }),
      row(2, { type: "reasoning", text: "thinking" }),
      row(3, { type: "reasoning", text: " more" }),
      row(4, { type: "user_message", text: "second" }, "turn-2"),
      row(5, { type: "reasoning", text: "new thinking" }, "turn-2"),
    ]);
    const turnContents = (turn: (typeof turns)[number]) => [
      turn.id,
      turn.prompt,
      turn.rows.map((r) => r.item),
    ];
    expect(turns.map(turnContents)).toEqual([
      [1, "first", [{ type: "reasoning", text: "thinking more" }]],
      [4, "second", [{ type: "reasoning", text: "new thinking" }]],
    ]);
  });
  it("updates tool lifecycle at the original position without combining another turn", () => {
    expect(
      buildTurns([
        row(1, tool("running")),
        row(2, assistant("working")),
        row(3, tool("completed")),
        row(4, tool("running"), "turn-2"),
      ])[0]!.rows,
    ).toEqual([
      { ...row(1, tool("completed")), endSeq: 3 },
      row(2, assistant("working")),
      row(4, tool("running"), "turn-2"),
    ]);
  });
  it("pins the turn at the reading line and switches when the next turn reaches it", () => {
    const geometry = [
      { id: 1, y: 40 },
      { id: 5, y: 240 },
    ];
    expect([
      readingTurn(geometry, 0),
      readingTurn(geometry, 40),
      readingTurn(geometry, 239),
    ]).toEqual([null, 1, 5]);
  });
});
