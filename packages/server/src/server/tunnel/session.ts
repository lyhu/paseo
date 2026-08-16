import type { SessionInboundMessage, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import type { TunnelSubsystem } from "./subsystem.js";

interface TunnelSessionHost {
  emit(message: SessionOutboundMessage): void;
}

export class TunnelSession {
  constructor(
    private readonly host: TunnelSessionHost,
    private readonly subsystem: TunnelSubsystem,
  ) {}

  dispatch(message: SessionInboundMessage): Promise<void> | undefined {
    switch (message.type) {
      case "tunnel.http.state.get.request":
        this.host.emit({
          type: "tunnel.http.state.get.response",
          payload: { requestId: message.requestId, state: this.subsystem.getState() },
        });
        return undefined;
      case "tunnel.http.ingress.offer.export.request":
        return this.subsystem.exportRouteOffer(message.ingressId).then((offer) => {
          return this.host.emit({
            type: "tunnel.http.ingress.offer.export.response",
            payload: { requestId: message.requestId, offer },
          });
        });
      case "tunnel.http.entry.mutate.request":
        return this.mutate(message.mutation).then((result) => {
          return this.host.emit({
            type: "tunnel.http.entry.mutate.response",
            payload: { requestId: message.requestId, ...result },
          });
        });
      default:
        return undefined;
    }
  }

  private mutate(
    mutation: Extract<
      SessionInboundMessage,
      { type: "tunnel.http.entry.mutate.request" }
    >["mutation"],
  ) {
    switch (mutation.operation) {
      case "createIngress":
        return this.subsystem.createIngress(mutation);
      case "updateIngress":
        return this.subsystem.updateIngress(mutation);
      case "deleteIngress":
        return this.subsystem.deleteIngress(mutation.id);
      case "rotateIngressSecret":
        return this.subsystem.rotateIngressSecret(mutation.id);
      case "createEgress":
        return this.subsystem.createEgress(mutation);
      case "updateEgress":
        return this.subsystem.updateEgress(mutation);
      case "deleteEgress":
        return this.subsystem.deleteEgress(mutation.id);
      case "replaceEgressOffer":
        return this.subsystem.replaceEgressOffer(mutation.id, mutation.offer);
      case "rotateEgressToken":
        return this.subsystem.rotateEgressToken(mutation.id, mutation);
    }
  }
}
