import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TunnelSubsystem } from "./subsystem.js";

describe("TunnelSubsystem", () => {
  let subsystem: TunnelSubsystem;
  let testHome: string;

  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "paseo-tunnel-test-"));
    subsystem = new TunnelSubsystem({
      paseoHome: testHome,
      relayEndpoint: "wss://relay.example.com",
      relayUseTls: true,
    });
  });

  afterEach(async () => {
    await subsystem.stop();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("starts with empty state when no config exists", () => {
    const state = subsystem.getState();
    expect(state.relayStatus).toBe("inactive");
    expect(state.ingresses).toEqual([]);
    expect(state.egresses).toEqual([]);
  });

  it("creates an ingress with generated identity and route credentials", async () => {
    const result = await subsystem.createIngress({
      name: "Test API",
      targetOrigin: "http://localhost:8000",
    });

    expect(result.state.ingresses).toHaveLength(1);
    const ingress = result.state.ingresses[0];
    expect(ingress.name).toBe("Test API");
    expect(ingress.targetOrigin).toBe("http://localhost:8000");
    expect(ingress.enabled).toBe(true);
    expect(ingress.status).toBe("ready");
    expect(ingress.id).toMatch(/^ing_[a-f0-9]+$/);

    // Verify it's persisted by reading fresh state
    const freshState = subsystem.getState();
    expect(freshState.ingresses).toHaveLength(1);
  });

  it("creates an egress with route offer", async () => {
    // First create an ingress
    const ingressResult = await subsystem.createIngress({
      name: "Backend",
      targetOrigin: "http://localhost:3000",
    });
    const ingress = ingressResult.state.ingresses[0];

    // Export the offer
    const offer = await subsystem.exportRouteOffer(ingress.id);

    // Create egress with the offer
    const result = await subsystem.createEgress({
      name: "Public Access",
      listen: { host: "127.0.0.1", port: 8080 },
      offer,
      access: { mode: "header", token: "test-token-123" },
    });

    expect(result.state.egresses).toHaveLength(1);
    const egress = result.state.egresses[0];
    expect(egress.name).toBe("Public Access");
    expect(egress.listen).toEqual({ host: "127.0.0.1", port: 8080 });
    expect(egress.access.mode).toBe("header");
    expect(egress.access.configured).toBe(true);
    expect(egress.id).toMatch(/^egr_[a-f0-9]+$/);

    // One-time token should be returned
    expect(result.oneTimeToken).toBe("test-token-123");
  });

  it("updates ingress properties", async () => {
    const createResult = await subsystem.createIngress({
      name: "Original",
      targetOrigin: "http://localhost:8000",
    });
    const ingressId = createResult.state.ingresses[0].id;

    const updateResult = await subsystem.updateIngress({
      id: ingressId,
      name: "Updated Name",
      targetOrigin: "https://api.example.com",
      enabled: false,
    });

    const ingress = updateResult.state.ingresses[0];
    expect(ingress.name).toBe("Updated Name");
    expect(ingress.targetOrigin).toBe("https://api.example.com");
    expect(ingress.enabled).toBe(false);
    expect(ingress.status).toBe("disabled");
  });

  it("deletes an ingress", async () => {
    const createResult = await subsystem.createIngress({
      name: "Temporary",
      targetOrigin: "http://localhost:9000",
    });
    const ingressId = createResult.state.ingresses[0].id;

    const deleteResult = await subsystem.deleteIngress(ingressId);
    expect(deleteResult.state.ingresses).toHaveLength(0);
  });

  it("preserves tunnel identity after deleting all ingresses", async () => {
    const createResult = await subsystem.createIngress({
      name: "Temporary",
      targetOrigin: "http://localhost:9000",
    });
    const offer1 = await subsystem.exportRouteOffer(createResult.state.ingresses[0].id);

    await subsystem.deleteIngress(createResult.state.ingresses[0].id);

    // Create another ingress and verify identity is stable
    const secondResult = await subsystem.createIngress({
      name: "Second",
      targetOrigin: "http://localhost:9001",
    });
    const offer2 = await subsystem.exportRouteOffer(secondResult.state.ingresses[0].id);
    expect(offer1.tunnelServerId).toBe(offer2.tunnelServerId);
  });

  it("sanitizes state by removing secrets", async () => {
    await subsystem.createIngress({
      name: "Test",
      targetOrigin: "http://localhost:8000",
    });

    const state = subsystem.getState();
    const serialized = JSON.stringify(state);

    // Should not contain secret fields
    expect(serialized).not.toContain("routeSecret");
    expect(serialized).not.toContain("secretKeyB64");
    expect(serialized).not.toContain("tokenHash");
  });
});
