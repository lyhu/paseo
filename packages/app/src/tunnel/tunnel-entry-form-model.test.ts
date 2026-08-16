import { describe, expect, it } from "vitest";
import { openTunnelEntryForm } from "./tunnel-entry-form-model";

describe("Tunnel entry form model", () => {
  it("opens each ingress form from its supplied snapshot", () => {
    const first = openTunnelEntryForm({
      kind: "ingress",
      mode: "edit",
      entry: { id: "ing_1", name: "API", targetOrigin: "http://127.0.0.1:3000" },
    });
    first.setName("Changed");

    const second = openTunnelEntryForm({
      kind: "ingress",
      mode: "create",
    });

    expect(first.getState().name).toBe("Changed");
    expect(second.getState()).toMatchObject({
      name: "",
      targetOrigin: "",
      canSubmit: false,
    });
  });

  it("accepts only a complete HTTP origin for an ingress submission", () => {
    const form = openTunnelEntryForm({ kind: "ingress", mode: "create" });
    form.setName("API");
    form.setTargetOrigin("https://api.example.test/path");
    expect(form.getState().canSubmit).toBe(false);

    form.setTargetOrigin("https://api.example.test:8443");
    expect(form.getState()).toMatchObject({
      canSubmit: true,
      targetOrigin: "https://api.example.test:8443",
    });
  });

  it("requires a valid route offer and port for a new egress", () => {
    const form = openTunnelEntryForm({ kind: "egress", mode: "create" });
    form.setName("Public API");
    form.setRouteOfferText("not json");
    form.setListenPort("8080");
    expect(form.getState().canSubmit).toBe(false);

    form.setRouteOfferText(JSON.stringify({ protocolVersion: 1 }));
    expect(form.getState().canSubmit).toBe(false);

    form.setRouteOfferText(JSON.stringify(offer));
    expect(form.getState()).toMatchObject({ canSubmit: true, listenPort: "8080" });
  });

  it("keeps optional egress access credentials in the form state", () => {
    const form = openTunnelEntryForm({ kind: "egress", mode: "create" });
    form.setAccessMode("bearer");
    form.setAccessToken("custom-token");

    expect(form.getState()).toMatchObject({
      accessMode: "bearer",
      accessToken: "custom-token",
    });
  });
});

const offer = {
  protocolVersion: 1,
  relayEndpoint: "wss://relay.example.test",
  relayUseTls: true,
  tunnelServerId: "tunnel_1",
  tunnelPublicKeyB64: "public-key",
  routeId: "route_1",
  routeSecret: "secret",
  ingressHostName: "Host",
  ingressName: "Ingress",
  suggestedPort: 8080,
};
