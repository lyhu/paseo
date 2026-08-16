import { describe, expect, it } from "vitest";
import {
  type PersistedTunnelConfig,
  PersistedTunnelConfigSchema,
  createTunnelIdentity,
} from "./config.js";

describe("Tunnel config schema", () => {
  it("validates a complete tunnel config with identity, ingresses, and egresses", () => {
    const config: PersistedTunnelConfig = {
      identity: {
        serverId: "tunnel_abc123",
        publicKeyB64: "SGVsbG8gV29ybGQ=",
        secretKeyB64: "U2VjcmV0S2V5MTIzNDU2Nzg5MA==",
      },
      ingresses: [
        {
          id: "ing_1",
          name: "Production API",
          enabled: true,
          targetOrigin: "http://localhost:8000",
          routeId: "route_abc",
          routeSecret: "secret_xyz",
        },
      ],
      egresses: [
        {
          id: "egr_1",
          name: "External Access",
          enabled: true,
          listen: { host: "127.0.0.1", port: 8080 },
          offer: {
            protocolVersion: 1,
            relayEndpoint: "wss://relay.paseo.sh",
            relayUseTls: true,
            tunnelServerId: "tunnel_abc123",
            tunnelPublicKeyB64: "SGVsbG8gV29ybGQ=",
            routeId: "route_abc",
            routeSecret: "secret_xyz",
            ingressHostName: "Dev Machine",
            ingressName: "Production API",
            suggestedPort: 8000,
          },
          access: {
            mode: "header",
            tokenHash: "hashed_token",
          },
        },
      ],
    };

    const result = PersistedTunnelConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("accepts empty config with no tunnel setup", () => {
    const result = PersistedTunnelConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success");
    expect(result.data).toEqual({});
  });

  it("generates a unique tunnel identity", () => {
    const identity1 = createTunnelIdentity();
    const identity2 = createTunnelIdentity();

    expect(identity1.serverId).toMatch(/^tunnel_[a-f0-9]{16}$/);
    expect(identity1.publicKeyB64).toBeTruthy();
    expect(identity1.secretKeyB64).toBeTruthy();
    expect(identity1.serverId).not.toBe(identity2.serverId);
  });

  it("rejects invalid target origins", () => {
    const withPath = PersistedTunnelConfigSchema.safeParse({
      ingresses: [
        {
          id: "ing_1",
          name: "Test",
          enabled: true,
          targetOrigin: "http://localhost:8000/path",
          routeId: "route_1",
          routeSecret: "secret_1",
        },
      ],
    });
    expect(withPath.success).toBe(false);

    const withQuery = PersistedTunnelConfigSchema.safeParse({
      ingresses: [
        {
          id: "ing_1",
          name: "Test",
          enabled: true,
          targetOrigin: "http://localhost:8000?query=1",
          routeId: "route_1",
          routeSecret: "secret_1",
        },
      ],
    });
    expect(withQuery.success).toBe(false);
  });

  it("rejects unknown persisted fields", () => {
    expect(() =>
      PersistedTunnelConfigSchema.parse({
        ingresses: [],
        unexpected: true,
      }),
    ).toThrow();
  });

  it("validates access modes", () => {
    const validModes = ["header", "bearer", "none"];
    for (const mode of validModes) {
      const result = PersistedTunnelConfigSchema.safeParse({
        egresses: [
          {
            id: "egr_1",
            name: "Test",
            enabled: true,
            listen: { host: "127.0.0.1", port: 8080 },
            offer: {
              protocolVersion: 1,
              relayEndpoint: "wss://relay.paseo.sh",
              relayUseTls: true,
              tunnelServerId: "tunnel_1",
              tunnelPublicKeyB64: "key",
              routeId: "route_1",
              routeSecret: "secret_1",
              ingressHostName: "Host",
              ingressName: "Ingress",
              suggestedPort: 8000,
            },
            access: { mode },
          },
        ],
      });
      expect(result.success).toBe(true);
    }
  });
});
