import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";

export interface ReaderRow {
  seq: number;
  endSeq?: number;
  timestamp: string;
  turnId?: string;
  item: AgentTimelineItem;
}
export interface ReaderTurn {
  id: number;
  prompt: string | null;
  timestamp: string;
  rows: ReaderRow[];
}

// Canonical seq is the identity for both fetched pages and live delivery.
export function mergeRows(
  previous: readonly ReaderRow[],
  incoming: readonly ReaderRow[],
): ReaderRow[] {
  const rows = new Map(previous.map((row) => [row.seq, row]));
  for (const row of incoming) rows.set(row.seq, row);
  return [...rows.values()].sort((a, b) => a.seq - b.seq);
}

export function buildTurns(rows: readonly ReaderRow[]): ReaderTurn[] {
  const turns: ReaderTurn[] = [];
  for (const row of rows) {
    const item = row.item;
    if (item.type === "user_message" || turns.length === 0) {
      turns.push({
        id: row.seq,
        prompt: item.type === "user_message" ? item.text : null,
        timestamp: row.timestamp,
        rows: [],
      });
    }
    if (item.type === "user_message") continue;
    const turn = turns[turns.length - 1]!;
    if (item.type === "tool_call") {
      const index = turn.rows.findIndex(
        (r) =>
          r.item.type === "tool_call" && r.item.callId === item.callId && r.turnId === row.turnId,
      );
      if (index >= 0) {
        const old = turn.rows[index]!;
        turn.rows[index] = { ...old, endSeq: row.seq, item };
        continue;
      }
    }
    const previous = turn.rows.at(-1);
    if (
      previous &&
      row.seq === (previous.endSeq ?? previous.seq) + 1 &&
      row.turnId === previous.turnId &&
      ((item.type === "assistant_message" &&
        previous.item.type === "assistant_message" &&
        item.messageId === previous.item.messageId) ||
        (item.type === "reasoning" && previous.item.type === "reasoning"))
    ) {
      // Preserve the first seq for stable component identity as chunks grow.
      turn.rows[turn.rows.length - 1] = {
        ...previous,
        endSeq: row.seq,
        item: { ...item, text: (previous.item as { text: string }).text + item.text },
      };
      continue;
    }
    turn.rows.push(row);
  }
  return turns;
}

export interface TurnGeometry {
  id: number;
  y: number;
}
export function readingTurn(geometry: readonly TurnGeometry[], offset: number): number | null {
  let active: number | null = null;
  for (const turn of geometry) {
    if (turn.y > offset + 1) break;
    active = turn.id;
  }
  return active;
}
