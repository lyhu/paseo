import type { TunnelAccessMode } from "./tunnel-form-types";

export interface AccessTokenFormSnapshot {
	entryId: string;
	entryName: string;
	accessMode: TunnelAccessMode;
}

export interface AccessTokenFormState {
	entryId: string;
	entryName: string;
	accessMode: TunnelAccessMode;
	accessToken: string;
	canSubmit: boolean;
	submitError: string | null;
}

export interface AccessTokenFormModel {
	getState(): AccessTokenFormState;
	subscribe(listener: () => void): () => void;
	close(): void;
	setAccessMode(value: TunnelAccessMode): void;
	setAccessToken(value: string): void;
	setSubmitError(value: string | null): void;
}

export function openAccessTokenForm(
	snapshot: AccessTokenFormSnapshot,
): AccessTokenFormModel {
	const listeners = new Set<() => void>();
	let closed = false;
	let state: AccessTokenFormState = deriveState({
		entryId: snapshot.entryId,
		entryName: snapshot.entryName,
		accessMode: snapshot.accessMode,
		accessToken: "",
		canSubmit: false,
		submitError: null,
	});

	function deriveState(nextState: AccessTokenFormState): AccessTokenFormState {
		return {
			...nextState,
			canSubmit:
				nextState.accessMode === "none" ||
				nextState.accessToken.trim().length >= 8,
		};
	}

	function publish(nextState: AccessTokenFormState): void {
		if (closed) return;
		state = deriveState(nextState);
		for (const listener of listeners) listener();
	}

	return {
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		close() {
			closed = true;
			listeners.clear();
		},
		setAccessMode(value) {
			publish({ ...state, accessMode: value, submitError: null });
		},
		setAccessToken(value) {
			publish({ ...state, accessToken: value, submitError: null });
		},
		setSubmitError(value) {
			publish({ ...state, submitError: value });
		},
	};
}
