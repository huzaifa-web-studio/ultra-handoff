/**
 * Unread state for one comment.
 *
 * Why this file: the comment row carries a per-thread read marker, and computing
 * it needs the cursor and the baseline. Keeping it apart from the full count
 * keeps the row mapping cheap.
 *
 * Used by: `services/comment/`.
 */

import type { TenantTx } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import { loadThreadReadCursors, loadUnreadBaseline } from "./baseline";
import { computeThreadUnread } from "./compute";
import type { CommentUnread, ReadableComment } from "./types";

/**
 * The newest unread info for one thread, used by the focused thread endpoint.
 *
 * The caller already loaded the thread rows in canonical order, so this is a
 * pure calculation followed by one cursor lookup.
 */
export async function threadUnreadState(
	tx: TenantTx,
	tenant: TenantContext,
	projectId: string,
	rootId: string,
	comments: readonly ReadableComment[],
): Promise<CommentUnread> {
	const cursor = (await loadThreadReadCursors(tx, tenant, [rootId])).get(
		rootId,
	);

	return computeThreadUnread({
		comments,
		viewerId: tenant.userId,
		baselineAt: await loadUnreadBaseline(tx, tenant, projectId),
		cursorId: cursor?.lastReadCommentId ?? null,
	});
}
