# Member Profile Views Test Report

**Date:** 25 Nov 2026
**Branch:** `feature/profile-views`
**Feature commits:** `5a3c566`, `80bfcb7`, `0bc2282`, `424e846`
**Fix commit:** `2afd4ea`
**QA report commit:** `b7053ae`
**Test cases:** `qa/profile-views-test-cases.md`
**Environment:** live dev stack, web `http://localhost:3000`, API `http://localhost:3001`
**Workspace:** Retest B (`retest-b-brtmwt2gq2z`)
**Method:** static review, API checks in the browser session, Chrome DevTools browser pass, Lighthouse, unit, integration and type checks

---

## 1. Verdict

The feature works as designed on the happy path, on the security boundaries that
matter, and on the accessibility checks. No critical or high severity defect was
found in the first pass.

All four actionable findings from that pass are now fixed and retested:

1. A 404 profile is no longer retried. A former member's card shows the correct
   state immediately and the trigger stops being a link.
2. A capped assignment list now returns `hasMoreAssignments`, and the page shows
   a plus sign and a "Showing the first 50" note instead of a complete looking
   partial list.
3. A former member's comment avatar is plain from the start, and a mention chip
   becomes a disabled link once the 404 is known.
4. Assignments without a due date no longer render a "No due date" line.

The only remaining item is F5, which is expected behaviour for a private,
`noindex` application and is not a defect.

---

## 1a. Retest after fixes

The fixes were retested on 25 Nov 2026 against the live dev stack and the test
database.

| Check | Result |
|---|---|
| Former member profile request | One 404, no retries (was four) |
| Former member mention card | Shows "No longer in this workspace" in about one second; chip becomes `aria-disabled` with no `href`; card stays open |
| Former member comment avatar | Rendered as a plain avatar with no link |
| 51 live assignments | API returns 50 rows and `hasMoreAssignments: true`; page shows `50+` and "Showing the first 50 open assignments." |
| Assignment without a due date | No date line is rendered |
| Valid mention card | Still opens with the profile data and an active profile link |
| API unit tests | 503 pass, 150 skip, 0 fail |
| Integration suite | 624 pass, 0 fail |
| Web tests | 115 pass, 0 fail |
| Type check, Biome, web build | Pass |

Two regression tests were added: a 51 assignment truncation test in
`member-profile.integration.test.ts`, and a former comment author test in
`tenant-boundary-comments.integration.test.ts` that removes the membership and
asserts `author.isMember` is false.

---

## 2. Scope and fixtures

The pass used the existing Retest B QA workspace and added the following
fixtures without changing application code:

| Fixture | Purpose |
|---|---|
| `job_title`, `bio`, `location` on Retest Member B | Card and page content, XSS check |
| `job_title`, `bio`, `location` on Retest Owner A | Self profile and form save |
| `qa-profile-hidden-project` plus owner membership | Project the viewer must not see |
| `qa-profile-done-ms` (done) | Must not appear as assigned work |
| `qa-profile-hidden-ms` (todo, hidden project) | Must not appear as assigned work |
| `qa-profile-assignee-live` / `done` / `hidden` / `self` | Assignment filtering |
| `qa-profile-former-user` and comment, member row deleted | Former member card and 404 |
| `qa-profile-former-mention-comment` | Former member mention chip, disabled link after 404 |
| `qa-profile-empty-user` and member row | Empty states |
| 51 `qa-profile-bulk-ms-*` milestones and assignments | Assignment cap and `hasMoreAssignments` |

The XSS payload used as a bio during the test was `"<script>window.__profileXss=1</script><img src=x onerror=\"window.__profileXss=2\">Plain text bio"`. The bio was restored to `"Runs client delivery for the studio."` after the test.

The visitor account for the pass is the existing `Retest Owner A` member
session in the Chrome profile. No passwords were entered or changed.

---

## 3. Automated results

| Check | Command | Result |
|---|---|---|
| Biome | `bun run check` | 621 files, no issues |
| Type check | `bunx nx run-many -t typecheck -p api web` | Pass |
| API unit tests | `cd apps/api && bun test` | 503 pass, 149 skip, 0 fail |
| API integration suite | `cd apps/api && bun run test:db` | 616 pass, 0 fail |
| Web tests | `cd apps/web && bun test` | 115 pass, 0 fail |
| Web build | `VITE_API_URL=https://api.example.com bunx nx run web:build` | Pass |
| API build | `bunx nx run api:build` | Pass |
| Lighthouse, profile page | Chrome DevTools audit | Accessibility 100, Best Practices 100, SEO 63, Agentic 67 |

The SEO and Agentic scores are expected for an authenticated application that
sets `noindex` and does not ship an `llms.txt`. They are not defects for this
feature.

The integration suite includes the new `member-profile.integration.test.ts`
with six tests: identity and optional fields, hidden project filtering, owner
overlay, live-only assignments, outsider 404 and a second workspace read.

---

## 4. API results

All checks were made in the signed-in browser session against the live API.

| ID | Result | Observation |
|---|---|---|
| PV-01 | Pass | Owner profile returned 200 with 769-byte body: name, email, job title, bio, location, role, `joinedAt`, one visible project, one live assignment, counts. |
| PV-02 | Pass | Self profile returned `isSelf: true`. |
| PV-03 | Pass | Outsider id returned 404, "That person is not part of this workspace." |
| PV-04 | Pass | `curl` without the session cookie returned 401. |
| PV-05 | Pass | `QA Hidden Project` was absent from the owner's profile as seen by the member. |
| PV-06 | Pass by integration test | The owner overlay is covered by the integration suite. Not repeated live because the owner already had explicit rows. |
| PV-07 | Pass | `Retest Milestone B` (todo) appeared; `QA Finished Work` (done) did not. |
| PV-08 | Pass | The assignment in `QA Hidden Project` did not appear. |
| PV-09 | Pass | Email was present for a workspace member. |
| PV-10 | Pass | The migration is three nullable `ALTER TABLE` statements. The dev database already had the columns and no backfill was needed. |

### Security review of the read path

- `:orgSlug` is resolved by the tenant macro after a membership check. The
  service is never reached for a workspace the caller does not belong to.
- The target is resolved with `getOrganizationMember`, so a user id from another
  workspace is indistinguishable from a missing account.
- Business data runs inside `withTenant`, so RLS is active as a second boundary.
- Project visibility uses `projectVisibility`, the same clause as the project
  list and mention search.
- Assignments are filtered to live statuses and non-archived projects.
- Better Auth tables are read on the privileged client, matching the existing
  organization service pattern.
- No new write path was added. The only write is the existing Better Auth
  `updateUser` with validators.

---

## 5. Browser results

Chrome DevTools, signed in as Retest Owner A (organization member). The
workspace theme was switched between system dark, light and mobile during the
pass.

| ID | Result | Observation |
|---|---|---|
| PV-11 | Pass | Members table hover opened the card with Delivery lead, Owner, bio, 23 Nov 2026, Lahore, Pakistan, Retest Project B and the CTA. The hidden project was absent. |
| PV-12 | Pass | Moving the pointer to the page heading closed the card. |
| PV-13 | Pass | Keyboard focus opened the card after the warmup delay; Escape closed it. |
| PV-14 | Pass | Fresh page, zero `/people/` requests before hover. |
| PV-15 | Pass | Hover then click within 60 seconds used one request. A second request appears only after the query is older than the 60 second stale window, which is expected. |
| PV-16 | Pass | Hovering the `@Retest Owner A` mention chip opened the correct card. |
| PV-17 | Pass | Hovering the comment author avatar opened the card. |
| PV-18 | Pass | Hovering the milestone assignee stack opened the card. |
| PV-19 | Pass | Hovering the project header member stack opened the card. The member card and dialog use the same component. |
| PV-20 | Pass with delay | The former member card eventually showed "No longer in this workspace" with no link. It stayed on the skeleton for about seven seconds. See finding F1. |
| PV-21 | Pass in real use | A single synthetic DevTools hover does not open the card until React Aria's modality is pointer. A synthetic `pointermove`, or any real mouse movement, makes the first hover work. This is tooling behaviour, not a product defect. See section 7. |
| PV-22 | Pass | Clicking the avatar navigated to `/people/:userId`. |
| PV-23 | Not run | Sidebar self avatar and organization logos are intentionally not wrapped. Verified by code review only. |
| PV-24 | Pass | Header, About, Projects and Assigned work rendered with the expected values. |
| PV-25 | Pass | All visible dates used day month year, for example `23 Nov 2026`. |
| PV-26 | Pass | Copy button showed "Email address copied." |
| PV-27 | Pass | Self profile showed the `You` badge and an Edit profile link to `/account`. |
| PV-28 | Pass | `QA Empty Profile` showed "No shared projects yet." and "No open work assigned." |
| PV-29 | Pass | Outsider id showed the "Profile not found" card and a Back to members link. No crash. |
| PV-30 | Pass | Breadcrumb read `RETEST B > RETEST MEMBER B`. |
| PV-31 | Pass | Dark and light screenshots both used the app tokens. No literal colors were introduced. |
| PV-32 | Pass | At 390 x 844 the header stacked, the avatar centered, facts wrapped and the cards stacked in one column. |
| PV-33 | Pass | Only expected 404 and 400 network errors appeared. No React or runtime errors. |
| PV-34 | Pass | Accessibility 100. |
| PV-35 | Pass | Saving Quality lead, Karachi, Pakistan and a bio showed "Profile updated." and the profile reflected it. |
| PV-36 | Pass | A 501 character bio returned 400, "Bio must be 500 characters or fewer." |
| PV-37 | Pass | Inputs expose `maxlength` 80, 80 and 500, and the bio is a 4 row textarea. |
| PV-38 | Pass | Whitespace and empty values returned null from the API and the profile hid the fields. |
| PV-39 | Pass | The script and image payload rendered as literal text on the page and in the hover card. `window.__profileXss` stayed null and no injected image element existed. |
| PV-40 | Pass | After the save, the mention chip card showed "Quality lead" and the new bio. |
| PV-41 | Pass | Members table, project members, milestone list and comments all rendered; no layout break. |
| PV-42 | Not run | Low risk, code review only. |
| PV-43 | Pass | See section 3. |

### Evidence

| File | Content |
|---|---|
| `qa/evidence/profile-views/01-members-hover-card-dark.png` | Members table hover card in dark mode |
| `qa/evidence/profile-views/02-profile-page-dark.png` | Full profile page in dark mode |
| `qa/evidence/profile-views/03-mention-hover-card.png` | User mention chip hover card |
| `qa/evidence/profile-views/04-profile-page-light.png` | Profile page in light mode |
| `qa/evidence/profile-views/05-profile-mobile.png` | Profile page at 390 x 844 |
| `qa/evidence/profile-views/06-former-member-card.png` | Former member card after retries |
| `qa/evidence/profile-views/07-profile-not-found.png` | Outsider profile not found |

---

## 6. Findings

### F1. Former member hover card stays on the skeleton for about seven seconds

**Severity:** Medium
**Type:** UX, error handling
**Where:** `apps/web/src/features/people/hooks.ts`, `member-hover-card.tsx`

A profile request for a removed member returns 404. TanStack Query retries three
times by default, and `isPending` stays true while retrying, so the card shows
the loading skeleton for about seven seconds before it renders "No longer in
this workspace". The full profile page shows its error card immediately because
`isError` flips on the first failure, but it still makes the three retries in the
background.

**Reproduction:** hover the avatar of `QA Former Member` in the milestone
comments.

**Status:** Fixed on 25 Nov 2026.

**Fix:** `useMemberProfile` now refuses to retry 4xx responses and caps 5xx at
two retries. A former member profile makes one request and the card renders the
former state immediately. The retest confirmed one 404 request and no retry
burst.

### F2. Assignment list truncates at 50 with no "more" signal

**Severity:** Low to Medium
**Type:** Data completeness
**Where:** `apps/api/src/services/member-profile.service.ts`

The assignments query has `.limit(ASSIGNMENT_LIMIT)` with `ASSIGNMENT_LIMIT = 50`,
and `counts.assignments` is the length of the returned array. A person with 51
open assignments sees a list and a count of 50, presented as complete. The same
is true for the card, which slices to three and shows "+N more", but the total
is already capped.

**Status:** Fixed on 25 Nov 2026.

**Fix:** the query reads `ASSIGNMENT_LIMIT + 1` rows, returns at most 50, and
sets `hasMoreAssignments` when the extra row exists. The page shows `50+` and
"Showing the first 50 open assignments." A 51 assignment integration test now
pins the behaviour.

### F3. Former member avatars still link to a 404 profile

**Severity:** Low
**Type:** UX
**Where:** `member-hover-card.tsx`

The avatar link is rendered before the profile is fetched, so a removed member's
avatar still navigates to a profile that returns 404. The page handles it with a
friendly not-found card, and the hover card shows the correct state after F1 is
fixed. A full fix would need the member list to include a "still a member" flag,
which is a larger change.

**Status:** Fixed on 25 Nov 2026.

**Fix:** the comment payload now carries `author.isMember`, read from the
membership table in the same page load. A former author gets a plain avatar with
no link. A mention chip starts as a link, and once its profile 404s the trigger
switches to a disabled link with no `href`, while the card stays open and
explains the state. A comment integration test removes a membership and asserts
`isMember` is false.

### F4. "No due date" appears under every assignment without a due date

**Severity:** Info
**Type:** Design
**Where:** `profile-assignments.tsx`

`describeDueDate` returns "No due date" for a null value, so the card showed a
calendar icon and that text for every such assignment. It was informative but
added a line per row.

**Status:** Fixed on 25 Nov 2026. The date line renders only when a due date
exists. Assignments without one now show just the title, project and status.

### F5. SEO and Agentic Lighthouse scores are not full marks

**Severity:** Info
**Type:** Expected
**Where:** app shell

SEO 63 is caused by the deliberate `noindex` on an authenticated product.
Agentic 67 is the Lighthouse `llms.txt` recommendation, which does not apply to
an internal workspace. Accessibility and Best Practices are both 100.

---

## 7. Automation note

The Chrome DevTools MCP `hover` command dispatches a single mouse move. React
Aria's `PreviewTrigger` only opens on hover when the interaction modality is
`pointer`, and a single synthetic move does not always update that modality
before the hover handler runs. Hovering after a click, or after a synthetic
`pointermove` on the document, opens the card on the first hover. Real mouse
movement generates a stream of pointer moves, so this is a test harness detail,
not a product defect. Future automation should click the page or dispatch a
`pointermove` before asserting a hover card.

The other tooling quirk: the DevTools `fill` command appends to the existing
value on the aria-sera `TextArea`. The boundary check was therefore done through
the auth endpoint, which is the same path the form uses.

---

## 8. Coverage gaps and residual risk

| Area | Status | Note |
|---|---|---|
| Touch long press on a real device | Not run | RAC handles it; needs a touch device or emulation with touch events. |
| Archived project with a live assignment | Not run live | Covered by the `isNull(project.archivedAt)` filter in code review. |
| Organization owner viewing their own implicit projects | Integration test only | Not repeated live because the fixture had explicit rows. |
| Very large workspace (many projects or assignments) | Not run | The 50 assignment cap is now labelled with a plus sign. The projects list is unbounded by design. |
| Rate limiting on profile reads | Not applicable | Authenticated workspace read; hover cards are cached and only fetch on open. |
| Screen reader announcements for the hover card | Partial | Lighthouse 100 and the a11y tree exposes the card as a described dialog with a Dismiss button. A manual NVDA or VoiceOver pass is still worth doing. |

---

## 9. Recommendation

All actionable findings are fixed and covered by automated tests. F5 is expected
for a private, `noindex` application and should stay as it is.

The feature matches the plan: tenant scoping, project visibility, plain text
rendering, keyboard access, day month year dates, a single cached profile read
shared by the card and the page, and honest signalling when a list is capped.

---

## Appendix: fixture cleanup (optional)

The fixtures live only in the `Retest B` QA workspace. To remove them:

```sql
delete from comment where id in (
  'qa-profile-former-comment',
  'qa-profile-former-mention-comment'
);
delete from "user" where id = 'qa-profile-former-user';
delete from member where id = 'qa-profile-empty-member';
delete from "user" where id = 'qa-profile-empty-user';
delete from milestone_assignee where id like 'qa-profile-assignee-%';
delete from milestone_assignee where id like 'qa-profile-bulk-assignee-%';
delete from milestone where id like 'qa-profile-bulk-ms-%';
delete from project where id = 'qa-profile-hidden-project';
delete from milestone where id in ('qa-profile-done-ms', 'qa-profile-hidden-ms');
```

The profile fields on Retest Member B and Retest Owner A were set to normal
values after the test and do not need cleanup.
