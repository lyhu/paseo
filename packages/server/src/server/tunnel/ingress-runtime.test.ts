import { generateKeyPair } from "@getpaseo/relay/e2ee";
import { afterEach, describe, expect, test } from "vitest";
import { IngressRuntime, type IngressRuntimeStatus } from "./ingress-runtime.js";
import { createInProcessRelay, type RelayHarness } from "./test-relay-harness.js";

describe("IngressRuntime", () => {
  let relay: RelayHarness | null = null;
  let runtime: IngressRuntime | null = null;

  afterEach(async () => {
    await runtime?.stop();
    await relay?.stop();
  });

  test("reconnects its control connection after the relay disconnects", async () => {
    relay = await createInProcessRelay();
    const statuses: IngressRuntimeStatus[] = [];
    runtime = new IngressRuntime({
      relayEndpoint: relay.httpBaseUrl,
      relayUseTls: false,
      tunnelServerId: "reconnect-ingress",
      tunnelKeyPair: generateKeyPair(),
      routes: [],
      reconnectDelayMs: 10,
      readyTimeoutMs: 250,
      onStatus: (status) => statuses.push(status),
    });

    await runtime.start();
    expect(runtime.getStatus()).toBe("ready");

    relay.dropControlConnections();
    await waitForStatus(runtime, "connecting");
    await waitForStatus(runtime, "ready");

    expect(statuses).toEqual(["connecting", "ready", "connecting", "ready"]);
  });
});

async function waitForStatus(
  runtime: IngressRuntime,
  expected: IngressRuntimeStatus,
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (runtime.getStatus() !== expected) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for Ingress status ${expected}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
