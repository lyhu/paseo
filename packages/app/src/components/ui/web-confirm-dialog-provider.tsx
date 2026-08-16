import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { AdaptiveConfirmDialog } from "@/components/ui/adaptive-confirm-dialog";
import {
	setWebConfirmHandler,
	type ConfirmDialogInput,
} from "@/utils/confirm-dialog";

interface PendingConfirm extends ConfirmDialogInput {
	resolve: (result: boolean) => void;
}

interface WebConfirmDialogProviderProps {
	children: ReactNode;
}

/**
 * Renders confirm dialogs as in-app layered overlays on web (replacing the
 * native browser `confirm()`). Native and desktop platforms keep their native
 * dialog bridges and do not mount this provider.
 */
export function WebConfirmDialogProvider({
	children,
}: WebConfirmDialogProviderProps): ReactNode {
	const { t } = useTranslation();
	const [pending, setPending] = useState<PendingConfirm | null>(null);

	const handleConfirm = useCallback(() => {
		const current = pending;
		if (!current) return;
		setPending(null);
		current.resolve(true);
	}, [pending]);

	const handleClose = useCallback(() => {
		const current = pending;
		if (!current) return;
		setPending(null);
		current.resolve(false);
	}, [pending]);

	const request = useCallback(
		(input: ConfirmDialogInput): Promise<boolean> =>
			new Promise<boolean>((resolve) => {
				setPending({ ...input, resolve });
			}),
		[],
	);

	useEffect(() => {
		setWebConfirmHandler(request);
		return () => setWebConfirmHandler(null);
	}, [request]);

	const fallbackLabels = useMemo(
		() => ({
			confirm: pending?.confirmLabel ?? "Confirm",
			cancel: pending?.cancelLabel ?? t("common.actions.cancel"),
		}),
		[pending?.cancelLabel, pending?.confirmLabel, t],
	);

	return (
		<>
			{children}
			<AdaptiveConfirmDialog
				visible={Boolean(pending)}
				title={pending?.title ?? ""}
				message={pending?.message ?? ""}
				confirmLabel={fallbackLabels.confirm}
				cancelLabel={fallbackLabels.cancel}
				destructive={pending?.destructive}
				onClose={handleClose}
				onConfirm={handleConfirm}
			/>
		</>
	);
}
