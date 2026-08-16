import { describe, expect, it } from "vitest";
import {
  FLOW_WINDOW_BYTES,
  FRAME_BYTES,
  TunnelCreditWindow,
  decodeTunnelFrame,
  encodeTunnelFrame,
} from "./tunnel-wire.js";

describe("Tunnel wire protocol", () => {
  it("round-trips a request head with repeated headers", () => {
    const frame = decodeTunnelFrame(
      encodeTunnelFrame({
        v: 1,
        type: "request.head",
        method: "POST",
        path: "/v1/chat/completions?stream=true",
        routeId: "route_1",
        routeSecret: "secret_1",
        client: { address: "127.0.0.1", host: "caller.example", protocol: "http" },
        headers: [
          ["x-example", "one"],
          ["x-example", "two"],
        ],
      }),
    );

    expect(frame).toEqual({
      v: 1,
      type: "request.head",
      method: "POST",
      path: "/v1/chat/completions?stream=true",
      routeId: "route_1",
      routeSecret: "secret_1",
      client: { address: "127.0.0.1", host: "caller.example", protocol: "http" },
      headers: [
        ["x-example", "one"],
        ["x-example", "two"],
      ],
    });
  });

  it("only allows eight 64 KiB chunks before acknowledgement", () => {
    const window = new TunnelCreditWindow();

    for (let index = 0; index < 8; index += 1) window.reserve(FRAME_BYTES);

    expect(window.usedBytes).toBe(FLOW_WINDOW_BYTES);
    expect(() => window.reserve(1)).toThrow("credit window exhausted");
    window.acknowledge(FRAME_BYTES);
    window.reserve(1);
    expect(window.usedBytes).toBe(FLOW_WINDOW_BYTES - FRAME_BYTES + 1);
  });

  it("rejects malformed or oversized protocol frames", () => {
    expect(() => decodeTunnelFrame('{"type":"request.head","method":"GET"}')).toThrow(
      "Invalid Tunnel frame",
    );
    expect(() => new TunnelCreditWindow().reserve(FRAME_BYTES + 1)).toThrow(
      "chunk exceeds 65536 byte limit",
    );
  });

  it("accepts only fixed public error codes", () => {
    expect(decodeTunnelFrame('{"v":1,"type":"error","code":"ROUTE_NOT_FOUND"}')).toEqual({
      v: 1,
      type: "error",
      code: "ROUTE_NOT_FOUND",
    });
    expect(() =>
      decodeTunnelFrame('{"v":1,"type":"error","code":"http://internal.example"}'),
    ).toThrow("Invalid Tunnel frame");
  });
});
