import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Pressable,
  Text,
  View,
  type ScrollView as NativeScrollView,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import { useAgent, type PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { ScrollView, Modal, copyText } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import {
  buildTurns,
  readingTurn,
  type ReaderTurn,
  type ReaderRow,
  type TurnGeometry,
} from "../shared/model";
import { useTimeline } from "./use-timeline";
import { Markdown } from "./markdown";

type Mode = "A" | "B" | "C";
const MODE_NAMES: Record<Mode, string> = { A: "正文", B: "执行", C: "轮次" };

function Action<T = undefined>({
  children,
  onPress,
  value,
  theme,
  selected = false,
  disabled = false,
  label,
}: {
  children: ReactNode;
  onPress: (value: T) => void;
  value?: T;
  theme: PluginTheme;
  selected?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const styles = useMemo(
    () =>
      ({
        s0: {
          paddingHorizontal: 10,
          paddingVertical: 7,
          borderRadius: 6,
          opacity: disabled ? 0.5 : 1,
          backgroundColor: selected ? theme.colors.surface2 : "transparent",
        },
        s1: {
          color: selected ? theme.colors.foreground : theme.colors.foregroundMuted,
          fontSize: 12,
        },
      }) as const,
    [theme, selected, disabled],
  );

  const handlePress = useCallback(() => onPress(value as T), [onPress, value]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={handlePress}
      style={styles.s0}
    >
      <Text style={styles.s1}>{children}</Text>
    </Pressable>
  );
}

function Disclosure({
  title,
  children,
  theme,
  warning = false,
  initialOpen = false,
}: {
  title: string;
  children: ReactNode;
  theme: PluginTheme;
  warning?: boolean;
  initialOpen?: boolean;
}) {
  const styles = useMemo(
    () =>
      ({
        s0: { marginVertical: 5 },
        s1: { flexDirection: "row", gap: 8, paddingVertical: 8 },
        s2: {
          color: warning ? theme.colors.statusDanger : theme.colors.foregroundMuted,
          fontSize: 12,
        },
        s3: {
          flex: 1,
          color: warning ? theme.colors.statusDanger : theme.colors.foregroundMuted,
          fontSize: 12,
        },
        s4: {
          borderLeftWidth: 1,
          borderColor: theme.colors.border,
          paddingLeft: 12,
          marginLeft: 4,
        },
      }) as const,
    [theme, warning],
  );

  const [open, setOpen] = useState(initialOpen);
  const extra = useMemo(() => ({ s0: { expanded: open } }), [open]);
  const toggleOpen = useCallback(() => setOpen((v) => !v), []);
  return (
    <View style={styles.s0}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={extra.s0}
        onPress={toggleOpen}
        style={styles.s1}
      >
        <Text style={styles.s2}>{open ? "⌄" : "›"}</Text>
        <Text style={styles.s3}>{title}</Text>
      </Pressable>
      {open && <View style={styles.s4}>{children}</View>}
    </View>
  );
}

const Process = memo(function Process({ turn, theme }: { turn: ReaderTurn; theme: PluginTheme }) {
  const styles = useMemo(
    () =>
      ({
        s0: {
          color: theme.colors.foregroundMuted,
          fontFamily: "monospace",
          fontSize: 12,
          lineHeight: 21,
          paddingVertical: 8,
        },
        s1: { color: theme.colors.statusDanger, fontSize: 12 },
        s2: { marginVertical: 10 },
        s3: {
          color: theme.colors.foreground,
          fontSize: 13,
          lineHeight: 24,
        },
        s4: {
          color: theme.colors.statusDanger,
          fontSize: 13,
          lineHeight: 23,
          paddingVertical: 7,
        },
        s5: { color: theme.colors.foregroundMuted, fontSize: 12, paddingVertical: 8 },
        s6: { color: theme.colors.foregroundMuted, fontSize: 12 },
      }) as const,
    [theme],
  );

  return (
    <View>
      {turn.rows
        .filter((r) => r.item.type !== "assistant_message")
        .map((row) => {
          const item = row.item;
          if (item.type === "reasoning")
            return (
              <Disclosure key={row.seq} title="思考过程" theme={theme}>
                <Markdown text={item.text} theme={theme} />
              </Disclosure>
            );
          if (item.type === "tool_call") {
            const mark = toolMark(item.status);
            return (
              <Disclosure
                key={row.seq}
                title={`${mark} ${item.name} · ${item.status}`}
                theme={theme}
                warning={item.status === "failed"}
                initialOpen={item.status === "failed"}
              >
                <Text selectable style={styles.s0}>
                  {JSON.stringify(item.detail, null, 2)}
                </Text>
                {item.error != null && (
                  <Text selectable style={styles.s1}>
                    {String(item.error)}
                  </Text>
                )}
              </Disclosure>
            );
          }
          if (item.type === "todo")
            return (
              <View key={row.seq} style={styles.s2}>
                {item.items.map((task) => (
                  <Text key={task.id ?? task.text} style={styles.s3}>
                    {task.completed ? "✓" : "○"} {task.text}
                  </Text>
                ))}
              </View>
            );
          if (item.type === "error" || item.type === "notification")
            return (
              <Text key={row.seq} selectable style={styles.s4}>
                {item.message}
              </Text>
            );
          if (item.type === "compaction")
            return (
              <Text key={row.seq} style={styles.s5}>
                上下文压缩 · {item.status}
              </Text>
            );
          if (item.type === "plugin")
            return (
              <Text key={row.seq} style={styles.s6}>
                插件内容 · {item.kind}
              </Text>
            );
          return null;
        })}
    </View>
  );
});

function processSummary(turn: ReaderTurn) {
  const tools = turn.rows.filter((r) => r.item.type === "tool_call");
  const running = tools.filter(
    (r) => r.item.type === "tool_call" && r.item.status === "running",
  ).length;
  const failed = tools.filter(
    (r) => r.item.type === "tool_call" && r.item.status === "failed",
  ).length;
  return {
    text: `${tools.length} 次工具调用${running ? ` · ${running} 项运行中` : ""}${failed ? ` · ${failed} 项失败` : ""}`,
    failed,
  };
}

const TurnBody = memo(function TurnBody({
  turn,
  mode,
  compact,
  theme,
  onCopy,
}: {
  turn: ReaderTurn;
  mode: Mode;
  compact: boolean;
  theme: PluginTheme;
  onCopy: (turn: ReaderTurn) => void;
}) {
  const styles = useMemo(
    () =>
      ({
        s0: {
          paddingBottom: 30,
          paddingHorizontal: mode === "C" ? 16 : 0,
          backgroundColor: mode === "C" ? theme.colors.surface1 : "transparent",
          borderBottomLeftRadius: 9,
          borderBottomRightRadius: 9,
        },
        s1: { marginTop: 16 },
        s2: { color: theme.colors.foregroundMuted, fontSize: 13, paddingVertical: 15 },
        s3: { color: theme.colors.statusDanger, fontSize: 13, lineHeight: 23 },
        s4: {
          borderTopWidth: 1,
          borderColor: theme.colors.border,
          marginTop: 15,
          paddingTop: 10,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        },
        s5: { color: theme.colors.foregroundMuted, fontSize: 11 },
      }) as const,
    [theme, mode],
  );

  const summary = processSummary(turn);
  const showProcess = mode !== "B" || compact;
  return (
    <View style={styles.s0}>
      {showProcess && turn.rows.some((r) => r.item.type !== "assistant_message") && (
        <Disclosure
          title={`${summary.text} · 查看执行过程`}
          theme={theme}
          warning={summary.failed > 0}
          initialOpen={summary.failed > 0}
        >
          <Process turn={turn} theme={theme} />
        </Disclosure>
      )}
      <View style={styles.s1}>
        {turn.rows
          .filter((r) => r.item.type === "assistant_message")
          .map((row) => (
            <Markdown key={row.seq} text={(row.item as { text: string }).text} theme={theme} />
          ))}
        {!turn.rows.some((r) => r.item.type === "assistant_message") && (
          <Text style={styles.s2}>暂无回答正文</Text>
        )}
      </View>
      {turn.rows
        .filter(
          (r) =>
            r.item.type === "error" || (r.item.type === "tool_call" && r.item.status === "failed"),
        )
        .map((row) => (
          <Text key={`error-${row.seq}`} selectable style={styles.s3}>
            {failureText(row)}
          </Text>
        ))}
      <View style={styles.s4}>
        <Text style={styles.s5}>{summary.text}</Text>
        <Action theme={theme} onPress={onCopy} value={turn}>
          复制回答
        </Action>
      </View>
    </View>
  );
});

function firstSequence(rows: ReaderRow[]) {
  return rows[0]?.seq ?? null;
}

function pruneMeasurements(
  turns: ReaderTurn[],
  geometry: { current: TurnGeometry[] },
  heights: { current: Map<number, number> },
) {
  const currentIds = new Set(turns.map((turn) => turn.id));
  geometry.current = geometry.current.filter((turn) => currentIds.has(turn.id));
  for (const id of heights.current.keys()) {
    if (!currentIds.has(id)) heights.current.delete(id);
  }
}

function Reader({ agentId, theme, layout, navigation }: PluginAgentPanelProps) {
  const extra = useMemo(
    () => ({
      s0: { paddingHorizontal: 10, gap: 4 },
      s1: { padding: 16 },
      s2: { padding: layout.compact ? 16 : 28, paddingBottom: 50 },
    }),
    [layout.compact],
  );

  const [mode, setMode] = useState<Mode>("A");
  const styles = useMemo(
    () =>
      ({
        s0: { flex: 1, backgroundColor: theme.colors.surface0 },
        s1: {
          paddingHorizontal: layout.compact ? 12 : 20,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderColor: theme.colors.border,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        },
        s2: { flex: 1 },
        s3: { color: theme.colors.foreground, fontSize: 14 },
        s4: { color: theme.colors.foregroundMuted, fontSize: 11 },
        s5: { flexDirection: "row" },
        s13: { padding: 12, borderBottomWidth: 1, borderColor: theme.colors.border },
        s14: { color: theme.colors.statusDanger, fontSize: 12 },
        s15: { paddingHorizontal: 16, paddingVertical: 6 },
        s16: { color: theme.colors.statusWarning, fontSize: 12 },
        s17: { flexGrow: 0, maxHeight: 44 },
        s18: { flex: 1, flexDirection: "row", minHeight: 0 },
        s19: {
          width: 270,
          borderRightWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
        },
        s20: { color: theme.colors.foreground, fontSize: 13, marginBottom: 12 },
        s21: { flex: 1 },
        s22: { width: "100%", maxWidth: 800, alignSelf: "center" },
        s23: { color: theme.colors.foregroundMuted },
        s24: { color: theme.colors.foregroundMuted },
        s30: {
          borderTopWidth: 1,
          borderColor: theme.colors.border,
          paddingHorizontal: 12,
          paddingVertical: 5,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        },
        s31: { color: theme.colors.foregroundMuted, fontSize: 10 },
        s32: { flexDirection: "row" },
        s33: { color: theme.colors.foreground, fontSize: 15, lineHeight: 26 },
      }) as const,
    [theme, layout.compact],
  );

  const timeline = useTimeline(agentId);
  const { loadOlder } = timeline;
  const agent = useAgent(agentId, (a) => ({
    title: a.title,
    status: a.status,
    requiresAttention: a.requiresAttention,
  }));
  const turns = useMemo(() => buildTurns(timeline.rows), [timeline.rows]);

  const [activeId, setActiveId] = useState<number | null>(null);
  const [pinnedId, setPinnedId] = useState<number | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [fullPrompt, setFullPrompt] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const scroll = useRef<NativeScrollView>(null);
  const geometry = useRef<TurnGeometry[]>([]);
  const promptHeights = useRef(new Map<number, number>());
  const offset = useRef(0);
  const following = useRef(true);
  const pendingAnchor = useRef<{ id: number; delta: number; beforeSeq: number | null } | null>(
    null,
  );
  const firstSeq = firstSequence(timeline.rows);
  const firstSeqRef = useRef(firstSeq);
  firstSeqRef.current = firstSeq;
  pruneMeasurements(turns, geometry, promptHeights);
  const selectedTurn = turns.find((t) => t.id === activeId) ?? turns[0];
  const pinned = turns.find((t) => t.id === pinnedId);
  const columns = mode === "B" && !layout.compact;

  const reportPosition = useCallback((y: number) => {
    offset.current = y;
    const id = readingTurn(geometry.current, y);
    setActiveId(id);
    const position = geometry.current.find((t) => t.id === id);
    setPinnedId(
      position && y >= position.y + (promptHeights.current.get(position.id) ?? 0) ? id : null,
    );
  }, []);
  const jump = useCallback((id: number) => {
    const position = geometry.current.find((t) => t.id === id);
    if (position) {
      pendingAnchor.current = null;
      following.current = false;
      setAtBottom(false);
      scroll.current?.scrollTo({ y: position.y, animated: true });
    }
  }, []);
  const switchMode = useCallback(
    (next: Mode) => {
      if (next === mode) return;
      const position = geometry.current.find((turn) => turn.id === selectedTurn?.id);
      if (position) {
        pendingAnchor.current = {
          id: position.id,
          delta: offset.current - position.y,
          beforeSeq: null,
        };
        following.current = false;
      }
      geometry.current = [];
      promptHeights.current.clear();
      setAtBottom(false);
      setMode(next);
    },
    [selectedTurn, mode],
  );
  const copy = useCallback(async (turn: ReaderTurn) => {
    setCopyStatus("复制中…");
    try {
      await copyText(
        turn.rows
          .filter((r) => r.item.type === "assistant_message")
          .map((r) => (r.item as { text: string }).text)
          .join("\n\n"),
      );
      setCopyStatus("已复制回答");
    } catch (e) {
      setCopyStatus(`复制失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);
  const older = useCallback(async () => {
    following.current = false;
    setAtBottom(false);
    const position = geometry.current.find((turn) => turn.id === selectedTurn?.id);
    if (position) {
      pendingAnchor.current = {
        id: position.id,
        delta: offset.current - position.y,
        beforeSeq: firstSeqRef.current,
      };
    }
    if (!(await loadOlder())) pendingAnchor.current = null;
  }, [loadOlder, selectedTurn]);

  const measureTurn = useCallback(
    (id: number, y: number, height: number, positionChanged: boolean) => {
      promptHeights.current.set(id, height);
      if (!positionChanged) {
        reportPosition(offset.current);
        return;
      }
      const top = y + (layout.compact ? 16 : 28);
      geometry.current = [...geometry.current.filter((t) => t.id !== id), { id, y: top }].sort(
        (a, b) => a.y - b.y,
      );
      const anchor = pendingAnchor.current;
      const pageArrived =
        anchor?.beforeSeq === null ||
        (firstSeqRef.current !== null &&
          anchor?.beforeSeq !== undefined &&
          firstSeqRef.current < anchor.beforeSeq);
      const anchorTurn = turns.find(
        (turn) =>
          turn.id === anchor?.id ||
          turn.rows.some(
            (row) =>
              anchor !== null && row.seq <= anchor.id && (row.endSeq ?? row.seq) >= anchor.id,
          ),
      );
      if (anchor && anchorTurn?.id === id && pageArrived) {
        pendingAnchor.current = null;
        following.current = false;
        const restored = Math.max(0, top + anchor.delta);
        scroll.current?.scrollTo({ y: restored, animated: false });
        reportPosition(restored);
      }
      reportPosition(offset.current);
    },
    [layout.compact, reportPosition, turns],
  );
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      reportPosition(contentOffset.y);
      const near = contentSize.height - contentOffset.y - layoutMeasurement.height < 48;
      if (!pendingAnchor.current) following.current = near;
      setAtBottom(near);
    },
    [reportPosition],
  );
  const handleContentSize = useCallback(() => {
    if (following.current && !pendingAnchor.current)
      scroll.current?.scrollToEnd({ animated: false });
    reportPosition(offset.current);
  }, [reportPosition]);
  const latest = useCallback(() => {
    pendingAnchor.current = null;
    following.current = true;
    scroll.current?.scrollToEnd({ animated: true });
  }, []);
  const openNative = useCallback(() => navigation?.openAgent({ agentId }), [navigation, agentId]);
  const closePrompt = useCallback((open: boolean) => {
    if (!open) setFullPrompt(null);
  }, []);
  return (
    <View testID="conversation-view" style={styles.s0}>
      <View style={styles.s1}>
        <View style={styles.s2}>
          <Text numberOfLines={1} style={styles.s3}>
            {agent?.title ?? "对话视图"}
          </Text>
          <Text style={styles.s4}>
            {turns.length} 轮已加载 · {agent?.status ?? "连接中"}
          </Text>
        </View>
        <View style={styles.s5}>
          {(["A", "B", "C"] as const).map((m) => (
            <Action
              key={m}
              theme={theme}
              selected={mode === m}
              onPress={switchMode}
              value={m}
              label={`视图 ${m}`}
            >
              {m} {MODE_NAMES[m]}
            </Action>
          ))}
        </View>
      </View>
      <PinnedContext turn={pinned} theme={theme} onPrompt={setFullPrompt} onJump={jump} />
      {timeline.error && (
        <View style={styles.s13}>
          <Text selectable style={styles.s14}>
            {timeline.error}
          </Text>
          <Action theme={theme} onPress={timeline.reconnect}>
            重新连接
          </Action>
        </View>
      )}
      {agent?.requiresAttention && (
        <View style={styles.s15}>
          <Text style={styles.s16}>Agent 需要处理，请打开原生对话查看权限或问题。</Text>
        </View>
      )}
      {mode === "C" && (
        <ScrollView horizontal style={styles.s17} contentContainerStyle={extra.s0}>
          {turns.map((turn, i) => (
            <Action
              key={turn.id}
              theme={theme}
              selected={turn.id === selectedTurn?.id}
              onPress={jump}
              value={turn.id}
            >
              {i + 1} · {(turn.prompt ?? "前文").slice(0, 10)}
            </Action>
          ))}
        </ScrollView>
      )}
      <View style={styles.s18}>
        {columns && (
          <View style={styles.s19}>
            <ScrollView contentContainerStyle={extra.s1}>
              <Text style={styles.s20}>当前轮执行过程</Text>
              {selectedTurn && <Process turn={selectedTurn} theme={theme} />}
            </ScrollView>
          </View>
        )}
        <ScrollView
          ref={scroll}
          scrollEventThrottle={16}
          style={styles.s21}
          onScroll={handleScroll}
          onContentSizeChange={handleContentSize}
          contentContainerStyle={extra.s2}
        >
          <View key={mode} style={styles.s22}>
            {timeline.loading ? (
              <Text style={styles.s23}>正在加载对话…</Text>
            ) : (
              turns.length === 0 && <Text style={styles.s24}>还没有对话记录。</Text>
            )}
            {timeline.hasOlder && (
              <Action theme={theme} disabled={timeline.loadingOlder} onPress={older}>
                {timeline.loadingOlder ? "正在加载…" : "加载更早的对话"}
              </Action>
            )}
            {turns.map((turn, i) => (
              <TurnSection
                key={turn.id}
                turn={turn}
                ordinal={i + 1}
                mode={mode}
                compact={layout.compact}
                theme={theme}
                onCopy={copy}
                onPrompt={setFullPrompt}
                onMeasure={measureTurn}
              />
            ))}
          </View>
        </ScrollView>
      </View>
      <View style={styles.s30}>
        <Text style={styles.s31}>{copyStatus ?? "独立阅读面板"}</Text>
        <View style={styles.s32}>
          {!atBottom && (
            <Action theme={theme} onPress={latest}>
              回到最新 ↓
            </Action>
          )}
          {navigation && (
            <Action theme={theme} onPress={openNative}>
              原生对话
            </Action>
          )}
        </View>
      </View>
      <Modal title="完整提问" open={fullPrompt !== null} onOpenChange={closePrompt}>
        <Modal.Content>
          <Text selectable style={styles.s33}>
            {fullPrompt}
          </Text>
        </Modal.Content>
      </Modal>
    </View>
  );
}

export function ConversationPanel(props: PluginAgentPanelProps) {
  return <Reader key={props.agentId} {...props} />;
}

function PinnedContext({
  turn,
  theme,
  onPrompt,
  onJump,
}: {
  turn: ReaderTurn | undefined;
  theme: PluginTheme;
  onPrompt: (text: string | null) => void;
  onJump: (id: number) => void;
}) {
  const styles = useMemo(
    () => ({
      container: {
        height: 92,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderColor: theme.colors.border,
      },
      row: {
        flexDirection: "row" as const,
        justifyContent: "space-between" as const,
        alignItems: "center" as const,
      },
      actions: { flexDirection: "row" as const },
      label: { color: theme.colors.foregroundMuted, fontSize: 10 },
      text: { color: theme.colors.foreground, fontSize: 13, lineHeight: 20 },
      empty: { color: theme.colors.foregroundMuted, fontSize: 12, paddingTop: 20 },
    }),
    [theme],
  );
  if (!turn?.prompt)
    return (
      <View style={styles.container}>
        <Text style={styles.empty}>滚动阅读时，在这里保留当前轮提问</Text>
      </View>
    );
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={styles.label}>当前轮提问</Text>
        <View style={styles.actions}>
          <Action theme={theme} onPress={onPrompt} value={turn.prompt}>
            全文
          </Action>
          <Action theme={theme} onPress={onJump} value={turn.id}>
            定位
          </Action>
        </View>
      </View>
      <Text testID="pinned-question" numberOfLines={2} style={styles.text}>
        {turn.prompt}
      </Text>
    </View>
  );
}
const TurnSection = memo(function TurnSection({
  turn,
  ordinal,
  mode,
  compact,
  theme,
  onCopy,
  onPrompt,
  onMeasure,
}: {
  turn: ReaderTurn;
  ordinal: number;
  mode: Mode;
  compact: boolean;
  theme: PluginTheme;
  onCopy: (turn: ReaderTurn) => void;
  onPrompt: (text: string | null) => void;
  onMeasure: (id: number, y: number, height: number, positionChanged: boolean) => void;
}) {
  const styles = useMemo(
    () => ({
      section: { marginBottom: 28 },
      header: {
        paddingVertical: 14,
        paddingHorizontal: mode === "C" ? 16 : 0,
        marginBottom: 12,
        borderBottomWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: mode === "C" ? theme.colors.surface1 : "transparent",
        borderTopLeftRadius: 9,
        borderTopRightRadius: 9,
      },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        marginBottom: 8,
      },
      label: { color: theme.colors.foregroundMuted, fontSize: 11 },
      prompt: {
        color: theme.colors.foreground,
        fontSize: 15,
        lineHeight: 25,
        fontWeight: "500" as const,
      },
    }),
    [theme, mode],
  );
  const position = useRef<number | null>(null);
  const height = useRef(0);
  const measure = useCallback(
    (e: LayoutChangeEvent) => {
      position.current = e.nativeEvent.layout.y;
      onMeasure(turn.id, position.current, height.current, true);
    },
    [onMeasure, turn.id],
  );
  const measurePrompt = useCallback(
    (e: LayoutChangeEvent) => {
      height.current = e.nativeEvent.layout.height;
      if (position.current !== null) onMeasure(turn.id, position.current, height.current, false);
    },
    [onMeasure, turn.id],
  );
  return (
    <View style={styles.section} onLayout={measure}>
      <View style={styles.header} onLayout={measurePrompt}>
        <View style={styles.row}>
          <Text style={styles.label}>
            {ordinal} · {turn.prompt === null ? "前文未加载" : "你"} ·{" "}
            {new Date(turn.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
          {turn.prompt && (
            <Action theme={theme} onPress={onPrompt} value={turn.prompt}>
              全文
            </Action>
          )}
        </View>
        <Text selectable numberOfLines={4} style={styles.prompt}>
          {turn.prompt ?? "加载更早的对话，以查看这段回答对应的提问。"}
        </Text>
      </View>
      <TurnBody turn={turn} mode={mode} compact={compact} theme={theme} onCopy={onCopy} />
    </View>
  );
});

function toolMark(status: string) {
  const marks: Record<string, string> = {
    completed: "✓",
    running: "●",
    failed: "!",
    canceled: "−",
  };
  return marks[status] ?? "○";
}
function failureText(row: ReaderRow) {
  if (row.item.type === "error") return row.item.message;
  if (row.item.type === "tool_call") return `${row.item.name}: ${row.item.error}`;
  return "";
}
