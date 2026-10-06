import { describe, expect, it } from "vitest";
import type { AgentPermissionRequest } from "@getpaseo/protocol/agent-types";
import { parseQuestions, questionResponse } from "./attention-model";

describe("permission question input", () => {
  const input = {
    questions: [
      {
        header: "Choice",
        question: "Choose",
        options: [{ label: "A" }],
        multiSelect: true,
        isOther: true,
      },
    ],
    source: "agent",
  };
  const request: AgentPermissionRequest = {
    id: "request-1",
    name: "AskUserQuestion",
    kind: "question",
    provider: "codex",
    input,
  };

  it("preserves the provider input when adding keyed answers", () => {
    const questions = parseQuestions(input)!;
    expect(questions[0].allowOther).toBe(true);
    expect(questionResponse(request, questions, { Choice: "A, Custom" })).toEqual({
      behavior: "allow",
      updatedInput: { ...input, answers: { Choice: "A, Custom" } },
    });
  });

  it("does not approve an unanswered required question", () => {
    expect(questionResponse(request, parseQuestions(input)!, { Choice: "  " })).toBeNull();
  });

  it("accepts explicitly optional input", () => {
    const optional = parseQuestions({
      questions: [{ header: "Text", question: "Feedback", options: [], allowEmpty: true }],
    })!;
    expect(questionResponse(request, optional, {})).toEqual({
      behavior: "allow",
      updatedInput: { ...input, answers: { Text: "" } },
    });
  });

  it("rejects unknown question shapes instead of fabricating an allow response", () => {
    expect(parseQuestions({ questions: [{ question: "Missing header", options: [] }] })).toBeNull();
    expect(
      parseQuestions({ questions: [{ header: "X", question: "Bad option", options: ["A"] }] }),
    ).toBeNull();
    expect(parseQuestions({ questions: [] })).toBeNull();
  });
});
