import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  Pressable,
  Text,
  TextInput,
  View,
  Platform,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { useAgent, usePaseo } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { createSubmission, isSubmitShortcut } from "./submission";

interface ComposerProps {
  agentId: string;
  theme: PluginTheme;
  compact: boolean;
  onSent: () => void;
  onStop?: () => Promise<void>;
}

export function Composer({ agentId, theme, compact, onSent, onStop }: ComposerProps) {
  const paseo = usePaseo();
  const status = useAgent(agentId, (agent) => agent.status);
  const attention = useAgent(agentId, (agent) => agent.attentionReason);
  const stopCallback = useRef(onStop);
  useEffect(() => {
    stopCallback.current = onStop;
  }, [onStop]);
  const actions = useMemo(
    () =>
      createSubmission({
        send: (text, messageId) => paseo.agents.ref(agentId).send(text, { messageId }),
        stop: async () => {
          if (!stopCallback.current) throw new Error("当前视图无法停止 Agent");
          await stopCallback.current();
        },
      }),
    [paseo, agentId],
  );
  const state = useSyncExternalStore(actions.subscribe, actions.getSnapshot, actions.getSnapshot);
  const pending = state.phase === "sending" || state.phase === "stopping";
  const unavailable = status === null || status === "closed" || status === "initializing";
  const blocked = pending || unavailable;
  const canSend = !blocked && state.text.trim().length > 0;
  const running = status === "running";
  const canStop = running && Boolean(onStop);
  const styles = useMemo(
    () => ({
      container: {
        borderTopWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
        paddingHorizontal: compact ? 16 : 28,
        paddingVertical: 12,
        gap: 8,
      },
      inner: { width: "100%" as const, maxWidth: 800, alignSelf: "center" as const, gap: 8 },
      input: {
        minHeight: compact ? 74 : 86,
        maxHeight: 180,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 10,
        padding: 12,
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface1,
        fontSize: 14,
        lineHeight: 22,
        textAlignVertical: "top" as const,
      },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
      hint: { flex: 1, color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 17 },
      error: { color: theme.colors.statusDanger, fontSize: 12, lineHeight: 18 },
      send: {
        backgroundColor: theme.colors.accent,
        opacity: canSend ? 1 : 0.45,
        paddingHorizontal: 16,
        paddingVertical: 9,
        borderRadius: 8,
      },
      sendText: { color: theme.colors.accentForeground, fontSize: 13, fontWeight: "600" as const },
      stop: { borderWidth: 1, borderColor: theme.colors.border, padding: 9, borderRadius: 8 },
      stopText: { color: theme.colors.foreground, fontSize: 13 },
    }),
    [theme, compact, canSend],
  );
  const sendPrompt = useCallback(async () => {
    if (blocked) return;
    if (await actions.send()) onSent();
  }, [actions, blocked, onSent]);
  const stopGeneration = useCallback(async () => {
    await actions.stop();
  }, [actions]);
  const keyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (!isSubmitShortcut(event.nativeEvent)) return;
      event.preventDefault();
      void sendPrompt();
    },
    [sendPrompt],
  );
  let hint = "支持多行输入 · 点击发送";
  if (Platform.OS === "web") hint = "Enter 换行 · ⌘ / Ctrl + Enter 发送";
  if (running) hint = "发送新消息会中断当前执行，并开始新的请求";
  if (attention === "permission") hint = "Agent 正在等待权限确认";
  if (status === "initializing") hint = "Agent 正在初始化";
  if (status === "closed") hint = "Agent 已关闭，无法发送消息";
  if (status === null) hint = "正在连接 Agent…";
  let sendingLabel = running ? "中断并发送" : "发送";
  if (state.phase === "sending") sendingLabel = "发送中…";
  const stoppingLabel = state.phase === "stopping" ? "停止中…" : "停止生成";
  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        <TextInput
          testID="conversation-composer"
          accessibilityLabel="给 Agent 发送消息"
          multiline
          editable={!blocked}
          value={state.text}
          onChangeText={actions.setText}
          onKeyPress={keyPress}
          placeholder="继续对话，或提出新的需求…"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.input}
        />
        {state.phase === "error" && <Text style={styles.error}>{state.message}</Text>}
        <View style={styles.row}>
          <Text style={styles.hint}>{hint}</Text>
          {canStop && (
            <Pressable
              accessibilityRole="button"
              disabled={pending}
              onPress={stopGeneration}
              style={styles.stop}
            >
              <Text style={styles.stopText}>{stoppingLabel}</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={!canSend}
            onPress={sendPrompt}
            style={styles.send}
          >
            <Text style={styles.sendText}>{sendingLabel}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
