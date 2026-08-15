export const FRAME_BYTES = 64 * 1024;
export const FLOW_WINDOW_CHUNKS = 8;
export const FLOW_WINDOW_BYTES = FRAME_BYTES * FLOW_WINDOW_CHUNKS;

export type TunnelHeader = [name: string, value: string];

export type TunnelFrame =
  | { type: "request.head"; method: string; path: string; headers: TunnelHeader[] }
  | { type: "request.end" }
  | { type: "request.ack"; bytes: number }
  | { type: "response.head"; statusCode: number; headers: TunnelHeader[] }
  | { type: "response.end" }
  | { type: "response.ack"; bytes: number }
  | { type: "cancel" };

export function encodeTunnelFrame(frame: TunnelFrame): string {
  return JSON.stringify(frame);
}

export function decodeTunnelFrame(raw: string): TunnelFrame {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Invalid Tunnel frame");
  }
  if (!isRecord(value) || typeof value.type !== "string") throw new Error("Invalid Tunnel frame");

  switch (value.type) {
    case "request.head":
      if (typeof value.method === "string" && typeof value.path === "string" && isHeaders(value.headers)) {
        return { type: value.type, method: value.method, path: value.path, headers: value.headers };
      }
      break;
    case "response.head":
      if (
        typeof value.statusCode === "number" &&
        Number.isInteger(value.statusCode) &&
        isHeaders(value.headers)
      ) {
        return { type: value.type, statusCode: value.statusCode, headers: value.headers };
      }
      break;
    case "request.ack":
    case "response.ack":
      if (isChunkByteLength(value.bytes)) return { type: value.type, bytes: value.bytes };
      break;
    case "request.end":
    case "response.end":
    case "cancel":
      return { type: value.type };
  }
  throw new Error("Invalid Tunnel frame");
}

export class TunnelCreditWindow {
  #usedBytes = 0;

  get usedBytes(): number {
    return this.#usedBytes;
  }

  reserve(bytes: number): void {
    assertChunkByteLength(bytes);
    if (this.#usedBytes + bytes > FLOW_WINDOW_BYTES) {
      throw new Error("Tunnel credit window exhausted");
    }
    this.#usedBytes += bytes;
  }

  acknowledge(bytes: number): void {
    assertChunkByteLength(bytes);
    if (bytes > this.#usedBytes) throw new Error("Tunnel acknowledgement exceeds outstanding credit");
    this.#usedBytes -= bytes;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHeaders(value: unknown): value is TunnelHeader[] {
  return (
    Array.isArray(value) &&
    value.every(
      (header): header is TunnelHeader =>
        Array.isArray(header) &&
        header.length === 2 &&
        typeof header[0] === "string" &&
        typeof header[1] === "string",
    )
  );
}

function isChunkByteLength(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= FRAME_BYTES;
}

function assertChunkByteLength(bytes: number): void {
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > FRAME_BYTES) {
    throw new Error(`Tunnel chunk exceeds ${FRAME_BYTES} byte limit`);
  }
}
