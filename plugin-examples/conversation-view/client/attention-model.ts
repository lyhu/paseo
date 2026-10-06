import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
} from "@getpaseo/protocol/agent-types";

export interface Question {
  header: string;
  question: string;
  options: { label: string; description?: string }[];
  multiSelect: boolean;
  allowOther: boolean;
  allowEmpty: boolean;
}

export function parseQuestions(input: AgentPermissionRequest["input"]): Question[] | null {
  const raw = input?.questions;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const result: Question[] = [];
  for (const value of raw) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    if (typeof value.header !== "string" || typeof value.question !== "string") return null;
    if (!Array.isArray(value.options)) return null;
    const options: Question["options"] = [];
    for (const option of value.options) {
      if (typeof option !== "object" || option === null || Array.isArray(option)) return null;
      if (typeof option.label !== "string") return null;
      options.push({
        label: option.label,
        description: typeof option.description === "string" ? option.description : undefined,
      });
    }
    result.push({
      header: value.header,
      question: value.question,
      options,
      multiSelect: value.multiSelect === true,
      allowOther: value.allowOther === true || value.isOther === true,
      allowEmpty: value.allowEmpty === true,
    });
  }
  return result;
}

export function questionResponse(
  request: AgentPermissionRequest,
  questions: Question[],
  answers: Record<string, string>,
): AgentPermissionResponse | null {
  if (!questions.every((q) => q.allowEmpty || Boolean(answers[q.header]?.trim()))) return null;
  const normalized = Object.fromEntries(
    questions.map((q) => [q.header, answers[q.header]?.trim() ?? ""]),
  );
  return { behavior: "allow", updatedInput: { ...request.input, answers: normalized } };
}
