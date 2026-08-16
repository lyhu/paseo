import { RouteOfferSchema, type RouteOffer } from "@getpaseo/protocol/tunnel-messages";

export type TunnelEntryFormKind = "ingress" | "egress" | "offer" | "token";
export type TunnelEntryFormMode = "create" | "edit";
export type TunnelAccessMode = "bearer" | "header" | "none";

export interface TunnelEntryFormSnapshot {
  kind: TunnelEntryFormKind;
  mode: TunnelEntryFormMode;
  offer?: RouteOffer;
  entry?: {
    id: string;
    name: string;
    targetOrigin?: string;
    listen?: { host: string; port: number };
    accessMode?: TunnelAccessMode;
  };
}

export interface TunnelEntryFormState {
  kind: TunnelEntryFormKind;
  mode: TunnelEntryFormMode;
  entryId: string | null;
  name: string;
  targetOrigin: string;
  routeOfferText: string;
  listenHost: string;
  listenPort: string;
  accessMode: TunnelAccessMode;
  accessToken: string;
  canSubmit: boolean;
  submitError: string | null;
}

export interface TunnelEntryFormModel {
  getState(): TunnelEntryFormState;
  subscribe(listener: () => void): () => void;
  close(): void;
  setName(value: string): void;
  setTargetOrigin(value: string): void;
  setRouteOfferText(value: string): void;
  setListenHost(value: string): void;
  setListenPort(value: string): void;
  setAccessMode(value: TunnelAccessMode): void;
  setAccessToken(value: string): void;
  setSubmitError(value: string | null): void;
  getRouteOffer(): RouteOffer | null;
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

function initialListenPort(snapshot: TunnelEntryFormSnapshot): string {
  if (snapshot.entry?.listen) return String(snapshot.entry.listen.port);
  if (snapshot.offer) return String(snapshot.offer.suggestedPort);
  return "";
}

function deriveState(state: TunnelEntryFormState): TunnelEntryFormState {
  const name = state.name.trim();
  if (state.kind === "ingress") {
    return { ...state, canSubmit: Boolean(name) && isTargetOrigin(state.targetOrigin) };
  }
  if (state.kind === "offer") {
    return { ...state, canSubmit: parseRouteOffer(state.routeOfferText) !== null };
  }
  if (state.kind === "token") return { ...state, canSubmit: true };
  const canSubmit =
    Boolean(name) &&
    isListenHost(state.listenHost) &&
    isListenPort(state.listenPort) &&
    (state.mode === "edit" || parseRouteOffer(state.routeOfferText) !== null);
  return { ...state, canSubmit };
}

export function openTunnelEntryForm(snapshot: TunnelEntryFormSnapshot): TunnelEntryFormModel {
  const listeners = new Set<() => void>();
  let closed = false;
  let state = deriveState({
    kind: snapshot.kind,
    mode: snapshot.mode,
    entryId: snapshot.entry?.id ?? null,
    name: snapshot.entry?.name ?? "",
    targetOrigin: snapshot.entry?.targetOrigin ?? "",
    routeOfferText: snapshot.offer ? JSON.stringify(snapshot.offer) : "",
    listenHost: snapshot.entry?.listen?.host ?? "127.0.0.1",
    listenPort: initialListenPort(snapshot),
    accessMode: snapshot.entry?.accessMode ?? "header",
    accessToken: "",
    canSubmit: false,
    submitError: null,
  });

  function publish(nextState: TunnelEntryFormState): void {
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
