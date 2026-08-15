// PROTOTYPE — throwaway UI for the selected Tunnel settings layout on the existing
// /settings/hosts/[serverId]/tunnel route. Variant A was selected for implementation.
/* oxlint-disable complexity, react-perf/jsx-no-new-function-as-prop, react-perf/jsx-no-jsx-as-prop */
import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { isWeb } from "@/constants/platform";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";

type AccessMode = "header" | "bearer" | "none";
type ListenScope = "local" | "all";
type TokenSource = "generated" | "custom" | "none";

interface Ingress {
  id: string;
  name: string;
  targetOrigin: string;
  enabled: boolean;
}

interface Egress {
  id: string;
  name: string;
  sourceHostName: string;
  sourceIngressName: string;
  listenScope: ListenScope;
  port: number;
  accessMode: AccessMode;
  tokenSource: TokenSource;
  enabled: boolean;
  runtime: "listening" | "error" | "disabled";
}

interface Draft {
  name: string;
  target: string;
  routeOffer: string;
  sourceHostName: string;
  sourceIngressName: string;
  listenScope: ListenScope;
  port: string;
  accessMode: AccessMode;
  tokenSource: TokenSource;
  customToken: string;
}

interface TokenResult {
  name: string;
  token: string;
}

interface VariantProps {
  ingresses: Ingress[];
  egresses: Egress[];
  editing: "ingress" | "egress" | "import-egress" | null;
  editingId: string | null;
  tokenResult: TokenResult | null;
  rotatingEgressId: string | null;
  onToggleIngress: (id: string) => void;
  onToggleEgress: (id: string) => void;
  onAddIngress: () => void;
  onAddEgress: () => void;
  onImportEgress: () => void;
  onEditIngress: (id: string) => void;
  onEditEgress: (id: string) => void;
  onDeleteIngress: (id: string) => void;
  onDeleteEgress: (id: string) => void;
  onRotateToken: (id: string) => void;
  onCancelRotation: () => void;
  onSaveRotation: (source: Exclude<TokenSource, "none">, customToken: string) => void;
  onCloseEditor: () => void;
  onSaveDraft: (draft: Draft) => void;
}

const INITIAL_INGRESSES: Ingress[] = [
  {
    id: "ing-api",
    name: "Local API",
    targetOrigin: "http://127.0.0.1:11434",
    enabled: true,
  },
  {
    id: "ing-preview",
    name: "Preview server",
    targetOrigin: "http://127.0.0.1:3000",
    enabled: false,
  },
];

const INITIAL_EGRESSES: Egress[] = [
  {
    id: "eg-api",
    name: "API on cloud host",
    sourceHostName: "Office Mac",
    sourceIngressName: "Local API",
    listenScope: "local",
    port: 8080,
    accessMode: "header",
    tokenSource: "generated",
    enabled: true,
    runtime: "listening",
  },
];

const REMOTE_INGRESS_HOSTS = [
  {
    id: "office-mac",
    name: "Office Mac",
    ingresses: [
      {
        id: "office-api",
        name: "Local API",
        targetOrigin: "http://127.0.0.1:11434",
        enabled: true,
      },
      {
        id: "office-preview",
        name: "Preview server",
        targetOrigin: "http://127.0.0.1:3000",
        enabled: true,
      },
    ],
  },
];

export function TunnelPrototypePage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const [ingresses, setIngresses] = useState(INITIAL_INGRESSES);
  const [egresses, setEgresses] = useState(INITIAL_EGRESSES);
  const [tokenResult, setTokenResult] = useState<TokenResult | null>(null);
  const [editing, setEditing] = useState<"ingress" | "egress" | "import-egress" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rotatingEgressId, setRotatingEgressId] = useState<string | null>(null);

  const toggleIngress = useCallback((id: string) => {
    setIngresses((items) =>
      items.map((item) => (item.id === id ? { ...item, enabled: !item.enabled } : item)),
    );
  }, []);

  const toggleEgress = useCallback((id: string) => {
    setEgresses((items) =>
      items.map((item) =>
        item.id === id
          ? {
              ...item,
              enabled: !item.enabled,
              runtime: item.enabled ? "disabled" : "listening",
            }
          : item,
      ),
    );
  }, []);

  const saveDraft = useCallback(
    (draft: Draft) => {
      if (editing === "ingress") {
        setIngresses((items) => {
          if (editingId) {
            return items.map((item) =>
              item.id === editingId
                ? {
                    ...item,
                    name: draft.name || item.name,
                    targetOrigin: draft.target || item.targetOrigin,
                  }
                : item,
            );
          }
          return [
            ...items,
            {
              id: `ing-${items.length + 1}`,
              name: draft.name || "New ingress",
              targetOrigin: draft.target || "http://127.0.0.1:3000",
              enabled: true,
            },
          ];
        });
      } else {
        const previousEgress = egresses.find((item) => item.id === editingId);
        const egressName = draft.name || previousEgress?.name || "New egress";
        setEgresses((items) => {
          if (editingId) {
            return items.map((item) =>
              item.id === editingId
                ? {
                    ...item,
                    name: draft.name || item.name,
                    sourceHostName: draft.sourceHostName,
                    sourceIngressName: draft.sourceIngressName,
                    listenScope: draft.listenScope,
                    port: Number(draft.port) || item.port,
                    accessMode: draft.accessMode,
                    tokenSource: draft.tokenSource,
                  }
                : item,
            );
          }
          return [
            ...items,
            {
              id: `eg-${items.length + 1}`,
              name: egressName,
              sourceHostName: draft.sourceHostName,
              sourceIngressName: draft.sourceIngressName,
              listenScope: draft.listenScope,
              port: Number(draft.port) || 8080,
              accessMode: draft.accessMode,
              tokenSource: draft.tokenSource,
              enabled: true,
              runtime: "listening",
            },
          ];
        });
        if (
          draft.tokenSource !== "none" &&
          (!previousEgress || previousEgress.tokenSource === "none")
        ) {
          setTokenResult({
            name: egressName,
            token: draft.customToken || generatePrototypeToken(),
          });
        }
      }
      setEditing(null);
      setEditingId(null);
    },
    [editing, editingId, egresses],
  );

  const openEditor = useCallback((kind: "ingress" | "egress" | "import-egress") => {
    setRotatingEgressId(null);
    setEditingId(null);
    setEditing(kind);
  }, []);
  const closeEditor = useCallback(() => {
    setEditing(null);
    setEditingId(null);
  }, []);
  const editIngress = useCallback((id: string) => {
    setEditingId(id);
    setEditing("ingress");
  }, []);
  const editEgress = useCallback((id: string) => {
    setRotatingEgressId(null);
    setEditingId(id);
    setEditing("egress");
  }, []);
  const rotateToken = useCallback((id: string) => {
    setEditing(null);
    setEditingId(null);
    setRotatingEgressId(id);
  }, []);
  const cancelRotation = useCallback(() => setRotatingEgressId(null), []);
  const saveRotation = useCallback(
    (source: Exclude<TokenSource, "none">, customToken: string) => {
      const egress = egresses.find((item) => item.id === rotatingEgressId);
      if (!egress) return;
      setEgresses((items) =>
        items.map((item) => (item.id === egress.id ? { ...item, tokenSource: source } : item)),
      );
      setTokenResult({
        name: egress.name,
        token: customToken || generatePrototypeToken(),
      });
      setRotatingEgressId(null);
    },
    [egresses, rotatingEgressId],
  );
  const deleteIngress = useCallback(
    async (id: string) => {
      const ingress = ingresses.find((item) => item.id === id);
      if (!ingress) return;
      const confirmed = await confirmDialog({
        title: t("settings.tunnel.delete.ingressTitle", { name: ingress.name }),
        message: t("settings.tunnel.delete.ingressMessage"),
        confirmLabel: t("settings.tunnel.actions.delete"),
        cancelLabel: t("settings.tunnel.actions.cancel"),
        destructive: true,
      });
      if (!confirmed) return;
      setIngresses((items) => removeItemById(items, id));
      if (editingId === id) closeEditor();
    },
    [closeEditor, editingId, ingresses, t],
  );
  const deleteEgress = useCallback(
    async (id: string) => {
      const egress = egresses.find((item) => item.id === id);
      if (!egress) return;
      const confirmed = await confirmDialog({
        title: t("settings.tunnel.delete.egressTitle", { name: egress.name }),
        message: t("settings.tunnel.delete.egressMessage"),
        confirmLabel: t("settings.tunnel.actions.delete"),
        cancelLabel: t("settings.tunnel.actions.cancel"),
        destructive: true,
      });
      if (!confirmed) return;
      setEgresses((items) => removeItemById(items, id));
      if (editingId === id) closeEditor();
      if (rotatingEgressId === id) setRotatingEgressId(null);
    },
    [closeEditor, editingId, egresses, rotatingEgressId, t],
  );

  const props: VariantProps = {
    ingresses,
    egresses,
    editing,
    editingId,
    tokenResult,
    rotatingEgressId,
    onToggleIngress: toggleIngress,
    onToggleEgress: toggleEgress,
    onAddIngress: () => openEditor("ingress"),
    onAddEgress: () => openEditor("egress"),
    onImportEgress: () => openEditor("import-egress"),
    onEditIngress: editIngress,
    onEditEgress: editEgress,
    onDeleteIngress: deleteIngress,
    onDeleteEgress: deleteEgress,
    onRotateToken: rotateToken,
    onCancelRotation: cancelRotation,
    onSaveRotation: saveRotation,
    onCloseEditor: closeEditor,
    onSaveDraft: saveDraft,
  };

  return (
    <View style={styles.page}>
      <View style={styles.prototypeBanner}>
        <Text style={styles.prototypeLabel}>{t("settings.tunnel.prototype")}</Text>
        <Text style={styles.prototypeCopy}>
          {t("settings.tunnel.configurationFor", { serverId })}
        </Text>
      </View>
      <VariantA {...props} />
      <StatePanel ingresses={ingresses} egresses={egresses} />
    </View>
  );
}

function VariantA(props: VariantProps) {
  const { t } = useTranslation();
  return (
    <>
      <PageIntro
        title={t("settings.tunnel.introA.title")}
        description={t("settings.tunnel.introA.description")}
      />
      <SettingsSection
        title={t("settings.tunnel.ingress")}
        trailing={
          <SectionActions
            status={t("settings.tunnel.relayReady")}
            label={t("settings.tunnel.actions.addIngress")}
            onPress={props.onAddIngress}
          />
        }
      >
        <View style={settingsStyles.card}>
          {props.ingresses.map((item, index) => (
            <SettingsIngressRow
              key={item.id}
              item={item}
              bordered={index > 0}
              onToggle={() => props.onToggleIngress(item.id)}
              onEdit={() => props.onEditIngress(item.id)}
              onDelete={() => props.onDeleteIngress(item.id)}
            />
          ))}
        </View>
        {props.editing === "ingress" ? (
          <DraftForm
            key={props.editingId ?? "new-ingress"}
            kind="ingress"
            initialIngress={props.ingresses.find((item) => item.id === props.editingId)}
            onCancel={props.onCloseEditor}
            onSave={props.onSaveDraft}
          />
        ) : null}
      </SettingsSection>
      <SettingsSection
        title={t("settings.tunnel.egress")}
        trailing={
          <EgressSectionActions onAdd={props.onAddEgress} onImport={props.onImportEgress} />
        }
      >
        <View style={settingsStyles.card}>
          {props.egresses.map((item, index) => (
            <SettingsEgressRow
              key={item.id}
              item={item}
              bordered={index > 0}
              onToggle={() => props.onToggleEgress(item.id)}
              onRotateToken={() => props.onRotateToken(item.id)}
              onEdit={() => props.onEditEgress(item.id)}
              onDelete={() => props.onDeleteEgress(item.id)}
            />
          ))}
        </View>
        {props.editing === "egress" || props.editing === "import-egress" ? (
          <DraftForm
            key={props.editingId ?? props.editing}
            kind="egress"
            importOffer={props.editing === "import-egress"}
            localIngresses={props.ingresses}
            initialEgress={props.egresses.find((item) => item.id === props.editingId)}
            onCancel={props.onCloseEditor}
            onSave={props.onSaveDraft}
          />
        ) : null}
        {props.rotatingEgressId ? (
          <RotateTokenForm
            key={props.rotatingEgressId}
            egress={props.egresses.find((item) => item.id === props.rotatingEgressId)}
            onCancel={props.onCancelRotation}
            onSave={props.onSaveRotation}
          />
        ) : null}
        <ResultNotice result={props.tokenResult} />
      </SettingsSection>
    </>
  );
}

function SettingsIngressRow({
  item,
  bordered,
  onToggle,
  onEdit,
  onDelete,
}: {
  item: Ingress;
  bordered: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={[styles.entryRow, bordered && settingsStyles.rowBorder]}>
      <View style={styles.entryMain}>
        <View style={styles.titleWithBadge}>
          <Text style={settingsStyles.rowTitle}>{item.name}</Text>
          <StatusBadge
            label={item.enabled ? t("settings.tunnel.enabled") : t("settings.tunnel.disabled")}
            variant={item.enabled ? "success" : "muted"}
          />
        </View>
        <Metadata label={t("settings.tunnel.labels.targetOrigin")} value={item.targetOrigin} mono />
        <View style={styles.entryActions}>
          <Button size="xs" variant="ghost" leftIcon={Copy}>
            {t("settings.tunnel.actions.copyOffer")}
          </Button>
          <Button size="xs" variant="ghost" onPress={onEdit}>
            {t("settings.tunnel.actions.edit")}
          </Button>
          <Button size="xs" variant="ghost" leftIcon={Trash2} onPress={onDelete}>
            {t("settings.tunnel.actions.delete")}
          </Button>
        </View>
      </View>
      <Switch value={item.enabled} onValueChange={onToggle} />
    </View>
  );
}

function SettingsEgressRow({
  item,
  bordered,
  onToggle,
  onRotateToken,
  onEdit,
  onDelete,
}: {
  item: Egress;
  bordered: boolean;
  onToggle: () => void;
  onRotateToken: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={[styles.entryRow, bordered && settingsStyles.rowBorder]}>
      <View style={styles.entryMain}>
        <View style={styles.titleWithBadge}>
          <Text style={settingsStyles.rowTitle}>{item.name}</Text>
          <StatusBadge
            label={runtimeLabel(item.runtime, t)}
            variant={item.runtime === "listening" ? "success" : "muted"}
          />
        </View>
        <View style={styles.metadataGrid}>
          <Metadata label={t("settings.tunnel.labels.sourceHost")} value={item.sourceHostName} />
          <Metadata
            label={t("settings.tunnel.labels.sourceIngress")}
            value={item.sourceIngressName}
          />
          <Metadata
            label={t("settings.tunnel.labels.listener")}
            value={listenerAddress(item)}
            mono
          />
          <Metadata
            label={t("settings.tunnel.labels.authentication")}
            value={accessLabel(item.accessMode, t)}
          />
        </View>
        <View style={styles.entryActions}>
          {item.accessMode === "none" ? null : (
            <Button size="xs" variant="ghost" leftIcon={KeyRound} onPress={onRotateToken}>
              {t("settings.tunnel.actions.rotateToken")}
            </Button>
          )}
          <Button size="xs" variant="ghost" onPress={onEdit}>
            {t("settings.tunnel.actions.edit")}
          </Button>
          <Button size="xs" variant="ghost" leftIcon={Trash2} onPress={onDelete}>
            {t("settings.tunnel.actions.delete")}
          </Button>
        </View>
      </View>
      <Switch value={item.enabled} onValueChange={onToggle} />
    </View>
  );
}

function Metadata({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.metadata}>
      <Text style={styles.metadataLabel}>{label}</Text>
      <Text style={mono ? styles.metadataMonoValue : styles.metadataValue}>{value}</Text>
    </View>
  );
}

function DraftForm({
  kind,
  importOffer = false,
  localIngresses = [],
  initialIngress,
  initialEgress,
  onCancel,
  onSave,
}: {
  kind: "ingress" | "egress";
  importOffer?: boolean;
  localIngresses?: Ingress[];
  initialIngress?: Ingress;
  initialEgress?: Egress;
  onCancel: () => void;
  onSave: (draft: Draft) => void;
}) {
  const { t } = useTranslation();
  const sourceHosts = [
    ...REMOTE_INGRESS_HOSTS,
    {
      id: "current",
      name: t("settings.tunnel.form.thisHost"),
      ingresses: localIngresses,
    },
  ];
  const seededSourceHost = sourceHosts.find((host) => host.name === initialEgress?.sourceHostName);
  const initialSourceHost = seededSourceHost?.ingresses.length ? seededSourceHost : sourceHosts[0];
  const initialSourceIngress =
    initialSourceHost.ingresses.find(
      (ingress) => ingress.name === initialEgress?.sourceIngressName,
    ) ?? initialSourceHost.ingresses[0];
  const [name, setName] = useState(initialIngress?.name ?? initialEgress?.name ?? "");
  const [target, setTarget] = useState(initialIngress?.targetOrigin ?? "http://127.0.0.1:3000");
  const [routeOffer, setRouteOffer] = useState("");
  const [sourceHostId, setSourceHostId] = useState(initialSourceHost.id);
  const [sourceIngressId, setSourceIngressId] = useState(initialSourceIngress.id);
  const [listenScope, setListenScope] = useState<ListenScope>(
    initialEgress?.listenScope ?? "local",
  );
  const [port, setPort] = useState(
    initialPort(importOffer, initialEgress, initialSourceIngress.targetOrigin),
  );
  const [portResetKey, setPortResetKey] = useState(0);
  const [accessMode, setAccessMode] = useState<AccessMode>(initialEgress?.accessMode ?? "header");
  const hasStoredToken = Boolean(initialEgress && initialEgress.tokenSource !== "none");
  const [tokenSource, setTokenSource] = useState<Exclude<TokenSource, "none">>(
    initialEgress?.tokenSource === "custom" ? "custom" : "generated",
  );
  const [customToken, setCustomToken] = useState("");
  const sourceHost = sourceHosts.find((host) => host.id === sourceHostId) ?? initialSourceHost;
  const sourceIngress =
    sourceHost.ingresses.find((ingress) => ingress.id === sourceIngressId) ??
    sourceHost.ingresses[0];
  let formTitle = t("settings.tunnel.form.addEgress");
  if (kind === "ingress") formTitle = t("settings.tunnel.form.addIngress");
  if (importOffer) formTitle = t("settings.tunnel.form.importEgress");
  if (initialIngress) formTitle = t("settings.tunnel.form.editIngress");
  if (initialEgress) formTitle = t("settings.tunnel.form.editEgress");

  const selectSourceHost = (hostId: string) => {
    const nextHost = sourceHosts.find((host) => host.id === hostId) ?? initialSourceHost;
    const nextIngress = nextHost.ingresses[0];
    setSourceHostId(nextHost.id);
    setSourceIngressId(nextIngress.id);
    setPort(effectivePort(nextIngress.targetOrigin));
    setPortResetKey((key) => key + 1);
  };

  const selectSourceIngress = (ingressId: string) => {
    const nextIngress = sourceHost.ingresses.find((ingress) => ingress.id === ingressId);
    if (!nextIngress) return;
    setSourceIngressId(nextIngress.id);
    setPort(effectivePort(nextIngress.targetOrigin));
    setPortResetKey((key) => key + 1);
  };

  return (
    <View style={styles.formCard}>
      <Text style={styles.formTitle}>{formTitle}</Text>
      <Field label={t("settings.tunnel.form.name")}>
        <FormTextInput
          initialValue={name}
          onChangeText={setName}
          placeholder={
            kind === "ingress"
              ? t("settings.tunnel.form.ingressPlaceholder")
              : t("settings.tunnel.form.egressPlaceholder")
          }
        />
      </Field>
      {kind === "ingress" ? (
        <Field
          label={t("settings.tunnel.labels.targetOrigin")}
          hint={t("settings.tunnel.form.originHint")}
        >
          <FormTextInput initialValue={target} onChangeText={setTarget} />
        </Field>
      ) : null}
      {kind === "egress" ? (
        <>
          {importOffer ? (
            <Field label={t("settings.tunnel.labels.routeOffer")}>
              <FormTextInput
                onChangeText={setRouteOffer}
                placeholder={t("settings.tunnel.form.routeOfferPlaceholder")}
              />
            </Field>
          ) : (
            <>
              <Field label={t("settings.tunnel.labels.sourceHost")}>
                <SegmentedControl
                  size="sm"
                  value={sourceHostId}
                  onValueChange={selectSourceHost}
                  options={sourceHosts.map((host) => ({ value: host.id, label: host.name }))}
                />
              </Field>
              <Field label={t("settings.tunnel.labels.sourceIngress")}>
                <SegmentedControl
                  size="sm"
                  value={sourceIngress.id}
                  onValueChange={selectSourceIngress}
                  options={sourceHost.ingresses.map((ingress) => ({
                    value: ingress.id,
                    label: ingress.name,
                  }))}
                />
              </Field>
              <View style={styles.formSource}>
                <Metadata
                  label={t("settings.tunnel.labels.targetOrigin")}
                  value={sourceIngress.targetOrigin}
                  mono
                />
                <Text style={styles.formSourceValue}>
                  {t("settings.tunnel.form.egressRunsHere")}
                </Text>
              </View>
            </>
          )}
          {importOffer ? (
            <View style={styles.formSource}>
              <Text style={styles.formSourceValue}>
                {t("settings.tunnel.form.offerSourceHint")}
              </Text>
            </View>
          ) : null}
          <Field label={t("settings.tunnel.labels.egressHost")}>
            <View style={styles.currentHostValue}>
              <Text style={styles.currentHostText}>{t("settings.tunnel.form.thisHost")}</Text>
              <Text style={styles.currentHostHint}>
                {t("settings.tunnel.form.egressHostFixed")}
              </Text>
            </View>
          </Field>
          <Field
            label={t("settings.tunnel.labels.listenScope")}
            hint={
              listenScope === "local"
                ? t("settings.tunnel.form.localOnlyHint")
                : t("settings.tunnel.form.allInterfacesHint")
            }
          >
            <SegmentedControl
              size="sm"
              value={listenScope}
              onValueChange={setListenScope}
              options={[
                { value: "local", label: t("settings.tunnel.form.localOnly") },
                { value: "all", label: t("settings.tunnel.form.allInterfaces") },
              ]}
            />
          </Field>
          <Field label={t("settings.tunnel.labels.port")} hint={t("settings.tunnel.form.portHint")}>
            <FormTextInput
              initialValue={port}
              resetKey={portResetKey}
              onChangeText={setPort}
              keyboardType="number-pad"
            />
          </Field>
          <Field
            label={t("settings.tunnel.labels.authentication")}
            hint={t(`settings.tunnel.access.${accessMode}Hint`)}
          >
            <SegmentedControl
              size="sm"
              value={accessMode}
              onValueChange={setAccessMode}
              options={[
                { value: "header", label: t("settings.tunnel.access.headerShort") },
                { value: "bearer", label: t("settings.tunnel.access.bearerShort") },
                { value: "none", label: t("settings.tunnel.access.none") },
              ]}
            />
          </Field>
          {accessMode !== "none" && hasStoredToken ? (
            <View style={styles.formSource}>
              <Metadata
                label={t("settings.tunnel.labels.accessToken")}
                value={t("settings.tunnel.token.configured")}
              />
              <Text style={styles.formSourceValue}>{t("settings.tunnel.token.storedHint")}</Text>
            </View>
          ) : null}
          {accessMode !== "none" && !hasStoredToken ? (
            <>
              <Field
                label={t("settings.tunnel.labels.accessToken")}
                hint={t("settings.tunnel.token.setupHint")}
              >
                <SegmentedControl
                  size="sm"
                  value={tokenSource}
                  onValueChange={setTokenSource}
                  options={[
                    {
                      value: "generated",
                      label: t("settings.tunnel.token.generateAutomatically"),
                    },
                    { value: "custom", label: t("settings.tunnel.token.useCustom") },
                  ]}
                />
              </Field>
              {tokenSource === "custom" ? (
                <Field label={t("settings.tunnel.token.customValue")}>
                  <FormTextInput
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={setCustomToken}
                    placeholder={t("settings.tunnel.token.customPlaceholder")}
                  />
                </Field>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
      {kind === "egress" && listenScope === "all" ? (
        <Text style={styles.warning}>{t("settings.tunnel.form.networkWarning")}</Text>
      ) : null}
      <View style={styles.formActions}>
        <Button variant="ghost" size="sm" onPress={onCancel}>
          {t("settings.tunnel.actions.cancel")}
        </Button>
        <Button
          variant="default"
          size="sm"
          onPress={() =>
            onSave({
              name,
              target,
              routeOffer,
              sourceHostName: importOffer
                ? t("settings.tunnel.form.importedHost")
                : sourceHost.name,
              sourceIngressName: importOffer
                ? t("settings.tunnel.form.importedIngress")
                : sourceIngress.name,
              listenScope,
              port,
              accessMode,
              tokenSource: resolveTokenSource(accessMode, initialEgress, tokenSource),
              customToken,
            })
          }
          disabled={
            kind === "egress" &&
            accessMode !== "none" &&
            !hasStoredToken &&
            tokenSource === "custom" &&
            !customToken.trim()
          }
        >
          {initialIngress || initialEgress
            ? t("settings.tunnel.actions.saveChanges")
            : t("settings.tunnel.actions.saveEnabled")}
        </Button>
      </View>
    </View>
  );
}

function RotateTokenForm({
  egress,
  onCancel,
  onSave,
}: {
  egress?: Egress;
  onCancel: () => void;
  onSave: (source: Exclude<TokenSource, "none">, customToken: string) => void;
}) {
  const { t } = useTranslation();
  const [source, setSource] = useState<Exclude<TokenSource, "none">>("generated");
  const [customToken, setCustomToken] = useState("");
  if (!egress) return null;
  return (
    <View style={styles.formCard}>
      <Text style={styles.formTitle}>
        {t("settings.tunnel.token.rotateTitle", { name: egress.name })}
      </Text>
      <Text style={styles.warning}>{t("settings.tunnel.token.rotateWarning")}</Text>
      <Field
        label={t("settings.tunnel.labels.accessToken")}
        hint={t("settings.tunnel.token.setupHint")}
      >
        <SegmentedControl
          size="sm"
          value={source}
          onValueChange={setSource}
          options={[
            {
              value: "generated",
              label: t("settings.tunnel.token.generateAutomatically"),
            },
            { value: "custom", label: t("settings.tunnel.token.useCustom") },
          ]}
        />
      </Field>
      {source === "custom" ? (
        <Field label={t("settings.tunnel.token.customValue")}>
          <FormTextInput
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setCustomToken}
            placeholder={t("settings.tunnel.token.customPlaceholder")}
          />
        </Field>
      ) : null}
      <View style={styles.formActions}>
        <Button variant="ghost" size="sm" onPress={onCancel}>
          {t("settings.tunnel.actions.cancel")}
        </Button>
        <Button
          variant="default"
          size="sm"
          disabled={source === "custom" && !customToken.trim()}
          onPress={() => onSave(source, customToken)}
        >
          {t("settings.tunnel.actions.rotateToken")}
        </Button>
      </View>
    </View>
  );
}

function StatePanel({ ingresses, egresses }: { ingresses: Ingress[]; egresses: Egress[] }) {
  const { t } = useTranslation();
  return (
    <View style={styles.statePanel}>
      <Text style={styles.overline}>{t("settings.tunnel.labels.prototypeState")}</Text>
      <View style={styles.stateSummary}>
        <Text style={styles.stateLabel}>{t("settings.tunnel.labels.relay")}</Text>
        <StatusBadge label={t("settings.tunnel.relayReady")} variant="success" />
      </View>
      {ingresses.map((item) => (
        <View key={item.id} style={styles.stateRow}>
          <Text style={styles.stateKind}>{t("settings.tunnel.ingress")}</Text>
          <View style={styles.stateMain}>
            <Text style={styles.stateName}>{item.name}</Text>
            <Text style={styles.stateValue}>{item.targetOrigin}</Text>
          </View>
          <Text style={styles.stateStatus}>
            {item.enabled ? t("settings.tunnel.enabled") : t("settings.tunnel.disabled")}
          </Text>
        </View>
      ))}
      {egresses.map((item) => (
        <View key={item.id} style={styles.stateRow}>
          <Text style={styles.stateKind}>{t("settings.tunnel.egress")}</Text>
          <View style={styles.stateMain}>
            <Text style={styles.stateName}>{item.name}</Text>
            <Text style={styles.stateValue}>
              {item.sourceHostName} / {item.sourceIngressName} → {listenerAddress(item)} ·{` `}
              {accessLabel(item.accessMode, t)}
            </Text>
          </View>
          <Text style={styles.stateStatus}>{runtimeLabel(item.runtime, t)}</Text>
        </View>
      ))}
    </View>
  );
}

function PageIntro({ title, description }: { title: string; description: string }) {
  return (
    <View style={styles.pageIntro}>
      <Text style={styles.pageTitle}>{title}</Text>
      <Text style={styles.pageDescription}>{description}</Text>
    </View>
  );
}

function ResultNotice({ result }: { result: TokenResult | null }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  if (!result) return null;

  const copyToken = async () => {
    try {
      await Clipboard.setStringAsync(result.token);
    } catch {
      if (!isWeb) return;
      const input = document.createElement("textarea");
      input.value = result.token;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    setCopied(true);
  };

  return (
    <View style={styles.notice}>
      <Text style={styles.noticeTitle}>{t("settings.tunnel.result.title")}</Text>
      <Text style={styles.noticeText}>
        {t("settings.tunnel.result.description", { name: result.name })}
      </Text>
      <View style={styles.noticeTokenBox}>
        <Text selectable style={styles.noticeToken}>
          {result.token}
        </Text>
      </View>
      <Button size="xs" variant="outline" leftIcon={Copy} onPress={() => void copyToken()}>
        {copied ? t("settings.tunnel.actions.copiedToken") : t("settings.tunnel.actions.copyToken")}
      </Button>
    </View>
  );
}

function SectionActions({
  status,
  label,
  onPress,
}: {
  status: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.sectionActions}>
      <StatusBadge label={status} variant="success" />
      <AddAction label={label} onPress={onPress} />
    </View>
  );
}

function EgressSectionActions({ onAdd, onImport }: { onAdd: () => void; onImport: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.sectionActions}>
      <Button size="xs" variant="ghost" leftIcon={Copy} onPress={onImport}>
        {t("settings.tunnel.actions.importOffer")}
      </Button>
      <AddAction label={t("settings.tunnel.actions.addEgress")} onPress={onAdd} />
    </View>
  );
}

function AddAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Button size="xs" variant="ghost" leftIcon={Plus} onPress={onPress}>
      {label}
    </Button>
  );
}

function accessLabel(mode: AccessMode, t: TFunction) {
  if (mode === "bearer") return t("settings.tunnel.access.bearer");
  if (mode === "none") return t("settings.tunnel.access.none");
  return t("settings.tunnel.access.header");
}

function listenerAddress(egress: Egress) {
  const host = egress.listenScope === "local" ? "127.0.0.1" : "0.0.0.0";
  return `${host}:${egress.port}`;
}

function effectivePort(origin: string) {
  try {
    const url = new URL(origin);
    if (url.port) return url.port;
    return url.protocol === "https:" ? "443" : "80";
  } catch {
    return "8080";
  }
}

function initialPort(importOffer: boolean, egress: Egress | undefined, targetOrigin: string) {
  if (importOffer) return "";
  if (egress) return String(egress.port);
  return effectivePort(targetOrigin);
}

function resolveTokenSource(
  accessMode: AccessMode,
  egress: Egress | undefined,
  selectedSource: Exclude<TokenSource, "none">,
): TokenSource {
  if (accessMode === "none") return "none";
  if (egress?.tokenSource && egress.tokenSource !== "none") return egress.tokenSource;
  return selectedSource;
}

function removeItemById<T extends { id: string }>(items: T[], id: string) {
  return items.filter((item) => item.id !== id);
}

function generatePrototypeToken() {
  return `pat-${Math.random().toString(36).slice(2, 14)}${Math.random().toString(36).slice(2, 14)}`;
}

function runtimeLabel(runtime: Egress["runtime"], t: TFunction) {
  if (runtime === "listening") return t("settings.tunnel.listening");
  if (runtime === "disabled") return t("settings.tunnel.disabled");
  return "Error";
}

const styles = StyleSheet.create((theme) => ({
  page: { paddingBottom: theme.spacing[6] },
  prototypeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginBottom: theme.spacing[6],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
  },
  prototypeLabel: {
    color: theme.colors.accent,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    letterSpacing: 0.8,
  },
  prototypeCopy: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  pageIntro: { marginBottom: theme.spacing[6], gap: theme.spacing[2] },
  pageTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.medium,
  },
  pageDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    maxWidth: 560,
  },
  sectionActions: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  entryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[4],
    padding: theme.spacing[4],
  },
  entryMain: { flex: 1, minWidth: 0, gap: theme.spacing[3] },
  titleWithBadge: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  metadataGrid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[6] },
  metadata: { minWidth: 180, gap: theme.spacing[1] },
  metadataLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  metadataValue: { color: theme.colors.foreground, fontSize: theme.fontSize.xs },
  metadataMonoValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontFamily.mono,
  },
  entryActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1],
    marginLeft: -theme.spacing[2],
  },
  notice: {
    padding: theme.spacing[4],
    marginBottom: theme.spacing[6],
    borderWidth: 1,
    borderColor: `${theme.colors.statusSuccess}55`,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: `${theme.colors.statusSuccess}10`,
    gap: theme.spacing[1],
  },
  noticeTitle: {
    color: theme.colors.statusSuccess,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  noticeText: { color: theme.colors.foreground, fontSize: theme.fontSize.xs, lineHeight: 18 },
  noticeToken: {
    color: theme.colors.accent,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    fontFamily: theme.fontFamily.mono,
  },
  noticeTokenBox: {
    alignSelf: "flex-start",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderWidth: 1,
    borderColor: `${theme.colors.accent}66`,
    borderRadius: theme.borderRadius.md,
    backgroundColor: `${theme.colors.accent}18`,
  },
  overline: { color: theme.colors.foregroundMuted, fontSize: 10, letterSpacing: 0.7 },
  formCard: {
    padding: theme.spacing[4],
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[4],
  },
  formTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  formSource: {
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
    gap: theme.spacing[2],
  },
  formSourceValue: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontFamily.mono,
  },
  currentHostValue: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  currentHostText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  currentHostHint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  formActions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
  warning: { color: theme.colors.palette.amber[500], fontSize: theme.fontSize.xs, lineHeight: 18 },
  statePanel: {
    marginTop: theme.spacing[2],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing[3],
  },
  stateSummary: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  stateLabel: { minWidth: 72, color: theme.colors.foreground, fontSize: theme.fontSize.xs },
  stateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingTop: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  stateKind: { width: 72, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  stateMain: { flex: 1, minWidth: 0 },
  stateName: { color: theme.colors.foreground, fontSize: theme.fontSize.xs },
  stateValue: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
    fontFamily: theme.fontFamily.mono,
    marginTop: 2,
  },
  stateStatus: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
}));
