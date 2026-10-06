import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import {
  ScrollView,
  copyText,
  useRevealedText,
  useToast,
} from "@getpaseo/plugin/client/react-native";
import type { NativeTextData, NativeToolData } from "../shared/native";
import { Markdown } from "./markdown";

function useStyles(theme: PluginTheme, compact: boolean) {
  return useMemo(
    () =>
      ({
        answer: { gap: 6, paddingVertical: compact ? 8 : 12 },
        label: { color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 18 },
        copy: { alignSelf: "flex-start", paddingVertical: 7, paddingHorizontal: 4 },
        card: {
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 8,
          marginVertical: 4,
          overflow: "hidden",
        },
        header: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: compact ? 10 : 12,
        },
        chevron: { color: theme.colors.foregroundMuted, fontSize: 12 },
        title: { flex: 1, color: theme.colors.foreground, fontSize: 13, fontWeight: "500" },
        status: { color: theme.colors.foregroundMuted, fontSize: 11 },
        running: { color: theme.colors.accent, fontSize: 11 },
        failed: { color: theme.colors.statusDanger, fontSize: 11 },
        error: {
          color: theme.colors.statusDanger,
          fontSize: 12,
          lineHeight: 20,
          paddingHorizontal: 12,
          paddingBottom: 10,
        },
        body: {
          borderTopWidth: 1,
          borderColor: theme.colors.border,
          paddingHorizontal: 12,
          paddingVertical: 10,
          gap: 10,
        },
        code: {
          color: theme.colors.foreground,
          fontFamily: "monospace",
          fontSize: 12,
          lineHeight: 20,
          paddingVertical: 4,
        },
      }) as const,
    [theme, compact],
  );
}

function Disclosure({
  title,
  status,
  failed = false,
  running = false,
  error,
  theme,
  compact,
  children,
}: {
  title: string;
  status: string;
  failed?: boolean;
  running?: boolean;
  error?: string;
  theme: PluginTheme;
  compact: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const styles = useStyles(theme, compact);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const accessibilityState = useMemo(() => ({ expanded: open }), [open]);
  const statusStyle = failed ? styles.failed : styles.status;
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}，${status}`}
        accessibilityState={accessibilityState}
        onPress={toggle}
        style={styles.header}
      >
        <Text style={styles.chevron}>{open ? "⌄" : "›"}</Text>
        <Text numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        <Text style={running ? styles.running : statusStyle}>{status}</Text>
      </Pressable>
      {error ? (
        <Text selectable numberOfLines={open ? undefined : 2} style={styles.error}>
          {error}
        </Text>
      ) : null}
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

export function NativeAnswer({ item, theme, layout }: PluginTimelineItemProps<NativeTextData>) {
  const text = useRevealedText(item.data.text, item.data.phase);
  const styles = useStyles(theme, layout.compact);
  return (
    <View style={styles.answer}>
      <Text style={styles.label}>
        {item.data.phase === "streaming" ? "对话增强 · 生成中" : "对话增强"}
      </Text>
      <Markdown text={text} theme={theme} />
      {item.data.phase === "complete" ? (
        <AnswerCopy text={item.data.text} theme={theme} compact={layout.compact} />
      ) : null}
    </View>
  );
}

function AnswerCopy({
  text,
  theme,
  compact,
}: {
  text: string;
  theme: PluginTheme;
  compact: boolean;
}) {
  const styles = useStyles(theme, compact);
  const toast = useToast();
  const copy = useCallback(() => {
    void copyText(text).then(
      () => toast.show("已复制回答", { variant: "success" }),
      () => toast.error("复制失败，请重试"),
    );
  }, [text, toast]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="复制回答"
      onPress={copy}
      style={styles.copy}
    >
      <Text style={styles.label}>复制回答</Text>
    </Pressable>
  );
}

export function NativeThinking({ item, theme, layout }: PluginTimelineItemProps<NativeTextData>) {
  const text = useRevealedText(item.data.text, item.data.phase);
  const running = item.data.phase === "streaming";
  return (
    <Disclosure
      title="思考过程"
      status={running ? "思考中" : "已完成"}
      running={running}
      theme={theme}
      compact={layout.compact}
    >
      <Markdown text={text} theme={theme} />
    </Disclosure>
  );
}

function printable(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function toolSummary(data: NativeToolData): string {
  const detail = detailRecord(data.detail);
  let summary: unknown;
  switch (detail.type) {
    case "shell":
      summary = detail.command;
      break;
    case "read":
    case "edit":
    case "write":
      summary = detail.filePath;
      break;
    case "search":
      summary = detail.query;
      break;
    case "fetch":
      summary = detail.url;
      break;
    case "sub_agent":
      summary = detail.description;
      break;
    case "plain_text":
      summary = detail.label;
      break;
    default:
      return data.name;
  }
  return typeof summary === "string" && summary ? summary : data.name;
}

function detailRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value))
    return value as Record<string, unknown>;
  return {};
}

function ToolDetails({
  data,
  theme,
  compact,
}: {
  data: NativeToolData;
  theme: PluginTheme;
  compact: boolean;
}) {
  const styles = useStyles(theme, compact);
  const detail = detailRecord(data.detail);
  if (detail.type === "plan" && typeof detail.text === "string")
    return <Markdown text={detail.text} theme={theme} />;
  return (
    <ScrollView horizontal>
      <Text selectable style={styles.code}>
        {printable(data.detail)}
      </Text>
    </ScrollView>
  );
}

const STATUS_LABELS = {
  running: "执行中",
  completed: "已完成",
  failed: "失败",
  canceled: "已取消",
} as const;

export function NativeTool({ item, theme, layout }: PluginTimelineItemProps<NativeToolData>) {
  const data = item.data;
  const failed = data.status === "failed";
  return (
    <Disclosure
      title={`${data.name} · ${toolSummary(data)}`}
      status={STATUS_LABELS[data.status]}
      running={data.status === "running"}
      failed={failed}
      error={failed ? printable(data.error) || "工具执行失败" : undefined}
      theme={theme}
      compact={layout.compact}
    >
      <ToolDetails data={data} theme={theme} compact={layout.compact} />
    </Disclosure>
  );
}
