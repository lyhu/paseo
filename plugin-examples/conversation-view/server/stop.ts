import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PaseoApi } from "@getpaseo/client";

const runCli = promisify(execFile);

export async function stopAgent(agentId: string, paseo: PaseoApi): Promise<Record<string, never>> {
  const home = process.env.PASEO_HOME;
  if (!home?.trim()) {
    throw new Error("无法确认当前 Paseo 实例，停止操作未执行。");
  }
  const snapshot = await paseo.agents.ref(agentId).refresh();
  if (!snapshot) {
    throw new Error("当前 Paseo 实例中没有这个 Agent。");
  }
  if (snapshot.agent.status !== "running") return {};

  let output: { stdout: string; stderr: string };
  try {
    output = await runCli(
      process.env.PASEO_CLI || "paseo",
      ["stop", snapshot.agent.id, "--home", home, "--json"],
      { timeout: 30_000, maxBuffer: 64 * 1024, encoding: "utf8" },
    );
  } catch {
    // CLI errors can contain its command or credentials; show no raw subprocess output.
    throw new Error("停止操作失败或超时，请确认连接后重试。");
  }
  // The CLI can report a failed cancellation on stderr while still exiting successfully.
  if (output.stderr.trim()) {
    throw new Error("Paseo 未能完成停止操作，请重试。");
  }
  let result: unknown;
  try {
    result = JSON.parse(output.stdout);
  } catch {
    throw new Error("Paseo 返回了无效的停止结果。");
  }
  if (
    result === null ||
    typeof result !== "object" ||
    !("stoppedCount" in result) ||
    (result.stoppedCount !== 1 && result.stoppedCount !== 0)
  ) {
    throw new Error("Paseo 未确认停止结果，请重试。");
  }
  return {};
}
