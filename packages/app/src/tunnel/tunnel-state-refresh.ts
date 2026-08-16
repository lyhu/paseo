export const TUNNEL_STATE_REFRESH_MS = 1_000;

export function shouldPollTunnelState(connected: boolean, supported: boolean): boolean {
  return connected && supported;
}
