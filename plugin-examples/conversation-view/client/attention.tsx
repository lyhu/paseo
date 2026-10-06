import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { usePaseo } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import type {
  AgentPermissionAction,
  AgentPermissionRequest,
  AgentPermissionResponse,
} from "@getpaseo/protocol/agent-types";
import { parseQuestions, questionResponse, type Question } from "./attention-model";

const DEFAULT_ACTIONS: AgentPermissionAction[] = [
  { id: "deny", label: "拒绝", behavior: "deny" },
  { id: "allow", label: "允许本次", behavior: "allow" },
];

function useStyles(theme: PluginTheme, compact: boolean) {
  return useMemo(
    () => ({
      card: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        borderRadius: 10,
        padding: compact ? 12 : 16,
        gap: 10,
      },
      stack: { gap: 8 },
      row: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
      title: { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" as const },
      text: { color: theme.colors.foreground, fontSize: 13, lineHeight: 21 },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 19 },
      error: { color: theme.colors.statusDanger, fontSize: 12 },
      detail: { color: theme.colors.foregroundMuted, fontSize: 11, fontFamily: "monospace" },
      button: {
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 7,
        backgroundColor: theme.colors.surface2,
      },
      input: {
        color: theme.colors.foreground,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 7,
        padding: 10,
        minHeight: 42,
      },
    }),
    [theme, compact],
  );
}

type Styles = ReturnType<typeof useStyles>;

function ActionButton({
  action,
  disabled,
  onAction,
  styles,
}: {
  action: AgentPermissionAction;
  disabled: boolean;
  onAction: (action: AgentPermissionAction) => void;
  styles: Styles;
}) {
  const press = useCallback(() => onAction(action), [onAction, action]);
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={press} style={styles.button}>
      <Text style={styles.text}>{action.label}</Text>
    </Pressable>
  );
}

function Option({
  option,
  selected,
  disabled,
  onSelect,
  styles,
}: {
  option: Question["options"][number];
  selected: boolean;
  disabled: boolean;
  onSelect: (label: string) => void;
  styles: Styles;
}) {
  const press = useCallback(() => onSelect(option.label), [onSelect, option.label]);
  const state = useMemo(() => ({ checked: selected, disabled }), [selected, disabled]);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={state}
      disabled={disabled}
      onPress={press}
      style={styles.button}
    >
      <Text style={styles.text}>
        {selected ? "✓ " : "○ "}
        {option.label}
      </Text>
      {option.description && <Text style={styles.muted}>{option.description}</Text>}
    </Pressable>
  );
}

function QuestionField({
  question,
  disabled,
  onAnswer,
  styles,
}: {
  question: Question;
  disabled: boolean;
  onAnswer: (header: string, value: string) => void;
  styles: Styles;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState("");
  const choose = useCallback(
    (label: string) => {
      let next = [label];
      if (question.multiSelect)
        next = selected.includes(label)
          ? selected.filter((v) => v !== label)
          : [...selected, label];
      setSelected(next);
      if (!question.multiSelect) setText("");
      onAnswer(
        question.header,
        question.multiSelect ? [...next, text.trim()].filter(Boolean).join(", ") : label,
      );
    },
    [selected, text, question, onAnswer],
  );
  const change = useCallback(
    (value: string) => {
      setText(value);
      if (!question.multiSelect && value.trim()) setSelected([]);
      const answer = question.multiSelect
        ? [...selected, value.trim()].filter(Boolean).join(", ")
        : value.trim() || selected.join(", ");
      onAnswer(question.header, answer);
    },
    [question, selected, onAnswer],
  );
  return (
    <View style={styles.stack}>
      <Text style={styles.text}>{question.question}</Text>
      {question.options.map((option) => (
        <Option
          key={option.label}
          option={option}
          selected={selected.includes(option.label)}
          disabled={disabled}
          onSelect={choose}
          styles={styles}
        />
      ))}
      {(question.allowOther || question.options.length === 0) && (
        <TextInput
          accessibilityLabel={question.question}
          placeholder={question.allowEmpty ? "回答（可留空）" : "输入回答"}
          value={text}
          onChangeText={change}
          editable={!disabled}
          multiline
          style={styles.input}
        />
      )}
    </View>
  );
}

function RequestCard({
  request,
  agentId,
  theme,
  compact,
}: {
  request: AgentPermissionRequest;
  agentId: string;
  theme: PluginTheme;
  compact: boolean;
}) {
  const paseo = usePaseo();
  const styles = useStyles(theme, compact);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const responseLock = useRef(false);
  const questions = useMemo(
    () => (request.kind === "question" ? parseQuestions(request.input) : null),
    [request],
  );
  const response = questions ? questionResponse(request, questions, answers) : null;
  const respond = useCallback(
    async (value: AgentPermissionResponse) => {
      if (responseLock.current) return;
      responseLock.current = true;
      setPending(true);
      setError(null);
      try {
        await paseo.agents
          .ref(agentId)
          .respondToPermission({ requestId: request.id, response: value });
        setSubmitted(true);
      } catch (cause) {
        responseLock.current = false;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setPending(false);
      }
    },
    [paseo, agentId, request.id],
  );
  const act = useCallback(
    (action: AgentPermissionAction) => {
      void respond(
        action.behavior === "allow"
          ? { behavior: "allow", selectedActionId: action.id }
          : { behavior: "deny", selectedActionId: action.id, message: "Denied by user" },
      );
    },
    [respond],
  );
  const answer = useCallback(
    (header: string, value: string) => setAnswers((current) => ({ ...current, [header]: value })),
    [],
  );
  const submit = useCallback(() => {
    if (response) void respond(response);
  }, [response, respond]);
  const deny = useCallback(() => {
    void respond({ behavior: "deny", message: "Dismissed by user" });
  }, [respond]);
  const actions = request.actions?.length ? request.actions : DEFAULT_ACTIONS;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{request.title ?? request.name}</Text>
      <Text style={styles.muted}>
        {request.kind === "question" ? "Agent 需要你的回答" : "Agent 等待你的决定 · 仅处理当前请求"}
      </Text>
      {request.description && (
        <Text selectable style={styles.text}>
          {request.description}
        </Text>
      )}
      {questions ? (
        <View style={styles.stack}>
          {questions.map((question) => (
            <QuestionField
              key={question.header}
              question={question}
              disabled={pending || submitted}
              onAnswer={answer}
              styles={styles}
            />
          ))}
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              disabled={pending || submitted || !response}
              onPress={submit}
              style={styles.button}
            >
              <Text style={styles.text}>提交回答</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={pending || submitted}
              onPress={deny}
              style={styles.button}
            >
              <Text style={styles.text}>取消回答</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.stack}>
          <Text selectable style={styles.detail}>
            {JSON.stringify(request.detail ?? request.input ?? {}, null, 2)}
          </Text>
          {request.kind === "question" ? (
            <Text style={styles.error}>此问题格式暂未支持，请回原生对话回答。</Text>
          ) : (
            <View style={styles.row}>
              {actions.map((action) => (
                <ActionButton
                  key={action.id}
                  action={action}
                  disabled={pending || submitted}
                  onAction={act}
                  styles={styles}
                />
              ))}
            </View>
          )}
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      {(pending || submitted) && (
        <Text style={styles.muted}>{pending ? "正在提交…" : "已提交，等待 Agent 继续…"}</Text>
      )}
    </View>
  );
}

export function Attention({
  agentId,
  theme,
  compact,
}: {
  agentId: string;
  theme: PluginTheme;
  compact: boolean;
}) {
  const paseo = usePaseo();
  const styles = useStyles(theme, compact);
  const [requests, setRequests] = useState<AgentPermissionRequest[]>([]);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const agent = paseo.agents.ref(agentId);
    const update = () => {
      if (alive) {
        setRequests(agent.pendingPermissions ?? []);
        setError(null);
      }
    };
    const remove = agent.subscribe(update);
    void agent
      .refresh()
      .then(update)
      .catch((cause) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      alive = false;
      remove();
    };
  }, [paseo, agentId, revision]);
  if (!requests.length && !error) return null;
  return (
    <View style={styles.stack}>
      {error && (
        <View style={styles.stack}>
          <Text style={styles.error}>待处理请求加载失败：{error}</Text>
          <Pressable accessibilityRole="button" onPress={retry} style={styles.button}>
            <Text style={styles.text}>重试加载</Text>
          </Pressable>
        </View>
      )}
      {requests.map((request) => (
        <RequestCard
          key={request.id}
          request={request}
          agentId={agentId}
          theme={theme}
          compact={compact}
        />
      ))}
    </View>
  );
}
