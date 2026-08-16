import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DaemonConfigStore } from "../daemon-config-store.js";
import { TunnelSession } from "./session.js";
import { TunnelSubsystem } from "./subsystem.js";
import { createInProcessRelay, type RelayHarness } from "./test-relay-harness.js";

describe("TunnelSession", () => {
  let paseoHome: string;
  let relay: RelayHarness;
  let subsystem: TunnelSubsystem;
  let messages: SessionOutboundMessage[];
  let session: TunnelSession;

  beforeEach(async () => {
    paseoHome = mkdtempSync(join(tmpdir(), "paseo-tunnel-session-"));
    relay = await createInProcessRelay();
    const configStore = new DaemonConfigStore(paseoHome, {
      relay: { enabled: false },
      mcp: { injectIntoAgents: false },
      browserTools: { enabled: false },
      providers: {},
      metadataGeneration: { providers: [] },
      autoArchiveAfterMerge: false,
      enableTerminalAgentHooks: false,
      appendSystemPrompt: "",
    });
    subsystem = new TunnelSubsystem({
      configStore,
      relayEndpoint: relay.httpBaseUrl,
      relayUseTls: false,
    });
    messages = [];
    session = new TunnelSession({ emit: (message) => messages.push(message) }, subsystem);
  });

  afterEach(async () => {
    await subsystem.stop();
    await relay.stop();
    rmSync(paseoHome, { recursive: true, force: true });
  });

  it("creates, reads, and exports an ingress through dotted RPCs", async () => {
    await session.dispatch({
      type: "tunnel.http.entry.mutate.request",
      requestId: "create-1",
      mutation: {
        operation: "createIngress",
        name: "RPC ingress",
        targetOrigin: "http://localhost:9600",
      },
    });

    expect(messages[0]).toMatchObject({
      type: "tunnel.http.entry.mutate.response",
      payload: {
        requestId: "create-1",
        state: { ingresses: [{ name: "RPC ingress" }] },
      },
    });

    session.dispatch({ type: "tunnel.http.state.get.request", requestId: "state-1" });
    const stateResponse = messages[1];
    expect(stateResponse).toMatchObject({
      type: "tunnel.http.state.get.response",
      payload: { requestId: "state-1", state: { ingresses: [{ name: "RPC ingress" }] } },
    });
    if (stateResponse.type !== "tunnel.http.state.get.response") {
      throw new Error("Unexpected Tunnel state response");
    }

    await session.dispatch({
      type: "tunnel.http.ingress.offer.export.request",
      requestId: "offer-1",
      ingressId: stateResponse.payload.state.ingresses[0].id,
    });

    expect(messages[2]).toMatchObject({
      type: "tunnel.http.ingress.offer.export.response",
      payload: {
        requestId: "offer-1",
        offer: { ingressName: "RPC ingress", protocolVersion: 1 },
      },
    });
  });

  it("rejects unsupported listener hosts at the mutation RPC boundary", async () => {
    const ingress = await subsystem.createIngress({
      name: "RPC ingress",
      targetOrigin: "http://localhost:9600",
    });
    const offer = await subsystem.exportRouteOffer(ingress.state.ingresses[0].id);

    await expect(
      session.dispatch({
        type: "tunnel.http.entry.mutate.request",
        requestId: "create-egress-1",
        mutation: {
          operation: "createEgress",
          name: "Unsupported listener",
          listen: { host: "127.0.0.2", port: 8080 },
          offer,
          access: { mode: "none" },
        },
      }),
    ).rejects.toThrow("Listener host must be 127.0.0.1 or 0.0.0.0");
    expect(messages).toEqual([]);
    expect(subsystem.getState().egresses).toEqual([]);
  });
});
