/**
 * Milestone scope shapes.
 *
 * Why this file: every scope module and the milestone payload name the same
 * section summary and update result, so they live together.
 *
 * Used by: the scope modules and `services/milestone/`.
 */

import type { milestoneScopeEntry } from "../../../db/schema";
import type { NotificationDelivery } from "../../notification.service";

/** The three kinds of scope addition. */
export type MilestoneScopeKind = "change" | "test" | "review";

/** The fields every summary needs, without the rich text body. */
export type ScopeEntrySource = {
	id: string;
	kind: string;
	round: number | null;
	title: string;
	changeRequestId: string | null;
	statusPeriodId: string | null;
	createdBy: string | null;
	updatedBy: string | null;
	createdAt: Date;
	updatedAt: Date;
};

/** One section without its rich text body. */
export type MilestoneScopeEntrySummary = {
	id: string;
	kind: MilestoneScopeKind;
	/** Test and review only. Null for an accepted change. */
	round: number | null;
	title: string;
	/** True when the body is more than an empty document. */
	hasBody: boolean;
	changeRequestId: string | null;
	statusPeriodId: string | null;
	createdBy: string | null;
	createdByName: string | null;
	updatedBy: string | null;
	updatedByName: string | null;
	createdAt: string;
	updatedAt: string;
};

/** One section with its full editor document. */
export type MilestoneScopeEntry = MilestoneScopeEntrySummary & {
	body: unknown[];
};

/** A database row, before it is mapped to the wire shape. */
export type MilestoneScopeEntryRecord = typeof milestoneScopeEntry.$inferSelect;

/** One scope update plus the notifications it produced. */
export type MilestoneScopeUpdateResult = MilestoneScopeEntry & {
	notifications: NotificationDelivery[];
};

/** Public update input for one section. */
export type UpdateMilestoneScopeEntryInput = {
	title?: string;
	body?: unknown;
};
