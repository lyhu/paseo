import { Alert } from "react-native";
import { getDesktopHost, type DesktopDialogAskOptions } from "@/desktop/host";
import { isNative } from "@/constants/platform";

/**
 * In-app confirm handler for web. The WebConfirmDialogProvider registers here
 * so confirmDialog() can render a layered in-app dialog instead of the native
 * browser `confirm()`. Null means no provider is mounted.
 */
type WebConfirmHandler = (input: ConfirmDialogInput) => Promise<boolean>;
let webConfirmHandler: WebConfirmHandler | null = null;

/** Registers/unregisters the web in-app confirm handler. */
export function setWebConfirmHandler(handler: WebConfirmHandler | null): void {
	webConfirmHandler = handler;
}

/**
 * Asks the mounted web confirm provider. Resolves null when no provider is
 * mounted (callers fall back to the browser confirm).
 */
export async function requestWebConfirm(
	input: ConfirmDialogInput,
): Promise<boolean | null> {
	if (!webConfirmHandler) return null;
	return webConfirmHandler(input);
}

export interface ConfirmDialogInput {
	title: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	destructive?: boolean;
}

interface ConfirmButtonConfig {
	confirmLabel: string;
	cancelLabel: string;
}

function resolveButtonLabels(input: ConfirmDialogInput): ConfirmButtonConfig {
	return {
		confirmLabel: input.confirmLabel ?? "Confirm",
		cancelLabel: input.cancelLabel ?? "Cancel",
	};
}

async function showNativeConfirmDialog(
	input: ConfirmDialogInput,
): Promise<boolean> {
	const labels = resolveButtonLabels(input);

	return new Promise<boolean>((resolve) => {
		Alert.alert(
			input.title,
			input.message,
			[
				{
					text: labels.cancelLabel,
					style: "cancel",
					onPress: () => resolve(false),
				},
				{
					text: labels.confirmLabel,
					style: input.destructive ? "destructive" : "default",
					onPress: () => resolve(true),
				},
			],
			{
				cancelable: true,
				onDismiss: () => resolve(false),
			},
		);
	});
}

function getDesktopApi() {
	if (isNative) {
		return null;
	}
	return getDesktopHost();
}

function buildDesktopAskOptions(
	input: ConfirmDialogInput,
): DesktopDialogAskOptions {
	const labels = resolveButtonLabels(input);

	return {
		title: input.title,
		okLabel: labels.confirmLabel,
		cancelLabel: labels.cancelLabel,
		kind: input.destructive ? "warning" : "info",
	};
}

function blurActiveWebElement(): void {
	if (isNative) {
		return;
	}
	const activeElement = (globalThis as { document?: Document }).document
		?.activeElement;
	(activeElement as HTMLElement | null)?.blur?.();
}

async function showDesktopConfirmDialog(
	input: ConfirmDialogInput,
): Promise<boolean | null> {
	const desktopApi = getDesktopApi();
	if (!desktopApi) {
		return null;
	}

	blurActiveWebElement();
	const options = buildDesktopAskOptions(input);
	const desktopAsk = desktopApi.dialog?.ask;

	if (typeof desktopAsk === "function") {
		return await desktopAsk(input.message, options);
	}

	return null;
}

async function showWebConfirmDialog(
	input: ConfirmDialogInput,
): Promise<boolean> {
	const webResult = await requestWebConfirm(input);
	if (webResult !== null) {
		return webResult;
	}

	const browserConfirm = (
		globalThis as { confirm?: (message?: string) => boolean }
	).confirm;
	if (typeof browserConfirm !== "function") {
		throw new Error(
			"[ConfirmDialog] No web confirmation backend is available.",
		);
	}

	blurActiveWebElement();
	const promptMessage = `${input.title}\n\n${input.message}`;
	return browserConfirm(promptMessage);
}

export async function confirmDialog(
	input: ConfirmDialogInput,
): Promise<boolean> {
	if (isNative) {
		return showNativeConfirmDialog(input);
	}

	const desktopResult = await showDesktopConfirmDialog(input);
	if (desktopResult !== null) {
		return desktopResult;
	}

	return showWebConfirmDialog(input);
}

export const __private__ = {
	blurActiveWebElement,
	buildDesktopAskOptions,
};
