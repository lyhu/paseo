/* oxlint-disable react-perf/jsx-no-jsx-as-prop -- SettingsSection owns the header action slot. */
import { useCallback, useState, useSyncExternalStore, type ReactNode } from "react";
import { Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { StyleSheet } from "react-native-unistyles";
import type {
  RouteOffer,
  TunnelEgressState,
  TunnelIngressState,
} from "@getpaseo/protocol/tunnel-messages";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useTunnelEntryFormModel } from "@/tunnel/use-tunnel-entry-form-model";
import type {
  TunnelAccessMode,
  TunnelEntryFormModel,
  TunnelEntryFormSnapshot,
  TunnelEntryFormState,
} from "@/tunnel/tunnel-entry-form-model";
import { useTunnelState } from "@/tunnel/tunnel-state";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";

type EditorSnapshot = TunnelEntryFormSnapshot;

const ACCESS_MODE_OPTIONS: Array<{ value: TunnelAccessMode; label: string }> = [
  { value: "header", label: "Header" },
  { value: "bearer", label: "Bearer" },
  { value: "none", label: "None" },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statusVariant(
  status: "disabled" | "ready" | "error" | "starting" | "listening" | "inactive" | "connecting",
) {
  if (status === "ready" || status === "listening") return "success" as const;
  if (status === "error") return "error" as const;
  return "muted" as const;
}

function requireRouteOffer(offer: RouteOffer | null): RouteOffer {
  if (!offer) throw new Error("Route Offer is invalid");
  return offer;
}

function rotateTokenMutation(input: {
  id: string;
  access: { mode: "bearer" | "header" | "none"; token?: string };
}) {
  return {
    operation: "rotateEgressToken" as const,
    id: input.id,
    mode: input.access.mode,
    ...(input.access.token ? { token: input.access.token } : {}),
  };
}

function AccessFields({
  state,
  model,
  pending,
}: {
  state: TunnelEntryFormState;
  model: TunnelEntryFormModel;
  pending: boolean;
}) {
  return (
    <>
      <Field label="Access mode">
        <SegmentedControl
          value={state.accessMode}
          onValueChange={model.setAccessMode}
          options={ACCESS_MODE_OPTIONS}
          size="sm"
        />
      </Field>
      {state.accessMode !== "none" ? (
        <Field label="Access token">
          <FormTextInput
            initialValue={state.accessToken}
            onChangeText={model.setAccessToken}
            editable={!pending}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Access token"
          />
        </Field>
      ) : null}
    </>
  );
}

function EgressFields({
  state,
  model,
  pending,
}: {
  state: TunnelEntryFormState;
  model: TunnelEntryFormModel;
  pending: boolean;
}) {
  return (
    <>
      <Field label="Route Offer">
        <FormTextInput
          initialValue={state.routeOfferText}
          onChangeText={model.setRouteOfferText}
          editable={!pending}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Route Offer"
        />
      </Field>
      <Field label="Listener host">
        <FormTextInput
          initialValue={state.listenHost}
          onChangeText={model.setListenHost}
          editable={!pending}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Listener host"
        />
      </Field>
      <Field label="Listener port">
        <FormTextInput
          initialValue={state.listenPort}
          onChangeText={model.setListenPort}
          editable={!pending}
          keyboardType="number-pad"
          accessibilityLabel="Listener port"
        />
      </Field>
      {state.mode === "create" ? (
        <AccessFields state={state} model={model} pending={pending} />
      ) : null}
    </>
  );
}

function TunnelEntryEditor({
  snapshot,
  pending,
  onCancel,
  onSubmit,
}: {
  snapshot: EditorSnapshot;
  pending: boolean;
  onCancel(): void;
  onSubmit(input: {
    name: string;
    targetOrigin: string;
    listen: { host: string; port: number };
    offer: RouteOffer | null;
    access: { mode: "bearer" | "header" | "none"; token?: string };
  }): Promise<void>;
}) {
  const model = useTunnelEntryFormModel(snapshot);
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const submit = useCallback(async () => {
    const offer = model.getRouteOffer();
    try {
      await onSubmit({
        name: state.name.trim(),
        targetOrigin: state.targetOrigin.trim(),
        listen: { host: state.listenHost.trim(), port: Number(state.listenPort) },
        offer,
        access: {
          mode: state.accessMode,
          ...(state.accessToken.trim() ? { token: state.accessToken.trim() } : {}),
        },
      });
    } catch (error) {
      model.setSubmitError(errorMessage(error));
    }
  }, [
    model,
    onSubmit,
    state.accessMode,
    state.accessToken,
    state.listenHost,
    state.listenPort,
    state.name,
    state.targetOrigin,
  ]);

  let fields: ReactNode;
  if (state.kind === "ingress") {
    fields = (
      <Field label="Target origin" hint="http:// or https:// origin without a path">
        <FormTextInput
          initialValue={state.targetOrigin}
          onChangeText={model.setTargetOrigin}
          editable={!pending}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Target origin"
        />
      </Field>
    );
  } else if (state.kind === "offer") {
    fields = (
      <Field label="Route Offer">
        <FormTextInput
          initialValue={state.routeOfferText}
          onChangeText={model.setRouteOfferText}
          editable={!pending}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Route Offer"
        />
      </Field>
    );
  } else if (state.kind === "token") {
    fields = <AccessFields state={state} model={model} pending={pending} />;
  } else {
    fields = <EgressFields state={state} model={model} pending={pending} />;
  }

  return (
    <View style={[settingsStyles.card, styles.editor]}>
      <Field label="Name">
        <FormTextInput
          initialValue={state.name}
          onChangeText={model.setName}
          editable={!pending}
          accessibilityLabel="Tunnel name"
        />
      </Field>
      {fields}
      {state.submitError ? <Alert variant="error" title={state.submitError} /> : null}
      <View style={styles.actions}>
        <Button variant="outline" size="sm" onPress={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button size="sm" onPress={submit} disabled={!state.canSubmit || pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </View>
    </View>
  );
}

function IngressRow({
  entry,
  pending,
  onToggle,
  onEdit,
  onExport,
  onRotateSecret,
  onDelete,
}: {
  entry: TunnelIngressState;
  pending: boolean;
  onToggle(entry: TunnelIngressState): void;
  onEdit(entry: TunnelIngressState): void;
  onExport(entry: TunnelIngressState): void;
  onRotateSecret(entry: TunnelIngressState): void;
  onDelete(entry: TunnelIngressState): void;
}) {
  const toggle = useCallback(() => onToggle(entry), [entry, onToggle]);
  const edit = useCallback(() => onEdit(entry), [entry, onEdit]);
  const exportOffer = useCallback(() => onExport(entry), [entry, onExport]);
  const rotateSecret = useCallback(() => onRotateSecret(entry), [entry, onRotateSecret]);
  const remove = useCallback(() => onDelete(entry), [entry, onDelete]);

  return (
    <View style={styles.row}>
      <View style={settingsStyles.rowContent}>
        <View style={styles.title}>
          <Text style={settingsStyles.rowTitle}>{entry.name}</Text>
          <StatusBadge label={entry.status} variant={statusVariant(entry.status)} />
        </View>
        <Text style={settingsStyles.rowHint}>{entry.targetOrigin}</Text>
      </View>
      <Switch
        value={entry.enabled}
        onValueChange={toggle}
        disabled={pending}
        accessibilityLabel={`Enable ${entry.name}`}
      />
      <View style={styles.actions}>
        <Button variant="outline" size="sm" onPress={edit} disabled={pending}>
          Edit
        </Button>
        <Button variant="outline" size="sm" onPress={exportOffer} disabled={pending}>
          Export offer
        </Button>
        <Button variant="outline" size="sm" onPress={rotateSecret} disabled={pending}>
          Rotate secret
        </Button>
        <Button variant="outline" size="sm" onPress={remove} disabled={pending}>
          Delete
        </Button>
      </View>
    </View>
  );
}

function EgressRow({
  entry,
  pending,
  onToggle,
  onEdit,
  onReplaceOffer,
  onRotateToken,
  onDelete,
}: {
  entry: TunnelEgressState;
  pending: boolean;
  onToggle(entry: TunnelEgressState): void;
  onEdit(entry: TunnelEgressState): void;
  onReplaceOffer(entry: TunnelEgressState): void;
  onRotateToken(entry: TunnelEgressState): void;
  onDelete(entry: TunnelEgressState): void;
}) {
  const toggle = useCallback(() => onToggle(entry), [entry, onToggle]);
  const edit = useCallback(() => onEdit(entry), [entry, onEdit]);
  const replaceOffer = useCallback(() => onReplaceOffer(entry), [entry, onReplaceOffer]);
  const rotateToken = useCallback(() => onRotateToken(entry), [entry, onRotateToken]);
  const remove = useCallback(() => onDelete(entry), [entry, onDelete]);

  return (
    <View style={styles.row}>
      <View style={settingsStyles.rowContent}>
        <View style={styles.title}>
          <Text style={settingsStyles.rowTitle}>{entry.name}</Text>
          <StatusBadge label={entry.status} variant={statusVariant(entry.status)} />
        </View>
        <Text
          style={settingsStyles.rowHint}
        >{`${entry.listen.host}:${entry.listen.port} → ${entry.ingressName}`}</Text>
      </View>
      <Switch
        value={entry.enabled}
        onValueChange={toggle}
        disabled={pending}
        accessibilityLabel={`Enable ${entry.name}`}
      />
      <View style={styles.actions}>
        <Button variant="outline" size="sm" onPress={edit} disabled={pending}>
          Edit
        </Button>
        <Button variant="outline" size="sm" onPress={replaceOffer} disabled={pending}>
          Replace offer
        </Button>
        <Button variant="outline" size="sm" onPress={rotateToken} disabled={pending}>
          Rotate token
        </Button>
        <Button variant="outline" size="sm" onPress={remove} disabled={pending}>
          Delete
        </Button>
      </View>
    </View>
  );
}

export function TunnelPage({ serverId }: { serverId: string }) {
  const connected = useHostRuntimeIsConnected(serverId);
  const supported = useHostFeature(serverId, "httpTunnel");
  const { state, mutate, exportOffer } = useTunnelState(serverId, supported);
  const [editor, setEditor] = useState<EditorSnapshot | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(
    null,
  );
  const [copyValue, setCopyValue] = useState<{ label: string; value: string } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const pending = mutate.isPending || isExporting;

  const runMutation = useCallback(
    async (mutation: Parameters<typeof mutate.mutateAsync>[0]): Promise<boolean> => {
      setFeedback(null);
      try {
        const result = await mutate.mutateAsync(mutation);
        setFeedback({
          kind: "success",
          message: result.oneTimeToken ? "Access token created" : "Saved",
        });
        if (result.oneTimeToken) {
          setCopyValue({ label: "Access token", value: result.oneTimeToken });
        }
        return true;
      } catch (error) {
        setFeedback({ kind: "error", message: errorMessage(error) });
        return false;
      }
    },
    [mutate],
  );
  const submitEditor = useCallback(
    async (input: {
      name: string;
      targetOrigin: string;
      listen: { host: string; port: number };
      offer: RouteOffer | null;
      access: { mode: "bearer" | "header" | "none"; token?: string };
    }) => {
      if (!editor) return;
      if (editor.kind === "ingress") {
        const saved = await runMutation(
          editor.mode === "create"
            ? { operation: "createIngress", name: input.name, targetOrigin: input.targetOrigin }
            : {
                operation: "updateIngress",
                id: editor.entry?.id ?? "",
                name: input.name,
                targetOrigin: input.targetOrigin,
              },
        );
        if (!saved) throw new Error("Request failed; retry.");
      } else if (editor.kind === "egress") {
        if (editor.mode === "create") {
          const saved = await runMutation({
            operation: "createEgress",
            name: input.name,
            listen: input.listen,
            offer: requireRouteOffer(input.offer),
            access: input.access,
          });
          if (!saved) throw new Error("Request failed; retry.");
        } else {
          const saved = await runMutation({
            operation: "updateEgress",
            id: editor.entry?.id ?? "",
            name: input.name,
            listen: input.listen,
          });
          if (!saved) throw new Error("Request failed; retry.");
        }
      } else if (editor.kind === "offer") {
        const saved = await runMutation({
          operation: "replaceEgressOffer",
          id: editor.entry?.id ?? "",
          offer: requireRouteOffer(input.offer),
        });
        if (!saved) throw new Error("Request failed; retry.");
      } else {
        const saved = await runMutation(
          rotateTokenMutation({ id: editor.entry?.id ?? "", access: input.access }),
        );
        if (!saved) throw new Error("Request failed; retry.");
      }
      setEditor(null);
    },
    [editor, runMutation],
  );
  const deleteIngress = useCallback(
    async (entry: TunnelIngressState) => {
      if (
        await confirmDialog({
          title: `Delete ${entry.name}?`,
          message: "Existing egresses will stop forwarding requests.",
          confirmLabel: "Delete",
          destructive: true,
        })
      ) {
        await runMutation({ operation: "deleteIngress", id: entry.id });
      }
    },
    [runMutation],
  );
  const deleteEgress = useCallback(
    async (entry: TunnelEgressState) => {
      if (
        await confirmDialog({
          title: `Delete ${entry.name}?`,
          message: "The listener will be removed.",
          confirmLabel: "Delete",
          destructive: true,
        })
      ) {
        await runMutation({ operation: "deleteEgress", id: entry.id });
      }
    },
    [runMutation],
  );
  const getOffer = useCallback(
    async (entry: TunnelIngressState) => {
      setIsExporting(true);
      try {
        const result = await exportOffer(entry.id);
        setCopyValue({ label: "Route Offer", value: JSON.stringify(result.offer) });
        setFeedback({ kind: "success", message: "Route Offer exported" });
      } catch (error) {
        setFeedback({ kind: "error", message: errorMessage(error) });
      } finally {
        setIsExporting(false);
      }
    },
    [exportOffer],
  );
  const openCreateIngress = useCallback(() => setEditor({ kind: "ingress", mode: "create" }), []);
  const openCreateEgress = useCallback(() => setEditor({ kind: "egress", mode: "create" }), []);
  const closeEditor = useCallback(() => setEditor(null), []);
  const toggleIngress = useCallback(
    (entry: TunnelIngressState) => {
      void runMutation({ operation: "updateIngress", id: entry.id, enabled: !entry.enabled });
    },
    [runMutation],
  );
  const editIngress = useCallback(
    (entry: TunnelIngressState) => setEditor({ kind: "ingress", mode: "edit", entry }),
    [],
  );
  const exportIngressOffer = useCallback(
    (entry: TunnelIngressState) => void getOffer(entry),
    [getOffer],
  );
  const rotateIngressSecret = useCallback(
    async (entry: TunnelIngressState) => {
      if (
        await confirmDialog({
          title: `Rotate secret for ${entry.name}?`,
          message: "Existing Route Offers will stop working.",
          confirmLabel: "Rotate secret",
          destructive: true,
        })
      ) {
        await runMutation({ operation: "rotateIngressSecret", id: entry.id });
      }
    },
    [runMutation],
  );
  const removeIngress = useCallback(
    (entry: TunnelIngressState) => void deleteIngress(entry),
    [deleteIngress],
  );
  const toggleEgress = useCallback(
    (entry: TunnelEgressState) => {
      void runMutation({ operation: "updateEgress", id: entry.id, enabled: !entry.enabled });
    },
    [runMutation],
  );
  const editEgress = useCallback(
    (entry: TunnelEgressState) => setEditor({ kind: "egress", mode: "edit", entry }),
    [],
  );
  const removeEgress = useCallback(
    (entry: TunnelEgressState) => void deleteEgress(entry),
    [deleteEgress],
  );
  const replaceEgressOffer = useCallback(
    (entry: TunnelEgressState) => setEditor({ kind: "offer", mode: "edit", entry }),
    [],
  );
  const rotateEgressToken = useCallback(
    (entry: TunnelEgressState) => setEditor({ kind: "token", mode: "edit", entry }),
    [],
  );
  const copy = useCallback(async () => {
    if (!copyValue) return;
    try {
      await Clipboard.setStringAsync(copyValue.value);
      setFeedback({ kind: "success", message: `${copyValue.label} copied` });
    } catch (error) {
      setFeedback({ kind: "error", message: errorMessage(error) });
    }
  }, [copyValue]);

  if (!connected) return <Alert variant="warning" title="Tunnel host is offline" />;
  if (!supported) return <Alert variant="warning" title="Update this Host to use Tunnel" />;
  if (state.isLoading) return <Alert title="Loading Tunnel…" />;
  if (state.isError)
    return (
      <Alert
        variant="error"
        title="Tunnel could not load"
        description={errorMessage(state.error)}
      />
    );
  if (!state.data) return null;

  return (
    <View>
      <SettingsSection title="Tunnel">
        {feedback ? <Alert variant={feedback.kind} title={feedback.message} /> : null}
        {copyValue ? (
          <Alert title={`${copyValue.label} ready`} description={copyValue.value}>
            <Button size="sm" onPress={copy}>
              Copy
            </Button>
          </Alert>
        ) : null}
        <View style={settingsStyles.card}>
          <View style={styles.row}>
            <Text style={settingsStyles.rowTitle}>Relay</Text>
            <StatusBadge
              label={state.data.relayStatus}
              variant={statusVariant(state.data.relayStatus)}
            />
          </View>
        </View>
      </SettingsSection>
      <SettingsSection
        title="Ingress"
        trailing={
          <Button size="sm" onPress={openCreateIngress} disabled={pending}>
            Add ingress
          </Button>
        }
      >
        <View style={settingsStyles.card}>
          {state.data.ingresses.map((entry: TunnelIngressState) => (
            <IngressRow
              key={entry.id}
              entry={entry}
              pending={pending}
              onToggle={toggleIngress}
              onEdit={editIngress}
              onExport={exportIngressOffer}
              onRotateSecret={rotateIngressSecret}
              onDelete={removeIngress}
            />
          ))}
          {!state.data.ingresses.length ? (
            <Text style={settingsStyles.rowHint}>No ingress configured</Text>
          ) : null}
        </View>
      </SettingsSection>
      <SettingsSection
        title="Egress"
        trailing={
          <Button size="sm" onPress={openCreateEgress} disabled={pending}>
            Add egress
          </Button>
        }
      >
        <View style={settingsStyles.card}>
          {state.data.egresses.map((entry: TunnelEgressState) => (
            <EgressRow
              key={entry.id}
              entry={entry}
              pending={pending}
              onToggle={toggleEgress}
              onEdit={editEgress}
              onReplaceOffer={replaceEgressOffer}
              onRotateToken={rotateEgressToken}
              onDelete={removeEgress}
            />
          ))}
          {!state.data.egresses.length ? (
            <Text style={settingsStyles.rowHint}>No egress configured</Text>
          ) : null}
        </View>
      </SettingsSection>
      {editor ? (
        <TunnelEntryEditor
          key={`${editor.kind}:${editor.mode}:${editor.entry?.id ?? "new"}`}
          snapshot={editor}
          pending={pending}
          onCancel={closeEditor}
          onSubmit={submitEditor}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  editor: { padding: theme.spacing[4], gap: theme.spacing[3] },
  row: { padding: theme.spacing[4], gap: theme.spacing[2] },
  title: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
}));
