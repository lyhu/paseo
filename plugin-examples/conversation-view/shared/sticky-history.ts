import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";

export interface StickyPrompt {
  id: string;
  text: string;
  aliases?: readonly string[];
}

interface PromptPosition extends StickyPrompt {
  seq: number;
  time: number;
}

/** Keeps prompt metadata, never assistant bodies or tool outputs. */
export class PromptHistory {
  private prompts = new Map<number, PromptPosition>();
  private identities = new Map<string, number>();
  private oldestTime = Infinity;

  clear() {
    this.prompts.clear();
    this.identities.clear();
    this.oldestTime = Infinity;
  }

  add(item: AgentTimelineItem, timestamp: string, seq: number) {
    const time = Date.parse(timestamp);
    this.oldestTime = Math.min(this.oldestTime, time);
    if (item.type === "user_message") {
      const id = item.clientMessageId ?? item.messageId;
      if (id)
        this.prompts.set(seq, {
          id,
          text: item.text,
          seq,
          time,
          aliases: [item.clientMessageId, item.messageId].filter(
            (value): value is string => !!value,
          ),
        });
      if (item.clientMessageId) this.identities.set(item.clientMessageId, seq);
      if (item.messageId) this.identities.set(item.messageId, seq);
    } else if (item.type === "assistant_message" && item.messageId) {
      const previous = this.identities.get(item.messageId);
      this.identities.set(item.messageId, previous === undefined ? seq : Math.min(previous, seq));
    } else if (item.type === "tool_call") {
      // The host's tool stream row keeps the call identity across lifecycle updates.
      const id = `agent_tool_${item.callId}`;
      const previous = this.identities.get(id);
      this.identities.set(id, previous === undefined ? seq : Math.min(previous, seq));
    }
  }

  resolve(rowId: string, messageId: string | null): StickyPrompt | undefined {
    const sourceId = sourceIdentity(rowId);
    const identity = sourceIdentity(messageId ?? sourceId);
    const seq =
      this.identities.get(identity) ?? this.identities.get(identity.split(":segment:")[0]!);
    const match = /^(?:assistant|thought|user)_(\d+)_/.exec(sourceId);
    const time = match ? Number(match[1]) : undefined;
    // A timestamp outside the fetched window needs an older page first.
    if (seq === undefined && (time === undefined || time < this.oldestTime)) return undefined;
    let selected: PromptPosition | undefined;
    for (const prompt of this.prompts.values()) {
      const before = seq !== undefined ? prompt.seq <= seq : prompt.time <= time!;
      if (before && (!selected || prompt.seq > selected.seq)) selected = prompt;
    }
    return selected
      ? { id: selected.id, text: selected.text, aliases: selected.aliases }
      : undefined;
  }
}

function sourceIdentity(id: string): string {
  return /^[a-z][a-z0-9-]*\/(.+)\/\d+$/.exec(id)?.[1] ?? id;
}
