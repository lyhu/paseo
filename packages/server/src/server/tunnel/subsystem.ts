import { randomBytes, createHash } from "node:crypto";
import type { PersistedConfig } from "../persisted-config.js";
import type { DaemonConfigStore } from "../daemon-config-store.js";
import {
  type PersistedTunnelConfig,
  type PersistedIngress,
  type PersistedEgress,
  type RouteOffer,
  type TunnelListenHost,
  createTunnelIdentity,
} from "./config.js";
import type {
  TunnelState,
  TunnelIngressState,
  TunnelEgressState,
  TunnelRelayStatus,
} from "@getpaseo/protocol/tunnel-messages";
import { IngressRuntime } from "./ingress-runtime.js";
import { EgressRuntime } from "./egress-runtime.js";
import { importSecretKey, importPublicKey } from "@getpaseo/relay/e2ee";

export interface TunnelSubsystemOptions {
  configStore: Pick<DaemonConfigStore, "getPersistedConfigSnapshot" | "setPersistedTunnelConfig">;
  relayEndpoint: string;
  relayUseTls: boolean;
  relayPublicEndpoint?: string;
  relayPublicUseTls?: boolean;
}

export interface CreateIngressOptions {
  name: string;
  targetOrigin: string;
}

export interface UpdateIngressOptions {
  id: string;
  name?: string;
  targetOrigin?: string;
  enabled?: boolean;
}

export interface CreateEgressOptions {
  name: string;
  listen: { host: string; port: number };
  offer: RouteOffer;
  access: { mode: "bearer" | "header" | "none"; token?: string };
}

export interface UpdateEgressOptions {
  id: string;
  name?: string;
  listen?: { host: string; port: number };
  enabled?: boolean;
}

export interface RotateEgressTokenOptions {
  mode: "bearer" | "header" | "none";
  token?: string;
}

export interface MutationResult {
  state: TunnelState;
  oneTimeToken?: string;
}

export class TunnelSubsystem {
  #configStore: TunnelSubsystemOptions["configStore"];
  #relayEndpoint: string;
  #relayUseTls: boolean;
  #relayPublicEndpoint: string;
  #relayPublicUseTls: boolean;
  #ingressRuntime: IngressRuntime | null = null;
  #egressRuntimes = new Map<string, EgressRuntime>();
  #ingressStartError: string | null = null;
  #egressErrors = new Map<string, string>();
  #mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: TunnelSubsystemOptions) {
    this.#configStore = options.configStore;
    this.#relayEndpoint = options.relayEndpoint;
    this.#relayUseTls = options.relayUseTls;
    this.#relayPublicEndpoint = options.relayPublicEndpoint ?? options.relayEndpoint;
    this.#relayPublicUseTls = options.relayPublicUseTls ?? options.relayUseTls;
  }

  getState(): TunnelState {
    const config = this.#loadConfig();
    const tunnel = config.daemon?.tunnel ?? {};
    return this.#sanitizeState(tunnel);
  }

  start(): Promise<void> {
    return this.#enqueueMutation(() => this.#start());
  }

  reload(): Promise<void> {
    return this.#enqueueMutation(() => this.#start());
  }

  createIngress(options: CreateIngressOptions): Promise<MutationResult> {
    return this.#enqueueMutation(() => this.#createIngress(options));
  }

  updateIngress(options: UpdateIngressOptions): Promise<MutationResult> {
    return this.#enqueueMutation(() => this.#updateIngress(options));
  }

  deleteIngress(id: string): Promise<MutationResult> {
    return this.#enqueueMutation(() => this.#deleteIngress(id));
  }

  rotateIngressSecret(id: string): Promise<MutationResult> {
    return this.#enqueueMutation(() => this.#rotateIngressSecret(id));
  }

  createEgress(options: CreateEgressOptions): Promise<MutationResult> {
    return this.#enqueueMutation(() => this.#createEgress(options));
  }

  updateEgress(options: UpdateEgressOptions): Promise<MutationResult> {
    return this.#enqueueMutation(() => this.#updateEgress(options));
  }

  deleteEgress(id: string): Promise<MutationResult> {
    return this.#enqueueMutation(() => this.#deleteEgress(id));
  }

  replaceEgressOffer(id: string, offer: RouteOffer): Promise<MutationResult> {
    return this.#enqueueMutation(() => this.#replaceEgressOffer(id, offer));
  }

  rotateEgressToken(id: string, options: RotateEgressTokenOptions): Promise<MutationResult> {
    return this.#enqueueMutation(() => this.#rotateEgressToken(id, options));
  }

  stop(): Promise<void> {
    return this.#enqueueMutation(() => this.#stop());
  }

  async #start(): Promise<void> {
    await this.#syncIngressRuntime({ allowUnavailable: true });
    const config = this.#loadConfig();
    const enabledEgressIds = new Set(
      (config.daemon?.tunnel?.egresses ?? [])
        .filter((egress) => egress.enabled)
        .map((egress) => egress.id),
    );
    for (const egressId of this.#egressRuntimes.keys()) {
      if (!enabledEgressIds.has(egressId)) await this.#stopEgressRuntime(egressId);
    }
    for (const egressId of enabledEgressIds) {
      try {
        await this.#syncEgressRuntime(egressId);
      } catch {
        this.#egressErrors.set(egressId, "Listener unavailable");
      }
    }
  }

  async #createIngress(options: CreateIngressOptions): Promise<MutationResult> {
    const config = this.#loadConfig();
    if (!config.daemon) config.daemon = {};
    if (!config.daemon.tunnel) config.daemon.tunnel = {};
    const tunnel = config.daemon.tunnel;

    if (tunnel.ingresses?.some((ingress) => ingress.name === options.name)) {
      throw new Error("Ingress name already exists");
    }

    // Ensure identity exists
    if (!tunnel.identity) {
      tunnel.identity = createTunnelIdentity();
    }

    // Generate ingress
    const ingress: PersistedIngress = {
      id: this.#generateId("ing"),
      name: options.name,
      enabled: true,
      targetOrigin: options.targetOrigin,
      routeId: this.#generateId("route"),
      routeSecret: this.#generateSecret(),
    };

    if (!tunnel.ingresses) tunnel.ingresses = [];
    tunnel.ingresses.push(ingress);

    await this.#commitIngressConfig(config);
    return { state: this.getState() };
  }

  async #updateIngress(options: UpdateIngressOptions): Promise<MutationResult> {
    const config = this.#loadConfig();
    const ingress = config.daemon?.tunnel?.ingresses?.find((i) => i.id === options.id);
    if (!ingress) throw new Error(`Ingress ${options.id} not found`);

    if (
      options.name !== undefined &&
      config.daemon?.tunnel?.ingresses?.some(
        (candidate) => candidate.id !== options.id && candidate.name === options.name,
      )
    ) {
      throw new Error("Ingress name already exists");
    }

    if (options.name !== undefined) ingress.name = options.name;
    if (options.targetOrigin !== undefined) ingress.targetOrigin = options.targetOrigin;
    if (options.enabled !== undefined) ingress.enabled = options.enabled;

    await this.#commitIngressConfig(config);
    return { state: this.getState() };
  }

  async #deleteIngress(id: string): Promise<MutationResult> {
    const config = this.#loadConfig();
    if (!config.daemon?.tunnel?.ingresses) throw new Error(`Ingress ${id} not found`);

    const index = config.daemon.tunnel.ingresses.findIndex((i) => i.id === id);
    if (index === -1) throw new Error(`Ingress ${id} not found`);
    config.daemon.tunnel.ingresses.splice(index, 1);

    await this.#commitIngressConfig(config);
    return { state: this.getState() };
  }

  async #rotateIngressSecret(id: string): Promise<MutationResult> {
    const config = this.#loadConfig();
    const ingress = config.daemon?.tunnel?.ingresses?.find((item) => item.id === id);
    if (!ingress) throw new Error(`Ingress ${id} not found`);
    ingress.routeSecret = this.#generateSecret();
    await this.#commitIngressConfig(config);
    return { state: this.getState() };
  }

  async exportRouteOffer(ingressId: string): Promise<RouteOffer> {
    const config = this.#loadConfig();
    const tunnel = config.daemon?.tunnel ?? {};
    const ingress = tunnel.ingresses?.find((i) => i.id === ingressId);
    if (!ingress) throw new Error(`Ingress ${ingressId} not found`);
    if (!tunnel.identity) throw new Error("Tunnel identity not initialized");

    const targetUrl = new URL(ingress.targetOrigin);
    const suggestedPort =
      Number.parseInt(targetUrl.port, 10) || (targetUrl.protocol === "https:" ? 443 : 80);

    return {
      protocolVersion: 1,
      relayEndpoint: this.#relayPublicEndpoint,
      relayUseTls: this.#relayPublicUseTls,
      tunnelServerId: tunnel.identity.serverId,
      tunnelPublicKeyB64: tunnel.identity.publicKeyB64,
      routeId: ingress.routeId,
      routeSecret: ingress.routeSecret,
      ingressHostName: "Local Host",
      ingressName: ingress.name,
      suggestedPort,
    };
  }

  async #createEgress(options: CreateEgressOptions): Promise<MutationResult> {
    const listenHost = this.#requireListenHost(options.listen.host);
    const current = this.#loadConfig();
    if (current.daemon?.tunnel?.egresses?.some((egress) => egress.name === options.name)) {
      throw new Error("Egress name already exists");
    }
    const oneTimeToken =
      options.access.mode === "none"
        ? undefined
        : (options.access.token ?? `pat-${randomBytes(32).toString("base64url")}`);
    const tokenHash = oneTimeToken === undefined ? undefined : this.#hashToken(oneTimeToken);

    const egressId = this.#generateId("egr");
    const runtime = new EgressRuntime({
      listen: { host: listenHost, port: options.listen.port },
      relayEndpoint: options.offer.relayEndpoint,
      relayUseTls: options.offer.relayUseTls,
      tunnelServerId: options.offer.tunnelServerId,
      tunnelPublicKeyB64: options.offer.tunnelPublicKeyB64,
      routeId: options.offer.routeId,
      routeSecret: options.offer.routeSecret,
      access: {
        mode: options.access.mode,
        tokenHash,
      },
    });
    await runtime.start();
    this.#egressRuntimes.set(egressId, runtime);

    const actualPort = runtime.getActualPort();
    const config = this.#loadConfig();
    if (!config.daemon) config.daemon = {};
    if (!config.daemon.tunnel) config.daemon.tunnel = {};
    const tunnel = config.daemon.tunnel;

    const egress: PersistedEgress = {
      id: egressId,
      name: options.name,
      enabled: true,
      listen: { host: listenHost, port: actualPort },
      offer: options.offer,
      access: {
        mode: options.access.mode,
        tokenHash,
      },
    };

    if (!tunnel.egresses) tunnel.egresses = [];
    tunnel.egresses.push(egress);

    this.#saveConfig(config);
    this.#egressErrors.delete(egressId);
    return {
      state: this.getState(),
      oneTimeToken,
    };
  }

  async #updateEgress(options: UpdateEgressOptions): Promise<MutationResult> {
    const listen = options.listen
      ? { host: this.#requireListenHost(options.listen.host), port: options.listen.port }
      : undefined;
    const config = this.#loadConfig();
    const previousConfig = structuredClone(config);
    const egress = config.daemon?.tunnel?.egresses?.find((e) => e.id === options.id);
    if (!egress) throw new Error(`Egress ${options.id} not found`);

    if (
      options.name !== undefined &&
      config.daemon?.tunnel?.egresses?.some(
        (candidate) => candidate.id !== options.id && candidate.name === options.name,
      )
    ) {
      throw new Error("Egress name already exists");
    }

    if (options.name !== undefined) egress.name = options.name;
    if (listen !== undefined) egress.listen = listen;
    if (options.enabled !== undefined) egress.enabled = options.enabled;

    await this.#commitEgressConfig(config, previousConfig, options.id);
    return { state: this.getState() };
  }

  async #deleteEgress(id: string): Promise<MutationResult> {
    const config = this.#loadConfig();
    if (!config.daemon?.tunnel?.egresses) throw new Error(`Egress ${id} not found`);

    const index = config.daemon.tunnel.egresses.findIndex((e) => e.id === id);
    if (index === -1) throw new Error(`Egress ${id} not found`);
    config.daemon.tunnel.egresses.splice(index, 1);

    this.#saveConfig(config);
    await this.#stopEgressRuntime(id);
    this.#egressErrors.delete(id);
    return { state: this.getState() };
  }

  async #replaceEgressOffer(id: string, offer: RouteOffer): Promise<MutationResult> {
    const config = this.#loadConfig();
    const previousConfig = structuredClone(config);
    const egress = config.daemon?.tunnel?.egresses?.find((item) => item.id === id);
    if (!egress) throw new Error(`Egress ${id} not found`);
    egress.offer = offer;
    await this.#commitEgressConfig(config, previousConfig, id);
    return { state: this.getState() };
  }

  async #rotateEgressToken(id: string, options: RotateEgressTokenOptions): Promise<MutationResult> {
    const config = this.#loadConfig();
    const previousConfig = structuredClone(config);
    const egress = config.daemon?.tunnel?.egresses?.find((item) => item.id === id);
    if (!egress) throw new Error(`Egress ${id} not found`);
    const oneTimeToken =
      options.mode === "none"
        ? undefined
        : (options.token ?? `pat-${randomBytes(32).toString("base64url")}`);
    egress.access = {
      mode: options.mode,
      tokenHash: oneTimeToken === undefined ? undefined : this.#hashToken(oneTimeToken),
    };
    await this.#commitEgressConfig(config, previousConfig, id);
    return { state: this.getState(), oneTimeToken };
  }

  async #stop(): Promise<void> {
    await this.#ingressRuntime?.stop();
    this.#ingressRuntime = null;
    this.#ingressStartError = null;
    for (const runtime of this.#egressRuntimes.values()) {
      await runtime.stop();
    }
    this.#egressRuntimes.clear();
    this.#egressErrors.clear();
  }

  getMetrics() {
    return {
      activeDataConnections: this.#ingressRuntime?.getMetrics().activeDataConnections ?? 0,
    };
  }

  async #syncIngressRuntime(options: { allowUnavailable: boolean }): Promise<void> {
    const config = this.#loadConfig();
    const nextRuntime = await this.#startIngressRuntime(config.daemon?.tunnel, options);
    const previousRuntime = this.#ingressRuntime;
    this.#ingressRuntime = nextRuntime;
    await previousRuntime?.stop();
  }

  async #commitIngressConfig(config: PersistedConfig): Promise<void> {
    const nextRuntime = await this.#startIngressRuntime(config.daemon?.tunnel, {
      allowUnavailable: false,
    });
    try {
      this.#saveConfig(config);
    } catch (error) {
      await nextRuntime?.stop();
      throw error;
    }
    const previousRuntime = this.#ingressRuntime;
    this.#ingressRuntime = nextRuntime;
    await previousRuntime?.stop();
  }

  async #startIngressRuntime(
    tunnel: PersistedTunnelConfig | undefined,
    options: { allowUnavailable: boolean },
  ): Promise<IngressRuntime | null> {
    const enabledIngresses = tunnel?.ingresses?.filter((i) => i.enabled) ?? [];

    if (enabledIngresses.length === 0) {
      return null;
    }

    if (!tunnel?.identity) throw new Error("Tunnel identity not initialized");

    const runtime = new IngressRuntime({
      relayEndpoint: this.#relayEndpoint,
      relayUseTls: this.#relayUseTls,
      tunnelServerId: tunnel.identity.serverId,
      tunnelKeyPair: {
        publicKey: importPublicKey(tunnel.identity.publicKeyB64),
        secretKey: importSecretKey(tunnel.identity.secretKeyB64),
      },
      routes: enabledIngresses.map((i) => ({
        routeId: i.routeId,
        routeSecret: i.routeSecret,
        targetOrigin: i.targetOrigin,
      })),
    });
    try {
      await runtime.start();
      this.#ingressStartError = null;
    } catch (error) {
      if (!options.allowUnavailable) {
        await runtime.stop();
        throw error;
      }
      this.#ingressStartError = "Relay unavailable";
    }
    return runtime;
  }

  async #syncEgressRuntime(egressId: string): Promise<void> {
    const config = this.#loadConfig();
    const egress = config.daemon?.tunnel?.egresses?.find((e) => e.id === egressId);

    if (!egress || !egress.enabled) {
      await this.#stopEgressRuntime(egressId);
      return;
    }

    await this.#stopEgressRuntime(egressId);

    const runtime = await this.#startEgressRuntime(egress);
    this.#egressRuntimes.set(egressId, runtime);
    this.#egressErrors.delete(egressId);

    const actualPort = runtime.getActualPort();
    if (actualPort !== egress.listen.port) {
      egress.listen.port = actualPort;
      this.#saveConfig(config);
    }
  }

  async #commitEgressConfig(
    config: PersistedConfig,
    previousConfig: PersistedConfig,
    egressId: string,
  ): Promise<void> {
    const egress = config.daemon?.tunnel?.egresses?.find((item) => item.id === egressId);
    const previousEgress = previousConfig.daemon?.tunnel?.egresses?.find(
      (item) => item.id === egressId,
    );
    await this.#stopEgressRuntime(egressId);

    let runtime: EgressRuntime | null = null;
    try {
      if (egress?.enabled) {
        runtime = await this.#startEgressRuntime(egress);
        egress.listen.port = runtime.getActualPort();
      }
      this.#saveConfig(config);
    } catch (error) {
      await runtime?.stop();
      if (previousEgress?.enabled) {
        const restored = await this.#startEgressRuntime(previousEgress);
        this.#egressRuntimes.set(egressId, restored);
      }
      throw error;
    }

    if (runtime) this.#egressRuntimes.set(egressId, runtime);
    this.#egressErrors.delete(egressId);
  }

  async #startEgressRuntime(egress: PersistedEgress): Promise<EgressRuntime> {
    const runtime = new EgressRuntime({
      listen: egress.listen,
      relayEndpoint: egress.offer.relayEndpoint,
      relayUseTls: egress.offer.relayUseTls,
      tunnelServerId: egress.offer.tunnelServerId,
      tunnelPublicKeyB64: egress.offer.tunnelPublicKeyB64,
      routeId: egress.offer.routeId,
      routeSecret: egress.offer.routeSecret,
      access: egress.access,
    });
    await runtime.start();
    return runtime;
  }

  async #stopEgressRuntime(egressId: string): Promise<void> {
    const runtime = this.#egressRuntimes.get(egressId);
    if (runtime) {
      await runtime.stop();
      this.#egressRuntimes.delete(egressId);
    }
  }

  #sanitizeState(config: PersistedTunnelConfig): TunnelState {
    const hasEnabledIngresses = config.ingresses?.some((i) => i.enabled) ?? false;
    let relayStatus: TunnelRelayStatus = "inactive";
    if (hasEnabledIngresses) {
      relayStatus = this.#ingressRuntime?.getStatus() ?? "error";
      if (this.#ingressStartError && !this.#ingressRuntime) relayStatus = "error";
    }

    const ingresses: TunnelIngressState[] = (config.ingresses ?? []).map((ingress) => {
      let status: TunnelIngressState["status"] = "disabled";
      if (ingress.enabled) status = relayStatus === "ready" ? "ready" : "error";
      return {
        id: ingress.id,
        name: ingress.name,
        enabled: ingress.enabled,
        targetOrigin: ingress.targetOrigin,
        status,
      };
    });

    const egresses: TunnelEgressState[] = (config.egresses ?? []).map((egress) => {
      const runtime = this.#egressRuntimes.get(egress.id);
      const error = this.#egressErrors.get(egress.id);
      let status: TunnelEgressState["status"] = "disabled";
      if (egress.enabled && runtime) status = "listening";
      if (egress.enabled && !runtime) status = error ? "error" : "starting";

      const state: TunnelEgressState = {
        id: egress.id,
        name: egress.name,
        enabled: egress.enabled,
        listen: egress.listen,
        ingressHostName: egress.offer.ingressHostName,
        ingressName: egress.offer.ingressName,
        access: {
          mode: egress.access.mode,
          configured: egress.access.mode === "none" || Boolean(egress.access.tokenHash),
        },
        status,
      };
      if (error) state.error = error;
      return state;
    });

    return { relayStatus, ingresses, egresses };
  }

  #generateId(prefix: string): string {
    return `${prefix}_${randomBytes(8).toString("hex")}`;
  }

  #generateSecret(): string {
    return randomBytes(32).toString("hex");
  }

  #hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  #requireListenHost(host: string): TunnelListenHost {
    if (host === "127.0.0.1" || host === "0.0.0.0") return host;
    throw new Error("Listener host must be 127.0.0.1 or 0.0.0.0");
  }

  #loadConfig(): PersistedConfig {
    return this.#configStore.getPersistedConfigSnapshot();
  }

  #saveConfig(config: PersistedConfig): void {
    this.#configStore.setPersistedTunnelConfig(config.daemon?.tunnel ?? {});
  }

  #enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#mutationQueue.then(operation, operation);
    this.#mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
