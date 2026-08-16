import { exportPublicKey, generateKeyPair } from "@getpaseo/relay/e2ee";
import { afterEach, describe, expect, test } from "vitest";
import { EgressRuntime } from "./egress-runtime.js";
import { createInProcessRelay, type RelayHarness } from "./test-relay-harness.js";

describe("EgressRuntime", () => {
  let relay: RelayHarness | null = null;
  let runtime: EgressRuntime | null = null;

  afterEach(async () => {
    await runtime?.stop();
    await relay?.stop();
  });

  test("returns a fixed 502 when the E2EE peer never becomes ready", async () => {
    relay = await createInProcessRelay();
    const keyPair = generateKeyPair();
    runtime = new EgressRuntime({
      listen: { host: "127.0.0.1", port: 0 },
      relayEndpoint: relay.httpBaseUrl,
      relayUseTls: false,
      tunnelServerId: "missing-ingress",
      tunnelPublicKeyB64: exportPublicKey(keyPair.publicKey),
      routeId: "route_1",
      routeSecret: "secret_1",
      access: { mode: "none" },
      readyTimeoutMs: 25,
    });
    await runtime.start();

    const response = await fetch(`http://127.0.0.1:${runtime.getActualPort()}/v1/models`);

    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Tunnel request failed");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.getMetrics()).toEqual({
      activeDataConnections: 0,
      totalDataConnections: 1,
    });
  });
});
