import { RouteOfferSchema, type RouteOffer } from "@getpaseo/protocol/tunnel-messages";

export interface RouteOfferFormSnapshot {
  entryId: string;
}

export interface RouteOfferFormState {
  entryId: string;
  routeOfferText: string;
  canSubmit: boolean;
  submitError: string | null;
}

export interface RouteOfferFormModel {
  getState(): RouteOfferFormState;
  subscribe(listener: () => void): () => void;
  close(): void;
  setRouteOfferText(value: string): void;
  setSubmitError(value: string | null): void;
  getRouteOffer(): RouteOffer | null;
}

function parseRouteOffer(value: string): RouteOffer | null {
  try {
    const parsed = RouteOfferSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function openRouteOfferForm(snapshot: RouteOfferFormSnapshot): RouteOfferFormModel {
  const listeners = new Set<() => void>();
  let closed = false;
  let state: RouteOfferFormState = {
    entryId: snapshot.entryId,
    routeOfferText: "",
    canSubmit: false,
    submitError: null,
  };

  function publish(nextState: RouteOfferFormState): void {
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
    setRouteOfferText(value) {
      publish({
        ...state,
        routeOfferText: value,
        canSubmit: parseRouteOffer(value) !== null,
        submitError: null,
      });
    },
    setSubmitError(value) {
      publish({ ...state, submitError: value });
    },
    getRouteOffer() {
      return parseRouteOffer(state.routeOfferText);
    },
  };
}
