# Phase 3: Live End-to-End Report

**Project:** Handoff (ultra-handoff monorepo)
**Branch:** `the-fixess`
**Date:** 8 Nov 2026
**Mode:** Live testing against the running dev stack. No application code was changed.
**Stack:** web 3000, api 3001, postgres 5432, redis 6379, mailpit 8025, seaweedfs 8333.
**Driver:** Chrome DevTools MCP with one isolated browser context per persona, plus direct HTTP for the security negatives.

**Context:** the app is not hosted yet; this phase ran entirely against the local dev stack. Items about production defaults are pre-deployment risks, not current incidents. Bull Board and OpenAPI are dev-only and are not mounted when `NODE_ENV=production`, which both the production compose file and the API Dockerfile set.
**Fix tracking:** `qa/FIX-PLAN.md` (batch status, session log).

---

## 1. Method

- Five isolated browser contexts, one per persona, so sessions and cookies never mixed.
- Real sign-up, real email verification, real invitations and real magic links through Mailpit.
- Direct HTTP calls from inside each persona's browser context, so the requests carried that persona's real session cookie.
- Raw `curl` for unauthenticated probes, public file reads and replay tests.
- Lighthouse for accessibility and best practices.
- One controlled Redis outage to test the resilience claim from phase 1.

Screenshots are in `qa/evidence/`. Lighthouse reports are in `qa/evidence/lighthouse/`.

---

## 2. Test data

| Persona | Email | Org role | Project role |
|---|---|---|---|
| Owner | `qa.owner.p3203518@example.com` | owner | owner (overlay) |
| Admin | `qa.admin.p3203518@example.com` | admin | owner (project creator) |
| Member | `qa.member.p3203518@example.com` | member | member |
| Client | `qa.client.p3203518@example.com` | member | client |
| Outsider | `qa.outsider.p3203518@example.com` | member of QA Studio B | none in Studio A |

Organizations:

- `QA Studio p3203518` (`qa-studio-p3203518`), all four members plus the project.
- `QA Studio B p3203518` (`qa-studio-b-p3203518`), outsider only, used for the cross-tenant test.

Passwords: `Handoff1!` initially, then `Handoff2!` for the member after the reset test.

The accounts and both organizations are still in the dev database. The report lists them in section 10 so they can be removed later.

---

## 3. Results summary

| Area | Result | Notes |
|---|---|---|
| Sign up, email verification, first organization | PASS | Mailpit link, verified page, create org, dashboard |
| Invite admin, member, client | PASS | Per-email outcome, seat counts, role chips |
| Accept invitation via magic link | PASS | Admin, member, client, and outsider (second org) |
| Magic link one-time use | PASS | Replay redirects to `INVALID_TOKEN` |
| Invitation one-time use | PASS | Second accept returns `INVITATION_NOT_FOUND` |
| Members page, roles, counts | PASS | 4 members, 1 owner, 1 admin, 2 members, correct dates |
| Project create, overview, members | PASS | Creator becomes project owner, 4 members with roles |
| Milestone create, status change | PASS | To do to In progress to Done, completion timestamp |
| Realtime milestone update | PASS | Second persona saw DONE without reload |
| Comments, author-only edit/delete | PASS | Other roles see no edit/delete controls |
| Realtime comment delivery | PASS | Second persona saw the comment |
| Upload PDF, image, CSV, DOCX, XLSX | PASS | Presign, PUT, verify, attach, all five viewers render |
| Upload wrong type | PASS | Clear rejection, attachment state preserved |
| Upload oversized file | PASS | Clear 10 MB rejection |
| Password reset and session revocation | PASS | Session 401, old password 401, new password 200 |
| Authorization matrix | PASS | See section 6 |
| Cross-tenant access | PASS | Outsider in org B gets 404 for every org A path |
| Public file access after deletion | PASS (as a defect) | All attachments still 200 after project and comments were deleted |
| Open magic-link sign-up | PASS (as a defect) | Arbitrary email created a verified account with no invitation |
| Organization switch guard | PASS | Blocked dialog with the operation reason |
| Redis outage resilience | FAIL | Authenticated requests hang about 30 seconds |
| Accessibility | PASS | Lighthouse accessibility 100 |
| Mobile width | PARTIAL | Browser enforced a 500px minimum, no overflow at 500px |
| Link preview, mentions, OAuth, account deletion, bulk actions | NOT TESTED | Listed in section 9 |

---

## 4. What passed, in detail

### 4.1 Sign up and verification

The landing page exposes Sign in and Sign up. Sign up accepted a name, email and password, showed the password rule inline, and returned a "Check your inbox" state with a resend action. The verification email arrived in Mailpit, its link redirected to `/verify-email?verified=1`, and Continue opened the create-organization dialog. Creating `QA Studio p3203518` with slug `qa-studio-p3203518` landed on the dashboard.

Evidence: `01-landing.png`, `02-signup-check-inbox.png`, `03-email-verified.png`, `04-owner-dashboard.png`.

### 4.2 Invitations and acceptance

The invite dialog accepted a comma or newline separated list, showed ready-to-invite counts, seat usage and role. Admin was invited as admin, member and client as member. The invite page showed the organization, role, masked address (`q***@example.com`) and "Expires in 7 days" without revealing the full address.

Each invitee used "Email me a sign-in link", received a magic link, and landed on the join state. Accepting took them to the organization dashboard. The admin, member and client all ended up with the expected roles.

The second organization invitation exposed a useful control: when the browser already had a different session, the page said "This invitation belongs to another address" and offered "Sign out and use the invited address" instead of accepting as the wrong person.

Evidence: `05-members-page.png`, `06-invite-preview.png`, `07-admin-accepted.png`, `08-admin-dashboard.png`, `09-member-dashboard.png`, `10-client-dashboard.png`, `11-members-after-invites.png`.

### 4.3 Members

After all acceptances the members page showed 4 members: 1 owner, 1 admin, 2 members. Seats committed updated from 1 to 4. Every joined date rendered as day month year (`8 Nov 2026`). The owner and admin controls were correct for the caller's role.

### 4.4 Project and project members

The admin created `QA Website p3203518` with description and slug. The creator became project owner, and the organization owner was added as project owner automatically. The project overview showed members, created and updated dates, and the placeholder for scope and deliveries.

Project members were added one at a time with different roles: member as Member, client as Client. The resulting overview showed 4 members with OWNER, CLIENT, MEMBER and OWNER chips.

During the later authorization matrix, the admin deleted this project. That is correct behaviour: the admin created it, so the admin is a project owner, and project owners may delete. The delete cascaded the milestones, comments and assignments, which the database confirmed. It accidentally became the deletion test, and it produced the strongest evidence for the orphaned file finding, because the uploaded objects survived.

Evidence: `12-project-created.png`, `13-project-members.png`.

### 4.5 Milestones and realtime

The admin created `Homepage design p3203518` from the New dialog, then changed status To do to In progress to Done. The detail pane updated the completion line to "Completed now". The member had the same milestone open in another browser context and moved to DONE without a reload, including the activity rows in the comments timeline. This is real WebSocket delivery, not a refetch.

Evidence: `14-milestone-created.png`, `15-realtime-done-on-member.png`.

### 4.6 Comments

The member posted a comment. It appeared with "Just now" and author-only Edit and Delete controls. The admin, viewing the same thread in another context, saw the comment with Reply and Open as tab but no Edit or Delete. Status changes appeared as timeline events with from and to values.

Evidence: `16-comment-on-admin.png`.

### 4.7 Uploads and viewers

The full pipeline worked for every supported family:

| File | Result |
|---|---|
| `qa-brief.pdf` (388 B) | Attached, PDF viewer rendered "Page 1 of 1" |
| `qa-image.png` (68 B) | Inserted inline as an image node |
| `qa-data.csv` (78 B) | CSV viewer rendered the parsed table |
| `qa-spec.docx` (925 B) | DOCX viewer rendered the document text |
| `qa-budget.xlsx` (2 KB) | Sheet viewer rendered Item, Cost, Design, 1200 |

Negative cases:

- `qa-bad.html` was rejected with "This file type is not supported. PDF, Office, text or ZIP up to 10 MB." and the existing attachment stayed intact.
- An 11 MB PDF was rejected with "This file is too large. PDF, Office, text or ZIP up to 10 MB."

Evidence: `17-pdf-viewer.png`, `18-csv-viewer.png`, `19-docx-viewer.png`, `20-xlsx-viewer.png`.

### 4.8 Password reset

Requesting a reset for the member returned the neutral "If this email exists" response and sent a real email. The link opened `/reset-password?token=...` with new and confirm fields and the same password rule. Setting `Handoff2!` returned "Password updated" and "Every session was signed out after the reset."

Verification from the same context:

| Check | Result |
|---|---|
| Project list after reset | 401 |
| Sign in with old password | 401, "Invalid email or password" |
| Sign in with new password | 200 |

### 4.9 Organization switch guard

With a synthetic long-running operation recorded in localStorage (`Uploading 12 files`) for the current organization, switching to the second organization opened "CAN'T SWITCH RIGHT NOW", showed the exact reason and the target name, and offered Stay here. After clearing the entry, the switcher worked normally and the sidebar followed the new organization.

Evidence: `22-switch-blocked.png`.

### 4.10 Accessibility, responsive and console

Lighthouse on the dashboard:

| Category | Score |
|---|---|
| Accessibility | 100 |
| Best Practices | 96 |
| SEO | 82 |
| Agentic Browsing | 67 |

Failed audits: one console error (a 404 for `/favicon.ico`), missing meta description, invalid `robots.txt`, and an `llms.txt` recommendation. SEO and agentic browsing are not priorities for a private client workspace, but the favicon 404 is a real, trivial defect.

At a 500px viewport (the browser would not go to 390), `scrollWidth` equalled `innerWidth`, so there was no horizontal overflow. The screenshot is `21-mobile-dashboard.png`.

The only console error on the dashboard was the missing favicon. No application exceptions were logged on the pages exercised.

---

## 5. Defects found in phase 3

### P3-F1: Redis outage hangs every authenticated request for about 30 seconds

**Severity:** High, availability
**Where:** `apps/api/src/auth/secondary-storage.ts`, `apps/api/src/lib/redis.ts`, session lookup path

While Redis was stopped, the API process stayed up and `/health` returned 200. An authenticated request from a real persona, `GET /orgs/qa-studio-p3203518/projects`, did not fail fast. It hung for **29.7 seconds** and then failed in the browser with `TypeError: Failed to fetch`. The API log filled with repeated `DNSException: getaddrinfo ENOTFOUND redis`.

The "fail soft" secondary storage only catches a rejected command. ioredis queues commands while disconnected and retries indefinitely, so the `get` never settles, and the fallback to the database copy is never reached. Monitoring that only probes `/health` will report the API as healthy while every logged-in user is blocked.

After Redis restarted, the same request returned 200 in 9 ms, so recovery is immediate.

**Impact:** A Redis restart, failover or network blip becomes a full authentication outage that looks healthy to the health check.

**Recommendation:** Configure the Redis clients with `enableOfflineQueue: false` and a short `commandTimeout` and `connectTimeout`, and wrap secondary storage reads in a timeout race that falls back to Postgres. Add an authenticated request to the health probe, not only `/health`.

**Evidence:** shell timings and API log excerpt captured in the session. This finding replaces the phase 1 hypothesis that the process would crash; it did not crash.

### P3-F2: The app shell does not follow the organization in the URL

**Severity:** Medium, UX and consistency
**Where:** `apps/web/src/routes/_app.tsx`, `apps/web/src/components/app-sidebar/*`

After creating a second organization, the owner manually opened the first organization's URL. The page loaded the first organization's data, because the API is slug scoped, but the sidebar, breadcrumb and every navigation link still showed and pointed at the active organization, which was the second one. Clicking "All projects" from that page would have taken the user to the wrong workspace.

The switcher fixes the state, so this only affects deep links, bookmarks and tabs that were opened before a switch.

**Impact:** Confusing navigation. No data leak, because the API uses the URL slug, not the active organization.

**Recommendation:** Derive the shell's organization from the `$orgSlug` route param, or call `setActive` when the URL slug does not match the active organization, and show the URL organization consistently until the switch completes.

### P3-F3: Missing favicon causes a 404 on every page

**Severity:** Low
**Where:** `apps/web` static assets

`GET /favicon.ico` returns 404. It is the only console error on the dashboard and the reason Best Practices is 96 instead of 100.

**Recommendation:** Add a favicon and a link tag.

### P3-F4: Missing SEO metadata

**Severity:** Low, not a product priority
**Where:** root route head

No meta description, `robots.txt` is invalid, and `llms.txt` does not follow recommendations. For a private workspace this is acceptable, but the public marketing page should have a description and a deliberate robots policy.

### P3-F5: The generic magic-link route lands on the API origin

**Severity:** Low
**Where:** `apps/api/src/auth/auth.ts`, magic link plugin

Calling `POST /api/auth/sign-in/magic-link` without a `callbackURL` produces a link that lands on `http://localhost:3001/`, which renders the leftover `"Hello Huzaifa"` string. The invitation flow always passes an absolute web URL, so this only affects direct API callers. It reinforces P1-H1: the generic route is public and is not the intended entry point.

**Recommendation:** Disable sign-up on the plugin (P1-H1) and set a safe default callback to the web origin.

### P3-F6: TanStack Devtools is visible in the app

**Severity:** Low
**Where:** `apps/web/src/routes/__root.tsx`

The "Open TanStack Devtools" control is present in the shell for every persona. This confirms the phase 1 finding that the devtools bundle ships to production.

**Recommendation:** Mount it only in development.

---

## 6. Security matrix, live

All requests carried the persona's real session cookie.

| Request | Member | Client | Admin | Owner | Outsider (org B) |
|---|---|---|---|---|---|
| Own project detail | 200 | 200 | 200 | 200 | 404 |
| Private project detail | 404 | 404 | 404 | 200 | 404 |
| Patch private project | 404 | n/a | n/a | n/a | n/a |
| Sibling project with other project's milestone id | 404 | n/a | n/a | n/a | n/a |
| Create project | 403 | n/a | allowed | allowed | n/a |
| Patch own project | n/a | 403 | allowed | allowed | n/a |
| Create milestone | allowed | 403 | allowed | allowed | n/a |
| Delete milestone | allowed | 403 | allowed | allowed | n/a |
| Change the owner's role | 403 | n/a | n/a | n/a | n/a |
| Delete the organization | 403 | n/a | n/a | n/a | n/a |
| Org A project list | 200 | 200 | 200 | 200 | 404 |
| Org B project list | n/a | n/a | n/a | n/a | 200 |

Additional unauthenticated probes:

| Probe | Result |
|---|---|
| `GET /orgs/qa-studio-p3203518/projects` with no cookie | 401 |
| `POST /uploads` with no cookie | 401 |
| `GET /files/../etc/passwd` | 404 |
| `GET /bull-board/` with no cookie | 200 |

The last row confirms P1-C1 on the dev stack. The path traversal attempt is safely rejected.

---

## 7. Phase 1 findings, verified live

| Finding | Result |
|---|---|
| P1-C1, unauthenticated Bull Board | Confirmed on the dev stack, HTTP 200. Not a production finding: it is mounted only when `NODE_ENV` is development, and the production compose and Dockerfile set `NODE_ENV=production`. |
| P1-H1, open magic-link sign-up | Confirmed. A request for `qa.open.p3203518@example.com` sent a link; verifying it created a verified user with no invitation and no organization. The row was deleted afterwards. |
| P1-H4 and P1-M7, public files and orphaned objects | Confirmed. After the project and its comments were deleted (database shows 0 comments for that workspace), all five attachments still returned 200 to an unauthenticated request. |
| P1-H5, Redis crash | Disproved. The API did not crash. The real defect is P3-F1. |
| P1-M11, devtools in production | Confirmed. |
| P1-M13, leftover root string | Confirmed at `http://localhost:3001/`. |
| P1-M21, no CI | Unchanged. |

The public file URLs that still worked after deletion:

```
/files/organizations/<org>/comments/images/<id>.png                      200 image/png
/files/organizations/<org>/comments/files/<id>.pdf                      200 application/pdf
/files/organizations/<org>/comments/files/<id>.csv                      200 text/csv
/files/organizations/<org>/comments/files/<id>.docx                     200 application/vnd...wordprocessingml.document
/files/organizations/<org>/comments/files/<id>.xlsx                     200 application/vnd...spreadsheetml.sheet
```

---

## 8. Coverage against the phase 3 plan

| Planned area | Status |
|---|---|
| Signup, verify, login, session | Covered, except OAuth |
| Password reset and session revocation | Covered |
| Magic link | Covered, including replay |
| Organization create, invite, accept, switch | Covered |
| Organization switch guard | Covered |
| Projects, archive, delete | Create, members and delete covered; archive and bulk not exercised in the UI |
| Project members and roles | Covered |
| Milestones, statuses, dates, assignees | Create and status covered; dates, estimate and assignees not exercised in the UI |
| Comments, mentions, link previews | Comments covered; mentions and link previews not exercised in the UI |
| Files and viewers | PDF, image, CSV, DOCX, XLSX covered; wrong type and size covered |
| Authorization and cross-tenant | Covered at the HTTP layer |
| Account settings and deletion | Password reset covered; profile, avatar, sign-in methods and deletion not exercised |
| A11y, responsive, performance | Lighthouse and 500px layout covered; keyboard-only pass not done |
| Performance smoke | Not measured beyond Lighthouse; dev mode is not representative |

---

## 9. Not covered, and why

- **OAuth with GitHub and Google.** Needs real provider accounts and redirects; the buttons are present.
- **Account deletion.** Needs an owner who has transferred ownership or is not the last owner. The confirmation email flow was not run.
- **Avatar, organization logo and project logo uploads.** Only comment attachments were exercised. The same pipeline is shared, but the logo post-processing and cleanup were not tested live.
- **Archive, bulk archive, bulk delete, bulk role change, bulk remove.** The single-item paths were tested; the bulk paths were not.
- **Milestone dates, estimate, assignee picker, filters, sort and search.** The controls were visible; the interactions were not completed.
- **Mention picker and link preview cards.** The project under test was deleted during the delete test, so the remaining comments surface was gone. Unit tests cover the parsing and sanitization.
- **Keyboard-only and screen-reader pass.** Lighthouse accessibility is 100, but no manual keyboard walkthrough was done.
- **Load and concurrency.** The phase 1 performance findings remain code-reading estimates.

---

## 10. Test data left behind

If you want the dev database clean, these are the rows to remove:

```
organizations: qa-studio-p3203518, qa-studio-b-p3203518
users:         qa.owner.p3203518@example.com, qa.admin.p3203518@example.com,
               qa.member.p3203518@example.com, qa.client.p3203518@example.com,
               qa.outsider.p3203518@example.com
```

Deleting the organizations cascades projects, milestones, comments, members and invitations. The five uploaded objects remain in SeaweedFS, which is itself the P1-H4 and P1-M7 defect. They can be removed by key prefix if you want a full cleanup.

The pre-existing `neworg` data was not touched.

---

## 11. Recommended order after phase 3

1. **P3-F1**: make Redis failures fail fast, and add an authenticated probe. This is the most serious live defect.
2. **P1-H1 / P1-H2**: close magic-link sign-up and implicit account linking. These are real in every environment.
3. **P1-H3 / P1-M1**: make production configuration fail closed. Do this before the planned deployment next month.
4. **P1-H4 / P1-M7**: decide the file access model and delete objects on delete.
5. **P3-F2**: make the shell follow the URL organization.
6. **P1-C1 (dev only)**: bind the dev API port to loopback, or protect Bull Board. Production already excludes it.
7. **P3-F3 / P3-F4**: favicon and metadata.
8. **P3-F5 / P3-F6**: default magic-link callback and devtools in development only.

---

## Appendix A: Evidence

```
qa/evidence/01-landing.png
qa/evidence/02-signup-check-inbox.png
qa/evidence/03-email-verified.png
qa/evidence/04-owner-dashboard.png
qa/evidence/05-members-page.png
qa/evidence/06-invite-preview.png
qa/evidence/07-admin-accepted.png
qa/evidence/08-admin-dashboard.png
qa/evidence/09-member-dashboard.png
qa/evidence/10-client-dashboard.png
qa/evidence/11-members-after-invites.png
qa/evidence/12-project-created.png
qa/evidence/13-project-members.png
qa/evidence/14-milestone-created.png
qa/evidence/15-realtime-done-on-member.png
qa/evidence/16-comment-on-admin.png
qa/evidence/17-pdf-viewer.png
qa/evidence/18-csv-viewer.png
qa/evidence/19-docx-viewer.png
qa/evidence/20-xlsx-viewer.png
qa/evidence/21-mobile-dashboard.png
qa/evidence/22-switch-blocked.png
qa/evidence/lighthouse/report.html
qa/evidence/lighthouse/report.json
```

## Appendix B: Commands and probes

```bash
# stack health
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/health
curl -s -o /dev/null -w "%{http_code}" http://localhost:8025/

# unauthenticated checks
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/orgs/qa-studio-p3203518/projects
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3001/uploads -H 'content-type: application/json' -d '{}'
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/bull-board/

# open magic-link sign-up
curl -s -X POST http://localhost:3001/api/auth/sign-in/magic-link \
  -H 'content-type: application/json' \
  -d '{"email":"qa.open.p3203518@example.com","name":"Open Signup"}'

# Redis outage
docker stop ultra-dev-redis-1
# authenticated request from the browser context: hung 29.7 s, then Failed to fetch
docker start ultra-dev-redis-1
```

No application source file was modified in phase 3.
