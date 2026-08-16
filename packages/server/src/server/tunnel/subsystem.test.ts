import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { TunnelSubsystem } from "./subsystem.js";
import {
	createInProcessRelay,
	type RelayHarness,
} from "./test-relay-harness.js";
import { DaemonConfigStore } from "../daemon-config-store.js";

function createConfigStore(paseoHome: string): DaemonConfigStore {
	return new DaemonConfigStore(paseoHome, {
		relay: { enabled: false },
		mcp: { injectIntoAgents: false },
		browserTools: { enabled: false },
		providers: {},
		metadataGeneration: { providers: [] },
		autoArchiveAfterMerge: false,
		enableTerminalAgentHooks: false,
		appendSystemPrompt: "",
	});
}

describe("TunnelSubsystem", () => {
	let subsystem: TunnelSubsystem;
	let testHome: string;
	let relay: RelayHarness;

	beforeEach(async () => {
		testHome = mkdtempSync(join(tmpdir(), "paseo-tunnel-test-"));
		relay = await createInProcessRelay();
		subsystem = new TunnelSubsystem({
			configStore: createConfigStore(testHome),
			relayEndpoint: relay.httpBaseUrl,
			relayUseTls: false,
		});
	});

	afterEach(async () => {
		await subsystem.stop();
		await relay.stop();
		rmSync(testHome, { recursive: true, force: true });
	});

	it("starts with empty state when no config exists", () => {
		const state = subsystem.getState();
		expect(state.relayStatus).toBe("inactive");
		expect(state.ingresses).toEqual([]);
		expect(state.egresses).toEqual([]);
	});

	it("creates an ingress with generated identity and route credentials", async () => {
		const result = await subsystem.createIngress({
			name: "Test API",
			targetOrigin: "http://localhost:8000",
		});

		expect(result.state.ingresses).toHaveLength(1);
		const ingress = result.state.ingresses[0];
		expect(ingress.name).toBe("Test API");
		expect(ingress.targetOrigin).toBe("http://localhost:8000");
		expect(ingress.enabled).toBe(true);
		expect(ingress.status).toBe("ready");
		expect(ingress.id).toMatch(/^ing_[a-f0-9]+$/);

		// Verify it's persisted by reading fresh state
		const freshState = subsystem.getState();
		expect(freshState.ingresses).toHaveLength(1);
	});

	it("creates an egress with route offer", async () => {
		// First create an ingress
		const ingressResult = await subsystem.createIngress({
			name: "Backend",
			targetOrigin: "http://localhost:3000",
		});
		const ingress = ingressResult.state.ingresses[0];

		// Export the offer
		const offer = await subsystem.exportRouteOffer(ingress.id);

		// Create egress with the offer
		const result = await subsystem.createEgress({
			name: "Public Access",
			listen: { host: "127.0.0.1", port: 0 },
			offer,
			access: { mode: "header", token: "test-token-123" },
		});

		expect(result.state.egresses).toHaveLength(1);
		const egress = result.state.egresses[0];
		expect(egress.name).toBe("Public Access");
		expect(egress.listen.host).toBe("127.0.0.1");
		expect(egress.listen.port).toBeGreaterThan(0);
		expect(egress.access.mode).toBe("header");
		expect(egress.access.configured).toBe(true);
		expect(egress.id).toMatch(/^egr_[a-f0-9]+$/);

		// One-time token should be returned
		expect(result.oneTimeToken).toBe("test-token-123");
	});

	it("rejects listener hosts outside the supported scopes", async () => {
		const ingress = await subsystem.createIngress({
			name: "Backend",
			targetOrigin: "http://localhost:3000",
		});
		const offer = await subsystem.exportRouteOffer(
			ingress.state.ingresses[0].id,
		);

		await expect(
			subsystem.createEgress({
				name: "Unsupported listener",
				listen: { host: "127.0.0.2", port: 0 },
				offer,
				access: { mode: "none" },
			}),
		).rejects.toThrow("Listener host must be 127.0.0.1 or 0.0.0.0");
		expect(subsystem.getState().egresses).toEqual([]);

		const created = await subsystem.createEgress({
			name: "Supported listener",
			listen: { host: "127.0.0.1", port: 0 },
			offer,
			access: { mode: "none" },
		});
		const original = created.state.egresses[0];
		await expect(
			subsystem.updateEgress({
				id: original.id,
				listen: { host: "127.0.0.2", port: original.listen.port },
			}),
		).rejects.toThrow("Listener host must be 127.0.0.1 or 0.0.0.0");
		expect(subsystem.getState().egresses[0].listen).toEqual(original.listen);
	});

	it("generates a one-time access token without persisting plaintext", async () => {
		const ingressResult = await subsystem.createIngress({
			name: "Generated token target",
			targetOrigin: "http://localhost:3000",
		});
		const offer = await subsystem.exportRouteOffer(
			ingressResult.state.ingresses[0].id,
		);

		const result = await subsystem.createEgress({
			name: "Generated token egress",
			listen: { host: "127.0.0.1", port: 0 },
			offer,
			access: { mode: "header" },
		});

		expect(result.oneTimeToken).toMatch(/^ptt-[a-f0-9]{16}$/);
		expect(result.state.egresses[0].access.configured).toBe(true);
		expect(JSON.stringify(result.state)).not.toContain(result.oneTimeToken!);
	});

	it("updates ingress properties", async () => {
		const createResult = await subsystem.createIngress({
			name: "Original",
			targetOrigin: "http://localhost:8000",
		});
		const ingressId = createResult.state.ingresses[0].id;

		const updateResult = await subsystem.updateIngress({
			id: ingressId,
			name: "Updated Name",
			targetOrigin: "https://api.example.com",
			enabled: false,
		});

		const ingress = updateResult.state.ingresses[0];
		expect(ingress.name).toBe("Updated Name");
		expect(ingress.targetOrigin).toBe("https://api.example.com");
		expect(ingress.enabled).toBe(false);
		expect(ingress.status).toBe("disabled");
	});

	it("deletes an ingress", async () => {
		const createResult = await subsystem.createIngress({
			name: "Temporary",
			targetOrigin: "http://localhost:9000",
		});
		const ingressId = createResult.state.ingresses[0].id;

		const deleteResult = await subsystem.deleteIngress(ingressId);
		expect(deleteResult.state.ingresses).toHaveLength(0);
	});

	it("preserves tunnel identity after deleting all ingresses", async () => {
		const createResult = await subsystem.createIngress({
			name: "Temporary",
			targetOrigin: "http://localhost:9000",
		});
		const offer1 = await subsystem.exportRouteOffer(
			createResult.state.ingresses[0].id,
		);

		await subsystem.deleteIngress(createResult.state.ingresses[0].id);

		// Create another ingress and verify identity is stable
		const secondResult = await subsystem.createIngress({
			name: "Second",
			targetOrigin: "http://localhost:9001",
		});
		const offer2 = await subsystem.exportRouteOffer(
			secondResult.state.ingresses[0].id,
		);
		expect(offer1.tunnelServerId).toBe(offer2.tunnelServerId);
	});

	it("rotates route and access capabilities without exposing persisted secrets", async () => {
		const ingressResult = await subsystem.createIngress({
			name: "Rotating ingress",
			targetOrigin: "http://localhost:9002",
		});
		const ingressId = ingressResult.state.ingresses[0].id;
		const firstOffer = await subsystem.exportRouteOffer(ingressId);

		await subsystem.rotateIngressSecret(ingressId);
		const secondOffer = await subsystem.exportRouteOffer(ingressId);
		expect(secondOffer.routeId).toBe(firstOffer.routeId);
		expect(secondOffer.routeSecret).not.toBe(firstOffer.routeSecret);

		const egressResult = await subsystem.createEgress({
			name: "Rotating egress",
			listen: { host: "127.0.0.1", port: 0 },
			offer: firstOffer,
			access: { mode: "header", token: "first-token" },
		});
		const egressId = egressResult.state.egresses[0].id;

		const replacedOffer = await subsystem.replaceEgressOffer(
			egressId,
			secondOffer,
		);
		expect(replacedOffer.state.egresses[0].ingressName).toBe(
			secondOffer.ingressName,
		);

		const rotatedToken = await subsystem.rotateEgressToken(egressId, {
			mode: "header",
		});
		expect(rotatedToken.oneTimeToken).toMatch(/^ptt-[a-f0-9]{16}$/);
		expect(JSON.stringify(rotatedToken.state)).not.toContain(
			rotatedToken.oneTimeToken!,
		);
	});

	it("rejects duplicate names within each entry kind", async () => {
		await subsystem.createIngress({
			name: "Unique",
			targetOrigin: "http://localhost:9100",
		});
		await expect(
			subsystem.createIngress({
				name: "Unique",
				targetOrigin: "http://localhost:9101",
			}),
		).rejects.toThrow("Ingress name already exists");

		const offer = await subsystem.exportRouteOffer(
			subsystem.getState().ingresses[0].id,
		);
		await subsystem.createEgress({
			name: "Unique egress",
			listen: { host: "127.0.0.1", port: 0 },
			offer,
			access: { mode: "none" },
		});
		await expect(
			subsystem.createEgress({
				name: "Unique egress",
				listen: { host: "127.0.0.1", port: 0 },
				offer,
				access: { mode: "none" },
			}),
		).rejects.toThrow("Egress name already exists");
	});

	it("restores enabled runtimes from the persisted snapshot", async () => {
		const ingressResult = await subsystem.createIngress({
			name: "Restarted ingress",
			targetOrigin: "http://localhost:9200",
		});
		const offer = await subsystem.exportRouteOffer(
			ingressResult.state.ingresses[0].id,
		);
		const egressResult = await subsystem.createEgress({
			name: "Restarted egress",
			listen: { host: "127.0.0.1", port: 0 },
			offer,
			access: { mode: "none" },
		});
		const persistedPort = egressResult.state.egresses[0].listen.port;
		await subsystem.stop();

		subsystem = new TunnelSubsystem({
			configStore: createConfigStore(testHome),
			relayEndpoint: relay.httpBaseUrl,
			relayUseTls: false,
		});
		await subsystem.start();

		const restored = subsystem.getState();
		expect(restored.relayStatus).toBe("ready");
		expect(restored.ingresses[0].status).toBe("ready");
		expect(restored.egresses[0].status).toBe("listening");
		expect(restored.egresses[0].listen.port).toBe(persistedPort);
	});

	it("serializes concurrent mutations", async () => {
		const ingress = await subsystem.createIngress({
			name: "Concurrent ingress",
			targetOrigin: "http://localhost:9300",
		});
		const offer = await subsystem.exportRouteOffer(
			ingress.state.ingresses[0].id,
		);

		const results = await Promise.allSettled([
			subsystem.createEgress({
				name: "Concurrent egress",
				listen: { host: "127.0.0.1", port: 0 },
				offer,
				access: { mode: "none" },
			}),
			subsystem.createEgress({
				name: "Concurrent egress",
				listen: { host: "127.0.0.1", port: 0 },
				offer,
				access: { mode: "none" },
			}),
		]);

		expect(results.map((result) => result.status).sort()).toEqual([
			"fulfilled",
			"rejected",
		]);
		expect(subsystem.getState().egresses).toHaveLength(1);
	});

	it("does not persist an ingress when its relay runtime cannot start", async () => {
		await subsystem.stop();
		subsystem = new TunnelSubsystem({
			configStore: createConfigStore(testHome),
			relayEndpoint: "http://127.0.0.1:1",
			relayUseTls: false,
		});

		await expect(
			subsystem.createIngress({
				name: "Unavailable relay",
				targetOrigin: "http://localhost:9400",
			}),
		).rejects.toThrow();
		expect(subsystem.getState().ingresses).toEqual([]);
	});

	it("restores healthy listeners when another Tunnel entry is unavailable", async () => {
		const ingress = await subsystem.createIngress({
			name: "Partially restored ingress",
			targetOrigin: "http://localhost:9450",
		});
		const offer = await subsystem.exportRouteOffer(
			ingress.state.ingresses[0].id,
		);
		const blockedEgress = await subsystem.createEgress({
			name: "Blocked listener",
			listen: { host: "127.0.0.1", port: 0 },
			offer,
			access: { mode: "none" },
		});
		const healthyEgress = await subsystem.createEgress({
			name: "Healthy listener",
			listen: { host: "127.0.0.1", port: 0 },
			offer,
			access: { mode: "none" },
		});
		const blockedPort = blockedEgress.state.egresses.find(
			(entry) => entry.name === "Blocked listener",
		)!.listen.port;
		const healthyPort = healthyEgress.state.egresses.find(
			(entry) => entry.name === "Healthy listener",
		)!.listen.port;
		await subsystem.stop();

		const blocker = createServer();
		blocker.listen(blockedPort, "127.0.0.1");
		await once(blocker, "listening");
		try {
			subsystem = new TunnelSubsystem({
				configStore: createConfigStore(testHome),
				relayEndpoint: "http://127.0.0.1:1",
				relayUseTls: false,
			});

			await expect(subsystem.start()).resolves.toBeUndefined();

			const state = subsystem.getState();
			expect(state.relayStatus).toBe("connecting");
			expect(state.ingresses[0].status).toBe("error");
			expect(
				state.egresses.find((entry) => entry.name === "Blocked listener"),
			).toMatchObject({
				status: "error",
				error: "Listener unavailable",
			});
			expect(
				state.egresses.find((entry) => entry.name === "Healthy listener"),
			).toMatchObject({
				listen: { host: "127.0.0.1", port: healthyPort },
				status: "listening",
			});
		} finally {
			await new Promise<void>((resolve) => blocker.close(() => resolve()));
		}
	});

	it("keeps the previous egress when an updated listener cannot bind", async () => {
		const ingress = await subsystem.createIngress({
			name: "Bind ingress",
			targetOrigin: "http://localhost:9500",
		});
		const offer = await subsystem.exportRouteOffer(
			ingress.state.ingresses[0].id,
		);
		const created = await subsystem.createEgress({
			name: "Bind egress",
			listen: { host: "127.0.0.1", port: 0 },
			offer,
			access: { mode: "none" },
		});
		const original = created.state.egresses[0];

		const blocker = createServer();
		blocker.listen(0, "127.0.0.1");
		await once(blocker, "listening");
		const blockerAddress = blocker.address();
		if (!blockerAddress || typeof blockerAddress === "string") {
			throw new Error("Invalid blocker address");
		}
		try {
			await expect(
				subsystem.updateEgress({
					id: original.id,
					listen: { host: "127.0.0.1", port: blockerAddress.port },
				}),
			).rejects.toThrow();
		} finally {
			await new Promise<void>((resolve) => blocker.close(() => resolve()));
		}

		expect(subsystem.getState().egresses[0].listen).toEqual(original.listen);
		expect(subsystem.getState().egresses[0].status).toBe("listening");
	});

	it("does not leave a listener running when egress persistence fails", async () => {
		const ingress = await subsystem.createIngress({
			name: "Persist ingress",
			targetOrigin: "http://localhost:9600",
		});
		const offer = await subsystem.exportRouteOffer(
			ingress.state.ingresses[0].id,
		);
		const store = createConfigStore(testHome);
		const persistError = new Error("Tunnel persist failed");
		await subsystem.stop();
		subsystem = new TunnelSubsystem({
			configStore: {
				getPersistedConfigSnapshot: () => store.getPersistedConfigSnapshot(),
				setPersistedTunnelConfig: () => {
					throw persistError;
				},
			},
			relayEndpoint: relay.httpBaseUrl,
			relayUseTls: false,
		});

		await expect(
			subsystem.createEgress({
				name: "Unpersisted egress",
				listen: { host: "127.0.0.1", port: 0 },
				offer,
				access: { mode: "none" },
			}),
		).rejects.toThrow("Tunnel persist failed");
		expect(subsystem.getState().egresses).toEqual([]);

		const recovered = new TunnelSubsystem({
			configStore: store,
			relayEndpoint: relay.httpBaseUrl,
			relayUseTls: false,
		});
		const created = await recovered.createEgress({
			name: "Unpersisted egress",
			listen: { host: "127.0.0.1", port: 0 },
			offer,
			access: { mode: "none" },
		});
		expect(created.state.egresses).toHaveLength(1);
		expect(created.state.egresses[0].status).toBe("listening");
		await recovered.stop();
	});

	it("exports the current machine hostname as the Offer source label", async () => {
		const { hostname } = await import("node:os");
		const ingress = await subsystem.createIngress({
			name: "Hostname ingress",
			targetOrigin: "http://localhost:9700",
		});
		const offer = await subsystem.exportRouteOffer(
			ingress.state.ingresses[0].id,
		);
		expect(offer.ingressHostName).toBe(hostname() || "Local Host");
		expect(offer.ingressName).toBe("Hostname ingress");
	});

	it("sanitizes state by removing secrets", async () => {
		await subsystem.createIngress({
			name: "Test",
			targetOrigin: "http://localhost:8000",
		});

		const state = subsystem.getState();
		const serialized = JSON.stringify(state);

		// Should not contain secret fields
		expect(serialized).not.toContain("routeSecret");
		expect(serialized).not.toContain("secretKeyB64");
		expect(serialized).not.toContain("tokenHash");
	});
});
