# Notification System QA Report

**Date:** 23 Nov 2026
**Branch:** `feature/notifications`
**Commit under test:** `560673d` (added notifications system)
**Feature scope:** notification bell and page, notification writers, unread state, comment read cursors, milestone reminders, Web Push, personal realtime stream, timezone handling.
**Fix plan:** `qa/notifications-fix-plan.md` (all findings, preferred solutions, batches).

---

## 1. Verdict

The feature is functionally solid and the security boundary holds. Every read path is recipient scoped, RLS matches the service rules, and the realtime stream cannot leak one person's notification to another person or to a project socket.

Two **high severity** defects were found. First, a Row Level Security policy that the code relies on for cleanup does not work, so a mention removed by editing a comment leaves a stale unread bell entry. Second, clicking a comment notification opens the milestone with an **empty Comments panel**: the tab looks selected, but no comment renders, and the specific thread is never focused. One **medium** defect discards an alert that belongs to a non-active workspace. The rest are low severity or performance notes.

No data loss, no cross-recipient leak, and no authorization bypass were found.

---

## 2. Environment and method

| Item | Value |
|---|---|
| Runtime | Bun 1.4.5 |
| Database | PostgreSQL 18.6 (`app` superuser and `app_tenant` RLS role) |
| API | `http://localhost:3001` (dev compose stack, live) |
| Mail | Mailpit at `http://localhost:8025` (real verification and invitation mail) |
| Browser | Chrome DevTools MCP against the live dev stack, signed in as a real QA owner |
| Test database | `app_test`, created by `bun run test:db` |
| Dev data | Read only, except the fixtures created by the E2E scripts, which were removed afterwards |

Four passes, as requested:

1. **Code review** of every new file and migration, plus the modified services, routes and web surfaces.
2. **Automated tests**, written and run: unit, database-backed integration, HTTP end to end, and WebSocket end to end.
3. **Performance** timing and query plans against a seeded inbox.
4. **Browser walkthrough** with Chrome DevTools: a real workspace, a real invited second person, and every notification surface clicked, observed, and screenshotted.

The unit suite is added at `apps/api/src/lib/notification-copy.test.ts` (uncommitted, 25 tests). The database integration suite and the end to end scripts live in `/tmp/opencode/notif-qa/` for the reason explained in section 9. Screenshots, logs and the Lighthouse report are saved under `qa/evidence/notifications/`.

---

## 3. Results at a glance

| Check | Result |
|---|---|
| Repository suite (`bun test`, with `TEST_DATABASE=1`) | 547 pass, 0 fail (includes the 25 promoted unit tests) |
| RLS verification (`scripts/verify-rls.ts`) | 37 of 37 checks pass |
| New unit tests | 25 pass, 0 fail |
| New integration tests | 37 pass, 0 fail (1 expected-failing test pins the defect) |
| New HTTP end to end checks | 45 of 45 pass |
| New realtime end to end checks | 11 of 11 pass |
| New event matrix checks | 28 of 28 pass |
| Browser walkthrough (Chrome DevTools) | 24 checks, 2 defects reproduced, 1 observation |
| TypeScript (`tsc --noEmit`, api and web) | clean |
| Biome on the 22 changed files | clean |
| Web production build (`nx run web:build`) | success |

Total new automated assertions: 146 (62 tests plus 84 end to end checks).

---

## 4. What passed

### Writer and storage

- One row per recipient; the actor is never a recipient; duplicates inside one call collapse; a retried call with the same dedupe key inserts nothing (unique index holds).
- The insert-then-return trick works: the recipient is scoped for the insert so `RETURNING` echoes the row, then the actor scope is restored for the rest of the business transaction.
- A notification is rendered once, and the delivery descriptor carries the same title, body and href the list will show later.

### Reader

- Newest first, with the id as a stable tiebreaker for identical timestamps.
- Pagination walks every row exactly once across pages, including rows sharing a timestamp.
- `filter=unread` and the unread count agree with the list.
- The summary groups unread by project and the total equals the list count.
- Mark one is idempotent; a second call updates 0; a foreign id updates 0 and does not touch the real owner's row.
- Read-all is inclusive at millisecond precision and leaves a row created one millisecond later unread.
- Visibility is correct: a notification about an archived project is hidden from a plain member and shown to an organization owner; a notification from another workspace is invisible.
- Soft-deleted comments hide their notifications from every read path.

### Product events (verified through the real HTTP routes)

- `milestone_assigned` on assignment and on creation with assignees.
- `milestone_status` on a real transition, and no row for a repeated no-op save.
- `scope_locked` and `scope_unlocked` to assignees and clients.
- `change_request_created` to managers, `change_request_decided` to the requester.
- `project_member_added`, `project_role_changed`, `org_role_changed`, `member_joined`.
- `project_unarchived` to every member; an archive does not notify a plain member who cannot see the archived project.
- A mention wins over a reply and over "new comment"; each person gets one row, never two.
- The actor never notifies themselves in any flow.

### Comment unread state

- The thread cursor is monotonic: a late request for an older comment never moves it backwards.
- Marking a thread read clears the mention and reply notifications that point at it.
- Own messages, activity rows and deleted rows never count.

### Reminders

- No reminder before 09:00 local; one after 09:00.
- The recipient's own timezone decides eligibility (06:00 in Los Angeles is skipped while 14:00 UTC is eligible).
- A repeated sweep does not duplicate (concurrent or overlapping workers are safe).
- Day 1 overdue fires, day 2 does not.
- A moved due date hides the stale unread reminder; a completed milestone hides its unread reminder.
- An unassigned milestone falls back to project managers and organization owners, not plain members.
- The sweep window excludes a milestone due more than two days out, and reminders are not sent for archived projects.

### Realtime

- The personal socket opens with `scope: "user"` and the ready frame carries the organization and the person.
- A mention arrives as a `notification.created` frame with the rendered title, body and href already in the payload.
- The actor's own socket does not receive it, and a project socket does not receive personal frames.
- Marking read publishes `notification.read` so the same person's other tabs update.
- Refusals are correct: no cookie closes with 4401, a hostile Origin closes with 4403, an unknown workspace closes with 4403.

### Browser and UI (Chrome DevTools, real workspace)

Performed as a signed-in QA owner in a fresh workspace, with a second person invited by email and accepted through the real invitation link.

Passed:

- Workspace, project, milestone and invitation flows all worked through the UI, including the member list refresh after acceptance.
- The bell badge updated live from 0 to 1 unread when the second person accepted the invitation, with no reload.
- The bell popover renders the title, the body, the relative time and the unread dot, and groups the icon per type (at sign, message, user plus, git pull request).
- Clicking a row marks it read, clears the badge, and navigates.
- The "Invitation accepted", "New mention", "New reply" and "New change request" rows all arrive live over the socket while the page is open.
- The notifications page renders the All and Unread filters with the unread count, "Mark all read" clears everything (button then disables and the empty state says "No unread notifications."), and the Desktop alerts card shows the stored timezone (Asia/Karachi).
- Pagination works: 20 rows on the first page, "Load more" appends the rest, and the button disappears at the end.
- A notification whose comment was deleted disappears from the list.
- The change request deep link works: the milestone opens with the Changes tab selected and the request visible.
- The badge caps at "99+" while the accessible label keeps the true count ("Notifications, 101 unread").
- Reconnect recovery works: with the network offline a mention arrived at the server, and coming back online brought the badge to 1 unread without a reload.
- Responsive at a 390px mobile viewport with touch emulation: the header, the alerts card, the filters and the rows all reflow, and the bell popover fits the viewport with no horizontal scroll.
- Focus management: opening the bell moves focus into the dialog, and Escape closes it and returns focus to the bell button.
- Every API request made by the notifications page returned 200. No console errors beyond a pre-existing form field warning (see F15).

### Web Push and HTTP surface

- Push config reports `enabled: false` without VAPID keys and does not expose a private key.
- A subscription endpoint must be HTTPS; an invalid key is rejected; an endpoint is upserted; the oldest device is pruned past ten; a browser endpoint is reclaimed from a previous account on the same device (verified against RLS).
- Unauthenticated reads return 401; a non-member gets 404; limit `0`, `-5`, `9999` are clamped; `limit=abc` falls back to the default; an unknown filter, an over long cursor and an invalid cutoff are rejected; a timezone is validated.

---

## 5. Findings

### F1. High: the actor-delete RLS policy does nothing, so removed mentions stay in the bell

**Where:** `apps/api/src/db/rls.ts:174-188` (`notification_actor_delete`), used by `apps/api/src/services/comment.service.ts:874-887` (mention removed by an edit) and `apps/api/src/services/comment.service.ts:1152-1162` (comment deleted).

**What happens:** the policy is `FOR DELETE ... USING (organization_id = current_org and actor_user_id = current_user)`. Postgres also requires the row to be visible under the SELECT policy for a DELETE, and the only SELECT policy is recipient scoped. The actor therefore matches zero rows.

Reproduced directly on `app_test`:

```
rows before edit: 1 mention, actor = A, recipient = B
rows after edit:  1 mention          <-- cleanup did not run
direct delete as actor A:      0 rows
direct delete as recipient B:  1 row
same delete as actor A after adding an actor-scoped SELECT policy: 1 row
```

**Effect:**

- Editing a comment to remove a mention leaves the recipient's bell saying "A mentioned you in a comment on M" and counting it as unread, even though the comment no longer mentions them. It only clears when they read that thread.
- Deleting a comment as its author attempts the same delete and also affects zero rows. That case is masked by the read filter (`notificationScope` hides notifications whose comment is soft deleted), so it is invisible today, but the cleanup is still dead code.

**Evidence:** `notifications.integration.test.ts`, test `DEFECT: removing a mention by editing should delete the bell row`, recorded with `test.failing`.

**Browser evidence:** the second person posted a comment that mentioned the owner, then edited the comment to remove the mention. Reloading the owner's notifications page still showed an **unread** "New mention" row, and its preview had updated to the new text: "Member B mentioned you in a comment on Homepage delivery. \"No mention any more\"". The row claims a mention that no longer exists.

**Recommended fix:** perform the cleanup with the recipient scope, exactly like the insert path already does:

1. read `app.current_user_id`,
2. for each removed mention set the setting to that recipient, delete by `recipient_user_id` and `dedupe_key`, then restore the actor,
3. or move the delete into a `SECURITY DEFINER` function with a fixed `search_path`.

Do not "fix" it by adding an actor-scoped SELECT policy without review: that widens the read boundary in the database itself, and the comment at `rls.ts:174-181` would then be false in a more dangerous way. The comment should be corrected either way, because Postgres does not allow "remove but not read".

### F2. High: clicking a comment notification opens an empty Comments panel

Reproduced in the browser twice. Clicking a "New mention" or "New reply" row navigates to the milestone with `milestoneTab=comment:<rootId>` in the URL. The Comments tab is selected and shows its unread count, but the whole panel is blank: no thread, no composer, no text. The specific thread is never focused either.

**Where:** `apps/web/src/features/milestones/milestone-detail-panel.tsx:477-479` and `:1373-1391`; `apps/api/src/lib/notifications.ts:155-163` emits the comment tab key; `apps/web/src/features/milestones/tabs.ts:107-125` resolves an unopened focused tab down to `comments`.

**Root cause, blank panel:** `commentsOpened` initialises as `selectedTab === "comments"`. A comment deep link sets `selectedTab` to `comment:<rootId>`, so `commentsOpened` is `false`. `effectiveSelectedTab` resolves to `comments`, so the tab renders as selected, but `{commentsOpened && <CommentTab .../>}` never mounts. The panel is empty by construction.

**Root cause, wrong thread:** even with the panel mounted, a focused comment tab is only in `openCommentTabs` if the reader opened that thread before. Unlike scope tabs, there is no `requestedCommentTab` derived from the URL, so the focused tab does not join the strip on first paint.

**Evidence:** with `milestoneTab=comment:d7f0e7e9-...` the snapshot showed `tab "COMMENTS 2" selectable selected` and `tabpanel "COMMENTS 2"` with no content, and the comment text was absent from the DOM. Clicking Overview and then Comments (which rewrites the URL to `milestoneTab=comments`) rendered the thread immediately. The same happened with `milestoneTab=comment:85165656-...` earlier.

**Fix:**
1. initialise `commentsOpened` as `selectedTab === "comments" || isCommentTabKey(selectedTab)`, and
2. derive a `requestedCommentTab` from the URL and the loaded thread, mirroring `requestedScopeTab`, so the thread is focused on first paint.

### F3. Medium: an alert from a non-active workspace cannot be opened

**Where:** `apps/web/src/routes/_app.tsx:105-152`, `apps/web/src/features/organization/active-workspace.ts:44`, `apps/web/public/sw.js:48-83`, `apps/web/src/features/notifications/realtime.tsx:130`.

**What happens:** the notification href always names the workspace that produced it. If that workspace is not the session's active organization, the shell redirects the URL to the active workspace root. The click target is discarded. The click handler also marks the row read with the active slug, so the API updates zero rows and the alert stays unread.

**Effect:** a multi-workspace user who is active in workspace A and clicks an OS alert from workspace B lands on A's home and keeps the unread row. Single-workspace users are unaffected.

**Browser evidence:** signed in to workspace B's alert, then switched the active organization to workspace A, then opened the notification href with `?notification=<id>` (exactly what the service worker builds). The app redirected to `http://localhost:3000/qa-studio-p3203518` (workspace A's dashboard). The alert stayed unread. Marking the same id through workspace B's API returned `{"updated":1}`, while marking it through workspace A's API returned `{"updated":0}`.

**Fix:** in the `?notification=` handler, parse the workspace slug from the notification before navigating. If it differs from the active one, switch through `useSwitchOrganization` (with a reason, so the switch guard stays honest) and then navigate. Mark read with the href's slug rather than the active one.

### F4. Low: the page ends early when the cursor row was deleted

**Where:** `apps/api/src/services/notification-query.service.ts:221-239`.

The cursor is a keyset subquery resolving the row by id. If that row was deleted (a deleted comment cascades, a removed mention is cleaned up, an organization is deleted), the subquery returns no row, the tuple comparison is NULL, and the page is empty with `nextCursor: null`. The reader sees the list end until a refetch.

**Fix:** if the cursor row is missing, fall back to the first page, or resolve the position from a stored timestamp carried in the cursor.

**Evidence:** test `KNOWN: a cursor whose row was deleted returns an empty page`.

### F5. Low: a decodable garbage cursor is accepted

**Where:** `apps/api/src/services/notification-query.service.ts:86-103`.

`Buffer.from(value, "base64url")` never throws for a string; it silently drops invalid characters. The `try/catch` is therefore dead code. A cursor of only invalid characters decodes to zero bytes and correctly gets a 400, but any garbage that decodes to one or more bytes is accepted and returns 200 with an empty page.

**Fix:** validate the decoded value against the id shape, or re-encode and compare with the input. A malformed cursor should be a 400, as the doc comment already claims.

**Evidence:** HTTP checks `a cursor of only invalid base64 characters is rejected` (400) and `KNOWN: a valid base64 cursor for a missing row returns an empty page` (200).

### F6. Low: marking comments read is all or nothing, and the client does not retry

**Where:** `apps/api/src/services/comment-read.service.ts:458-462` and `apps/web/src/features/milestones/comments/comment-tab.tsx:229-235`.

One id that was deleted between render and click fails the whole request with 400. The client adds ids to `markedRef` before the mutation resolves and never removes them on failure, so those comments stay unread for the rest of the session.

**Fix:** ignore unknown ids and mark the rest; remove the ids from `markedRef` on error so a later render retries.

### F7. Low: push is suppressed by a visible window in another workspace

**Where:** `apps/web/public/sw.js:29-33`.

The service worker suppresses the OS alert when any app window is visible, assuming the in-app UI already showed it. The personal socket only covers the active workspace (`realtime.tsx:170`), so a visible app in workspace A silently swallows a push for workspace B. The user gets neither an OS alert nor an in-app one until they switch workspaces.

**Fix:** include the workspace in the push payload and suppress only when a window is showing that workspace, or stop suppressing when the app is not focused.

### F8. Performance: the unread count probes milestone and comment once per unread row

Measured on `app_test` with the service functions, using a member role (the realistic visibility path), across 20 projects:

| Scenario | Time (two runs) |
|---|---|
| Bell list, 20 rows, 2,700 unread | 69 to 108 ms |
| Bell list, unread filter | 66 to 117 ms |
| Summary (count plus grouped count) | 45 to 66 ms |
| Five 50-row pages (each page also counts) | 306 to 713 ms |
| Mark one read | 32 to 62 ms |
| Mark all (2,700 rows) | 154 to 392 ms |
| Unread count, 20,000 unread | 105 ms |

The second run was taken with Chrome and the dev stack busy, hence the upper end. The shape and the plan are the same. The full second run is saved at `qa/evidence/notifications/logs/perf-check.txt`.

Plan at 20,000 unread:

```
Index Scan using notification_recipient_project_unread_idx on notification
  Filter: organization_id = ...
Nested Loop Left Join  ->  Seq Scan on milestone  (actual rows=0, loops=20000)
Nested Loop Left Join  ->  Seq Scan on comment    (actual rows=0, loops=20000)
```

The joins are only needed for two rare conditions: a soft-deleted comment, and a stale reminder. They cost one probe per row on the hot path, which runs on every bell request and on a 60 second poll per open tab.

**Fix:** count the ordinary rows (no `comment_id`, not a reminder type) with no joins so the partial index can serve them, then add the two conditional groups (`comment_id is not null` and `reminder`) with EXISTS. Also include `organization_id` in the partial unread index to avoid the post-scan filter.

### F9. Low: scope mentions are never cleaned up and can duplicate

**Where:** `apps/api/src/services/milestone-scope.service.ts` (mention on scope entry update).

Removing a mention from a scope entry deletes nothing, and the dedupe key includes `updated.updatedAt`, so each edit that re-adds the same mention creates another unread row. The comment path at least attempts cleanup; this path does neither.

**Fix:** use a stable key (`mention:scope:<entryId>:<userId>`) and mirror the comment cleanup, with F1 fixed first.

### F10. Informational

- **Two due-soon reminders per due date.** The dedupe key includes the phase, so "due tomorrow" and "due today" are two rows, and the first stays unread unless read. Confirm this is the product intent.
- **Silent fan-out cap.** `MAX_CANDIDATES = 500` drops recipients beyond 500 with no log or metric.
- **Read-all marks invisible rows.** The UPDATE has no visibility or staleness predicate, so it also marks rows the reader never saw (for example an archived project's row). Harmless for the badge, but it makes read history less honest.
- **List churn on each click.** `useMarkNotificationRead` invalidates the whole list, so clicking three rows refetches page one three times. Patching the row's `readAt` in the cache is enough.
- **`as never` on the timezone write.** `authClient.updateUser({ timezone } as never)` bypasses the type contract, and the failure is swallowed. It works today (verified over HTTP), but a library change would silently leave reminders on UTC with no signal.
- **Incorrect comment in `rls.ts`.** The comment says the author "cannot read the row, only remove it". Postgres does not offer that, as F1 shows.

### F15. Low: form fields without id or name on the workspace forms

The console reports `A form field element should have an id or name attribute (count: 5 to 6)` on the invite members dialog and the project members page. It is a pre-existing accessibility and autofill issue, not specific to notifications, but it appears on the pages a notification leads to. Give the inputs an `id`/`name` pair.

---

## 6. Code review notes that are not defects

- `notificationHref` encodes the workspace slug and the thread id correctly; `URLSearchParams` handles the `comment:` colon.
- `renderNotification` covers all 18 types, degrades unknown enum values to the raw string, and never emits `undefined`, `null`, `NaN` or `[object Object]`.
- Notification preview squashes whitespace and truncates at 117 characters plus an ellipsis.
- Dates in notification copy use `en-GB` at UTC noon, so they read day month year as rule 24 requires.
- `navigate({ to: target.pathname })` with `as never` follows the same pattern already used by the breadcrumb, which works at runtime.
- `withUser` is the right boundary for push subscriptions, and the endpoint claim path is scoped by the endpoint setting, so it cannot be used to enumerate.
- The personal topic includes both organization and user, so the same person in two workspaces cannot cross streams.
- Membership revocation closes user sockets on an organization-level revocation, and correctly leaves them open on a project-level one.

---

## 7. Coverage gaps

1. **The OS notification permission prompt could not be automated.** Chrome DevTools MCP does not expose a permission grant, so `Notification.requestPermission()` stayed pending and the card was left in its "Enabling..." state. The granted path (a page level alert and an OS click) is therefore not exercised. The unsupported, denied and unavailable branches were code-reviewed.
2. **Actual push delivery was not tested.** The dev deployment has no VAPID keys, so `pushEnabled` is false. Storage, validation, pruning, claiming and the web-push error classification were tested; an actual push alert was not.
3. **The BullMQ scheduler was not exercised.** Redis was not reachable from the host test process, so the sweep was invoked directly with fixed clocks. The scheduling call and the queue wiring were reviewed only.
4. **Rate limiting was not boundary tested.** `consumeRateLimit` fails open when Redis is unreachable, which is what the host tests saw.
5. **Email copy was not asserted.** Verification and invitation mail were used to complete the flow through Mailpit, not checked for wording.
6. **Reminder copy was not seen in the browser.** Reminders are produced by an hourly server sweep, so the browser tests used mention, reply, invitation and change request rows. The reminder list rendering was covered by the integration suite instead.

---

## 8. Suggested fix order

1. F2 (empty Comments panel), because it breaks the main action of every comment notification.
2. F1 (mention cleanup) and its migration or service change.
3. F3 (cross-workspace alert), because it silently drops an alert the user clicked.
4. F8 (unread count), before inboxes grow.
5. F4 to F7, F9 and F15 as normal maintenance.
6. F9 with F1, since it needs the same mechanism.

---

## 9. Artifacts and how to promote them

Scripts live in `/tmp/opencode/notif-qa/`:

| File | Purpose | Status |
|---|---|---|
| `notifications.unit.test.ts` | Pure renderer, vocabulary, unread math, timezone | Promoted to `apps/api/src/lib/notification-copy.test.ts` (25 tests, green) |
| `notifications.integration.test.ts` | Database and RLS, writer, reader, reminders, push | Kept in `/tmp/opencode/notif-qa/`; see the note below |
| `e2e-helpers.ts` | Session and workspace setup through Better Auth and Mailpit | `/tmp/opencode/notif-qa/` |
| `e2e-flow.ts` | Full user flow over HTTP | `/tmp/opencode/notif-qa/` |
| `e2e-ws.ts` | Personal realtime stream | `/tmp/opencode/notif-qa/` |
| `e2e-events.ts` | Product event matrix | `/tmp/opencode/notif-qa/` |
| `perf-check.ts`, `perf-plan.ts` | Timing and query plan | `/tmp/opencode/notif-qa/` |

**Why the integration suite is not in the repository yet:** `tenant-boundary.integration.test.ts` ends the shared `adminClient`, `tenantDb` and Redis singletons in its `afterAll`. Once one integration file runs, `adminDb` is ended for the whole process, so a second integration file fails in `beforeAll` with `CONNECTION_ENDED`. Promoting the notification integration suite requires either merging it into the existing file or making the database clients recreatable (for example a `getAdminDb()` that rebuilds after `end()`). This is an infrastructure change, not a notification change, so it was left out of this QA pass. The suite runs cleanly on its own with the command below.

Run commands:

```bash
# The promoted unit suite
cd apps/api
bun test src/lib/notification-copy.test.ts

# Unit and integration against the throwaway database
cd apps/api
TEST_DATABASE=1 \
DATABASE_URL=postgres://app:app@localhost:5432/app_test \
DATABASE_APP_URL=postgres://app_tenant:tenant@localhost:5432/app_test \
  bun test /tmp/opencode/notif-qa/notifications.integration.test.ts

# End to end against the running dev stack (needs a dev stack and Mailpit)
cd apps/api
bun run /tmp/opencode/notif-qa/e2e-flow.ts
bun run /tmp/opencode/notif-qa/e2e-ws.ts
bun run /tmp/opencode/notif-qa/e2e-events.ts
```

Do not set `NODE_ENV=development` for the full repository suite. It flips `isDevelopment`, and `src/middleware/security-headers.test.ts` then fails because the production CSP branch is skipped. The project's own `bun run test:db` omits it; use the same environment.

Also note that `e2e-flow.ts`, `e2e-ws.ts` and `e2e-events.ts` create real users and workspaces in the development database and do not clean up on purpose, so a failure can be inspected. The fixtures created during this run were removed afterwards (10 workspaces and 13 users prefixed `qa-e2e-`, the browser workspace `qa-notif-br-275003`, 25 seeded pagination rows and 100 seeded badge rows). The QA owner's active organization was restored to `qa-studio-p3203518`.

The integration suite is skipped unless `TEST_DATABASE=1` and the URL ends in `app_test`, matching the existing `tenant-boundary.integration.test.ts` guard, so it cannot touch development data.

## 10. Browser evidence captured

| Check | Observed |
|---|---|
| Bell updates live on invite acceptance | aria-label changed to "Notifications, 1 unread" with no reload |
| Bell row content | "New mention / Member B mentioned you in a comment on Homepage delivery. \"...\" / now" |
| Mark read from the bell | aria-label returned to "Notifications", row lost its dot |
| Comment deep link | URL `milestoneTab=comment:...`, tab "COMMENTS 2" selected, panel empty, comment text absent from the DOM (`03-empty-comments-panel.png`) |
| Same comment after Overview then Comments | URL rewritten to `milestoneTab=comments`, thread rendered (`04-comments-after-manual-open.png`) |
| Change request deep link | Changes tab selected, "Please add a pricing table" visible |
| Deleted comment | "New reply" row disappeared after the author deleted the comment |
| Mention removed by edit | unread "New mention" row still present, preview "No mention any more" |
| Cross-workspace click | redirected to the active workspace dashboard, alert stayed unread |
| Offline then online | badge went to 1 unread without a reload |
| Badge cap | "99+" badge, aria-label "Notifications, 101 unread" |
| Mobile 390px | no horizontal scroll, popover fits, rows reflow (`05-mobile-notifications.png`, `06-mobile-bell.png`) |
| Focus management | opening moves focus into the dialog, Escape returns it to the bell |
| API health on the page | every request 200, no console errors beyond F15 |
