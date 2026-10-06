import * as React from "react";
import * as JSX from "react/jsx-runtime";
import * as ReactNative from "react-native-web";
import { expect, it, vi } from "vitest";
import { compilePlugin } from "../../../packages/server/src/server/plugins/compiler";

it("loads a sticky-only plugin without replacing native messages or their fork footer", async () => {
  const { clientBundle } = await compilePlugin({
    client: new URL("../index.client.tsx", import.meta.url).pathname,
    server: null,
  });
  const modules: Record<string, unknown> = {
    react: React,
    "react/jsx-runtime": JSX,
    "react-native": ReactNative,
    "@getpaseo/plugin/client": {
      usePaseo: () => {
        throw new Error("Registration must not call a React hook");
      },
    },
    "@getpaseo/plugin/client/react-native": { Icon: () => null },
  };
  const factory = (0, eval)(clientBundle!);
  const exports = factory((name: string) => {
    if (!(name in modules)) throw new Error(`Unsupported runtime module: ${name}`);
    return modules[name];
  });
  const remove = vi.fn();
  const release = vi.fn(async () => {});
  const unsubscribe = vi.fn();
  const addTimelineTransformer = vi.fn();
  const addTimelineRenderer = vi.fn();
  const addComposerPill = vi.fn((pill) => {
    expect(typeof pill.button.icon).toBe("function");
    return { remove, update: vi.fn() };
  });
  const cleanup = exports.default({
    paseo: {
      agents: {
        subscribe: () => unsubscribe,
        list: async () => ({
          entries: [
            { agent: { id: "active", workspaceId: "workspace", archivedAt: null } },
            { agent: { id: "archived", workspaceId: "workspace", archivedAt: "2026-10-06" } },
          ],
          subscription: { release },
        }),
      },
    },
    addTimelineTransformer,
    addTimelineRenderer,
    addComposerPill,
  });
  await Promise.resolve();
  expect(addComposerPill).toHaveBeenCalledTimes(1);
  expect(addComposerPill.mock.calls[0]![0].agentId).toBe("active");
  expect(addTimelineTransformer).not.toHaveBeenCalled();
  expect(addTimelineRenderer).not.toHaveBeenCalled();
  expect(clientBundle).not.toContain("对话增强");
  expect(clientBundle).not.toContain("复制回答");
  await cleanup();
  expect(remove).toHaveBeenCalledOnce();
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledOnce();
});
