export type IngressFormMode = "create" | "edit";

export interface IngressFormSnapshot {
  mode: IngressFormMode;
  entry?: {
    id: string;
    name: string;
    targetOrigin: string;
  };
}

export interface IngressFormState {
  mode: IngressFormMode;
  entryId: string | null;
  name: string;
  targetOrigin: string;
  canSubmit: boolean;
  submitError: string | null;
}

export interface IngressFormModel {
  getState(): IngressFormState;
  subscribe(listener: () => void): () => void;
  close(): void;
  setName(value: string): void;
  setTargetOrigin(value: string): void;
  setSubmitError(value: string | null): void;
}

function isTargetOrigin(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      Boolean(url.hostname) &&
      (url.pathname === "/" || url.pathname === "") &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function deriveState(state: IngressFormState): IngressFormState {
  return {
    ...state,
    canSubmit: Boolean(state.name.trim()) && isTargetOrigin(state.targetOrigin),
  };
}

export function openIngressForm(snapshot: IngressFormSnapshot): IngressFormModel {
  const listeners = new Set<() => void>();
  let closed = false;
  let state = deriveState({
    mode: snapshot.mode,
    entryId: snapshot.entry?.id ?? null,
    name: snapshot.entry?.name ?? "",
    targetOrigin: snapshot.entry?.targetOrigin ?? "",
    canSubmit: false,
    submitError: null,
  });

  function publish(nextState: IngressFormState): void {
    if (closed) return;
    state = deriveState(nextState);
    for (const listener of listeners) listener();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closed = true;
      listeners.clear();
    },
    setName(value) {
      publish({ ...state, name: value, submitError: null });
    },
    setTargetOrigin(value) {
      publish({ ...state, targetOrigin: value, submitError: null });
    },
    setSubmitError(value) {
      publish({ ...state, submitError: value });
    },
  };
}
