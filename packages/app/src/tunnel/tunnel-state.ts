import { useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TunnelMutationPayload, TunnelState } from "@getpaseo/protocol/tunnel-messages";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { shouldPollTunnelState, TUNNEL_STATE_REFRESH_MS } from "./tunnel-state-refresh";

export function tunnelStateQueryKey(serverId: string) {
  return ["tunnel", serverId] as const;
}

export function useTunnelState(serverId: string, supported: boolean) {
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => tunnelStateQueryKey(serverId), [serverId]);
  const state = useFetchQuery({
    queryKey,
    dataShape: "value",
    staleTimeMs: 1_000,
    enabled: Boolean(client && connected && supported),
    refetchInterval: shouldPollTunnelState(connected, supported) ? TUNNEL_STATE_REFRESH_MS : false,
    queryFn: async () => {
      if (!client) throw new Error("Tunnel host is offline");
      return (await client.tunnelHttpStateGet()).state;
    },
  });
  const mutate = useMutation({
    mutationFn: async (mutation: TunnelMutationPayload) => {
      if (!client) throw new Error("Tunnel host is offline");
      return client.tunnelHttpEntryMutate({ mutation });
    },
    onSuccess: (result) => queryClient.setQueryData<TunnelState>(queryKey, result.state),
  });
  const exportOffer = useCallback(
    async (ingressId: string) => {
      if (!client) throw new Error("Tunnel host is offline");
      return client.tunnelHttpIngressOfferExport({ ingressId });
    },
    [client],
  );

  return { state, mutate, exportOffer };
}
