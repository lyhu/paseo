import { RouteOfferSchema, type RouteOffer } from "@getpaseo/protocol/tunnel-messages";

export type EgressFormMode = "create" | "edit";
export type TunnelAccessMode = "bearer" | "header" | "none";

export interface EgressFormSnapshot {
  mode: EgressFormMode;
  offer?: RouteOffer;
  entry?: {
    id: string;
    name: string;
    listen: { host: string; port: number };
    accessMode?: TunnelAccessMode;
  };
}

export interface EgressFormState {
  mode: EgressFormMode;
  entryId: string | null;
  name: string;
  routeOfferText: string;
  listenHost: string;
  listenPort: string;
  accessMode: TunnelAccessMode;
  accessToken: string;
  canSubmit: boolean;
  submitError: string | null;
}

export interface EgressFormModel {
  getState(): EgressFormState;
  subscribe(listener: () => void): () => void;
  close(): void;
  setName(value: string): void;
  setRouteOfferText(value: string): void;
  setListenHost(value: string): void;
  setListenPort(value: string): void;
  setAccessMode(value: TunnelAccessMode): void;
  setAccessToken(value: string): void;
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

function isListenPort(value: string): boolean {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535;
}

function isListenHost(value: string): boolean {
  return value === "127.0.0.1" || value === "0.0.0.0";
}

function deriveState(state: EgressFormState): EgressFormState {
  return {
    ...state,
    canSubmit:
      Boolean(state.name.trim()) &&
      isListenHost(state.listenHost) &&
      isListenPort(state.listenPort) &&
      (state.mode === "edit" || parseRouteOffer(state.routeOfferText) !== null),
  };
}

function initialListenPort(snapshot: EgressFormSnapshot): string {
  if (snapshot.entry) return String(snapshot.entry.listen.port);
  if (snapshot.offer) return String(snapshot.offer.suggestedPort);
  return "";
}

export function openEgressForm(snapshot: EgressFormSnapshot): EgressFormModel {
  const listeners = new Set<() => void>();
  let closed = false;
  let state = deriveState({
    mode: snapshot.mode,
    entryId: snapshot.entry?.id ?? null,
    name: snapshot.entry?.name ?? "",
    routeOfferText: snapshot.offer ? JSON.stringify(snapshot.offer) : "",
    listenHost: snapshot.entry?.listen.host ?? "127.0.0.1",
    listenPort: initialListenPort(snapshot),
    accessMode: snapshot.entry?.accessMode ?? "header",
    accessToken: "",
    canSubmit: false,
    submitError: null,
  });

  function publish(nextState: EgressFormState): void {
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
    setRouteOfferText(value) {
      const offer = parseRouteOffer(value);
      publish({
        ...state,
        routeOfferText: value,
        listenPort: state.listenPort || (offer ? String(offer.suggestedPort) : ""),
        submitError: null,
      });
    },
    setListenHost(value) {
      publish({ ...state, listenHost: value, submitError: null });
    },
    setListenPort(value) {
      publish({ ...state, listenPort: value, submitError: null });
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
    getRouteOffer() {
      return parseRouteOffer(state.routeOfferText);
    },
  };
}
