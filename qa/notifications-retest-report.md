# Notifications Retest Report

**Date:** 23 Nov 2026
**Source report:** `qa/notifications-system-test-report.md`
**Fix plan:** `qa/notifications-fix-plan.md`
**Branches:** `fix/notifications-lifecycle`, `fix/notifications-links`,
`fix/notifications-hardening` (stacked, all three contain the full fix set)

---

## 1. Scope of this retest

This pass re-tests every finding through automated tests, type checks, the RLS
verifier, a production type check, a performance measurement on `app_test`, and
a browser walkthrough with Chrome DevTools in two workspaces.

The browser results are in section 5. Only live Web Push delivery remains
unverified, because the dev deployment has no VAPID keys.

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

## 5. Browser retest

Run on 23 Nov 2026 against the live dev stack with Chrome DevTools, signed in as
a fresh owner account in two workspaces. The fixtures are described in section 6
of this report.

| Case | Expected | Observed |
|---|---|---|
| Same-workspace mention from the bell | Focused thread, author label, row read | Thread selected and rendered, label "Retest Member B: Cache row one...", bell 2 to 1 unread |
| Fresh profile deep link (localStorage cleared) | Same result with no stored tabs | Thread opened, label from the loaded thread |
| Reply notification | Focuses the root thread | `milestoneTab` carried the root id, not the reply id (API check) |
| Deleted thread link | Deleted panel, not a blank tab | "This discussion was deleted. The replies remain for context.", tab label "Thread" |
| Plain `milestoneTab=comments` | Shows the list | Comments list rendered with the root comments |
| Alert for another workspace | Switch, open, mark read | Active workspace moved from A to B, thread opened, `notification` removed from the URL, row read in B |
| Unknown workspace | No switch, fall back, no error | Redirected to the active workspace root, no error |
| Blocked switch | Dialog, no switch, no navigation | "CAN'T SWITCH RIGHT NOW" with the operation reason, stayed in the active workspace |
| Form field warnings | 0 on the members, invitations and project members pages | 0 on all four surfaces (members, invitations, project members, invite and add dialogs) |
| Mark-read network | No list refetch from the click | 0 notification list requests after the click marker; the badge cleared immediately |

Evidence is in `qa/evidence/notifications/`: `07-comment-deep-link.png`,
`08-cross-workspace-alert.png`, `09-invite-dialog.png`,
`10-project-members.png`, `11-deleted-thread.png`.

Two notes from the browser pass:

1. Task 8 needed one small follow-up: a deleted thread resolved with an empty
   body, so the generated label read "Author: Attachment". The panel now keeps
   the "Thread" placeholder when `deletedAt` is set.
2. The milestone page itself still shows the Chrome form-field warning for its
   own fields (milestone search, title, status and date selects). Those were not
   part of F15, which names the invite dialog and the project members page, and
   they do not block autofill of the forms a notification leads to. Worth a
   separate pass if the warning on every page matters.

## 6. Fixtures used for the browser pass

Two verified accounts and two workspaces, created through the real auth and
project routes:

- `Retest Owner A`, owner of `retest-a-brtmwt2gq2z`, member of B
- `Retest Member B`, owner of `retest-b-brtmwt2gq2z`, member of A

The browser session is left signed in as `Retest Owner A`. To remove the
fixtures, delete those two users; the organizations, projects, comments and
notifications cascade.

## 7. Outstanding items

Only the live push delivery check remains. It needs VAPID keys, which the dev
deployment does not have, and it was already listed as a coverage gap in the
original report.

