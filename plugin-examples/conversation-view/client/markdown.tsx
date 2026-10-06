import { memo, useCallback, useMemo } from "react";
import { Linking } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useToast } from "@getpaseo/plugin/client/react-native";
import type MarkdownItType from "markdown-it";
import type { Markdown as MarkdownComponent } from "./generated/markdown-types";
import Engine, { MarkdownIt as EngineMarkdownIt } from "./generated/markdown.gen";

const MarkdownEngine = Engine as MarkdownComponent;
const MarkdownIt = EngineMarkdownIt as unknown as typeof MarkdownItType;
const parser = new MarkdownIt({ html: false, linkify: true, typographer: false });

/** CommonMark/GFM renderer prebundled for Paseo's restricted client imports. */
export const Markdown = memo(function Markdown({
  text,
  theme,
}: {
  text: string;
  theme: PluginTheme;
}) {
  const toast = useToast();
  const style = useMemo(
    () => ({
      body: { color: theme.colors.foreground, fontSize: 15, lineHeight: 25 },
      paragraph: { marginTop: 0, marginBottom: 12 },
      heading1: {
        fontSize: 25,
        lineHeight: 34,
        fontWeight: "600" as const,
        marginTop: 14,
        marginBottom: 10,
      },
      heading2: {
        fontSize: 21,
        lineHeight: 30,
        fontWeight: "600" as const,
        marginTop: 12,
        marginBottom: 8,
      },
      heading3: {
        fontSize: 18,
        lineHeight: 27,
        fontWeight: "600" as const,
        marginTop: 10,
        marginBottom: 8,
      },
      heading4: { fontSize: 16, lineHeight: 25, fontWeight: "600" as const },
      heading5: { fontSize: 15, lineHeight: 25, fontWeight: "600" as const },
      heading6: { fontSize: 15, lineHeight: 25, fontWeight: "600" as const },
      link: { color: theme.colors.accent },
      blockquote: {
        backgroundColor: theme.colors.surface1,
        borderColor: theme.colors.border,
        borderLeftWidth: 2,
      },
      hr: { backgroundColor: theme.colors.border },
      code_inline: {
        borderWidth: 0,
        padding: 0,
        paddingHorizontal: 0,
        paddingVertical: 0,
        color: theme.colors.accent,
        backgroundColor: theme.colors.surface1,
        fontFamily: "monospace",
        fontSize: 13,
      },
      fence: {
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface1,
        borderColor: theme.colors.border,
        fontFamily: "monospace",
        fontSize: 13,
        lineHeight: 21,
        padding: 12,
        borderRadius: 8,
      },
      code_block: {
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface1,
        borderColor: theme.colors.border,
        fontFamily: "monospace",
        fontSize: 13,
        lineHeight: 21,
        padding: 12,
        borderRadius: 8,
      },
      table: { borderColor: theme.colors.border, borderWidth: 1, borderRadius: 6 },
      thead: { backgroundColor: theme.colors.surface1 },
      tr: { borderColor: theme.colors.border },
      th: { padding: 9 },
      td: { padding: 9 },
      bullet_list: { marginBottom: 10 },
      ordered_list: { marginBottom: 10 },
      list_item: { marginBottom: 4 },
    }),
    [theme],
  );
  const openLink = useCallback(
    (url: string) => {
      if (/^(?:https?:|mailto:)/i.test(url)) {
        void Linking.openURL(url).catch(() => toast.error("无法打开链接"));
      }
      return false;
    },
    [toast],
  );
  return (
    <MarkdownEngine markdownit={parser} style={style} onLinkPress={openLink}>
      {text}
    </MarkdownEngine>
  );
});
