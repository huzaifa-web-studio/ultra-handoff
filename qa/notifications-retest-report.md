# Notifications Retest Report

**Date:** 23 Nov 2026
**Source report:** `qa/notifications-system-test-report.md`
**Fix plan:** `qa/notifications-fix-plan.md`
**Branches:** `fix/notifications-lifecycle`, `fix/notifications-links`,
`fix/notifications-hardening` (stacked, all three contain the full fix set)

---

## 1. Scope of this retest

This pass re-tests every finding through automated tests, type checks, the RLS
verifier, a production type check and a performance measurement on `app_test`.

The browser walkthrough from section 8 of the plan was **not** re-run in this
pass. It needs two seeded workspaces, a second signed-in person, Chrome
DevTools approval and screenshots. Those four cases are listed in section 5 as
the only outstanding items.

---

## 2. Automated results

| Check | Command | Result |
|---|---|---|
| API unit suite | `cd apps/api && bun test` | 497 pass, 117 skip, 0 fail |
| API integration suite | `TEST_DATABASE=1 ... bun test` | 610 pass, 0 fail, one process |
| Web suite | `cd apps/web && bun test` | 115 pass, 0 fail |
| API typecheck | `bunx tsc --noEmit` | clean |
| Web typecheck | `bunx tsc --noEmit` | clean |
| UI typecheck | `bunx tsc --noEmit` | clean |
| Biome | `bunx biome check apps/api/src apps/web/src packages/ui/src apps/api/scripts` | clean |
| RLS verifier | `bun run db:verify-rls` | 37 of 37 |

The integration suite runs `tenant-boundary.integration.test.ts` and
`notification.integration.test.ts` in one process. Both used to close the shared
Postgres and Redis clients in `afterAll`, which made the second file fail with
`CONNECTION_ENDED`; fixtures are now cleaned and the process closes the clients.

---

## 3. Finding status

| ID | Status | Evidence |
|---|---|---|
| F1 | Fixed | Mention removal by edit deletes the recipient row; comment deletion runs through `delete_comment_notifications`; a cross-workspace call deletes nothing. |
| F2 | Fixed in code | `commentsOpened` accepts a comment key, a placeholder tab is derived from the URL, and the label is refreshed on load. Unit tests cover `commentTabId`. |
| F3 | Fixed in code | `decideNotificationLink` covers same, other and unknown; a blocked switch abandons the hold so the guard still returns the person. Unit tests cover the decision. |
| F4 | Fixed | Integration: deleting the row a cursor points at still returns the next page. |
| F5 | Fixed | Six malformed cursor shapes each reject; unit tests plus an integration loop. |
| F6 | Fixed | Server marks what exists; both comment surfaces roll back `markedRef` on error. |
| F7 | Fixed | `shouldSuppressPush` suppresses only for the payload's workspace and keeps the old rule for a payload without a slug. Six unit tests. |
| F8 | Fixed and measured | See section 4. |
| F9 | Fixed | Scope key is stable, removal deletes, re-add stays one row. Three integration tests. |
| F10a | Fixed | Today replaces the unread tomorrow row; a read tomorrow row stays. Two integration tests. |
| F10b | Fixed | Truncation logs tenant, accepted and dropped; 501 candidates insert 500 and do not throw. |
| F10c | Fixed | Read-all selects visible ids first; a hidden archived row stays unread, and 2,000 rows complete. |
| F10d | Fixed | `useMarkNotificationRead` patches the cache instead of invalidating the list. |
| F10e | Fixed | `reportTimezone` carries one narrow cast; no `as never` remains. |
| F15 | Fixed | Search inputs and selection checkboxes carry `id` and `name`; the invite textarea has a name. |
| D10 | Fixed | One client lifecycle for the whole test process. |

---

## 4. Performance at 20,000 unread rows

Measured on `app_test` with one member, 20 projects and 20,000 unread rows.

| Operation | Before | After |
|---|---|---|
| Unread count | 105 ms | 13.7 ms |
| Summary (count plus grouped) | 45 to 66 ms | 29 to 54 ms |
| Bell list, limit 20 | not measured at 20k | 24 ms |

The plan for the count shows the `comment` and `milestone` subplans as
`never executed`, so there are no `loops=20000` probes. The unread index is now
`(recipient_user_id, organization_id, created_at, id)` partial on
`read_at is null`.

---

## 5. Outstanding items

These are the only parts of the definition of done that were not executed here.
Each needs a browser with two real workspaces and a second person.

1. Task 8: deep link from the bell on a fresh profile, a reply link, and a
   deleted thread.
2. Task 9: same workspace, other workspace, and a workspace the person is not
   in, with the switch guard checked.
3. Task 14: console warning count is 0 on the invite dialog and the project
   members page.
4. Task 15: zero list requests in the network panel while clicking three bell
   rows.
5. Task 10: a live push for a non-active workspace (needs VAPID keys, which the
   dev deployment does not have).

The automated substitutes for 1 to 4 are in place and green. Item 5 was already
listed as a coverage gap in the original report because the dev deployment has
no VAPID keys.
