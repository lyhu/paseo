import type { AgentTimelineItem, JsonValue } from "@getpaseo/protocol/agent-types";
import type { PluginTimelineTransformResult } from "@getpaseo/plugin";
import { z } from "zod";

const phaseSchema = z.enum(["streaming", "complete"]);
export const answerSchema = z.object({ text: z.string(), phase: phaseSchema });
export const thinkingSchema = answerSchema;
export const toolSchema = z.object({
  callId: z.string(),
  name: z.string(),
  status: z.enum(["running", "completed", "failed", "canceled"]),
  detail: z.unknown(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  error: z.unknown().optional(),
  phase: phaseSchema,
});

export type NativeTextData = z.infer<typeof answerSchema>;
export type NativeToolData = z.infer<typeof toolSchema>;
interface TransformInput<Type extends AgentTimelineItem["type"]> {
  item: Extract<AgentTimelineItem, { type: Type }>;
  phase: NativeTextData["phase"];
}

// Ignore fence-like text inside other code blocks. An unfinished Mermaid fence
// already belongs to the Mermaid renderer while the answer is still streaming.
export function hasMermaidFence(text: string): boolean {
  let open: { marker: string; length: number } | undefined;
  for (const line of text.split("\n")) {
    const fence = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line);
    if (!fence) continue;
    const marker = fence[1]!;
    const info = fence[2]!.trim();
    // Match the installed Mermaid renderer's single-language fence headers,
    // including tab and space indentation, so registration order stays safe.
    if (/[\s`~]/.test(info)) continue;
    if (open) {
      if (marker[0] === open.marker && marker.length >= open.length && !info) {
        open = undefined;
      }
      continue;
    }
    if (info.toLowerCase() === "mermaid") return true;
    open = { marker: marker[0]!, length: marker.length };
  }
  return false;
}

function needsHostMarkdown(text: string): boolean {
  // Images and workspace/file targets need host-owned navigation and resource
  // resolution. Keep their entire source row with the native Markdown renderer.
  if (/(^|[^\\])!\[[^\]\n]*\]|<img\s/i.test(text)) return true;
  const inlineLinks = [...text.matchAll(/\[[^\]\n]*\]\(\s*<?([^\s)>]+)/g)];
  const references = [...text.matchAll(/^\s*\[[^\]\n]+\]:\s*<?([^\s>]+)/gm)];
  return [...inlineLinks, ...references].some((link) => !/^(https?:|mailto:)/i.test(link[1]!));
}

export function transformAnswer({
  item,
  phase,
}: TransformInput<"assistant_message">): PluginTimelineTransformResult | undefined {
  if (hasMermaidFence(item.text) || needsHostMarkdown(item.text)) return undefined;
  return {
    items: [
      { type: "plugin", kind: "conversation-answer", version: 1, data: { text: item.text, phase } },
    ],
  };
}

export function transformThinking({
  item,
  phase,
}: TransformInput<"reasoning">): PluginTimelineTransformResult {
  return {
    items: [
      {
        type: "plugin",
        kind: "conversation-thinking",
        version: 1,
        data: { text: item.text, phase },
      },
    ],
  };
}

export function transformTool({
  item,
  phase,
}: TransformInput<"tool_call">): PluginTimelineTransformResult {
  const { type: _type, ...source } = item;
  // Tool payloads arrive over JSON; remove optional undefined properties before
  // passing their structured input, output and errors to the plugin contract.
  const data: JsonValue = JSON.parse(JSON.stringify({ ...source, phase }));
  return {
    items: [{ type: "plugin", kind: "conversation-tool", version: 1, data }],
  };
}
