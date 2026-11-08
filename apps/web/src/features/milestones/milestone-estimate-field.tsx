/**
 * Time estimate field.
 *
 * Why a text field with a parser: people think in "1h 30m", while the database
 * stores exact minutes so totals can be summed. The field shows the friendly
 * form and rejects anything it cannot read instead of guessing.
 *
 * The value is committed on blur, not on every keystroke, so typing "1h 3"
 * does not save a one hour estimate on the way to "1h 30m".
 *
 * Used by: milestone-detail-panel.tsx.
 */

import { useEffect, useRef, useState } from "react";

import { MilestoneEstimateInput } from "./milestone-estimate-input";
import {
	estimateInputValue,
	formatEstimate,
	parseEstimateInput,
} from "./schema";

export function MilestoneEstimateField({
	minutes,
	onCommit,
	readOnly = false,
}: {
	minutes: number | null;
	onCommit: (next: number | null) => void;
	readOnly?: boolean;
}) {
	const [draft, setDraft] = useState(() => estimateInputValue(minutes));
	const [error, setError] = useState<string | null>(null);
	// A remote change must not overwrite a value the user is still typing.
	const focused = useRef(false);

	// The prop only moves after a save or a broadcast, so this keeps a remote
	// estimate visible without touching keystrokes already in the field.
	useEffect(() => {
		if (focused.current) return;

		setDraft(estimateInputValue(minutes));
		setError(null);
	}, [minutes]);

	if (readOnly) {
		return (
			<span className="text-sm text-app-text">{formatEstimate(minutes)}</span>
		);
	}

	function commit() {
		const parsed = parseEstimateInput(draft);

		if (!parsed.ok) {
			setError(parsed.message);
			return;
		}

		setError(null);

		if (parsed.minutes !== minutes) {
			onCommit(parsed.minutes);
		}

		// Normalise the field to what was stored, so "1.5h" becomes "1h 30m"
		// and "1d 1h 1m 1s" becomes "1d 1h 1m".
		setDraft(estimateInputValue(parsed.minutes));
	}

	return (
		<div className="flex flex-col gap-1">
			<MilestoneEstimateInput
				value={draft}
				onChange={(next) => {
					setDraft(next);
					setError(null);
				}}
				onFocus={() => {
					focused.current = true;
				}}
				onBlur={() => {
					focused.current = false;
					commit();
				}}
				invalid={error !== null}
			/>

			{error ? (
				<p className="text-xs text-danger">{error}</p>
			) : (
				<p className="text-xs text-app-text-muted">
					{minutes === null ? "No estimate" : formatEstimate(minutes)}
				</p>
			)}
		</div>
	);
}
