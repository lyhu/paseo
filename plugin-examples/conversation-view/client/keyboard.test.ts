import { describe, expect, it } from "vitest";
import { isSubmitShortcut } from "./submission";

describe("composer keyboard submission", () => {
  it("allows Ctrl or Cmd Enter and preserves plain Enter for newlines", () => {
    expect(isSubmitShortcut({ key: "Enter", ctrlKey: true })).toBe(true);
    expect(isSubmitShortcut({ key: "Enter", metaKey: true })).toBe(true);
    expect(isSubmitShortcut({ key: "Enter" })).toBe(false);
    expect(isSubmitShortcut({ key: "a", ctrlKey: true })).toBe(false);
  });
  it("never submits keys while an IME is composing", () => {
    expect(isSubmitShortcut({ key: "Enter", ctrlKey: true, isComposing: true })).toBe(false);
    expect(isSubmitShortcut({ key: "Enter", metaKey: true, keyCode: 229 })).toBe(false);
    expect(isSubmitShortcut({ key: "Enter", ctrlKey: true, keyCode: 13 })).toBe(true);
  });
});
