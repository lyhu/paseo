import type { TunnelAccessMode } from "./tunnel-form-types";

export interface AccessTokenFormSnapshot {
  entryId: string;
  entryName: string;
  accessMode: TunnelAccessMode;
}

export interface AccessTokenFormState {
  entryId: string;
  entryName: string;
  accessMode: TunnelAccessMode;
  accessToken: string;
  canSubmit: true;
  submitError: string | null;
}

export interface AccessTokenFormModel {
  getState(): AccessTokenFormState;
  subscribe(listener: () => void): () => void;
  close(): void;
  setAccessMode(value: TunnelAccessMode): void;
  setAccessToken(value: string): void;
  setSubmitError(value: string | null): void;
}

export function openAccessTokenForm(snapshot: AccessTokenFormSnapshot): AccessTokenFormModel {
  const listeners = new Set<() => void>();
  let closed = false;
  let state: AccessTokenFormState = {
    entryId: snapshot.entryId,
    entryName: snapshot.entryName,
    accessMode: snapshot.accessMode,
    accessToken: "",
    canSubmit: true,
    submitError: null,
  };

  function publish(nextState: AccessTokenFormState): void {
    if (closed) return;
    state = nextState;
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
    setAccessMode(value) {
      publish({ ...state, accessMode: value, submitError: null });
    },
    setAccessToken(value) {
      publish({ ...state, accessToken: value, submitError: null });
    },
    setSubmitError(value) {
      publish({ ...state, submitError: value });
    },
  };
}
