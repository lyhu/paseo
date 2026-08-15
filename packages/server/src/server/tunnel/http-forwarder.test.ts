import { once } from "node:events";
import { createServer, request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { forwardHttpRequest } from "./http-forwarder.js";

/* eslint-disable max-nested-callbacks -- real HTTP fixture lifecycle is callback-driven. */

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

describe("forwardHttpRequest", () => {
  it("streams an OpenAI-compatible SSE completion before the target finishes", async () => {
    const target = createServer((req, res) => {
      if (req.url !== "/v1/chat/completions") throw new Error("unexpected OpenAI path");
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n');
      setTimeout(() => res.end("data: [DONE]\n\n"), 80);
    });
    target.listen(0, "127.0.0.1");
    await once(target, "listening");
    const targetAddress = target.address();
    if (!targetAddress || typeof targetAddress === "string")
      throw new Error("target did not listen");
    closers.push(async () => new Promise((resolve) => target.close(() => resolve())));

    const egress = createServer((req, res) => {
      void forwardHttpRequest({
        request: req,
        response: res,
        origin: `http://127.0.0.1:${targetAddress.port}`,
      });
    });
    egress.listen(0, "127.0.0.1");
    await once(egress, "listening");
    const egressAddress = egress.address();
    if (!egressAddress || typeof egressAddress === "string")
      throw new Error("egress did not listen");
    closers.push(async () => new Promise((resolve) => egress.close(() => resolve())));

    const observed = await new Promise<{ first: string; full: string }>((resolve, reject) => {
      const client = request(
        {
          hostname: "127.0.0.1",
          port: egressAddress.port,
          path: "/v1/chat/completions",
          method: "POST",
        },
        async (response) => {
          let first = "";
          const chunks: Buffer[] = [];
          for await (const chunk of response) {
            const text = Buffer.from(chunk).toString();
            first ||= text;
            chunks.push(Buffer.from(chunk));
          }
          resolve({ first, full: Buffer.concat(chunks).toString() });
        },
      );
      client.once("error", reject);
      client.end('{"stream":true}');
    });

    expect(observed.first).toContain('"hello"');
    expect(observed.full).toContain("data: [DONE]");
  });

  it("forwards a fixed-origin JSON request while removing tunnel and hop-by-hop headers", async () => {
    const target = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      res.setHeader("set-cookie", ["first=1", "second=2"]);
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          body: Buffer.concat(chunks).toString(),
          authorization: req.headers.authorization,
          tunnelToken: req.headers["x-paseo-access-token"] ?? null,
          dropped: req.headers["x-drop"] ?? null,
        }),
      );
    });
    target.listen(0, "127.0.0.1");
    await once(target, "listening");
    const address = target.address();
    if (!address || typeof address === "string") throw new Error("target did not listen");
    closers.push(async () => new Promise((resolve) => target.close(() => resolve())));

    const egress = createServer((req, res) => {
      void forwardHttpRequest({
        request: req,
        response: res,
        origin: `http://127.0.0.1:${address.port}/fixed-base`,
      });
    });
    egress.listen(0, "127.0.0.1");
    await once(egress, "listening");
    const egressAddress = egress.address();
    if (!egressAddress || typeof egressAddress === "string")
      throw new Error("egress did not listen");
    closers.push(async () => new Promise((resolve) => egress.close(() => resolve())));

    const result = await new Promise<{
      status: number;
      body: string;
      cookies: string[] | undefined;
    }>((resolve, reject) => {
      const client = request(
        {
          hostname: "127.0.0.1",
          port: egressAddress.port,
          path: "/v1/chat/completions?stream=true",
          method: "POST",
          headers: {
            authorization: "Bearer target-token",
            connection: "keep-alive, x-drop",
            "x-drop": "remove-me",
            "x-paseo-access-token": "secret",
          },
        },
        async (response) => {
          const chunks: Buffer[] = [];
          for await (const chunk of response) chunks.push(Buffer.from(chunk));
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
            cookies: response.headers["set-cookie"],
          });
        },
      );
      client.once("error", reject);
      client.end('{"model":"local"}');
    });

    expect(result.status).toBe(200);
    expect(result.cookies).toEqual(["first=1", "second=2"]);
    expect(JSON.parse(result.body)).toEqual({
      method: "POST",
      url: "/v1/chat/completions?stream=true",
      body: '{"model":"local"}',
      authorization: "Bearer target-token",
      tunnelToken: null,
      dropped: null,
    });
  });
});
