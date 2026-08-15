import { z } from "zod";

// Sanitized state schemas (no secrets)
export const TunnelIngressStateSchema = z.object({
	id: z.string(),
	name: z.string(),
	enabled: z.boolean(),
	targetOrigin: z.string(),
	status: z.enum(["disabled", "ready", "error"]),
});

export const TunnelEgressStateSchema = z.object({
	id: z.string(),
	name: z.string(),
	enabled: z.boolean(),
	listen: z.object({
		host: z.string(),
		port: z.number(),
	}),
	ingressHostName: z.string(),
	ingressName: z.string(),
	access: z.object({
		mode: z.enum(["bearer", "header", "none"]),
		configured: z.boolean(),
	}),
	status: z.enum(["disabled", "starting", "listening", "error"]),
	error: z.string().optional(),
});

export const TunnelRelayStatusSchema = z.enum(["inactive", "connecting", "ready", "error"]);

export const TunnelStateSchema = z.object({
	relayStatus: TunnelRelayStatusSchema,
	ingresses: z.array(TunnelIngressStateSchema),
	egresses: z.array(TunnelEgressStateSchema),
});

// Route offer schema (exported only on explicit request)
export const RouteOfferSchema = z.object({
	protocolVersion: z.literal(1),
	relayEndpoint: z.string(),
	relayUseTls: z.boolean(),
	tunnelServerId: z.string(),
	tunnelPublicKeyB64: z.string(),
	routeId: z.string(),
	routeSecret: z.string(),
	ingressHostName: z.string(),
	ingressName: z.string(),
	suggestedPort: z.number(),
});

// RPC: Get state
export const TunnelHttpStateGetRequestSchema = z.object({
	type: z.literal("tunnel.http.state.get.request"),
	requestId: z.string(),
});

export const TunnelHttpStateGetResponseSchema = z.object({
	type: z.literal("tunnel.http.state.get.response"),
	requestId: z.string(),
	payload: TunnelStateSchema,
});

// RPC: Mutation operations
export const TunnelIngressCreatePayloadSchema = z.object({
	operation: z.literal("createIngress"),
	name: z.string().min(1),
	targetOrigin: z.string(),
});

export const TunnelIngressUpdatePayloadSchema = z.object({
	operation: z.literal("updateIngress"),
	id: z.string(),
	name: z.string().min(1).optional(),
	targetOrigin: z.string().optional(),
	enabled: z.boolean().optional(),
});

export const TunnelIngressDeletePayloadSchema = z.object({
	operation: z.literal("deleteIngress"),
	id: z.string(),
});

export const TunnelIngressRotateSecretPayloadSchema = z.object({
	operation: z.literal("rotateIngressSecret"),
	id: z.string(),
});

export const TunnelEgressCreatePayloadSchema = z.object({
	operation: z.literal("createEgress"),
	name: z.string().min(1),
	listen: z.object({
		host: z.string(),
		port: z.number().int().positive(),
	}),
	offer: RouteOfferSchema,
	access: z.object({
		mode: z.enum(["bearer", "header", "none"]),
		token: z.string().optional(),
	}),
});

export const TunnelEgressUpdatePayloadSchema = z.object({
	operation: z.literal("updateEgress"),
	id: z.string(),
	name: z.string().min(1).optional(),
	listen: z
		.object({
			host: z.string(),
			port: z.number().int().positive(),
		})
		.optional(),
	enabled: z.boolean().optional(),
});

export const TunnelEgressDeletePayloadSchema = z.object({
	operation: z.literal("deleteEgress"),
	id: z.string(),
});

export const TunnelEgressReplaceOfferPayloadSchema = z.object({
	operation: z.literal("replaceEgressOffer"),
	id: z.string(),
	offer: RouteOfferSchema,
});

export const TunnelEgressRotateTokenPayloadSchema = z.object({
	operation: z.literal("rotateEgressToken"),
	id: z.string(),
	mode: z.enum(["bearer", "header", "none"]),
	token: z.string().optional(),
});

export const TunnelMutationPayloadSchema = z.discriminatedUnion("operation", [
	TunnelIngressCreatePayloadSchema,
	TunnelIngressUpdatePayloadSchema,
	TunnelIngressDeletePayloadSchema,
	TunnelIngressRotateSecretPayloadSchema,
	TunnelEgressCreatePayloadSchema,
	TunnelEgressUpdatePayloadSchema,
	TunnelEgressDeletePayloadSchema,
	TunnelEgressReplaceOfferPayloadSchema,
	TunnelEgressRotateTokenPayloadSchema,
]);

export const TunnelHttpEntryMutateRequestSchema = z.object({
	type: z.literal("tunnel.http.entry.mutate.request"),
	requestId: z.string(),
	mutation: TunnelMutationPayloadSchema,
});

export const TunnelHttpEntryMutateResponseSchema = z.object({
	type: z.literal("tunnel.http.entry.mutate.response"),
	requestId: z.string(),
	payload: z.object({
		state: TunnelStateSchema,
		oneTimeToken: z.string().optional(),
	}),
});

// RPC: Export route offer
export const TunnelHttpIngressOfferExportRequestSchema = z.object({
	type: z.literal("tunnel.http.ingress.offer.export.request"),
	requestId: z.string(),
	ingressId: z.string(),
});

export const TunnelHttpIngressOfferExportResponseSchema = z.object({
	type: z.literal("tunnel.http.ingress.offer.export.response"),
	requestId: z.string(),
	payload: z.object({
		offer: RouteOfferSchema,
	}),
});

// Type exports
export type TunnelIngressState = z.infer<typeof TunnelIngressStateSchema>;
export type TunnelEgressState = z.infer<typeof TunnelEgressStateSchema>;
export type TunnelRelayStatus = z.infer<typeof TunnelRelayStatusSchema>;
export type TunnelState = z.infer<typeof TunnelStateSchema>;
export type RouteOffer = z.infer<typeof RouteOfferSchema>;

export type TunnelMutationPayload = z.infer<typeof TunnelMutationPayloadSchema>;

export type TunnelHttpStateGetRequest = z.infer<typeof TunnelHttpStateGetRequestSchema>;
export type TunnelHttpStateGetResponse = z.infer<typeof TunnelHttpStateGetResponseSchema>;
export type TunnelHttpEntryMutateRequest = z.infer<typeof TunnelHttpEntryMutateRequestSchema>;
export type TunnelHttpEntryMutateResponse = z.infer<typeof TunnelHttpEntryMutateResponseSchema>;
export type TunnelHttpIngressOfferExportRequest = z.infer<
	typeof TunnelHttpIngressOfferExportRequestSchema
>;
export type TunnelHttpIngressOfferExportResponse = z.infer<
	typeof TunnelHttpIngressOfferExportResponseSchema
>;
