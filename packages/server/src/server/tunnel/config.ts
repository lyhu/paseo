import { randomBytes } from "node:crypto";
import { z } from "zod";
import { exportPublicKey, exportSecretKey, generateKeyPair } from "@getpaseo/relay/e2ee";

const TunnelIdentitySchema = z
  .object({
    serverId: z.string().min(1),
    publicKeyB64: z.string().min(1),
    secretKeyB64: z.string().min(1),
  })
  .strict();

const PersistedIngressSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    enabled: z.boolean(),
    targetOrigin: z.string().refine(
      (value) => {
        try {
          const url = new URL(value);
          return (
            (url.protocol === "http:" || url.protocol === "https:") &&
            url.hostname &&
            (url.pathname === "/" || url.pathname === "") &&
            !url.search &&
            !url.hash &&
            !url.username &&
            !url.password
          );
        } catch {
          return false;
        }
      },
      { message: "Target origin must be http(s)://host[:port] with no path, query, or fragment" },
    ),
    routeId: z.string().min(1),
    routeSecret: z.string().min(1),
  })
  .strict();

const RouteOfferSchema = z
  .object({
    protocolVersion: z.literal(1),
    relayEndpoint: z.string().min(1),
    relayUseTls: z.boolean(),
    tunnelServerId: z.string().min(1),
    tunnelPublicKeyB64: z.string().min(1),
    routeId: z.string().min(1),
    routeSecret: z.string().min(1),
    ingressHostName: z.string().min(1),
    ingressName: z.string().min(1),
    suggestedPort: z.number().int().positive(),
  })
  .strict();

const EgressAccessSchema = z
  .object({
    mode: z.enum(["bearer", "header", "none"]),
    tokenHash: z.string().optional(),
  })
  .strict();

const PersistedEgressSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    enabled: z.boolean(),
    listen: z
      .object({
        host: z.string().min(1),
        port: z.number().int().positive(),
      })
      .strict(),
    offer: RouteOfferSchema,
    access: EgressAccessSchema,
  })
  .strict();

export const PersistedTunnelConfigSchema = z
  .object({
    identity: TunnelIdentitySchema.optional(),
    ingresses: z.array(PersistedIngressSchema).optional(),
    egresses: z.array(PersistedEgressSchema).optional(),
  })
  .strict();

export type PersistedTunnelConfig = z.infer<typeof PersistedTunnelConfigSchema>;
export type TunnelIdentity = z.infer<typeof TunnelIdentitySchema>;
export type PersistedIngress = z.infer<typeof PersistedIngressSchema>;
export type PersistedEgress = z.infer<typeof PersistedEgressSchema>;
export type RouteOffer = z.infer<typeof RouteOfferSchema>;
export type EgressAccess = z.infer<typeof EgressAccessSchema>;

export function createTunnelIdentity(): TunnelIdentity {
  const keyPair = generateKeyPair();
  const serverId = `tunnel_${randomBytes(8).toString("hex")}`;

  return {
    serverId,
    publicKeyB64: exportPublicKey(keyPair.publicKey),
    secretKeyB64: exportSecretKey(keyPair.secretKey),
  };
}
