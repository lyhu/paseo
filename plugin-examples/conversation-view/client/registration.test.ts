import * as React from "react";
import * as JSX from "react/jsx-runtime";
import * as ReactNative from "react-native-web";
import * as Zod from "zod";
import { expect, it } from "vitest";
import { compilePlugin } from "../../../packages/server/src/server/plugins/compiler";

it("loads the real bundle with Paseo's function-component registration contract", async () => {
  const { clientBundle } = await compilePlugin({
    client: new URL("../index.client.tsx", import.meta.url).pathname,
    server: null,
  });
  const modules: Record<string, unknown> = {
    react: React,
    "react/jsx-runtime": JSX,
    "react-native": ReactNative,
    zod: Zod,
    "@getpaseo/plugin/client/react-native": {
      ScrollView: ReactNative.ScrollView,
      useRevealedText: (text: string) => text,
      useToast: () => ({ show() {}, error() {} }),
      copyText: async () => {},
    },
  };
  const factory = (0, eval)(clientBundle!);
  const exports = factory((name: string) => {
    if (!(name in modules)) throw new Error(`Unsupported runtime module: ${name}`);
    return modules[name];
  });
  const registered: string[] = [];
  const cleanup = exports.default({
    addTimelineTransformer: () => () => {},
    addTimelineRenderer: (renderer: { kind: string; Component: unknown }) => {
      // Paseo 0.10.3 rejects React.memo objects at this boundary.
      expect(typeof renderer.Component).toBe("function");
      registered.push(renderer.kind);
      return () => {};
    },
  });
  expect(registered).toEqual(["conversation-answer", "conversation-thinking", "conversation-tool"]);
  expect(typeof cleanup).toBe("function");
  cleanup();
});
