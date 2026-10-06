interface Draft {
  text: string;
}
export type ComposerState =
  | (Draft & { phase: "idle" })
  | (Draft & { phase: "sending" | "stopping" })
  | (Draft & { phase: "error"; message: string });

interface SubmissionOptions {
  send: (text: string, messageId: string) => Promise<void>;
  stop: (() => Promise<void>) | null;
}

interface ComposerKey {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

export function isSubmitShortcut(event: ComposerKey) {
  const composing = event.isComposing || event.keyCode === 229;
  const modified = event.ctrlKey || event.metaKey;
  return event.key === "Enter" && Boolean(modified) && !composing;
}

export function createSubmission({ send, stop }: SubmissionOptions) {
  let state: ComposerState = { phase: "idle", text: "" };
  let messageId = "";
  const listeners = new Set<() => void>();
  function publish(next: ComposerState) {
    state = next;
    for (const listener of listeners) listener();
  }
  function pending() {
    return state.phase === "sending" || state.phase === "stopping";
  }
  async function perform(operation: "sending" | "stopping") {
    if (pending()) return false;
    const text = state.text;
    const prompt = text.trim();
    if (operation === "sending" && !prompt) return false;
    if (operation === "stopping" && !stop) return false;
    publish({ phase: operation, text });
    try {
      if (operation === "sending") await send(prompt, messageId);
      else if (stop) await stop();
      const draft = operation === "sending" ? "" : text;
      publish({ phase: "idle", text: draft });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      publish({ phase: "error", text, message });
      return false;
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setText(text: string) {
      if (pending()) return;
      if (text !== state.text) {
        messageId = `conversation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      }
      publish({ phase: "idle", text });
    },
    send: () => perform("sending"),
    stop: () => perform("stopping"),
  };
}
