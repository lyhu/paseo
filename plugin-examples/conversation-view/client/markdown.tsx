import { memo, useCallback, useMemo } from "react";
import { Linking, Text, View } from "react-native";
import { ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";

interface TextBlock {
  key: string;
  type: "code" | "heading" | "list" | "quote" | "paragraph";
  text: string;
  language?: string;
}
interface TableRow {
  key: string;
  cells: string[];
}
interface TableColumn {
  key: string;
  text: string;
  position: number;
}
interface TableBlock {
  key: string;
  type: "table";
  header: TableColumn[];
  rows: TableRow[];
}
type Block = TextBlock | TableBlock;

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}
function startsTable(lines: string[], i: number): boolean {
  const next = lines[i + 1];
  if (!lines[i]!.includes("|") || next === undefined) return false;
  const header = tableCells(lines[i]!);
  const separator = tableCells(next);
  return header.length === separator.length && separator.every((cell) => /^:?-{3,}:?$/.test(cell));
}
function parse(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const key = String(offset);
    offset += line.length + 1;
    if (!line.trim()) continue;
    if (startsTable(lines, i)) {
      let columnOffset = 0;
      const header = tableCells(line).map((cell, position) => {
        const column = { key: String(columnOffset), text: cell, position };
        columnOffset += cell.length + 1;
        return column;
      });
      const rows: TableRow[] = [];
      offset += lines[++i]!.length + 1;
      while (i + 1 < lines.length && lines[i + 1]!.trim() && lines[i + 1]!.includes("|")) {
        const row = lines[++i]!;
        rows.push({ key: String(offset), cells: tableCells(row) });
        offset += row.length + 1;
      }
      blocks.push({ key, type: "table", header, rows });
      continue;
    }
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i]!)) {
        code.push(lines[i]!);
        offset += lines[i]!.length + 1;
      }
      offset += (lines[i]?.length ?? 0) + 1;
      blocks.push({
        key,
        type: "code",
        language: line.replace(/^\s*```/, "").trim(),
        text: code.join("\n"),
      });
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)/.exec(line);
    if (heading) {
      blocks.push({ key, type: "heading", text: heading[2]! });
      continue;
    }
    const list = /^\s*([-*+]|\d+[.)])\s+(.+)/.exec(line);
    if (list) {
      const marker = /^\d/.test(list[1]!) ? list[1] : "•";
      blocks.push({ key, type: "list", text: `${marker}  ${list[2]}` });
      continue;
    }
    const quote = /^>\s?(.*)/.exec(line);
    if (quote) {
      blocks.push({ key, type: "quote", text: quote[1]! });
      continue;
    }
    let paragraph = line;
    while (
      i + 1 < lines.length &&
      lines[i + 1]!.trim() &&
      !/^\s*(?:#|```|>|[-*+] |\d+[.)] )/.test(lines[i + 1]!) &&
      !startsTable(lines, i + 1)
    ) {
      const next = lines[++i]!;
      paragraph += `\n${next}`;
      offset += next.length + 1;
    }
    blocks.push({ key, type: "paragraph", text: paragraph });
  }
  return blocks;
}
function InlineLink({ label, href, theme }: { label: string; href: string; theme: PluginTheme }) {
  const toast = useToast();
  const style = useMemo(
    () => ({ color: theme.colors.accent, textDecorationLine: "underline" as const }),
    [theme],
  );
  const open = useCallback(() => {
    void Linking.openURL(href).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`无法打开链接：${message}`);
    });
  }, [href, toast]);
  if (!/^https?:\/\//i.test(href))
    return (
      <Text>
        {label} ({href})
      </Text>
    );
  return (
    <Text accessibilityRole="link" accessibilityLabel={label} onPress={open} style={style}>
      {label}
    </Text>
  );
}
function Inline({ text, theme }: { text: string; theme: PluginTheme }) {
  const styles = useMemo(
    () => ({
      bold: { fontWeight: "600" as const, color: theme.colors.foreground },
      code: { fontFamily: "monospace", fontSize: 13, color: theme.colors.accent },
    }),
    [theme],
  );
  let offset = 0;
  return (
    <>
      {text
        .split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\))/g)
        .filter((part) => part.length > 0)
        .map((part) => {
          const key = String(offset);
          offset += part.length;
          const link = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(part);
          if (link) return <InlineLink key={key} label={link[1]!} href={link[2]!} theme={theme} />;
          if (part.startsWith("**"))
            return (
              <Text key={key} style={styles.bold}>
                {part.slice(2, -2)}
              </Text>
            );
          if (part.startsWith("`"))
            return (
              <Text key={key} style={styles.code}>
                {part.slice(1, -1)}
              </Text>
            );
          return <Text key={key}>{part}</Text>;
        })}
    </>
  );
}
const Table = memo(function Table({ block, theme }: { block: TableBlock; theme: PluginTheme }) {
  const styles = useMemo(
    () => ({
      table: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 6,
        marginVertical: 8,
        overflow: "hidden" as const,
      },
      tableHeader: { flexDirection: "row" as const, backgroundColor: theme.colors.surface1 },
      tableRow: {
        flexDirection: "row" as const,
        borderTopWidth: 1,
        borderColor: theme.colors.border,
      },
      cell: {
        width: 200,
        padding: 10,
        color: theme.colors.foreground,
        fontSize: 14,
        lineHeight: 22,
      },
      headerCell: {
        width: 200,
        padding: 10,
        color: theme.colors.foreground,
        fontSize: 14,
        lineHeight: 22,
        fontWeight: "600" as const,
      },
    }),
    [theme],
  );
  return (
    <ScrollView horizontal style={styles.table}>
      <View>
        <View style={styles.tableHeader}>
          {block.header.map((column) => (
            <Text key={column.key} selectable style={styles.headerCell}>
              <Inline text={column.text} theme={theme} />
            </Text>
          ))}
        </View>
        {block.rows.map((row) => (
          <View key={row.key} style={styles.tableRow}>
            {block.header.map((column) => (
              <Text key={column.key} selectable style={styles.cell}>
                <Inline text={row.cells[column.position] ?? ""} theme={theme} />
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
});

export const Markdown = memo(function Markdown({
  text,
  theme,
}: {
  text: string;
  theme: PluginTheme;
}) {
  const styles = useMemo(
    () => ({
      code: {
        backgroundColor: theme.colors.surface1,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 8,
        marginVertical: 8,
        overflow: "hidden" as const,
      },
      language: { color: theme.colors.foregroundMuted, fontSize: 11, padding: 9 },
      source: {
        color: theme.colors.foreground,
        fontFamily: "monospace",
        fontSize: 13,
        lineHeight: 21,
        padding: 13,
      },
      heading: {
        color: theme.colors.foreground,
        fontSize: 17,
        lineHeight: 27,
        fontWeight: "600" as const,
        marginTop: 17,
        marginBottom: 12,
      },
      paragraph: { color: theme.colors.foreground, fontSize: 15, lineHeight: 26, marginBottom: 12 },
      list: {
        color: theme.colors.foreground,
        fontSize: 15,
        lineHeight: 26,
        marginBottom: 12,
        paddingLeft: 12,
      },
      quote: {
        color: theme.colors.foregroundMuted,
        fontSize: 15,
        lineHeight: 26,
        marginBottom: 12,
        paddingLeft: 12,
        borderLeftWidth: 2,
        borderColor: theme.colors.border,
      },
    }),
    [theme],
  );
  const blocks = useMemo(() => parse(text), [text]);
  return (
    <View>
      {blocks.map((block) => {
        if (block.type === "table") return <Table key={block.key} block={block} theme={theme} />;
        if (block.type === "code")
          return (
            <View key={block.key} style={styles.code}>
              <Text style={styles.language}>{block.language || "代码"}</Text>
              <ScrollView horizontal>
                <Text selectable style={styles.source}>
                  {block.text}
                </Text>
              </ScrollView>
            </View>
          );
        return (
          <Text key={block.key} selectable style={styles[block.type]}>
            <Inline text={block.text} theme={theme} />
          </Text>
        );
      })}
    </View>
  );
});
