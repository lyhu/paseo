import { describe, expect, it } from "vitest";
import { TUNNEL_STATE_REFRESH_MS, shouldPollTunnelState } from "./tunnel-state-refresh";

describe("Tunnel state refresh", () => {
  it("polls only while a supported Host is connected", () => {
    expect(shouldPollTunnelState(true, true)).toBe(true);
    expect(shouldPollTunnelState(false, true)).toBe(false);
    expect(shouldPollTunnelState(true, false)).toBe(false);
  });

  it("uses a one second runtime refresh interval", () => {
    expect(TUNNEL_STATE_REFRESH_MS).toBe(1_000);
  });
});
