import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { describe, expect, it } from "vitest";
import {
  answerSchema,
  hasMermaidFence,
  thinkingSchema,
  toolSchema,
  transformAnswer,
  transformThinking,
  transformTool,
} from "./native";

describe("native conversation transforms", () => {
  it("preserves streamed and completed answer text without introducing another identity", () => {
    for (const phase of ["streaming", "complete"] as const) {
      const item = {
        type: "assistant_message",
        text: "## 答案\n正文",
        messageId: "answer",
      } as const;
      const output = transformAnswer({ item, phase })!;
      expect(output.items).toEqual([
        {
          type: "plugin",
          kind: "conversation-answer",
          version: 1,
          data: { text: item.text, phase },
        },
      ]);
      expect(answerSchema.parse(output.items[0]!.data)).toEqual({ text: item.text, phase });
      expect(output.items[0]).not.toHaveProperty("id");
    }
  });

  it("preserves reasoning text and its streaming phase", () => {
    const item = { type: "reasoning", text: "正在检查" } as const;
    const output = transformThinking({ item, phase: "streaming" });
    expect(output.items[0]!.kind).toBe("conversation-thinking");
    expect(thinkingSchema.parse(output.items[0]!.data)).toEqual({
      text: item.text,
      phase: "streaming",
    });
    expect(thinkingSchema.safeParse({ text: item.text, phase: "running" }).success).toBe(false);
  });

  it("yields Mermaid answers, including unfinished streaming fences, to the installed renderer", () => {
    for (const text of [
      "正文\n```mermaid\ngraph TD; A-->B\n```",
      "正文\n```mermaid\ngraph TD; A-->",
      "  ~~~MERMAID\nsequenceDiagram",
      "    ```mermaid\ngraph TD; A-->B",
      "\t~~~ MeRmAiD \t\nsequenceDiagram",
    ]) {
      expect(
        transformAnswer({ item: { type: "assistant_message", text }, phase: "streaming" }),
      ).toBeUndefined();
    }
  });

  it("does not yield ordinary mentions or Mermaid fence examples inside other code blocks", () => {
    expect(hasMermaidFence("Use Mermaid for diagrams.")).toBe(false);
    expect(hasMermaidFence("````markdown\n```mermaid\ngraph TD\n```\n````")).toBe(false);
    expect(hasMermaidFence("```js\nconst mermaid = 1;\n```\n```mermaid\ngraph TD")).toBe(true);
    expect(hasMermaidFence("\t````markdown\n    ```mermaid\ngraph TD\n```\n````")).toBe(false);
    expect(hasMermaidFence("```mermaid extra-info\ngraph TD")).toBe(false);
  });

  it("keeps images and workspace links with the native host renderer", () => {
    for (const text of [
      "![preview](https://example.com/image.png)",
      "![preview][image]\n[image]: ./preview.png",
      "[source](./src/app.ts:12)",
      "[source](/Users/example/project/app.ts)",
      "[source](file:///Users/example/project/app.ts)",
      "[source][file]\n[file]: src/app.ts",
    ]) {
      expect(
        transformAnswer({ item: { type: "assistant_message", text }, phase: "complete" }),
      ).toBeUndefined();
    }
    expect(
      transformAnswer({
        item: { type: "assistant_message", text: "[docs](https://example.com/docs)" },
        phase: "complete",
      }),
    ).toBeDefined();
  });

  it("retains every tool lifecycle state and the original structured detail and metadata", () => {
    for (const status of ["running", "completed", "canceled"] as const) {
      const item: Extract<AgentTimelineItem, { type: "tool_call" }> = {
        type: "tool_call",
        callId: "read-1",
        name: "read_file",
        status,
        error: null,
        detail: { type: "unknown", input: { path: "file.ts" }, output: { text: "file contents" } },
        metadata: { provider: "codex" },
      };
      const phase = status === "running" ? "streaming" : "complete";
      const output = transformTool({ item, phase });
      expect(output.items[0]!.kind).toBe("conversation-tool");
      expect(toolSchema.parse(output.items[0]!.data)).toEqual({
        callId: item.callId,
        name: item.name,
        status,
        error: null,
        detail: item.detail,
        metadata: item.metadata,
        phase,
      });
    }
  });

  it("keeps a failed tool's structured error and rejects invalid lifecycle values", () => {
    const item: Extract<AgentTimelineItem, { type: "tool_call" }> = {
      type: "tool_call",
      callId: "exec-1",
      name: "exec_command",
      status: "failed",
      error: { message: "permission denied", code: "EACCES" },
      detail: { type: "unknown", input: { command: "cat file" }, output: "denied" },
    };
    const data = transformTool({ item, phase: "complete" }).items[0]!.data;
    expect(toolSchema.parse(data).error).toEqual(item.error);
    expect(toolSchema.safeParse({ ...data, status: "done" }).success).toBe(false);
  });

  it("accepts a completed tool when the host omits optional error and metadata", () => {
    // Some clients project successful tools without the protocol's null error.
    const item: Extract<AgentTimelineItem, { type: "tool_call" }> = JSON.parse(
      '{"type":"tool_call","callId":"read-2","name":"read_file","status":"completed","detail":{"type":"unknown","input":{"path":"file.ts"},"output":"contents"}}',
    );
    const data = transformTool({ item, phase: "complete" }).items[0]!.data;
    const parsed = toolSchema.parse(data);
    expect(parsed).toMatchObject({ callId: "read-2", status: "completed", phase: "complete" });
    expect(parsed).not.toHaveProperty("error");
    expect(parsed).not.toHaveProperty("metadata");
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(data);
  });
});
