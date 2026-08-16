import { createHash } from "node:crypto";
import { createServer } from "node:http";

const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

const server = createServer(async (request, response) => {
  if (request.url === "/health") {
    response.end("ok");
    return;
  }

  if (request.url === "/json") {
    const body = await readBody(request);
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        method: request.method,
        body: JSON.parse(body.toString("utf8")),
      }),
    );
    return;
  }

  if (request.url === "/binary") {
    const body = await readBody(request);
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        bytes: body.length,
        sha256: createHash("sha256").update(body).digest("hex"),
      }),
    );
    return;
  }

  if (request.url === "/sse") {
    response.writeHead(200, {
      "cache-control": "no-cache",
      "content-type": "text/event-stream",
    });
    response.write('data: {"phase":"first"}\n\n');
    setTimeout(() => response.end('data: {"phase":"done"}\n\n'), 50);
    return;
  }

  if (request.url === "/v1/chat/completions") {
    const body = JSON.parse((await readBody(request)).toString("utf8"));
    if (!body.stream) {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          id: "chatcmpl-docker",
          object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content: "pong" } }],
        }),
      );
      return;
    }

    response.writeHead(200, {
      "cache-control": "no-cache",
      "content-type": "text/event-stream",
    });
    response.write(
      'data: {"id":"chatcmpl-docker","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"pong"}}]}\n\n',
    );
    setTimeout(() => response.end("data: [DONE]\n\n"), 50);
    return;
  }

  response.writeHead(404).end("not found");
});

server.listen(9000, "0.0.0.0", () => {
  console.log("docker tunnel target listening on 0.0.0.0:9000");
});
