import { randomBytes, createHash } from "node:crypto";
import { loadPersistedConfig, savePersistedConfig } from "../persisted-config.js";
import {
  type PersistedTunnelConfig,
  type PersistedIngress,
  type PersistedEgress,
  type RouteOffer,
  createTunnelIdentity,
} from "./config.js";
import type {
  TunnelState,
  TunnelIngressState,
  TunnelEgressState,
  TunnelRelayStatus,
} from "@getpaseo/protocol/tunnel-messages";

export interface TunnelSubsystemOptions {
  paseoHome: string;
  relayEndpoint: string;
  relayUseTls: boolean;
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

export interface MutationResult {
  state: TunnelState;
  oneTimeToken?: string;
}

export class TunnelSubsystem {
  #paseoHome: string;
  #relayEndpoint: string;
  #relayUseTls: boolean;

  constructor(options: TunnelSubsystemOptions) {
    this.#paseoHome = options.paseoHome;
    this.#relayEndpoint = options.relayEndpoint;
    this.#relayUseTls = options.relayUseTls;
  }

  getState(): TunnelState {
    const config = loadPersistedConfig(this.#paseoHome);
    const tunnel = config.daemon?.tunnel ?? {};
    return this.#sanitizeState(tunnel);
  }

  async createIngress(options: CreateIngressOptions): Promise<MutationResult> {
    const config = loadPersistedConfig(this.#paseoHome);
    if (!config.daemon) config.daemon = {};
    if (!config.daemon.tunnel) config.daemon.tunnel = {};
    const tunnel = config.daemon.tunnel;

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

    savePersistedConfig(this.#paseoHome, config);
    return { state: this.getState() };
  }

  async updateIngress(options: UpdateIngressOptions): Promise<MutationResult> {
    const config = loadPersistedConfig(this.#paseoHome);
    const ingress = config.daemon?.tunnel?.ingresses?.find((i) => i.id === options.id);
    if (!ingress) throw new Error(`Ingress ${options.id} not found`);

    if (options.name !== undefined) ingress.name = options.name;
    if (options.targetOrigin !== undefined) ingress.targetOrigin = options.targetOrigin;
    if (options.enabled !== undefined) ingress.enabled = options.enabled;

    savePersistedConfig(this.#paseoHome, config);
    return { state: this.getState() };
  }

  async deleteIngress(id: string): Promise<MutationResult> {
    const config = loadPersistedConfig(this.#paseoHome);
    if (!config.daemon?.tunnel?.ingresses) throw new Error(`Ingress ${id} not found`);

    const index = config.daemon.tunnel.ingresses.findIndex((i) => i.id === id);
    if (index === -1) throw new Error(`Ingress ${id} not found`);
    config.daemon.tunnel.ingresses.splice(index, 1);

    savePersistedConfig(this.#paseoHome, config);
    return { state: this.getState() };
  }

  async exportRouteOffer(ingressId: string): Promise<RouteOffer> {
    const config = loadPersistedConfig(this.#paseoHome);
    const tunnel = config.daemon?.tunnel ?? {};
    const ingress = tunnel.ingresses?.find((i) => i.id === ingressId);
    if (!ingress) throw new Error(`Ingress ${ingressId} not found`);
    if (!tunnel.identity) throw new Error("Tunnel identity not initialized");

    const targetUrl = new URL(ingress.targetOrigin);
    const suggestedPort =
      Number.parseInt(targetUrl.port, 10) || (targetUrl.protocol === "https:" ? 443 : 80);

    return {
      protocolVersion: 1,
      relayEndpoint: this.#relayEndpoint,
      relayUseTls: this.#relayUseTls,
      tunnelServerId: tunnel.identity.serverId,
      tunnelPublicKeyB64: tunnel.identity.publicKeyB64,
      routeId: ingress.routeId,
      routeSecret: ingress.routeSecret,
      ingressHostName: "Local Host",
      ingressName: ingress.name,
      suggestedPort,
    };
  }

  async createEgress(options: CreateEgressOptions): Promise<MutationResult> {
    const tokenHash =
      options.access.token && options.access.mode !== "none"
        ? this.#hashToken(options.access.token)
        : undefined;

    const config = loadPersistedConfig(this.#paseoHome);
    if (!config.daemon) config.daemon = {};
    if (!config.daemon.tunnel) config.daemon.tunnel = {};
    const tunnel = config.daemon.tunnel;

    const egress: PersistedEgress = {
      id: this.#generateId("egr"),
      name: options.name,
      enabled: true,
      listen: options.listen,
      offer: options.offer,
      access: {
        mode: options.access.mode,
        tokenHash,
      },
    };

    if (!tunnel.egresses) tunnel.egresses = [];
    tunnel.egresses.push(egress);

    savePersistedConfig(this.#paseoHome, config);
    return {
      state: this.getState(),
      oneTimeToken: options.access.token,
    };
  }

  async updateEgress(options: UpdateEgressOptions): Promise<MutationResult> {
    const config = loadPersistedConfig(this.#paseoHome);
    const egress = config.daemon?.tunnel?.egresses?.find((e) => e.id === options.id);
    if (!egress) throw new Error(`Egress ${options.id} not found`);

    if (options.name !== undefined) egress.name = options.name;
    if (options.listen !== undefined) egress.listen = options.listen;
    if (options.enabled !== undefined) egress.enabled = options.enabled;

    savePersistedConfig(this.#paseoHome, config);
    return { state: this.getState() };
  }

  async deleteEgress(id: string): Promise<MutationResult> {
    const config = loadPersistedConfig(this.#paseoHome);
    if (!config.daemon?.tunnel?.egresses) throw new Error(`Egress ${id} not found`);

    const index = config.daemon.tunnel.egresses.findIndex((e) => e.id === id);
    if (index === -1) throw new Error(`Egress ${id} not found`);
    config.daemon.tunnel.egresses.splice(index, 1);

    savePersistedConfig(this.#paseoHome, config);
    return { state: this.getState() };
  }

  async stop(): Promise<void> {
    // Placeholder for cleanup
  }

  #sanitizeState(config: PersistedTunnelConfig): TunnelState {
    const relayStatus: TunnelRelayStatus =
      config.ingresses && config.ingresses.length > 0 && config.ingresses.some((i) => i.enabled)
        ? "ready"
        : "inactive";

    const ingresses: TunnelIngressState[] = (config.ingresses ?? []).map((i) => ({
      id: i.id,
      name: i.name,
      enabled: i.enabled,
      targetOrigin: i.targetOrigin,
      status: i.enabled ? "ready" : "disabled",
    }));

    const egresses: TunnelEgressState[] = (config.egresses ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      enabled: e.enabled,
      listen: e.listen,
      ingressHostName: e.offer.ingressHostName,
      ingressName: e.offer.ingressName,
      access: {
        mode: e.access.mode,
        configured: e.access.mode === "none" || Boolean(e.access.tokenHash),
      },
      status: e.enabled ? "listening" : "disabled",
    }));

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
}
