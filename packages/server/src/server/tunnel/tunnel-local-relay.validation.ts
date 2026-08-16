import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { TunnelSubsystem } from "./subsystem.js";
import { DaemonConfigStore } from "../daemon-config-store.js";

const relayEndpoint = process.env.PASEO_TUNNEL_RELAY_URL ?? "http://127.0.0.1:8481";
const relayUseTls = new URL(relayEndpoint).protocol === "https:";

interface ManagedServer {
  server: Server;
  port: number;
}

interface GenericMetrics {
  cancellationObservedMs: number | null;
  slowUploadConsumeMs: number | null;
  slowDownloadProduceMs: number | null;
}

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

async function listen(server: Server): Promise<ManagedServer> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture failed to listen");
  return { server, port: address.port };
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function startGenericFixture(metrics: GenericMetrics): Promise<ManagedServer> {
  return listen(
    createServer((request, response) => {
      void (async () => {
        if (request.url === "/json") {
          const body = await readBody(request);
          response.setHeader("content-type", "application/json");
          response.end(body);
          return;
        }

        if (request.url === "/binary") {
          const body = await readBody(request);
          response.setHeader("content-type", "application/octet-stream");
          response.end(body);
          return;
        }

        if (request.url === "/sse") {
          response.writeHead(200, { "content-type": "text/event-stream" });
          await sleep(40);
          response.write("data: first\n\n");
          await sleep(120);
          response.end("data: second\n\n");
          return;
        }

        if (request.url === "/slow-upload") {
          const startedAt = performance.now();
          let bytes = 0;
          for await (const chunk of request) {
            bytes += Buffer.byteLength(chunk);
            await sleep(5);
          }
          metrics.slowUploadConsumeMs = performance.now() - startedAt;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ bytes }));
          return;
        }

        if (request.url === "/slow-download") {
          const startedAt = performance.now();
          const frame = Buffer.alloc(64 * 1024, 0xa5);
          for (let index = 0; index < 512; index += 1) {
            if (!response.write(frame)) await once(response, "drain");
          }
          metrics.slowDownloadProduceMs = performance.now() - startedAt;
          response.end();
          return;
        }

        if (request.url === "/cancel") {
          const startedAt = performance.now();
          response.writeHead(200, { "content-type": "text/event-stream" });
          const interval = setInterval(() => response.write("data: tick\n\n"), 20);
          response.once("close", () => {
            clearInterval(interval);
            metrics.cancellationObservedMs = performance.now() - startedAt;
          });
          return;
        }

        response.writeHead(404);
        response.end("Not found");
      })().catch(() => response.destroy());
    }),
  );
}

async function startOpenAiFixture(): Promise<ManagedServer> {
  return listen(
    createServer((request, response) => {
      void (async () => {
        if (request.url !== "/v1/chat/completions" || request.method !== "POST") {
          response.writeHead(404);
          response.end("Not found");
          return;
        }
        const payload = JSON.parse((await readBody(request)).toString()) as {
          model: string;
          stream?: boolean;
        };
        assert.equal(request.headers.authorization, "Bearer local-openai-token");
        if (!payload.stream) {
          response.setHeader("content-type", "application/json");
          response.end(
            JSON.stringify({
              id: "chatcmpl-local",
              object: "chat.completion",
              model: payload.model,
              choices: [{ index: 0, message: { role: "assistant", content: "local" } }],
            }),
          );
          return;
        }
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(
          'data: {"id":"chatcmpl-local","choices":[{"delta":{"content":"local"}}]}\n\n',
        );
        await sleep(80);
        response.end("data: [DONE]\n\n");
      })().catch(() => response.destroy());
    }),
  );
}

async function run(): Promise<void> {
  const ingressHome = mkdtempSync(join(tmpdir(), "paseo-tunnel-ingress-"));
  const egressHome = mkdtempSync(join(tmpdir(), "paseo-tunnel-egress-"));
  const metrics: GenericMetrics = {
    cancellationObservedMs: null,
    slowUploadConsumeMs: null,
    slowDownloadProduceMs: null,
  };
  const generic = await startGenericFixture(metrics);
  const openai = await startOpenAiFixture();
  const ingress = new TunnelSubsystem({
    configStore: createConfigStore(ingressHome),
    relayEndpoint,
    relayUseTls,
  });
  const egress = new TunnelSubsystem({
    configStore: createConfigStore(egressHome),
    relayEndpoint,
    relayUseTls,
  });

  try {
    const genericIngress = await ingress.createIngress({
      name: "generic",
      targetOrigin: `http://127.0.0.1:${generic.port}`,
    });
    const genericOffer = await ingress.exportRouteOffer(genericIngress.state.ingresses[0]!.id);
    const genericEgress = await egress.createEgress({
      name: "generic",
      listen: { host: "127.0.0.1", port: 0 },
      offer: genericOffer,
      access: { mode: "header", token: "local-generic-token" },
    });
    const genericPort = genericEgress.state.egresses[0]!.listen.port;
    const genericHeaders = { "x-paseo-access-token": "local-generic-token" };

    const jsonPayload = { tunnel: "production-runtime", unicode: "本地中继" };
    const jsonResponse = await fetch(`http://127.0.0.1:${genericPort}/json`, {
      method: "POST",
      headers: { ...genericHeaders, "content-type": "application/json" },
      body: JSON.stringify(jsonPayload),
    });
    assert.deepEqual(await jsonResponse.json(), jsonPayload);

    const binary = Buffer.alloc(2 * 1024 * 1024);
    for (let index = 0; index < binary.byteLength; index += 1) binary[index] = index % 251;
    const binaryResponse = await fetch(`http://127.0.0.1:${genericPort}/binary`, {
      method: "POST",
      headers: genericHeaders,
      body: binary,
    });
    const returnedBinary = Buffer.from(await binaryResponse.arrayBuffer());
    const binaryHash = createHash("sha256").update(binary).digest("hex");
    assert.equal(createHash("sha256").update(returnedBinary).digest("hex"), binaryHash);

    const sseStartedAt = performance.now();
    const sseResponse = await fetch(`http://127.0.0.1:${genericPort}/sse`, {
      headers: genericHeaders,
    });
    const sseReader = sseResponse.body!.getReader();
    const firstEvent = await sseReader.read();
    const sseFirstEventMs = performance.now() - sseStartedAt;
    assert.match(Buffer.from(firstEvent.value!).toString(), /data: first/);
    await sseReader.cancel();

    const largeBody = Buffer.alloc(32 * 1024 * 1024, 0x5a);
    const uploadStartedAt = performance.now();
    const uploadResponse = await fetch(`http://127.0.0.1:${genericPort}/slow-upload`, {
      method: "POST",
      headers: genericHeaders,
      body: largeBody,
    });
    const uploadResult = (await uploadResponse.json()) as { bytes: number };
    const slowUploadMs = performance.now() - uploadStartedAt;
    assert.equal(uploadResult.bytes, largeBody.byteLength);

    const downloadStartedAt = performance.now();
    const downloadResponse = await fetch(`http://127.0.0.1:${genericPort}/slow-download`, {
      headers: genericHeaders,
    });
    const downloadReader = downloadResponse.body!.getReader();
    let downloadBytes = 0;
    while (true) {
      const chunk = await downloadReader.read();
      if (chunk.done) break;
      downloadBytes += chunk.value.byteLength;
      await sleep(5);
    }
    const slowDownloadMs = performance.now() - downloadStartedAt;
    assert.equal(downloadBytes, 32 * 1024 * 1024);

    const cancelStartedAt = performance.now();
    const cancelController = new AbortController();
    const cancelResponse = await fetch(`http://127.0.0.1:${genericPort}/cancel`, {
      headers: genericHeaders,
      signal: cancelController.signal,
    });
    await cancelResponse.body!.getReader().read();
    cancelController.abort();
    while (metrics.cancellationObservedMs === null) await sleep(5);
    const cancellationPropagationMs = performance.now() - cancelStartedAt;

    const openAiIngress = await ingress.createIngress({
      name: "openai",
      targetOrigin: `http://127.0.0.1:${openai.port}`,
    });
    const openAiRoute = openAiIngress.state.ingresses.find((item) => item.name === "openai")!;
    const openAiOffer = await ingress.exportRouteOffer(openAiRoute.id);
    const openAiEgress = await egress.createEgress({
      name: "openai",
      listen: { host: "127.0.0.1", port: 0 },
      offer: openAiOffer,
      access: { mode: "bearer", token: "local-openai-token" },
    });
    const openAiPort = openAiEgress.state.egresses.find((item) => item.name === "openai")!.listen
      .port;
    const completionResponse = await fetch(`http://127.0.0.1:${openAiPort}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: "Bearer local-openai-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "local-model", stream: false }),
    });
    const completion = (await completionResponse.json()) as { choices: unknown[] };
    assert.equal(completion.choices.length, 1);

    const streamStartedAt = performance.now();
    const streamResponse = await fetch(`http://127.0.0.1:${openAiPort}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: "Bearer local-openai-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "local-model", stream: true }),
    });
    const streamReader = streamResponse.body!.getReader();
    const firstCompletionEvent = await streamReader.read();
    const openAiFirstEventMs = performance.now() - streamStartedAt;
    assert.match(Buffer.from(firstCompletionEvent.value!).toString(), /"local"/);
    const remainingCompletion = await new Response(
      new ReadableStream({
        async start(controller) {
          while (true) {
            const chunk = await streamReader.read();
            if (chunk.done) break;
            controller.enqueue(chunk.value);
          }
          controller.close();
        },
      }),
    ).text();
    assert.match(remainingCompletion, /data: \[DONE\]/);

    console.log(
      JSON.stringify(
        {
          relay: relayEndpoint,
          json: "passed",
          binary: { bytes: binary.byteLength, sha256: binaryHash },
          sse: { firstEventMs: sseFirstEventMs },
          backpressure: {
            upload: {
              bytes: largeBody.byteLength,
              callerMs: slowUploadMs,
              targetConsumeMs: metrics.slowUploadConsumeMs,
            },
            download: {
              bytes: downloadBytes,
              callerConsumeMs: slowDownloadMs,
              targetProduceMs: metrics.slowDownloadProduceMs,
            },
          },
          cancellation: {
            propagationMs: cancellationPropagationMs,
            targetObservedMs: metrics.cancellationObservedMs,
          },
          openai: { json: "passed", firstEventMs: openAiFirstEventMs, done: "passed" },
        },
        null,
        2,
      ),
    );
  } finally {
    await egress.stop();
    await ingress.stop();
    await close(generic.server);
    await close(openai.server);
    rmSync(ingressHome, { recursive: true, force: true });
    rmSync(egressHome, { recursive: true, force: true });
  }
}

await run();
