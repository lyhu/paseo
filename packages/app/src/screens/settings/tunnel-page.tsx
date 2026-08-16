/* oxlint-disable react-perf/jsx-no-jsx-as-prop -- SettingsSection owns the header action slot. */
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { Pressable, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Copy, Dices, Eye, EyeOff } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type {
	RouteOffer,
	TunnelEgressState,
	TunnelIngressState,
} from "@getpaseo/protocol/tunnel-messages";
import { Alert } from "@/components/ui/alert";
import { AdaptiveConfirmDialog } from "@/components/ui/adaptive-confirm-dialog";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { HostPicker } from "@/components/hosts/host-picker";
import type {
	EgressFormModel,
	EgressFormSnapshot,
	EgressFormState,
	TunnelAccessMode,
} from "@/tunnel/egress-form-model";
import type { IngressFormSnapshot } from "@/tunnel/ingress-form-model";
import type { RouteOfferFormSnapshot } from "@/tunnel/route-offer-form-model";
import type { AccessTokenFormSnapshot } from "@/tunnel/access-token-form-model";
import { useIngressFormModel } from "@/tunnel/use-ingress-form-model";
import { useEgressFormModel } from "@/tunnel/use-egress-form-model";
import { useRouteOfferFormModel } from "@/tunnel/use-route-offer-form-model";
import { useAccessTokenFormModel } from "@/tunnel/use-access-token-form-model";
import { useTunnelState } from "@/tunnel/tunnel-state";
import { useHostFeature, useHostFeatureMap } from "@/runtime/host-features";
import {
	useHostRuntimeConnectionStatuses,
	useHostRuntimeIsConnected,
	useHosts,
} from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function statusVariant(
	status:
		| "disabled"
		| "ready"
		| "error"
		| "starting"
		| "listening"
		| "inactive"
		| "connecting",
) {
	if (status === "ready" || status === "listening") return "success" as const;
	if (status === "error") return "error" as const;
	return "muted" as const;
}

const STATUS_KEYS = {
	disabled: "settings.tunnel.status.disabled",
	ready: "settings.tunnel.status.ready",
	error: "settings.tunnel.status.error",
	starting: "settings.tunnel.status.starting",
	listening: "settings.tunnel.status.listening",
	inactive: "settings.tunnel.status.inactive",
	connecting: "settings.tunnel.status.connecting",
} as const;

function requireRouteOffer(
	offer: RouteOffer | null,
	invalidMessage: string,
): RouteOffer {
	if (!offer) throw new Error(invalidMessage);
	return offer;
}

function accessModeLabel(
	t: (key: string) => string,
	mode: TunnelAccessMode,
): string {
	if (mode === "header") return t("settings.tunnel.access.headerShort");
	if (mode === "bearer") return t("settings.tunnel.access.bearerShort");
	return t("settings.tunnel.access.none");
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

const ACCESS_TOKEN_HEADER_KEY = "X-Paseo-Access-Token";

const ACCESS_TOKEN_PREFIX = "ptt-";

/** Generates a random access token: `ptt-` prefix + 16 hex chars = 20 chars. */
function generateAccessToken(): string {
	const bytes = new Uint8Array(8);
	globalThis.crypto.getRandomValues(bytes);
	const suffix = Array.from(bytes, (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	return `${ACCESS_TOKEN_PREFIX}${suffix}`;
}

/** Masks the middle of a token for display, keeping the prefix and last 4 chars. */
function maskToken(token: string): string {
	if (token.length <= 8) return token;
	const prefix = ACCESS_TOKEN_PREFIX;
	const keepStart = prefix.length + 4;
	const keepEnd = 4;
	const start = token.slice(0, keepStart);
	const end = token.slice(-keepEnd);
	const maskedMiddle = "•".repeat(
		Math.min(4, token.length - keepStart - keepEnd),
	);
	return `${start}${maskedMiddle}${end}`;
}

const ThemedEyeIcon = withUnistyles(Eye);
const ThemedEyeOffIcon = withUnistyles(EyeOff);
const ThemedDicesIcon = withUnistyles(Dices);
const ThemedCopyIcon = withUnistyles(Copy);

function AccessTokenInput({
	value,
	onChangeText,
	editable,
	accessibilityLabel,
}: {
	value: string;
	onChangeText(value: string): void;
	editable: boolean;
	accessibilityLabel: string;
}) {
	const { t } = useTranslation();
	const [revealed, setRevealed] = useState(false);
	const [resetKey, setResetKey] = useState(0);
	const revealToggle = useCallback(() => {
		setRevealed((current) => !current);
		setResetKey((current) => current + 1);
	}, []);
	const randomize = useCallback(() => {
		const next = generateAccessToken();
		onChangeText(next);
		setResetKey((current) => current + 1);
	}, [onChangeText]);
	const copyToken = useCallback(async () => {
		if (!value) return;
		await Clipboard.setStringAsync(value);
	}, [value]);

	return (
		<View style={styles.secretInputRow}>
			<View style={styles.secretInputChrome}>
				<FormTextInput
					initialValue={value}
					resetKey={`${revealed}:${resetKey}`}
					onChangeText={onChangeText}
					editable={editable}
					secureTextEntry={!revealed}
					autoCapitalize="none"
					autoCorrect={false}
					accessibilityLabel={accessibilityLabel}
				/>
			</View>
			<View style={styles.secretInputActions}>
				<Pressable
					onPress={revealToggle}
					disabled={!editable}
					hitSlop={8}
					style={styles.secretIconButton}
					accessibilityRole="button"
					accessibilityLabel={t("settings.tunnel.access.revealToken")}
				>
					{revealed ? (
						<ThemedEyeOffIcon size={16} />
					) : (
						<ThemedEyeIcon size={16} />
					)}
				</Pressable>
				<Pressable
					onPress={randomize}
					disabled={!editable}
					hitSlop={8}
					style={styles.secretIconButton}
					accessibilityRole="button"
					accessibilityLabel={t("settings.tunnel.access.generateToken")}
				>
					<ThemedDicesIcon size={16} />
				</Pressable>
				<Pressable
					onPress={copyToken}
					disabled={!editable || !value}
					hitSlop={8}
					style={styles.secretIconButton}
					accessibilityRole="button"
					accessibilityLabel={t("settings.tunnel.access.copyToken")}
				>
					<ThemedCopyIcon size={16} />
				</Pressable>
			</View>
		</View>
	);
}

function AccessFields({
	state,
	model,
	pending,
}: {
	state: { accessMode: TunnelAccessMode; accessToken: string };
	model: {
		setAccessMode(value: TunnelAccessMode): void;
		setAccessToken(value: string): void;
	};
	pending: boolean;
}) {
	const { t } = useTranslation();
	const options: Array<{ value: TunnelAccessMode; label: string }> = [
		{ value: "header", label: t("settings.tunnel.access.headerShort") },
		{ value: "bearer", label: t("settings.tunnel.access.bearerShort") },
		{ value: "none", label: t("settings.tunnel.access.none") },
	];

	return (
		<>
			<Field label={t("settings.tunnel.labels.authentication")}>
				<SegmentedControl
					value={state.accessMode}
					onValueChange={model.setAccessMode}
					options={options}
					size="sm"
				/>
			</Field>
			{state.accessMode !== "none" ? (
				<Field
					label={t("settings.tunnel.labels.accessToken")}
					hint={
						state.accessMode === "header"
							? t("settings.tunnel.form.accessTokenHeaderHint", {
									headerKey: ACCESS_TOKEN_HEADER_KEY,
								})
							: undefined
					}
				>
					<AccessTokenInput
						value={state.accessToken}
						onChangeText={model.setAccessToken}
						editable={!pending}
						accessibilityLabel={t("settings.tunnel.labels.accessToken")}
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
	selectedOffer,
}: {
	state: EgressFormState;
	model: EgressFormModel;
	pending: boolean;
	selectedOffer: RouteOffer | null;
}) {
	const { t } = useTranslation();
	const listenScopeOptions = [
		{ value: "127.0.0.1", label: t("settings.tunnel.form.localOnly") },
		{ value: "0.0.0.0", label: t("settings.tunnel.form.allInterfaces") },
	];

	return (
		<>
			{state.mode === "edit" && selectedOffer ? (
				<Field label={t("settings.tunnel.labels.sourceIngress")}>
					<Text style={settingsStyles.rowHint}>
						{selectedOffer.ingressHostName} / {selectedOffer.ingressName}
					</Text>
				</Field>
			) : (
				<Field label={t("settings.tunnel.labels.routeOffer")}>
					<FormTextInput
						initialValue={state.routeOfferText}
						onChangeText={model.setRouteOfferText}
						editable={!pending}
						autoCapitalize="none"
						autoCorrect={false}
						accessibilityLabel={t("settings.tunnel.labels.routeOffer")}
					/>
				</Field>
			)}
			<Field label={t("settings.tunnel.labels.listenScope")}>
				<SegmentedControl
					value={state.listenHost}
					onValueChange={model.setListenHost}
					options={listenScopeOptions}
					size="sm"
				/>
			</Field>
			{state.listenHost === "0.0.0.0" ? (
				<Alert
					variant="warning"
					title={t("settings.tunnel.form.networkWarningTitle")}
					description={t("settings.tunnel.form.networkWarning")}
				/>
			) : null}
			<Field label={t("settings.tunnel.labels.listenerPort")}>
				<FormTextInput
					initialValue={state.listenPort}
					onChangeText={model.setListenPort}
					editable={!pending}
					keyboardType="number-pad"
					accessibilityLabel={t("settings.tunnel.labels.listenerPort")}
				/>
			</Field>
			{state.mode === "create" ? (
				<AccessFields state={state} model={model} pending={pending} />
			) : null}
		</>
	);
}

function IngressEditor({
	snapshot,
	pending,
	onCancel,
	onSubmit,
}: {
	snapshot: IngressFormSnapshot;
	pending: boolean;
	onCancel(): void;
	onSubmit(input: { name: string; targetOrigin: string }): Promise<void>;
}) {
	const { t } = useTranslation();
	const model = useIngressFormModel(snapshot);
	const state = useSyncExternalStore(
		model.subscribe,
		model.getState,
		model.getState,
	);
	const submit = useCallback(async () => {
		try {
			await onSubmit({
				name: state.name.trim(),
				targetOrigin: state.targetOrigin.trim(),
			});
		} catch (error) {
			model.setSubmitError(errorMessage(error));
		}
	}, [model, onSubmit, state.name, state.targetOrigin]);

	return (
		<View style={[settingsStyles.card, styles.editor]}>
			<Field label={t("settings.tunnel.form.name")}>
				<FormTextInput
					initialValue={state.name}
					onChangeText={model.setName}
					editable={!pending}
					accessibilityLabel={t("settings.tunnel.form.tunnelName")}
				/>
			</Field>
			<Field
				label={t("settings.tunnel.labels.targetOrigin")}
				hint={t("settings.tunnel.form.originHint")}
			>
				<FormTextInput
					initialValue={state.targetOrigin}
					onChangeText={model.setTargetOrigin}
					editable={!pending}
					autoCapitalize="none"
					autoCorrect={false}
					accessibilityLabel={t("settings.tunnel.labels.targetOrigin")}
				/>
			</Field>
			{state.submitError ? (
				<Alert variant="error" title={state.submitError} />
			) : null}
			<View style={styles.actions}>
				<Button
					variant="outline"
					size="sm"
					onPress={onCancel}
					disabled={pending}
				>
					{t("settings.tunnel.actions.cancel")}
				</Button>
				<Button
					size="sm"
					onPress={submit}
					disabled={!state.canSubmit || pending}
				>
					{pending
						? t("settings.tunnel.actions.saving")
						: t("settings.tunnel.actions.save")}
				</Button>
			</View>
		</View>
	);
}

function EgressEditor({
	snapshot,
	pending,
	onCancel,
	onSubmit,
}: {
	snapshot: EgressFormSnapshot;
	pending: boolean;
	onCancel(): void;
	onSubmit(input: {
		name: string;
		listen: { host: string; port: number };
		offer: RouteOffer | null;
		access: { mode: TunnelAccessMode; token?: string };
	}): Promise<void>;
}) {
	const { t } = useTranslation();
	const model = useEgressFormModel(snapshot);
	const state = useSyncExternalStore(
		model.subscribe,
		model.getState,
		model.getState,
	);
	const isCreate = state.mode === "create";
	const applyOffer = useCallback(
		(offer: RouteOffer | null) => {
			model.setRouteOfferText(offer ? JSON.stringify(offer) : "");
		},
		[model],
	);
	const [showNetworkWarning, setShowNetworkWarning] = useState(false);
	const submit = useCallback(async () => {
		try {
			if (state.listenHost === "0.0.0.0") {
				setShowNetworkWarning(true);
				return;
			}
			await onSubmit({
				name: state.name.trim(),
				listen: { host: state.listenHost, port: Number(state.listenPort) },
				offer: model.getRouteOffer(),
				access: {
					mode: state.accessMode,
					...(state.accessToken.trim()
						? { token: state.accessToken.trim() }
						: {}),
				},
			});
		} catch (error) {
			model.setSubmitError(errorMessage(error));
		}
	}, [model, onSubmit, state]);
	const dismissNetworkWarning = useCallback(
		() => setShowNetworkWarning(false),
		[],
	);
	const confirmNetworkWarning = useCallback(async () => {
		setShowNetworkWarning(false);
		try {
			await onSubmit({
				name: state.name.trim(),
				listen: { host: state.listenHost, port: Number(state.listenPort) },
				offer: model.getRouteOffer(),
				access: {
					mode: state.accessMode,
					...(state.accessToken.trim()
						? { token: state.accessToken.trim() }
						: {}),
				},
			});
		} catch (error) {
			model.setSubmitError(errorMessage(error));
		}
	}, [model, onSubmit, state]);

	return (
		<View style={[settingsStyles.card, styles.editor]}>
			<Field label={t("settings.tunnel.form.name")}>
				<FormTextInput
					initialValue={state.name}
					onChangeText={model.setName}
					editable={!pending}
					accessibilityLabel={t("settings.tunnel.form.tunnelName")}
				/>
			</Field>
			{isCreate && !snapshot.offer ? (
				<EgressSourceFields pending={pending} onOfferChange={applyOffer} />
			) : null}
			<EgressFields
				state={state}
				model={model}
				pending={pending}
				selectedOffer={snapshot.offer ?? null}
			/>
			{state.submitError ? (
				<Alert variant="error" title={state.submitError} />
			) : null}
			<View style={styles.actions}>
				<Button
					variant="outline"
					size="sm"
					onPress={onCancel}
					disabled={pending}
				>
					{t("settings.tunnel.actions.cancel")}
				</Button>
				<Button
					size="sm"
					onPress={submit}
					disabled={!state.canSubmit || pending}
				>
					{pending
						? t("settings.tunnel.actions.saving")
						: t("settings.tunnel.actions.save")}
				</Button>
			</View>
			<AdaptiveConfirmDialog
				visible={showNetworkWarning}
				title={t("settings.tunnel.form.networkWarningTitle")}
				message={t("settings.tunnel.form.networkWarning")}
				confirmLabel={t("settings.tunnel.form.allInterfaces")}
				destructive
				onClose={dismissNetworkWarning}
				onConfirm={confirmNetworkWarning}
			/>
		</View>
	);
}

function RouteOfferEditor({
	snapshot,
	pending,
	onCancel,
	onSubmit,
}: {
	snapshot: RouteOfferFormSnapshot;
	pending: boolean;
	onCancel(): void;
	onSubmit(offer: RouteOffer): Promise<void>;
}) {
	const { t } = useTranslation();
	const model = useRouteOfferFormModel(snapshot);
	const state = useSyncExternalStore(
		model.subscribe,
		model.getState,
		model.getState,
	);
	const submit = useCallback(async () => {
		try {
			await onSubmit(
				requireRouteOffer(
					model.getRouteOffer(),
					t("settings.tunnel.errors.invalidRouteOffer"),
				),
			);
		} catch (error) {
			model.setSubmitError(errorMessage(error));
		}
	}, [model, onSubmit, t]);

	return (
		<View style={[settingsStyles.card, styles.editor]}>
			<Field label={t("settings.tunnel.labels.routeOffer")}>
				<FormTextInput
					initialValue={state.routeOfferText}
					onChangeText={model.setRouteOfferText}
					editable={!pending}
					autoCapitalize="none"
					autoCorrect={false}
					accessibilityLabel={t("settings.tunnel.labels.routeOffer")}
				/>
			</Field>
			{state.submitError ? (
				<Alert variant="error" title={state.submitError} />
			) : null}
			<View style={styles.actions}>
				<Button
					variant="outline"
					size="sm"
					onPress={onCancel}
					disabled={pending}
				>
					{t("settings.tunnel.actions.cancel")}
				</Button>
				<Button
					size="sm"
					onPress={submit}
					disabled={!state.canSubmit || pending}
				>
					{pending
						? t("settings.tunnel.actions.saving")
						: t("settings.tunnel.actions.save")}
				</Button>
			</View>
		</View>
	);
}

function AccessTokenEditor({
	snapshot,
	pending,
	onCancel,
	onSubmit,
}: {
	snapshot: AccessTokenFormSnapshot;
	pending: boolean;
	onCancel(): void;
	onSubmit(access: { mode: TunnelAccessMode; token?: string }): Promise<void>;
}) {
	const { t } = useTranslation();
	const model = useAccessTokenFormModel(snapshot);
	const state = useSyncExternalStore(
		model.subscribe,
		model.getState,
		model.getState,
	);
	const submit = useCallback(async () => {
		try {
			await onSubmit({
				mode: state.accessMode,
				...(state.accessToken.trim()
					? { token: state.accessToken.trim() }
					: {}),
			});
		} catch (error) {
			model.setSubmitError(errorMessage(error));
		}
	}, [model, onSubmit, state.accessMode, state.accessToken]);

	return (
		<View style={[settingsStyles.card, styles.editor]}>
			<Text style={settingsStyles.rowTitle}>
				{t("settings.tunnel.token.rotateTitle", { name: state.entryName })}
			</Text>
			<AccessFields state={state} model={model} pending={pending} />
			{state.submitError ? (
				<Alert variant="error" title={state.submitError} />
			) : null}
			<View style={styles.actions}>
				<Button
					variant="outline"
					size="sm"
					onPress={onCancel}
					disabled={pending}
				>
					{t("settings.tunnel.actions.cancel")}
				</Button>
				<Button
					size="sm"
					onPress={submit}
					disabled={!state.canSubmit || pending}
				>
					{pending
						? t("settings.tunnel.actions.saving")
						: t("settings.tunnel.actions.save")}
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
	onRotateSecret,
	onDelete,
}: {
	entry: TunnelIngressState;
	pending: boolean;
	onToggle(entry: TunnelIngressState): void;
	onEdit(entry: TunnelIngressState): void;
	onRotateSecret(entry: TunnelIngressState): void;
	onDelete(entry: TunnelIngressState): void;
}) {
	const { t } = useTranslation();
	const toggle = useCallback(() => onToggle(entry), [entry, onToggle]);
	const edit = useCallback(() => onEdit(entry), [entry, onEdit]);
	const rotateSecret = useCallback(
		() => onRotateSecret(entry),
		[entry, onRotateSecret],
	);
	const remove = useCallback(() => onDelete(entry), [entry, onDelete]);

	return (
		<View style={styles.row}>
			<View style={settingsStyles.rowContent}>
				<View style={styles.title}>
					<Text style={settingsStyles.rowTitle}>{entry.name}</Text>
					<StatusBadge
						label={t(STATUS_KEYS[entry.status])}
						variant={statusVariant(entry.status)}
					/>
				</View>
				<Text style={settingsStyles.rowHint}>{entry.targetOrigin}</Text>
			</View>
			<Switch
				value={entry.enabled}
				onValueChange={toggle}
				disabled={pending}
				accessibilityLabel={t("settings.tunnel.accessibility.enableEntry", {
					name: entry.name,
				})}
			/>
			<View style={styles.actions}>
				<Button variant="outline" size="sm" onPress={edit} disabled={pending}>
					{t("settings.tunnel.actions.edit")}
				</Button>
				<Button
					variant="outline"
					size="sm"
					onPress={rotateSecret}
					disabled={pending}
				>
					{t("settings.tunnel.actions.rotateSecret")}
				</Button>
				<Button variant="outline" size="sm" onPress={remove} disabled={pending}>
					{t("settings.tunnel.actions.delete")}
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
	const { t } = useTranslation();
	const toggle = useCallback(() => onToggle(entry), [entry, onToggle]);
	const edit = useCallback(() => onEdit(entry), [entry, onEdit]);
	const replaceOffer = useCallback(
		() => onReplaceOffer(entry),
		[entry, onReplaceOffer],
	);
	const rotateToken = useCallback(
		() => onRotateToken(entry),
		[entry, onRotateToken],
	);
	const remove = useCallback(() => onDelete(entry), [entry, onDelete]);

	return (
		<View style={styles.row}>
			<View style={settingsStyles.rowContent}>
				<View style={styles.title}>
					<Text style={settingsStyles.rowTitle}>{entry.name}</Text>
					<StatusBadge
						label={t(STATUS_KEYS[entry.status])}
						variant={statusVariant(entry.status)}
					/>
				</View>
				<Text style={settingsStyles.rowHint}>
					{`${entry.ingressHostName} / ${entry.ingressName}`}
				</Text>
				<Text style={settingsStyles.rowHint}>
					{`${entry.listen.host}:${entry.listen.port} · ${accessModeLabel(t, entry.access.mode)}`}
				</Text>
			</View>
			<Switch
				value={entry.enabled}
				onValueChange={toggle}
				disabled={pending}
				accessibilityLabel={t("settings.tunnel.accessibility.enableEntry", {
					name: entry.name,
				})}
			/>
			<View style={styles.actions}>
				<Button variant="outline" size="sm" onPress={edit} disabled={pending}>
					{t("settings.tunnel.actions.edit")}
				</Button>
				<Button
					variant="outline"
					size="sm"
					onPress={replaceOffer}
					disabled={pending}
				>
					{t("settings.tunnel.actions.replaceOffer")}
				</Button>
				<Button
					variant="outline"
					size="sm"
					onPress={rotateToken}
					disabled={pending}
				>
					{t("settings.tunnel.actions.rotateToken")}
				</Button>
				<Button variant="outline" size="sm" onPress={remove} disabled={pending}>
					{t("settings.tunnel.actions.delete")}
				</Button>
			</View>
		</View>
	);
}

function EgressSourceFields({
	pending,
	onOfferChange,
}: {
	pending: boolean;
	onOfferChange(offer: RouteOffer | null): void;
}) {
	const { t } = useTranslation();
	const hosts = useHosts();
	const hostIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
	const connectionStatuses = useHostRuntimeConnectionStatuses(hostIds);
	const tunnelFeatures = useHostFeatureMap(hostIds, "httpTunnel");
	const eligibleHosts = useMemo(
		() =>
			hosts.filter(
				(host) =>
					connectionStatuses.get(host.serverId) === "online" &&
					tunnelFeatures.get(host.serverId) === true,
			),
		[connectionStatuses, hosts, tunnelFeatures],
	);
	const [selectedHostId, setSelectedHostId] = useState(
		eligibleHosts[0]?.serverId ?? "",
	);
	const [selectedIngressId, setSelectedIngressId] = useState("");
	const [hostPickerOpen, setHostPickerOpen] = useState(false);
	const [isExporting, setIsExporting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const hostPickerAnchorRef = useRef<View>(null);
	const selectedHostSupported = tunnelFeatures.get(selectedHostId) === true;
	const sourceTunnel = useTunnelState(selectedHostId, selectedHostSupported);
	const exportOffer = sourceTunnel.exportOffer;
	const ingresses = useMemo(
		() =>
			sourceTunnel.state.data?.ingresses.filter((ingress) => ingress.enabled) ??
			[],
		[sourceTunnel.state.data?.ingresses],
	);

	useEffect(() => {
		if (eligibleHosts.some((host) => host.serverId === selectedHostId)) return;
		setSelectedHostId(eligibleHosts[0]?.serverId ?? "");
	}, [eligibleHosts, selectedHostId]);

	useEffect(() => {
		if (ingresses.some((ingress) => ingress.id === selectedIngressId)) return;
		setSelectedIngressId(ingresses[0]?.id ?? "");
	}, [ingresses, selectedIngressId]);

	// Auto-export the offer whenever the selected ingress changes.
	const selectedHostLabel =
		eligibleHosts.find((host) => host.serverId === selectedHostId)?.label ??
		t("settings.tunnel.form.selectHost");
	useEffect(() => {
		if (!selectedIngressId) {
			onOfferChange(null);
			return;
		}
		let cancelled = false;
		setIsExporting(true);
		setError(null);
		void (async () => {
			try {
				const result = await exportOffer(selectedIngressId);
				if (!cancelled) {
					onOfferChange({
						...result.offer,
						ingressHostName: selectedHostLabel,
					});
				}
			} catch (exportError) {
				if (!cancelled) {
					setError(errorMessage(exportError));
					onOfferChange(null);
				}
			} finally {
				if (!cancelled) setIsExporting(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [onOfferChange, selectedHostLabel, selectedIngressId, exportOffer]);

	const selectHost = useCallback((nextHostId: string) => {
		setSelectedHostId(nextHostId);
		setSelectedIngressId("");
		setError(null);
	}, []);
	const openHostPicker = useCallback(() => setHostPickerOpen(true), []);

	return (
		<>
			<Field label={t("settings.tunnel.labels.sourceHost")}>
				<HostPicker
					hosts={eligibleHosts}
					value={selectedHostId}
					onSelect={selectHost}
					open={hostPickerOpen}
					onOpenChange={setHostPickerOpen}
					anchorRef={hostPickerAnchorRef}
					title={t("settings.tunnel.labels.sourceHost")}
				>
					<View ref={hostPickerAnchorRef}>
						<Button
							variant="outline"
							size="sm"
							onPress={openHostPicker}
							disabled={pending || eligibleHosts.length === 0}
							accessibilityLabel={t("settings.tunnel.labels.sourceHost")}
						>
							{selectedHostLabel}
						</Button>
					</View>
				</HostPicker>
			</Field>
			<Field label={t("settings.tunnel.ingress")}>
				{sourceTunnel.state.isLoading ? (
					<Text>{t("settings.tunnel.states.loadingIngresses")}</Text>
				) : null}
				{!sourceTunnel.state.isLoading && ingresses.length > 0 ? (
					<SegmentedControl
						value={selectedIngressId}
						onValueChange={setSelectedIngressId}
						options={ingresses.map((ingress) => ({
							value: ingress.id,
							label: ingress.name,
						}))}
						size="sm"
					/>
				) : null}
				{!sourceTunnel.state.isLoading && ingresses.length === 0 ? (
					<Text style={settingsStyles.rowHint}>
						{t("settings.tunnel.empty.noEnabledIngress")}
					</Text>
				) : null}
				{isExporting ? (
					<Text style={settingsStyles.rowHint}>
						{t("settings.tunnel.states.exporting")}
					</Text>
				) : null}
			</Field>
			{error ? <Alert variant="error" title={error} /> : null}
		</>
	);
}

// oxlint-disable-next-line complexity -- This component coordinates the independent Tunnel form lifecycles and mutations.
export function TunnelPage({ serverId }: { serverId: string }) {
	const { t } = useTranslation();
	const connected = useHostRuntimeIsConnected(serverId);
	const supported = useHostFeature(serverId, "httpTunnel");
	const { state, mutate } = useTunnelState(serverId, supported);
	const [ingressEditor, setIngressEditor] =
		useState<IngressFormSnapshot | null>(null);
	const [egressEditor, setEgressEditor] = useState<EgressFormSnapshot | null>(
		null,
	);
	const [routeOfferEditor, setRouteOfferEditor] =
		useState<RouteOfferFormSnapshot | null>(null);
	const [accessTokenEditor, setAccessTokenEditor] =
		useState<AccessTokenFormSnapshot | null>(null);
	const [editorResult, setEditorResult] = useState<{
		value: string;
		copied: boolean;
		error: string | null;
	} | null>(null);
	const [egressPendingDelete, setEgressPendingDelete] =
		useState<TunnelEgressState | null>(null);
	const [ingressPendingDelete, setIngressPendingDelete] =
		useState<TunnelIngressState | null>(null);
	const [ingressPendingRotate, setIngressPendingRotate] =
		useState<TunnelIngressState | null>(null);
	const [feedback, setFeedback] = useState<{
		kind: "success" | "error";
		message: string;
	} | null>(null);
	const pending = mutate.isPending;

	const commitMutation = useCallback(
		async (mutation: Parameters<typeof mutate.mutateAsync>[0]) => {
			setFeedback(null);
			const result = await mutate.mutateAsync(mutation);
			setFeedback({
				kind: "success",
				message: t("settings.tunnel.states.saved"),
			});
			return result;
		},
		[mutate, t],
	);
	const runMutation = useCallback(
		async (
			mutation: Parameters<typeof mutate.mutateAsync>[0],
		): Promise<boolean> => {
			try {
				await commitMutation(mutation);
				return true;
			} catch (error) {
				setFeedback({ kind: "error", message: errorMessage(error) });
				return false;
			}
		},
		[commitMutation],
	);
	const submitIngress = useCallback(
		async (input: { name: string; targetOrigin: string }) => {
			if (!ingressEditor) return;
			await commitMutation(
				ingressEditor.mode === "create"
					? {
							operation: "createIngress",
							name: input.name,
							targetOrigin: input.targetOrigin,
						}
					: {
							operation: "updateIngress",
							id: ingressEditor.entry?.id ?? "",
							name: input.name,
							targetOrigin: input.targetOrigin,
						},
			);
			setIngressEditor(null);
		},
		[commitMutation, ingressEditor],
	);
	const submitEgress = useCallback(
		async (input: {
			name: string;
			listen: { host: string; port: number };
			offer: RouteOffer | null;
			access: { mode: TunnelAccessMode; token?: string };
		}) => {
			if (!egressEditor) return;
			const result =
				egressEditor.mode === "create"
					? await commitMutation({
							operation: "createEgress",
							name: input.name,
							listen: input.listen,
							offer: requireRouteOffer(
								input.offer,
								t("settings.tunnel.errors.invalidRouteOffer"),
							),
							access: input.access,
						})
					: await commitMutation({
							operation: "updateEgress",
							id: egressEditor.entry?.id ?? "",
							name: input.name,
							listen: input.listen,
						});
			if (result.oneTimeToken) {
				setEditorResult({
					value: result.oneTimeToken,
					copied: false,
					error: null,
				});
			} else {
				setEgressEditor(null);
			}
		},
		[commitMutation, egressEditor, t],
	);
	const submitRouteOffer = useCallback(
		async (offer: RouteOffer) => {
			if (!routeOfferEditor) return;
			await commitMutation({
				operation: "replaceEgressOffer",
				id: routeOfferEditor.entryId,
				offer,
			});
			setRouteOfferEditor(null);
		},
		[commitMutation, routeOfferEditor],
	);
	const submitAccessToken = useCallback(
		async (access: { mode: TunnelAccessMode; token?: string }) => {
			if (!accessTokenEditor) return;
			const result = await commitMutation(
				rotateTokenMutation({ id: accessTokenEditor.entryId, access }),
			);
			if (result.oneTimeToken) {
				setEditorResult({
					value: result.oneTimeToken,
					copied: false,
					error: null,
				});
			} else {
				setAccessTokenEditor(null);
			}
		},
		[accessTokenEditor, commitMutation],
	);
	const deleteIngress = useCallback((entry: TunnelIngressState) => {
		setIngressPendingDelete(entry);
	}, []);
	const confirmDeleteIngress = useCallback(async () => {
		if (!ingressPendingDelete) return;
		await runMutation({
			operation: "deleteIngress",
			id: ingressPendingDelete.id,
		});
		setIngressPendingDelete(null);
	}, [ingressPendingDelete, runMutation]);
	const cancelDeleteIngress = useCallback(
		() => setIngressPendingDelete(null),
		[],
	);
	const deleteEgress = useCallback((entry: TunnelEgressState) => {
		setEgressPendingDelete(entry);
	}, []);
	const confirmDeleteEgress = useCallback(async () => {
		if (!egressPendingDelete) return;
		await runMutation({
			operation: "deleteEgress",
			id: egressPendingDelete.id,
		});
		setEgressPendingDelete(null);
	}, [egressPendingDelete, runMutation]);
	const cancelDeleteEgress = useCallback(
		() => setEgressPendingDelete(null),
		[],
	);
	const closeEditor = useCallback(() => {
		setIngressEditor(null);
		setEgressEditor(null);
		setRouteOfferEditor(null);
		setAccessTokenEditor(null);
		setEditorResult(null);
	}, []);
	const openCreateIngress = useCallback(() => {
		closeEditor();
		setIngressEditor({ mode: "create" });
	}, [closeEditor]);
	const openCreateEgress = useCallback(() => {
		closeEditor();
		setEgressEditor({ mode: "create" });
	}, [closeEditor]);
	const importEgress = useCallback(() => {
		closeEditor();
		setEgressEditor({ mode: "create" });
	}, [closeEditor]);
	const toggleIngress = useCallback(
		(entry: TunnelIngressState) => {
			void runMutation({
				operation: "updateIngress",
				id: entry.id,
				enabled: !entry.enabled,
			});
		},
		[runMutation],
	);
	const editIngress = useCallback(
		(entry: TunnelIngressState) => {
			closeEditor();
			setIngressEditor({ mode: "edit", entry });
		},
		[closeEditor],
	);
	const rotateIngressSecret = useCallback((entry: TunnelIngressState) => {
		setIngressPendingRotate(entry);
	}, []);
	const confirmRotateIngressSecret = useCallback(async () => {
		if (!ingressPendingRotate) return;
		await runMutation({
			operation: "rotateIngressSecret",
			id: ingressPendingRotate.id,
		});
		setIngressPendingRotate(null);
	}, [ingressPendingRotate, runMutation]);
	const cancelRotateIngressSecret = useCallback(
		() => setIngressPendingRotate(null),
		[],
	);
	const removeIngress = useCallback(
		(entry: TunnelIngressState) => void deleteIngress(entry),
		[deleteIngress],
	);
	const toggleEgress = useCallback(
		(entry: TunnelEgressState) => {
			void runMutation({
				operation: "updateEgress",
				id: entry.id,
				enabled: !entry.enabled,
			});
		},
		[runMutation],
	);
	const editEgress = useCallback(
		(entry: TunnelEgressState) => {
			closeEditor();
			setEgressEditor({
				mode: "edit",
				entry: { ...entry, accessMode: entry.access.mode },
			});
		},
		[closeEditor],
	);
	const removeEgress = useCallback(
		(entry: TunnelEgressState) => void deleteEgress(entry),
		[deleteEgress],
	);
	const replaceEgressOffer = useCallback(
		(entry: TunnelEgressState) => {
			closeEditor();
			setRouteOfferEditor({ entryId: entry.id });
		},
		[closeEditor],
	);
	const rotateEgressToken = useCallback(
		(entry: TunnelEgressState) => {
			closeEditor();
			setAccessTokenEditor({
				entryId: entry.id,
				entryName: entry.name,
				accessMode: entry.access.mode,
			});
		},
		[closeEditor],
	);
	const copyEditorResult = useCallback(async () => {
		if (!editorResult) return;
		try {
			await Clipboard.setStringAsync(editorResult.value);
			setEditorResult({ ...editorResult, copied: true, error: null });
		} catch (error) {
			setEditorResult({ ...editorResult, error: errorMessage(error) });
		}
	}, [editorResult]);

	if (!connected)
		return (
			<Alert
				variant="warning"
				title={t("settings.tunnel.states.hostOffline")}
			/>
		);
	if (!supported)
		return (
			<Alert variant="warning" title={t("settings.tunnel.states.updateHost")} />
		);
	if (state.isLoading)
		return <Alert title={t("settings.tunnel.states.loading")} />;
	if (state.isError)
		return (
			<Alert
				variant="error"
				title={t("settings.tunnel.states.loadFailed")}
				description={errorMessage(state.error)}
			/>
		);
	if (!state.data) return null;

	return (
		<View>
			{feedback ? (
				<Alert variant={feedback.kind} title={feedback.message} />
			) : null}
			<SettingsSection
				title={t("settings.tunnel.ingress")}
				trailing={
					<View style={styles.actions}>
						<StatusBadge
							label={t(STATUS_KEYS[state.data.relayStatus])}
							variant={statusVariant(state.data.relayStatus)}
						/>
						<Button size="sm" onPress={openCreateIngress} disabled={pending}>
							{t("settings.tunnel.actions.addIngress")}
						</Button>
					</View>
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
							onRotateSecret={rotateIngressSecret}
							onDelete={removeIngress}
						/>
					))}
					{!state.data.ingresses.length ? (
						<Text style={settingsStyles.rowHint}>
							{t("settings.tunnel.empty.noIngress")}
						</Text>
					) : null}
				</View>
			</SettingsSection>
			<SettingsSection
				title={t("settings.tunnel.egress")}
				trailing={
					<View style={styles.actions}>
						<Button
							variant="outline"
							size="sm"
							onPress={importEgress}
							disabled={pending}
						>
							{t("settings.tunnel.actions.importEgress")}
						</Button>
						<Button size="sm" onPress={openCreateEgress} disabled={pending}>
							{t("settings.tunnel.actions.addEgress")}
						</Button>
					</View>
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
						<Text style={settingsStyles.rowHint}>
							{t("settings.tunnel.empty.noEgress")}
						</Text>
					) : null}
				</View>
			</SettingsSection>
			{ingressEditor && !editorResult ? (
				<IngressEditor
					key={`${ingressEditor.mode}:${ingressEditor.entry?.id ?? "new"}`}
					snapshot={ingressEditor}
					pending={pending}
					onCancel={closeEditor}
					onSubmit={submitIngress}
				/>
			) : null}
			{egressEditor ? (
				<EgressEditor
					key={`${egressEditor.mode}:${egressEditor.entry?.id ?? "new"}`}
					snapshot={egressEditor}
					pending={pending || Boolean(editorResult)}
					onCancel={closeEditor}
					onSubmit={submitEgress}
				/>
			) : null}
			{routeOfferEditor ? (
				<RouteOfferEditor
					key={routeOfferEditor.entryId}
					snapshot={routeOfferEditor}
					pending={pending}
					onCancel={closeEditor}
					onSubmit={submitRouteOffer}
				/>
			) : null}
			{accessTokenEditor ? (
				<AccessTokenEditor
					key={accessTokenEditor.entryId}
					snapshot={accessTokenEditor}
					pending={pending || Boolean(editorResult)}
					onCancel={closeEditor}
					onSubmit={submitAccessToken}
				/>
			) : null}
			{editorResult ? (
				<View style={[settingsStyles.card, styles.editor]}>
					<Alert
						title={t("settings.tunnel.result.title")}
						description={editorResult.error ?? undefined}
						variant={editorResult.error ? "error" : "default"}
					>
						<Text selectable style={styles.token}>
							{maskToken(editorResult.value)}
						</Text>
						<Button size="sm" onPress={copyEditorResult}>
							{editorResult.copied
								? t("settings.tunnel.actions.copied")
								: t("settings.tunnel.actions.copyToken")}
						</Button>
					</Alert>
					<Button variant="outline" size="sm" onPress={closeEditor}>
						{t("settings.tunnel.actions.done")}
					</Button>
				</View>
			) : null}
			<AdaptiveConfirmDialog
				visible={Boolean(egressPendingDelete)}
				title={t("settings.tunnel.delete.egressTitle", {
					name: egressPendingDelete?.name ?? "",
				})}
				message={t("settings.tunnel.delete.egressMessage")}
				confirmLabel={t("settings.tunnel.actions.delete")}
				destructive
				onClose={cancelDeleteEgress}
				onConfirm={confirmDeleteEgress}
			/>
			<AdaptiveConfirmDialog
				visible={Boolean(ingressPendingDelete)}
				title={t("settings.tunnel.delete.ingressTitle", {
					name: ingressPendingDelete?.name ?? "",
				})}
				message={t("settings.tunnel.delete.ingressMessage")}
				confirmLabel={t("settings.tunnel.actions.delete")}
				destructive
				onClose={cancelDeleteIngress}
				onConfirm={confirmDeleteIngress}
			/>
			<AdaptiveConfirmDialog
				visible={Boolean(ingressPendingRotate)}
				title={t("settings.tunnel.confirm.rotateSecretTitle", {
					name: ingressPendingRotate?.name ?? "",
				})}
				message={t("settings.tunnel.confirm.rotateSecretMessage")}
				confirmLabel={t("settings.tunnel.actions.rotateSecret")}
				destructive
				onClose={cancelRotateIngressSecret}
				onConfirm={confirmRotateIngressSecret}
			/>
		</View>
	);
}

const styles = StyleSheet.create((theme) => ({
	editor: { padding: theme.spacing[4], gap: theme.spacing[3] },
	row: { padding: theme.spacing[4], gap: theme.spacing[2] },
	title: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
	actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
	token: {
		fontFamily: theme.fontFamily.mono,
		fontSize: theme.fontSize.sm,
		color: theme.colors.foreground,
		backgroundColor: theme.colors.surface2,
		padding: theme.spacing[2],
	},
	secretInputRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: theme.spacing[2],
	},
	secretInputChrome: {
		flex: 1,
		minWidth: 0,
	},
	secretInputActions: {
		flexDirection: "row",
		alignItems: "center",
		gap: theme.spacing[1],
	},
	secretIconButton: {
		alignItems: "center",
		justifyContent: "center",
		padding: theme.spacing[1],
		borderRadius: theme.borderRadius.sm,
	},
}));
