import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaseoApi } from "@getpaseo/client";

const runCli = vi.hoisted(() => vi.fn());
vi.mock("node:util", () => ({ promisify: () => runCli }));
import { stopAgent } from "./stop";

function harness(status = "running") {
  const refresh = vi.fn().mockResolvedValue({ agent: { id: "agent-1", status } });
  const ref = vi.fn(() => ({ refresh }));
  return { paseo: { agents: { ref } } as unknown as PaseoApi, refresh, ref };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  runCli.mockReset();
  vi.stubEnv("PASEO_HOME", "/tmp/selected paseo");
  vi.stubEnv("PASEO_CLI", "/tmp/bundled paseo");
  runCli.mockResolvedValue({ stdout: '{"stoppedCount":1}', stderr: "" });
});

describe("conversation stop bridge", () => {
  it("verifies the selected host and targets its explicit home without a shell", async () => {
    const { paseo, ref, refresh } = harness();
    await expect(stopAgent("agent-1", paseo)).resolves.toEqual({});
    expect(ref).toHaveBeenCalledWith("agent-1");
    expect(refresh).toHaveBeenCalledOnce();
    expect(runCli).toHaveBeenCalledWith(
      "/tmp/bundled paseo",
      ["stop", "agent-1", "--home", "/tmp/selected paseo", "--json"],
      { timeout: 30_000, maxBuffer: 64 * 1024, encoding: "utf8" },
    );
  });

  it("refuses to use a default daemon when home is missing", async () => {
    vi.stubEnv("PASEO_HOME", "");
    const { paseo, ref } = harness();
    await expect(stopAgent("agent-1", paseo)).rejects.toThrow("停止操作未执行");
    expect(ref).not.toHaveBeenCalled();
    expect(runCli).not.toHaveBeenCalled();
  });

  it("does not invoke CLI for an absent or idle agent", async () => {
    const missing = harness();
    missing.refresh.mockResolvedValue(null);
    await expect(stopAgent("agent-1", missing.paseo)).rejects.toThrow("没有这个 Agent");
    await expect(stopAgent("agent-1", harness("idle").paseo)).resolves.toEqual({});
    expect(runCli).not.toHaveBeenCalled();
  });

  it("does not expose command errors or stderr secrets", async () => {
    runCli.mockRejectedValueOnce(new Error("token=SECRET"));
    await expect(stopAgent("agent-1", harness().paseo)).rejects.toThrow("失败或超时");
    runCli.mockResolvedValueOnce({ stdout: '{"stoppedCount":0}', stderr: "token=SECRET" });
    await expect(stopAgent("agent-1", harness().paseo)).rejects.toThrow("未能完成停止");
  });

  it("rejects invalid CLI output and accepts a turn that ended during the stop race", async () => {
    runCli.mockResolvedValueOnce({ stdout: "invalid", stderr: "" });
    await expect(stopAgent("agent-1", harness().paseo)).rejects.toThrow("无效的停止结果");
    runCli.mockResolvedValueOnce({ stdout: '{"stoppedCount":0}', stderr: "" });
    await expect(stopAgent("agent-1", harness().paseo)).resolves.toEqual({});
  });
});
