import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
	AdaptiveModalSheet,
	type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";

export interface AdaptiveConfirmDialogProps {
	visible: boolean;
	title: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	destructive?: boolean;
	onClose(): void;
	onConfirm(): Promise<void> | void;
	testID?: string;
}

/**
 * In-app layered confirmation dialog (not the native/web browser confirm()).
 * Renders through AdaptiveModalSheet so web/desktop/mobile all get a styled
 * in-app surface.
 */
export function AdaptiveConfirmDialog({
	visible,
	title,
	message,
	confirmLabel,
	cancelLabel,
	destructive = false,
	onClose,
	onConfirm,
	testID,
}: AdaptiveConfirmDialogProps) {
	const { t } = useTranslation();
	const confirm = useMemo(() => confirmLabel ?? "Confirm", [confirmLabel]);
	const cancel = useMemo(
		() => cancelLabel ?? t("common.actions.cancel"),
		[cancelLabel, t],
	);
	const sheetHeader = useMemo<SheetHeader>(() => ({ title }), [title]);
	const handleConfirm = useCallback(() => {
		void onConfirm();
	}, [onConfirm]);

	return (
		<AdaptiveModalSheet
			visible={visible}
			onClose={onClose}
			header={sheetHeader}
			snapPoints={["30%", "50%"]}
			desktopMaxWidth={420}
			testID={testID}
			scrollable={false}
		>
			<View style={styles.body}>
				<Text style={styles.message}>{message}</Text>
				<View style={styles.actions}>
					<Button
						variant="secondary"
						size="sm"
						style={styles.actionButton}
						onPress={onClose}
						testID={testID ? `${testID}-cancel` : undefined}
					>
						{cancel}
					</Button>
					<Button
						variant={destructive ? "destructive" : "default"}
						size="sm"
						style={styles.actionButton}
						onPress={handleConfirm}
						testID={testID ? `${testID}-confirm` : undefined}
					>
						{confirm}
					</Button>
				</View>
			</View>
		</AdaptiveModalSheet>
	);
}

const styles = StyleSheet.create((theme) => ({
	body: {
		gap: theme.spacing[4],
		paddingBottom: theme.spacing[2],
	},
	message: {
		color: theme.colors.foreground,
		fontSize: theme.fontSize.base,
		lineHeight: Math.round(theme.fontSize.base * 1.45),
	},
	actions: {
		flexDirection: "row",
		alignItems: "center",
		gap: theme.spacing[2],
	},
	actionButton: {
		flex: 1,
	},
}));
