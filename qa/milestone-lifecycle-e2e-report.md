# Milestone Lifecycle: Full Test Report

**Project:** Handoff (ultra-handoff monorepo)
**Branch:** `feat/milestone-lifecycle` at `f841245`
**Date:** 16 November 2026
**Mode:** Full test pass. Automated suites, a live HTTP contract matrix per persona, and a live UI walkthrough on the dev stack. No application code was changed.
**Stack:** web 3000, api 127.0.0.1:3001, postgres 5432, redis 6379, mailpit 8025, seaweedfs 8333.
**Evidence:** `qa/evidence/milestone-lifecycle/` (8 screenshots, Lighthouse report, raw matrix output).

---

## 1. What was tested, and why this branch is the whole story

`feat/milestone-lifecycle` is `main` plus four commits (`619265e` doc, `1ea62c6` scope v1, `1eb850d` dark mode, `f841245` lifecycle). `main` is a strict ancestor, the tree is clean, and there is one worktree. Every other branch is either merged into `main` or an ancestor of this branch. The superseded scope review feature exists only in `stash@{0}` and is deliberately not part of this branch.

Scope of this pass:

- the phase lifecycle and its eight statuses
- lock and unlock, and every write the lock does and does not freeze
- change requests, including accept, decline, move and withdraw while locked
- scope sections: initial scope, test rounds, review rounds, accepted changes
- focused scope tabs and their URL and storage behaviour
- phase timing and the Time in phases card
- dark mode
- realtime delivery of the new event types
- regression of the pre-existing product surface

---

## 2. Automated baseline (branch vs `main`)

A throwaway worktree of `main` (`53a2107`) was tested with the same suites against a freshly migrated database, so every number below is a real comparison, not a memory.

| Check | `main` | `feat/milestone-lifecycle` | Result |
|---|---|---|---|
| API unit tests | 413 pass, 49 skip, 0 fail (462 tests, 33 files) | 442 pass, 65 skip, 0 fail (507 tests, 34 files) | PASS, +29 pass |
| Web unit tests | 81 pass, 0 fail (11 files) | 97 pass, 0 fail (13 files) | PASS, +16 tests |
| Database suite | 460 pass, 0 fail | 505 pass, 0 fail | PASS, +45 tests |
| RLS verification | 23 checks (phase 4) | 29/29 pass | PASS, +6 for the new tables |
| Typecheck | n/a | 3 of 3 projects | PASS |
| Biome | n/a | 453 files, 0 issues | PASS |
| API build | n/a | compiled binary | PASS |
| Web build | n/a | Nitro bundle with `VITE_API_URL` | PASS |
| Web build guard | n/a | fails without `VITE_API_URL` with the expected message | PASS (intended) |

Notes:

- The database suite is skipped by design unless `TEST_DATABASE=1` and the URL contains `/app_test`. A first baseline run used `main_app_test` and silently skipped, so it was discarded and re-run on a clean `app_test` built from `main`. The numbers above are from the corrected runs.
- The one Redis line during the DB suite is the known rate limiter failing open. It does not fail a test.
- After the branch run, `app_test` was rebuilt from the branch schema and re-run to confirm repeatability: 505 pass again.

---

## 3. HTTP contract matrix (live, per persona)

101 assertions, run against the live API with five real sessions (owner, admin, member, client, outsider), each carrying its own cookie. The matrix created its own project, added the three project roles, and drove every endpoint. Raw output: `qa/evidence/milestone-lifecycle/phase2-http-matrix-results.txt`.

| Area | Assertions | Result |
|---|---|---|
| Project setup and role assignment | 5 | PASS |
| Viewer capabilities per persona | 10 | PASS |
| Status vocabulary and lifecycle | 13 | PASS |
| Phase periods | 2 | PASS |
| Phase-gated scope rounds | 12 | PASS |
| Lock and unlock | 21 | PASS |
| Change requests | 21 | PASS |
| Tenant and project boundary | 7 | PASS |
| Archived project | 6 | PASS |
| Delete | 3 | PASS |
| **Total** | **101** | **101 PASS, 0 FAIL** |

Behaviour confirmed:

- All eight statuses are accepted. `in_progress` is rejected (422 from schema validation) and the database constraint no longer allows it.
- The client cannot change status, lock, unlock, tick a checklist or decide a request. Staff can. Owner and admin can lock.
- While locked: title, description, dates, estimate and delete are refused with a readable 400. Status, assignees, checklist ticks, comments, change requests and accepting a request all still work.
- An empty `PATCH {}` is a true no-op: 200 and a byte-identical `updatedAt`.
- A test round is writable only by staff and only during its own testing visit. A review round is writable by the client, only during its own review visit. Leaving the phase returns a precise 403 and the round stays frozen.
- Entering testing and review creates exactly one round per visit, tied to the status period id.
- Exactly one open phase period exists per milestone after a nine-visit loop.
- A client can raise a request on a locked milestone. Only the author edits or withdraws it while open. Decline requires a reason and is final. Accepting while locked appends a `change` section and leaves the initial scope hash identical. Moving creates a milestone, links it, and marks the request moved. The open count tracks the list exactly.
- Every cross-tenant and cross-project attempt returns 404, never data.
- An archived project refuses milestone and change request writes, and works again after restore.
- Unlocked milestones delete; a client delete is refused.

---

## 4. Live UI walkthrough

Signed in as the owner with the password form and as the client through the real magic link flow (Mailpit). The fixture project was `HTTP Matrix 1794816679`, with a lifecycle milestone (four scope rounds) and a locked milestone (seven change requests).

| Check | Result | Evidence |
|---|---|---|
| Overview shows status, estimate, dates, assignees, scope cards and phase card, with no editor | PASS | `01-overview-light.png` |
| Scope tab is an index (initial scope, current phase, earlier additions) with kind chips, author, date and excerpt | PASS | `01`, walkthrough |
| Overview shows the latest three additions and `VIEW ALL` | PASS | walkthrough |
| Opening a section creates a focused tab and sets `?milestoneTab=scope:<id>` | PASS | walkthrough |
| Focused tab survives a reload at the copied URL | PASS | walkthrough |
| Closing a focused tab removes it and falls back to the parent tab with the URL updated | PASS | walkthrough |
| Locked milestone shows a LOCKED badge, the banner with actor and `16 Nov 2026`, and read-only fields | PASS | `02`, `05` |
| Client on a locked milestone sees no lock, unlock, delete, status select or title input | PASS | `04` |
| Client checklist checkbox is disabled while staff can still tick | PASS | walkthrough |
| Owner unlock restores the title input; lock restores the badge | PASS | walkthrough |
| Status select exposes all eight statuses | PASS | walkthrough |
| `Blocked` opens a reason dialog and the confirm stays disabled until a reason is typed | PASS | walkthrough |
| New milestone dialog with `Blocked` reveals a required "WHY IS IT BLOCKED?" field | PASS | walkthrough |
| Changes tab label carries the open count (`CHANGES 2`), filter buckets match the data | PASS | `02` |
| Client sees `NEW REQUEST`, `EDIT` and `WITHDRAW` only | PASS | walkthrough |
| Client creates a request on a locked milestone through the dialog | PASS | walkthrough |
| Staff sees `ACCEPT`, `DECLINE`, `MOVE TO A NEW MILESTONE` | PASS | walkthrough |
| Accept dialog prefills title and body, states the trim behaviour, has an optional decision note | PASS | walkthrough |
| Accepting appends a section, decrements the count, and the section appears in Scope | PASS | walkthrough |
| Decline dialog requires a reason and shows it as `DECLINED REASON` | PASS | walkthrough |
| Accepted request shows `Added to the milestone scope` and `OPEN SCOPE` | PASS | walkthrough |
| Moved request links to the new milestone | PASS | walkthrough |
| Time in phases details list every visit with day month year dates | PASS | walkthrough |
| Every visible date is day month year (`16 Nov 2026`) | PASS | `01`, `02`, `05` |
| Dark mode applies, persists in `handoff:theme`, survives reload, and renders the lock banner and every status pill | PASS | `05`, `08` |
| `Ready` renders correctly in the list and filter | PASS | `07`, `08` |
| Status select is keyboard reachable and opens with Enter, exposing eight options | PASS | walkthrough |
| Mobile at 500px has no horizontal overflow | PASS | `06-mobile-500.png` |
| No console errors on the milestone page | PASS | console log |
| Lighthouse accessibility | 97 (see F2, F3) | `report.html` |

---

## 5. Realtime

Two sessions: the browser as one persona, the other persona acting through its own live session.

| Action performed remotely | Observed in the open browser without reload | Result |
|---|---|---|
| Staff accepts a change request | Row left the Open filter, count went to 0, row showed ACCEPTED with decision date under All | PASS |
| Unlock | LOCKED badge and banner disappeared | PASS |
| Status change to `in_testing` | Header pill changed, list row changed, Test round appeared under CURRENT PHASE | PASS |
| Accept a request while testing | New `CHANGE` section appeared in the Scope index | PASS |
| Lock | Banner and badge appeared | PASS |
| Client posts a comment | Comment appeared in the open thread with the author | PASS |

No duplicate timeline rows were observed, and the timeline renders the new events in plain language ("locked the milestone", "unlocked the milestone", "accepted the change request", "declined the change request", "moved the change request to a new milestone").

---

## 6. Regression of the previous surface

| Area | What was checked | Result |
|---|---|---|
| Sign in | password form end to end, magic link end to end, sign out | PASS |
| Organization dashboard | loads, sidebar, org switcher entry point | PASS |
| Organization members | roles, counts, search, sort, 4 members | PASS |
| Project members | grid, role filter, add members | PASS |
| Project navigation | overview, milestones, settings | PASS (the only failure was my wrong URL, `/members` instead of `/settings/members`; 404 was correct) |
| Milestone list | search box, status filter with all eight statuses and counts, sort, pin | PASS |
| Milestone create dialog | all fields, blocked reason gate | PASS |
| Comments | composer, post, author controls (Edit, Delete, Open as tab), event timeline | PASS |
| Date formatting | every new surface | PASS |
| Theme toggle | applies, persists, restores, no console error | PASS |
| Mobile | 500px | PASS |

---

## 7. Data integrity

Read-only SQL after the destructive tests, plus the operator script:

- Every milestone has exactly one open status period (query returned zero exceptions).
- After deleting milestones and two projects, `change_request`, `milestone_scope_entry`, `milestone_status_period` and `milestone_assignee` have zero orphan rows.
- No milestone has status `in_progress`.
- The live constraint allows exactly the eight documented statuses and nothing else.
- The three new tables have RLS enabled and are in the tenant allowlist.
- `db:backfill-milestone-data` run twice: 0 milestones changed, 0 requests added, 12 open periods for 12 milestones both times. It is idempotent on the current data.

---

## 8. Performance

This was not measured in the first pass. It was measured afterwards, because "no performance issue" needs evidence. Live data is far too small (5 milestones, 13 requests) to mean anything, so the probe seeds volume inside a transaction, runs `analyze` so the planner has real statistics, and rolls everything back. Zero `perf-*` rows remained afterwards.

5,003 milestones in one project, 2,000 change requests:

| Query | Plan | Time |
|---|---|---|
| List counts (nine status filters) | seq scan of the project | 4.4 ms |
| List page, all statuses, due date sort | seq scan + sort of 5,003 rows | 4.1 ms |
| List page, one status | `milestone_project_status_due_idx` + incremental sort, 51 rows | 0.2 ms |
| Title search | scan + sort, 111 matched | 5.1 ms |
| Open change counts for one page | `change_request_project_milestone_status_idx`, 9 rows | 0.28 ms |
| Changes tab list | same index, 1 row | 0.07 ms |
| Open count for one milestone | same index | 0.07 ms |

End to end on the dev stack with 3 milestones: list 10 to 15 ms, detail 11 to 21 ms, changes 13 ms, warm.

Query count is constant, never per row. The list is access + counts + page + three batched lookups in parallel. The detail is access + record + scope entries + periods + one name map. No N+1.

Front end: the milestones route chunk is 1,195 KB raw, 345 KB gzip, 278 KB brotli. `main` builds the same chunk at 1,145 KB raw and 334 KB gzip, so the branch adds 50 KB raw and 11 KB gzip. The chunk is dominated by the Plate editor, which is imported statically. That is pre-existing. Search is debounced at 300 ms in `milestone-page.tsx`, so typing does not issue a request per keystroke.

Scalability notes, not current defects:

- The `all` status list sorts the project's milestones because `milestone_project_status_due_idx` leads with `status`. That is 4 ms at 5,003 rows. A `(project_id, due_date, id)` index would remove the sort, worth doing only if one project is expected to hold tens of thousands of milestones.
- The counts query reads every milestone in the project on each list load, 4.4 ms at 5,003. Same threshold.
- The probe ran as the table owner, which bypasses RLS. The tenant policy adds the same `organization_id` predicate that is already in the query, so the plan shape is unaffected.
- No memory, leak or load test was run.

## 9. Findings

No functional defect was found in the feature. Three pre-existing accessibility issues and one DX observation are recorded below.

### F1 (P3, pre-existing): sign-in inputs have no accessible name

The email and password fields in the sign-in modal have no label, `aria-label`, `aria-labelledby`, `placeholder`, `id` or `name`. A DOM probe returned all empty, and the console reports "A form field element should have an id or name attribute (count: 7)" across the shell.

- Impact: a screen reader announces two unnamed edit fields. WCAG 2.2 AA 3.3.2 and 4.1.2.
- Evidence: `03-signin-modal.png`, console message 99.
- Attribution: the auth UI is unchanged on this branch (`git diff main...HEAD` touches no auth component), so this predates the milestone work.
- Repro: sign out, open SIGN IN, inspect the two inputs.

### F2 (P3, pre-existing): label and accessible name mismatch

Lighthouse accessibility scores 97 on the milestones page. Two `label-content-name-mismatch` failures:

- the sort direction button shows `A to Z` but its accessible name is "Sorted ascending, switch to descending"
- the assignees trigger shows `Unassigned` but its accessible name is "Assignees"

Both elements are byte-identical on `main`. Evidence: `report.html`.

### F3 (P3, pre-existing pattern, more instances): list status pills are 19px tall

`target-size` flags the status pills in the milestone list at 19px against the 24x24 WCAG 2.2 AA minimum. The `size="sm"` plus `py-0.5` combination exists on `main` in `milestone-status-select.tsx`, so the defect is not introduced by this branch. The branch adds four more status values to the same component, so the pattern now appears more often and is worth fixing in a dedicated a11y pass.

### F4 (P4, introduced by this branch, not a defect against the criteria): raw validation message for an invalid status

`PATCH` with `status: "in_progress"` or an unknown value returns 422 with the Elysia message "Expected kind 'UnionEnum'" or "Expected string length greater or equal to 1". The status field on this branch is a `t.UnionEnum(MILESTONE_STATUSES)`, so this message is new with the new vocabulary. Unknown values are correctly rejected, which is all the acceptance criteria require, and the UI never sends them. A friendlier message would only matter if this endpoint is ever called by a third party.

Notable non-findings, to prevent future re-reporting:

- Phase round writes after leaving the phase return 403 with an accurate reason. The decision doc says "frozen"; 403 is a correct expression of that.
- Double lock, double unlock, deciding a decided request and withdrawing a withdrawn request all return 400 with clear messages.
- The lock refusal is 400 with the exact documented copy.

---

## 10. Not tested

- File uploads and the five viewers (PDF, image, CSV, DOCX, XLSX). Not touched by this branch and verified in phase 4.
- OAuth providers, account deletion, bulk project actions, invitation acceptance, the organization switch guard, and the Redis outage behaviour. Not touched by this branch.
- A true second browser profile. Realtime was proven with one browser plus a real second session through HTTP, which exercises the same server fanout.
- Production compose and the compiled binary in a container. The build passed; deployment is covered by `docs/DEPLOYMENT.md`.

---

## 11. Test data left in the dev database

- Project `HTTP Matrix 1794816679` (`http-matrix-1794816679`) in `qa-studio-p3203518`, kept because the screenshots reference it. It holds the lifecycle milestone, the locked milestone, the moved milestone and the change requests.
- One comment on the lifecycle milestone: "Regression check: comment posted after the lifecycle changes."
- Two throwaway projects were deleted at the end, and their cascade left no orphans.
- The `qa.*` accounts and both QA organizations already existed from phase 3.
- `app_test` is left migrated on the branch schema.

Delete the project to remove all of it.

---

## 12. Verdict

The milestone lifecycle feature behaves as `docs/MILESTONE-LIFECYCLE.md` describes, at the database, service, HTTP and UI layers. The new automated tests are broad and the numbers went up on every suite with zero failures. No previous behaviour was broken in the areas tested. Query plans and API timings at 5,003 milestones per project stay in the single digit milliseconds, with two documented indexing options that only matter at much larger volume. The only open items are pre-existing accessibility debt (F1 to F3) and one low-priority validation message (F4), none of which block the feature.
