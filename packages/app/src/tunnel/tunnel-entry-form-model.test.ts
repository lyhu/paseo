import { describe, expect, it } from "vitest";
import { openEgressForm } from "./egress-form-model";
import { openIngressForm } from "./ingress-form-model";
import { openRouteOfferForm } from "./route-offer-form-model";
import { openAccessTokenForm } from "./access-token-form-model";

describe("Ingress form model", () => {
  it("opens each form from its supplied snapshot", () => {
    const first = openIngressForm({
      mode: "edit",
      entry: { id: "ing_1", name: "API", targetOrigin: "http://127.0.0.1:3000" },
    });
    first.setName("Changed");

    const second = openIngressForm({ mode: "create" });

    expect(first.getState().name).toBe("Changed");
    expect(second.getState()).toMatchObject({
      name: "",
      targetOrigin: "",
      canSubmit: false,
    });
  });

  it("accepts only a complete HTTP origin", () => {
    const form = openIngressForm({ mode: "create" });
    form.setName("API");
    form.setTargetOrigin("https://api.example.test/path");
    expect(form.getState().canSubmit).toBe(false);

    form.setTargetOrigin("https://api.example.test:8443");
    expect(form.getState()).toMatchObject({
      canSubmit: true,
      targetOrigin: "https://api.example.test:8443",
    });
  });
});

describe("Egress form model", () => {
  it("requires a valid route offer and port when creating", () => {
    const form = openEgressForm({ mode: "create" });
    form.setName("Public API");
    form.setRouteOfferText("not json");
    form.setListenPort("8080");
    expect(form.getState().canSubmit).toBe(false);

    form.setRouteOfferText(JSON.stringify({ protocolVersion: 1 }));
    expect(form.getState().canSubmit).toBe(false);

    form.setRouteOfferText(JSON.stringify(offer));
    expect(form.getState()).toMatchObject({ canSubmit: true, listenPort: "8080" });
  });

  it("keeps optional access credentials in its own state", () => {
    const form = openEgressForm({ mode: "create" });
    expect(form.getState()).toMatchObject({
      accessMode: "header",
      listenHost: "127.0.0.1",
    });

    form.setAccessMode("bearer");
    form.setAccessToken("custom-token");

    expect(form.getState()).toMatchObject({
      accessMode: "bearer",
      accessToken: "custom-token",
    });
  });

  it("accepts only the two listener scopes", () => {
    const form = openEgressForm({ mode: "create", offer });
    form.setName("Public API");
    expect(form.getState()).toMatchObject({ canSubmit: true, listenPort: "8080" });

    form.setListenHost("192.168.1.20");
    expect(form.getState().canSubmit).toBe(false);

    form.setListenHost("0.0.0.0");
    expect(form.getState().canSubmit).toBe(true);
  });
});

describe("Tunnel auxiliary form models", () => {
  it("validates a replacement Route Offer without ingress or egress fields", () => {
    const form = openRouteOfferForm({ entryId: "eg_1" });

    form.setRouteOfferText("invalid");
    expect(form.getState()).toEqual({
      entryId: "eg_1",
      routeOfferText: "invalid",
      canSubmit: false,
      submitError: null,
    });

    form.setRouteOfferText(JSON.stringify(offer));
    expect(form.getState().canSubmit).toBe(true);
    expect(form.getRouteOffer()).toEqual(offer);
  });

  it("keeps token rotation independent from the egress create/edit form", () => {
    const form = openAccessTokenForm({
      entryId: "eg_1",
      entryName: "Public API",
      accessMode: "header",
    });

    form.setAccessMode("bearer");
    form.setAccessToken("replacement-token");

    expect(form.getState()).toEqual({
      entryId: "eg_1",
      entryName: "Public API",
      accessMode: "bearer",
      accessToken: "replacement-token",
      canSubmit: true,
      submitError: null,
    });
  });
});

const offer = {
  protocolVersion: 1 as const,
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
