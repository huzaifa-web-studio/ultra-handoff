# Notifications Fix Plan

**Created:** 23 Nov 2026
**Source report:** `qa/notifications-system-test-report.md`
**Branch to use:** `feature/notifications` (or `fix/notifications-<batch>` cut from it)
**Scope:** every finding in the report, including the informational ones. Nothing is deferred.

This file is written for the next agent. It states the preferred solution for each item, not a workaround. Follow the decisions in section 1 without reopening them. Update the status board and the session log at the end of every session.

**Prompt to hand to the agent:**

> Read `qa/notifications-fix-plan.md` and `qa/notifications-system-test-report.md`. Implement **batch 1 only** on a branch cut from `feature/notifications`. Follow the decisions in section 1 exactly. Run the verify commands for the batch, update the status board and the session log, and stop at the batch boundary. Do not touch batches 2 and 3 in the same session.

---

## 1. Decisions already made

These were chosen after review. Do not swap them for a shortcut.

| ID | Decision | Why |
|---|---|---|
| D1 | Comment deletion cleanup runs through a `SECURITY DEFINER` database function. | The acting author cannot read other recipients under RLS, so a recipient-scoped delete cannot work for a comment that fanned out to many people. A definer function is the correct database-level solution, not a bypass. |
| D2 | Mention removal by edit uses a recipient-scoped delete helper that switches `app.current_user_id`, the same way the insert already does. | The removed recipients are known, so no database function is needed, and the read boundary stays recipient-only. |
| D3 | When a "due today" reminder is created, the unread "due tomorrow" row for the same recipient, milestone and due date is deleted. | One live reminder per due date. A read tomorrow row stays as history. |
| D4 | The notification cursor becomes self-contained: it carries the position (timestamp text plus id), not a reference to a row. | A deleted row no longer breaks pagination, and validating the shape solves F5 at the same time. |
| D5 | The 500-recipient fan-out cap stays, but truncation is logged with the tenant and the counts. | The cap is a safety net for a malformed call, not normal behaviour. Silent loss is the defect, not the cap. |
| D6 | Mark-all-read only updates rows the list would show. | Read history must match what the person could see. |
| D7 | The push payload carries the workspace slug, and the service worker suppresses an alert only when a window is on that workspace. | A visible window in another workspace is not proof the alert was shown. |
| D8 | A comment deep link opens the focused thread with a placeholder label that is refreshed when the thread loads. | The thread is fetched by id, so the label does not need to exist before the fetch. This mirrors the scope tab behaviour. |
| D9 | The timezone write is typed. If the Better Auth client type cannot express it, put one narrow cast in a wrapper, never `as never` on the call site. | `as never` erases the contract and hides a silent failure that breaks reminders. |
| D10 | The shared database clients are closed once for the whole test process, not inside each integration file. | A second integration file currently fails with `CONNECTION_ENDED`. This is test infrastructure, not a product fix. |

---

## 2. Status board

Tick tasks as they land. One batch per branch and commit series.

| Batch | Theme | Tasks | Status | Depends on |
|---|---|---|---|---|
| 1 | Data correctness and lifecycle | 1 to 7 | Not started | none |
| 2 | Deep links and push delivery | 8 to 10 | Not started | Batch 1 (helper from task 1) |
| 3 | Hardening and performance | 11 to 17 | Not started | none |

Task IDs map to the report as follows: task 1 to 3 are F1, task 4 is F9, task 5 is F10a, task 6 is F10b, task 7 is F10c, task 8 is F2, task 9 is F3, task 10 is F7, task 11 is F4 plus F5, task 12 is F6, task 13 is F8, task 14 is F15, task 15 is F10d, task 16 is F10e, task 17 is D10.

---

## 3. Preconditions and global verify

- Dev stack running (`docker ps`: web, api, postgres, redis, mailpit, seaweedfs).
- `app_test` exists, or run `cd apps/api && bun run test:db -- --drop` once to create and drop it.
- Read `qa/notifications-system-test-report.md` first. It has the browser evidence and the reproduction steps.

Global verify after every batch:

```bash
cd apps/api && bun test
cd apps/web && bun test
cd apps/api && bunx tsc --noEmit -p tsconfig.json
cd apps/web && bunx tsc --noEmit -p tsconfig.json
cd packages/ui && bunx tsc --noEmit -p tsconfig.json
bunx biome check apps/api/src apps/web/src packages/ui/src
```

Integration suite (only when the batch touches services or the schema):

```bash
cd apps/api
TEST_DATABASE=1 \
DATABASE_URL=postgres://app:app@localhost:5432/app_test \
DATABASE_APP_URL=postgres://app_tenant:tenant@localhost:5432/app_test \
bun test
```

**Warning:** do not set `NODE_ENV=development` for the full suite. It flips `isDevelopment`, and `src/middleware/security-headers.test.ts` then fails because the production CSP branch is skipped. The project's `bun run test:db` also omits it.

**Migration rules:** never edit `apps/api/drizzle/` by hand. Change `src/db/schema.ts` or `src/db/rls.ts`, then `cd apps/api && bun run db:generate`. Database functions that Drizzle cannot model go in `apps/api/scripts/bootstrap-db.ts`, which already owns roles, extensions and grants, and is idempotent.

---

## 4. Batch 1: data correctness and lifecycle

Branch: `fix/notifications-lifecycle`

### Task 1: recipient-scoped delete helper (F1, mention removal)

**Symptom:** editing a comment to remove a mention leaves an unread "New mention" row in the recipient's bell forever, until they read that thread. The report has the reproduction and a browser screenshot.

**Preferred solution:** add a helper next to `createNotifications` that mirrors its recipient switching.

File: `apps/api/src/services/notification.service.ts`

```ts
/**
 * Delete rows the actor caused for another person.
 *
 * Why recipient scope: the DELETE policy reads the row, and only the recipient
 * can see it. The actor caused the row, so the recipient is known and the
 * transaction can be scoped to them for this statement, exactly like the insert.
 */
export async function deleteNotificationsForRecipient(
  tx: TenantTx,
  tenant: NotificationTenant,
  recipientUserId: string,
  dedupeKeys: string[],
): Promise<number>
```

Implementation:
1. Read the current `app.current_user_id`.
2. `set_config('app.current_user_id', recipientUserId, true)`.
3. Delete `where organization_id = tenant.organizationId and recipient_user_id = recipientUserId and dedupe_key in keys`.
4. Restore the original user in a `finally`, with `.catch(() => undefined)` like `createNotifications`, so a failed delete cannot mask the real error.
5. Return the count.

File: `apps/api/src/services/comment.service.ts`, `updateMilestoneComment`, the block at around line 874.

Replace the direct `tx.delete(notification)` with a call to the helper for each removed mention, then remove the now-wrong comment about the actor delete policy.

Acceptance:
- After an edit removes a mention, `GET /orgs/:slug/notifications` for the recipient no longer returns that mention row and the unread count drops.
- A mention that is still present is not deleted.
- A row for another recipient is not touched.

Tests:
- Integration: create a mention, edit it away, assert the recipient has 0 rows and the other participant keeps theirs.
- Integration: edit that keeps the mention, assert the row survives.
- The existing `test.failing` for this defect in the `/tmp` suite must flip to a normal passing test.

### Task 2: comment deletion function (F1, comment deletion)

**Symptom:** `deleteMilestoneComment` attempts the same cross-user delete and affects zero rows. The read filter hides the rows, so it is invisible today, but the cleanup is dead code and rows accumulate.

**Preferred solution:** a `SECURITY DEFINER` function that deletes every notification for one comment inside the current workspace.

File: `apps/api/scripts/bootstrap-db.ts` (idempotent, runs before and after migrations)

```sql
create or replace function public.delete_comment_notifications(p_comment_id text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted integer;
begin
  delete from public.notification
  where comment_id = p_comment_id
    and organization_id = current_setting('app.current_org_id', true);
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke all on function public.delete_comment_notifications(text) from public;
grant execute on function public.delete_comment_notifications(text) to app_tenant;
```

Notes:
- The function takes no organization parameter. It reads the transaction setting, so a caller cannot delete another workspace's rows.
- `set search_path = public, pg_temp` is required on a definer function.
- The `revoke all ... from public` before the grant matters.
- Guard creation exactly like the existing grants in the same script: only create the function when the `notification` table already exists (`pg_tables` check). A fresh database runs bootstrap before migrations, and `db:setup` runs it again after migrations, so the second pass creates it. Do not let a fresh `db:setup` fail here.

File: `apps/api/src/services/notification.service.ts`

```ts
/** Delete every notification that points at one comment. */
export async function deleteCommentNotifications(
  tx: TenantTx,
  commentId: string,
): Promise<number> {
  const rows = await tx.execute<{ count: number }>(
    sql`select public.delete_comment_notifications(${commentId}) as count`,
  );
  return rows[0]?.count ?? 0;
}
```

File: `apps/api/src/services/comment.service.ts`, `deleteMilestoneComment`, around line 1152. Replace the direct delete with `await deleteCommentNotifications(tx, commentId)`.

Acceptance:
- Deleting a comment removes every notification whose `comment_id` is that comment, across recipients.
- Calling it from workspace A for a comment in workspace B deletes nothing.

Tests:
- Integration: two recipients get mention and reply rows, the author deletes the comment, both recipients have 0 rows for it.
- Integration: a notification for a different comment survives.
- `verify-rls` still passes.

### Task 3: remove the dead actor-delete policy (F1)

**Preferred solution:** the policy was written to let an actor delete without reading. Postgres does not work that way, and tasks 1 and 2 make it unnecessary. Remove it from `notificationPolicies` in `apps/api/src/db/rls.ts` and generate the migration.

Also correct the comment block above the policies. It currently claims the author "cannot read the row, only remove it". Replace it with the actual rule: writes are workspace scoped, reads and deletes are recipient scoped, and a cross-recipient cleanup goes through the function or the recipient-scoped helper.

Acceptance:
- `notification` has exactly four policies: select, insert, update, delete, all as declared in `rls.ts`.
- `bun run db:generate` produces a migration with `DROP POLICY "notification_actor_delete"`, and `db:migrate` applies it to `app_test`.
- `bun run db:verify-rls` passes 37 of 37.

### Task 4: scope mention cleanup and stable key (F9)

**Symptom:** removing a mention from a scope section deletes nothing, and the dedupe key includes `updated.updatedAt`, so every re-add creates another row.

**Preferred solution:**
1. Change the dedupe key to `mention:scope:${entryId}:${recipientUserId}`, without the timestamp.
2. In `updateMilestoneScopeEntry` (`apps/api/src/services/milestone-scope.service.ts`), compute `removedMentionIds` the same way `addedMentionIds` is computed.
3. For each removed mention, call `deleteNotificationsForRecipient` with that stable key.
4. Keep the existing add path, which will now be idempotent thanks to the unique index.

Acceptance:
- Add a mention, save, remove it, save: the recipient has no row.
- Add the same mention twice across two edits: one row, not two.
- Removing a mention does not remove a row for another person.

Tests:
- Integration: the three cases above.

### Task 5: one live due-soon reminder (F10a)

**Symptom:** a milestone that is due tomorrow produces a "due tomorrow" row, and the next day produces a "due today" row. Both stay unread, so the bell shows two reminders for the same date.

**Preferred solution:** when the sweep creates the `phase: "today"` candidate, delete the unread `phase: "tomorrow"` row for the same recipient, milestone and due date.

File: `apps/api/src/services/reminder.service.ts`, in `runReminderSweepForOrganization` where the `milestone_due_soon` candidate is pushed with `difference === 0`.

Extend `deleteNotificationsForRecipient` with `options?: { onlyUnread?: boolean }` and add `and read_at is null` when it is set. In the sweep, after the today candidate is inserted, call the helper for the same recipient with the key `due_soon:${item.id}:${recipientUserId}:${item.dueDate}:tomorrow` and `{ onlyUnread: true }`. Insert the today row first, so a crash between the two leaves the old row rather than no reminder.

Acceptance:
- Due tomorrow: one row with phase tomorrow.
- Next day, first sweep: phase today exists, the unread tomorrow row is gone. If the tomorrow row had been read, it stays.
- A repeat sweep creates nothing new.

Tests:
- Integration with fixed clocks: seed due tomorrow, sweep, sweep next day, assert exactly one unread due_soon row and its phase is today.
- Integration: mark the tomorrow row read, sweep next day, assert both rows remain.

### Task 6: log fan-out truncation (F10b)

**Preferred solution:** keep `MAX_CANDIDATES`, but when the accepted list is truncated, log the tenant, the accepted count and the dropped count using the existing non-production `console.error` pattern used by workers. Add a comment that the organization seat limit should keep this unreachable.

File: `apps/api/src/services/notification.service.ts`.

Acceptance:
- No behavioural change below the cap.
- A test with 501 candidates confirms 500 rows and that the cap path does not throw. Assert the log only if the codebase has a testable logger; otherwise assert the counts and leave the log to review.

### Task 7: read-all only marks visible rows (F10c)

**Symptom:** read-all marks rows the reader cannot see, such as an archived project's row, so read history includes things they never saw.

**Preferred solution:** reuse the list predicate. In `markAllNotificationsRead` (`apps/api/src/services/notification-query.service.ts`):

1. Select the ids that satisfy `notificationScope`, `read_at is null` and the cutoff, using the same joins as the list.
2. Update those ids in chunks of 500 with `inArray`.
3. Return the update count and the new unread count.

This costs one extra read on a user action, which is acceptable and keeps one source of truth for visibility.

Acceptance:
- A hidden row (archived project, plain member) is not marked read by read-all.
- A visible row before the cutoff is marked read; one after the cutoff is not.
- A user with 2,000 unread rows completes read-all without a parameter limit error.

Tests:
- Integration: hidden and visible rows, cutoff precision, and a large batch.

### Batch 1 verify

```bash
cd apps/api && bun run db:generate
bun run db:migrate
bun run db:verify-rls
bun test
```

Then the integration suite and the global verify from section 3. Update the status board.

---

## 5. Batch 2: deep links and push delivery

Branch: `fix/notifications-links`

### Task 8: comment deep link opens the thread (F2)

**Symptom:** clicking a comment notification selects the Comments tab and renders an empty panel. The screenshot `qa/evidence/notifications/03-empty-comments-panel.png` shows it.

**Preferred solution, part A:** mount the panel for a comment tab key.

File: `apps/web/src/features/milestones/milestone-detail-panel.tsx`, `commentsOpened` initialiser around line 477.

```ts
const [commentsOpened, setCommentsOpened] = useState(
  selectedTab === "comments" || isCommentTabKey(selectedTab),
);
```

**Preferred solution, part B:** focus the deep-linked thread.

1. Add `commentTabId(key)` to `apps/web/src/features/milestones/tabs.ts`, mirroring `scopeTabId`, using the same `TAB_ID_PATTERN`.
2. In the panel, derive `requestedCommentTabId` from `selectedTab`.
3. Build a `requestedCommentTab` entry when the id is not in `openCommentTabs`: `{ id, label: "Thread", title: "" }`.
4. Add it to `openCommentTabs` in an effect once, the same way `requestedScopeTab` is added to `openScopeTabs`, and include it in `openTabKeys` for the first paint.
5. Extend `effectiveSelectedTab` so a requested comment tab counts as open, like `openDeepLinkedScope`.
6. Add an optional `onLoaded?: (comment: Comment) => void` prop to `CommentThreadTab`. Call it when the thread query resolves. The panel updates the stored tab with `toOpenCommentTab(comment)` so the label becomes the author name. Do not write local storage on every render.

**Files:** `milestone-detail-panel.tsx`, `tabs.ts`, `comment-thread-tab.tsx`, `tabs-storage.ts` (no shape change needed).

**Acceptance:**
- From the bell, a `comment:<id>` link lands on the milestone with a focused thread tab selected, the thread visible, and the tab label updated to the author name within one fetch.
- On a fresh browser profile with no localStorage, the same works.
- The plain `milestoneTab=comments` link still shows the list.
- A reply notification focuses the root thread, not the reply.
- A deleted thread shows the existing "This discussion was deleted" panel, not a blank one.

**Tests:** unit test `commentTabId` and the resolve behaviour in `tabs.test.ts`. Browser re-test with the steps in section 8.

### Task 9: open alerts from another workspace (F3)

**Symptom:** a click from an OS or push alert for workspace B while workspace A is active redirects to A's dashboard and leaves the row unread. The report has the exact redirect evidence.

**Preferred solution:** handle the notification link before the workspace redirect discards it.

Design:

1. Add a small hook, `useNotificationLink`, used by `apps/web/src/routes/_app.tsx`, that reads `notification` from the URL search and the workspace slug from the matched params (the existing `findUrlOrgSlug` helper).
2. If the URL slug equals the active slug, do nothing. The provider already marks the row read.
3. If the URL slug differs:
   - resolve the target organization from `authClient.useListOrganizations()` by slug,
   - if it is not in the list, fall back to the current behaviour (redirect to the active workspace),
   - otherwise call `useSwitchOrganization` with the target id, slug and name. This honours the switch guard and the cross-tab broadcast,
   - on `status: "switched"`, navigate to the original full href (path plus search minus the `notification` parameter) with `replace: true`, then mark that notification read with the target slug,
   - while the switch is in flight, return `switching: true` so the `_app` render guard does not redirect to the old workspace.
4. The provider's existing click handler should stop marking read when the URL slug differs. Move the mark-read into the hook so there is one owner.

`_app.tsx` changes:
- call the hook,
- treat `switching` like `waitingForWorkspace` in the `if (missingScope || redirectingWorkspace || waitingForWorkspace)` guard,
- skip the `redirectingWorkspace` navigation while a notification switch is in flight.

**Files:** `apps/web/src/routes/_app.tsx`, a new `apps/web/src/features/notifications/link.ts`, `apps/web/src/features/notifications/realtime.tsx`.

**Acceptance:**
- Same workspace: unchanged, row marked read, deep link works.
- Other workspace where the user is a member: the active organization switches, the deep link opens, the row is marked read.
- Workspace the user does not belong to: no switch, fall back to the active workspace, no error.
- A blocked switch (guard) opens the blocked dialog and does not navigate.
- Single-workspace users are unaffected.

**Tests:** unit test the slug parser and the "same / other / unknown" decision as pure functions. Browser re-test with two workspaces.

### Task 10: per-workspace push suppression (F7)

**Symptom:** a visible app window suppresses the OS alert even when it is showing a different workspace, so the alert is lost.

**Preferred solution:**
1. Add `organizationSlug` to `PushPayload` in `apps/api/src/services/push.service.ts`.
2. Set it in `dispatchNotificationDeliveries` from `delivery.organizationSlug` (`apps/api/src/services/notification-dispatch.service.ts`).
3. In `apps/web/public/sw.js`, replace `clients.some(client => client.visibilityState === "visible")` with a check that only suppresses when a visible client's URL contains the payload's workspace slug. Parse the first path segment of `client.url` and compare.
4. Keep the notification data `href` and `tag` as they are.

**Files:** `push.service.ts`, `notification-dispatch.service.ts`, `apps/web/public/sw.js`.

**Acceptance:**
- A push for workspace B is not suppressed by a visible window on workspace A.
- A push for the active workspace is still suppressed when that window is visible.
- An older payload without the slug is suppressed by any visible window, to stay backward compatible.
- Queue jobs and push payload types stay in sync (Eden types).

**Tests:** extract the decision into `apps/web/public/push-policy.js`, written as a classic script that assigns to the global object:

```js
(function (root) {
  function shouldSuppressPush(clients, slug) { /* pure */ }
  root.HandoffPushPolicy = { shouldSuppressPush };
})(typeof self !== "undefined" ? self : globalThis);
```

Load it in `sw.js` with `importScripts("/push-policy.js")`. In a Bun test, import the file by absolute path, which executes it and sets `globalThis.HandoffPushPolicy`, then call the pure function with a list of `{ url, visibilityState }` objects.

### Batch 2 verify

Global verify, plus a browser run of the three cases.

---

## 6. Batch 3: hardening and performance

Branch: `fix/notifications-hardening`

### Task 11: self-contained cursor (F4 and F5)

**Symptoms:**
- A cursor whose row was deleted returns an empty page and ends the list.
- A decodable garbage cursor returns 200 and an empty page instead of 400.

**Preferred solution:** change the cursor payload to a validated position.

File: `apps/api/src/services/notification-query.service.ts`.

```
cursor = base64url(JSON.stringify({ t: "2026-11-23T07:23:33.123456", i: "<id>" }))
```

- `t` is the `created_at` value read as text from Postgres, which keeps microseconds.
- `i` is the id, used as the tiebreaker.
- Decode with `Buffer.from(value, "base64url").toString("utf8")`, then `JSON.parse`, then validate:
  - object, `t` and `i` strings,
  - `t` matches a strict timestamp pattern,
  - `i` matches the id shape used by the table (UUID for notifications),
  - reject anything else with `BAD_REQUEST`.
- Compare `(${notification.createdAt}, ${notification.id}) < (${t}::timestamp, ${i})`. No subquery, no dependency on the row still existing.

The cursor is not a security boundary because the query still filters by recipient and organization. A forged valid cursor only changes where the user starts reading their own list.

**Acceptance:**
- Deleting the row a cursor points at does not break the next page.
- A garbage cursor, a truncated cursor, a wrong JSON shape and a non timestamp `t` each return 400 with the existing message.
- Pagination is stable for rows with identical timestamps.

**Tests:** unit test encode, decode and every rejection case. Integration test the deleted-cursor page.

### Task 12: mark-read partial success (F6)

**Preferred solution:**
1. Server (`apps/api/src/services/comment-read.service.ts`, `markCommentsRead`): drop the "one of those messages is no longer in this discussion" failure. Mark the ids that still exist and ignore the rest. If none exist, return the current state without an error.
2. Client (`apps/web/src/features/milestones/comments/comment-tab.tsx`, `markSeen`): on mutation error, remove the ids from `markedRef` so a later render retries. The `onError` callback of the mutation needs the ids, so pass them via the mutation variables or a closure.

**Acceptance:**
- Sending one valid and one deleted id marks the valid one and returns 200.
- A failed request leaves the ids eligible for retry.

**Tests:** integration for the mixed id case; unit test the `markedRef` rollback is not pure, so cover it with the browser or a component test if one exists.

### Task 13: unread count without per-row probes (F8)

**Symptom:** the count joins `milestone` and `comment` for every unread row. The plan in the report shows `Seq Scan on milestone loops=20000` and `Seq Scan on comment loops=20000`, at 105 ms for 20,000 unread.

**Preferred solution:** keep one query, but split the aggregate by row class so the common rows never touch the two rare tables.

```sql
with base as (
  select n.id, n.type, n.comment_id, n.milestone_id, n.data
  from notification n
  where n.organization_id = $org
    and n.recipient_user_id = $user
    and n.read_at is null
    and (n.project_id is null or <project visibility>)
)
select
  (select count(*) from base b
   where b.comment_id is null
     and b.type not in ('milestone_due_soon', 'milestone_overdue'))
  +
  (select count(*) from base b
   where b.comment_id is not null
     and not exists (
       select 1 from comment c where c.id = b.comment_id and c.deleted_at is not null
     ))
  +
  (select count(*) from base b
   where b.type in ('milestone_due_soon', 'milestone_overdue')
     and exists (
       select 1 from milestone m
       where m.id = b.milestone_id
         and m.due_date::text is not distinct from (b.data ->> 'dueDate')
         and (m.status not in ('done', 'cancelled') or b.read_at is not null)
     )) as unread
```

Notes:
- The first subquery is the bulk path and is served by the unread partial index.
- The other two only run over the rare subsets.
- Reuse the existing `projectVisibility` expression. Keep one source of truth for the scope predicate; export `notificationScope` or a helper from the same module rather than duplicating the SQL.
- The per-project grouped query in `getNotificationSummary` should use the same base filter so the total equals the list. Extract a shared `countUnreadExpression` or run the same three-way split grouped by project.

Index change (`apps/api/src/db/schema.ts`, then `db:generate`):

Replace `notification_recipient_unread_idx` with:

```ts
index("notification_recipient_unread_idx")
  .on(table.recipientUserId, table.organizationId, table.createdAt, table.id)
  .where(sql`${table.readAt} is null`)
```

Keep `notification_recipient_created_idx` for the full list and the keyset.

**Acceptance:**
- The count equals the current implementation on a seeded fixture that mixes plain, comment and reminder rows, including a soft-deleted comment and a stale reminder.
- `EXPLAIN (ANALYZE)` at 20,000 unread shows no `loops=20000` scans of `milestone` or `comment`.
- Wall time at 2,700 unread is meaningfully below the current 69 to 108 ms, and at 20,000 below 105 ms.
- `getNotificationSummary` total equals `listNotifications` unread for the same fixture.

**Tests:** integration fixtures for each row class and a performance script (reuse `/tmp/opencode/notif-qa/perf-check.ts` and `perf-plan.ts`).

### Task 14: form field ids (F15)

**Preferred solution:** reproduce the console warning on the invite members dialog and the project members page (`A form field element should have an id or name attribute`), then give every flagged control an `id` and a `name`. React Aria `TextField`, `TextArea` and `SearchField` accept both. Prefer a stable id derived from the field name, and keep the accessible label association intact.

**Acceptance:** the warning count is 0 on both pages, and autofill can identify the fields.

### Task 15: cache patch on mark read (F10d)

**Preferred solution:** in `useMarkNotificationRead` (`apps/web/src/features/notifications/hooks.ts`), stop invalidating the list. Patch every cached page for both filters to set `readAt` on the matching id, then keep the summary patch. If the row is filtered out of the unread view, the existing `useNotifications` stale time will drop it on the next refetch; optionally remove it from the unread pages for immediate consistency.

**Acceptance:** clicking three bell rows causes zero list refetches in the network panel, and the unread dot and badge update immediately.

### Task 16: typed timezone write (F10e)

**Preferred solution:** first try `authClient.updateUser({ timezone })` without a cast. If the client type rejects it, add a single narrow wrapper in `apps/web/src/features/notifications` or `features/auth`:

```ts
async function reportTimezone(timezone: string): Promise<void> {
  // One cast at the library boundary because Better Auth's client type does not
  // include the additional fields declared on the server.
  await authClient.updateUser({ timezone } as Parameters<typeof authClient.updateUser>[0]);
}
```

Never `as never`. Keep the failure non-blocking, but do not swallow silently in development: log through the existing dev-only console pattern if one exists.

**Acceptance:** typecheck passes without `as never`; the server stores the zone (covered by the HTTP check in the report); reminders still read it.

### Task 17: shared test client lifecycle (D10)

**Preferred solution:** stop ending the shared clients inside individual integration files. Move the close into one place for the whole test process.

Options, in preference order:
1. If Bun supports a global teardown for the suite, use it (`--preload` with an `afterAll` registered once).
2. Otherwise, remove `closeTenantDb()`, `closeRedis()` and `adminClient.end()` from `tenant-boundary.integration.test.ts` and rely on `bun test` exiting after the run. Verify the process exits and the database is clean.

Then add the notification integration suite from `/tmp/opencode/notif-qa/notifications.integration.test.ts` to `apps/api/src/services/notification.integration.test.ts`, converting absolute imports to relative ones.

**Acceptance:** the full suite with `TEST_DATABASE=1` runs both integration files in one process, 0 fail, and exits without hanging.

---

## 7. Tests to add, by task

| Task | Unit | Integration | Browser |
|---|---|---|---|
| 1 | dedupe key builder | mention removal, kept mention, other recipient | re-check F1 with two accounts |
| 2 | none | comment deletion across recipients, other comment survives | row disappears after delete |
| 3 | none | verify-rls 37 of 37 | none |
| 4 | none | add, remove, re-add mention on scope | none |
| 5 | none | tomorrow then today, read tomorrow kept | none |
| 6 | none | 501 candidates yields 500 | none |
| 7 | none | hidden row untouched, cutoff, 2,000 rows | read-all on a large list |
| 8 | `commentTabId`, resolve | none | fresh profile deep link, reply link, deleted thread |
| 9 | slug and decision helper | none | same, other and unknown workspace |
| 10 | suppression policy | none | two tabs on two workspaces with a mocked push |
| 11 | encode, decode, all rejections | deleted cursor page | none |
| 12 | none | mixed ids | failed mark-read retries |
| 13 | none | count equals list for mixed fixtures | none |
| 14 | none | none | warning count 0 |
| 15 | none | none | zero refetch on click |
| 16 | none | timezone HTTP check | card shows the zone |
| 17 | none | both integration files in one run | none |

Extend `apps/api/src/lib/notification-copy.test.ts` for pure logic. Re-create the integration suite in `/tmp` if it is gone.

---

## 8. Browser re-test script

Use the QA owner account and a second person. The exact setup used in the report is in sections 2 and 10 of `qa/notifications-system-test-report.md`.

1. Open two workspaces. Active is A.
2. As B, mention the owner in workspace B.
3. In the owner's bell, click the row. Expect: the active workspace switches to B, the milestone opens with the focused thread, the row is read.
4. Same workspace mention. Expect: the focused thread opens, no switch.
5. Workspace the owner is not in. Expect: no switch, fall back to the active workspace, no error.
6. Notification when the second person removes the mention by edit. Expect: no row in the bell.
7. Comment deletion. Expect: the row disappears.
8. Scope mention add and remove. Expect: one row, then zero.
9. A large inbox (seed 2,000 unread). Expect: read-all completes, the badge is 0, hidden rows stay unread.
10. Mark-read clicks: no list refetch in the network panel.
11. Delete the row a cursor points at, then load more. Expect: the next page loads.
12. Due-tomorrow reminder, then a sweep for the next day. Expect: one reminder row.

Capture screenshots into `qa/evidence/notifications/` with the next number in the sequence.

---

## 9. Definition of done

- [ ] Every task in section 2 is ticked.
- [ ] `bun run db:generate` produced the expected migrations and `db:migrate` applied them to `app_test`.
- [ ] `bun run db:verify-rls` passes.
- [ ] Full suite green, including both integration files in one process.
- [ ] Typecheck clean for api, web and ui.
- [ ] Biome clean on the touched paths.
- [ ] Browser re-test from section 8 passed, with screenshots.
- [ ] `qa/notifications-system-test-report.md` updated with a "retest" section, or a new `qa/notifications-retest-report.md` added.
- [ ] Status board and session log updated in the same commit.

---

## 10. Session log

Append one entry per session. Do not rewrite history.

```
### 23 Nov 2026, batch 1, tasks 1 to 3
Done:
Not done:
Blocked:
Notes:
```
