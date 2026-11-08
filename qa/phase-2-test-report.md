# Phase 2: Automated Test Report

**Project:** Handoff (ultra-handoff monorepo)
**Branch:** `the-fixess`
**Date:** 8 Nov 2026
**Mode:** Testing only. No application code was changed. New files are test files and this report.
**Database:** throwaway `app_test` on the existing Postgres container. The dev database was not touched.

---

## 1. What was done

1. Ran the existing suite to establish a baseline.
2. Ran the existing type, lint and RLS checks to establish a baseline.
3. Created an isolated `app_test` database, bootstrapped the tenant role and applied every migration.
4. Added 178 tests across 12 new files, at three levels: pure unit, service validation and real database integration.
5. Ran every suite twice, including a repeat of the database suite, and verified the test database is empty afterwards.

---

## 2. Baseline before any new test

| Check | Command | Result |
|---|---|---|
| API unit tests | `cd apps/api && bun test` | 197 pass, 0 fail, 11 files |
| Web unit tests | `cd apps/web && bun test` | 43 pass, 0 fail, 5 files |
| RLS verification | `cd apps/api && bun run db:verify-rls` | 18 of 18 checks pass |
| API typecheck | `tsc --noEmit -p tsconfig.json` | clean |
| Web typecheck | `tsc --noEmit -p tsconfig.json` | clean |
| UI typecheck | `tsc --noEmit -p tsconfig.json` | clean |
| Lint | `bun run check` | 17 errors, 9 warnings |
| Nx typecheck target | `bunx nx run-many -t typecheck` | fails, see P2-F3 |
| CI | `.github/workflows` | empty |

Baseline total: **240 passing tests, all unit level.** There was no database-backed automated test before this phase. The only database proof was the standalone `verify-rls` script.

The RLS script was run against `app_test` and passed 18 of 18, covering unscoped reads, scoped reads, cross-tenant insert, update and delete, Better Auth table denial, per-workspace slug uniqueness and the organization delete cascade.

---

## 3. New tests

| File | Level | Tests | What it pins |
|---|---|---|---|
| `apps/api/src/auth/permissions.test.ts` | unit | 24 | Role parsing, manager predicates, invite role allowlist, org slug and name validation |
| `apps/api/src/auth/project-permissions.test.ts` | unit | 30 | Project role overlay, edit and delete matrix, archived visibility, member role assignment, slug and name rules |
| `apps/api/src/auth/milestone-permissions.test.ts` | unit | 20 | Status vocabulary, title bounds, real calendar dates, date range, estimate bounds, client read-only |
| `apps/api/src/lib/storage/config.test.ts` | unit | 14 | Upload policy table, MIME allowlist, HTML and SVG exclusion, per-purpose prefixes, public key allowlist |
| `apps/api/src/lib/storage/image.test.ts` | unit | 4 | PNG and JPEG byte sniffing, rejection of GIF, WebP, SVG and HTML, truncated buffers |
| `apps/api/src/lib/password.test.ts` | unit | 8 | All four character classes, both bounds, shared error copy |
| `apps/api/src/lib/query.test.ts` | unit | 5 | LIKE escaping for `%`, `_` and backslash |
| `apps/api/src/lib/auth-error.test.ts` | unit | 8 | Status mapping, code mapping, raw message fallback |
| `apps/api/src/services/upload.service.test.ts` | unit | 9 | Every upload rejection that happens before Redis or S3 |
| `apps/api/src/services/tenant-boundary.integration.test.ts` | integration | 37 | RLS, project visibility, archive rules, milestone and comment IDOR, assignee injection, author-only edits |
| `apps/web/src/lib/date.test.ts` | unit | 14 | Day month year order, local day keys, relative labels, invalid values |
| `apps/web/src/features/files/viewer-kind.test.ts` | unit | 5 | Viewer routing by MIME and extension, unsupported types |

Total new: **159 API tests and 19 web tests, 178 in total.**

### What the integration suite proves

The suite seeds two organizations, four users in the first and two in the second, three projects (one with no project member rows, to prove the organization owner overlay) and three milestones. It then attempts:

- An unscoped tenant read, which returns zero rows.
- A scoped read, which only sees its own organization.
- A cross-tenant insert, which Postgres rejects with SQLSTATE 42501.
- A member reading a project they do not belong to, which returns 404.
- An organization owner reading a project with no member rows, which succeeds through the overlay.
- A member listing projects, which excludes hidden projects and the other tenant.
- A slug lookup for a hidden project, which returns 404.
- A member creating or deleting a project, which is forbidden.
- A client editing a project or writing a milestone, which is forbidden.
- Archiving, which hides the project from members and clients but not owners, and locks milestone and comment writes.
- Client archive visibility opt-in, which keeps the project visible to the client only.
- Milestone id swaps across projects and tenants, including the sharper case where the caller can see both sibling projects.
- Assigning someone who is not on the project, which is rejected.
- A client commenting successfully.
- Editing or deleting someone else's comment, which is forbidden.
- Replying to a deleted comment, which is rejected.
- Reading a discussion through a sibling milestone, which returns 404.

The suite is gated. It only runs when `TEST_DATABASE=1` and the admin URL contains `/app_test`, so it cannot accidentally write to the dev database.

---

## 4. Results after the new tests

| Check | Command | Result |
|---|---|---|
| API, unit only | `cd apps/api && bun test` | **319 pass, 39 skip, 0 fail**, 21 files |
| API, with database | `TEST_DATABASE=1 DATABASE_URL=... bun test` | **356 pass, 0 fail**, 21 files |
| Web | `cd apps/web && bun test` | **62 pass, 0 fail**, 7 files |
| Combined, with database | both projects | **418 pass, 0 fail** |
| Integration repeat | run twice | 37 of 37 both times |
| Test database after run | row counts | organizations 0, users 0, projects 0, milestones 0, comments 0 |
| API typecheck | `tsc --noEmit` | clean |
| Web typecheck | `tsc --noEmit` | clean |
| New files lint | `biome check` on the 12 new files | clean |

The 39 skips in the default run are the integration suite. That is intentional: a developer without a test database still gets a green unit run in under a second.

Growth: **240 to 418 passing tests, and 0 to 37 real database tests.**

---

## 5. Findings from phase 2

### P2-F1: Viewer routing contradicts its own documented precedence

**Severity:** Low
**Where:** `apps/web/src/features/files/viewer-kind.ts:43-59`

The module comment says "The MIME type wins when it is specific. The extension is the fallback." The code checks `extension === "pdf"`, `extension === "csv"` and `extension === "txt"` before comparing the MIME for those types. A file named `report.pdf` with `text/csv` is routed to the PDF viewer, and `notes.txt` with a DOCX MIME is routed to the text viewer.

**Impact:** A mislabelled attachment opens the wrong viewer and fails to render or shows binary content. It is not a security issue because every viewer handles failure and the bytes are still served with a fixed type.

**Test:** `viewer-kind.test.ts` pins the current behaviour with a comment, so a fix is a deliberate change rather than an accidental one.

### P2-F2: Target-only permission predicates are easy to misuse

**Severity:** Low, latent
**Where:** `apps/api/src/auth/permissions.ts:181-188`, `apps/api/src/auth/project-permissions.ts:248-255`

`canManageTarget(actorRole, targetRole)` and `canManageProjectTarget(actorRole, targetRole)` inspect the target role but do not first prove the actor is a manager. As standalone predicates, `canManageTarget("member", "member")` returns true and `canManageProjectTarget("member", "client")` returns true.

Every current caller checks the actor first (`assertManager`, `canManageMembers`, `canManageProjectMembers`), so there is no live hole. The risk is a future route that reuses the predicate without the earlier guard.

**Recommendation:** Fold the actor check into the predicate, or rename it to `isManageableTarget` so the missing precondition is obvious. The integration suite proves the service-level order is correct today.

### P2-F3: The Nx typecheck target is broken

**Severity:** Medium, tooling
**Where:** `nx.json` typecheck defaults, `@nx/js/typescript` plugin, project tsconfigs

`bunx nx run-many -t typecheck` fails before checking any code:

- `api:typecheck` runs `tsc --build tsconfig.json --emitDeclarationOnly` but the project does not set `declaration` or `composite`, so TypeScript rejects the invocation with TS5069.
- `@org/ui:typecheck` is disabled because a project reference sets `noEmit: true`.
- `web:typecheck` never runs because Nx stops on the API failure.

This is why the phase 1 review could not rely on the Nx target. Direct `tsc --noEmit` is clean for API, web and UI.

**Recommendation:** Give each project a proper composite declaration build, or set the target to `tsc --noEmit -p tsconfig.json` and remove `emitDeclarationOnly`. Then wire it into CI.

### P2-F4: `bun run check` is red, and it lints vendored skill files

**Severity:** Medium, tooling and quality
**Where:** `biome.json`, `packages/ui/src/components/ui/*`, `.agents/skills/ux-writing/index.html`

Current result: 17 errors and 9 warnings.

Application source, 13 errors:

- 5 SVG components without an accessible title (`githubDark`, `githubLight`, `githubWordmarkDark`, `githubWordmarkLight`, `google`).
- `input-group.tsx`: `useSemanticElements`, `useKeyWithClickEvents`.
- `field.tsx`: `useSemanticElements`, `noArrayIndexKey`, `noDoubleEquals`.
- `alert.tsx`: `useImportType`, import order.
- `sonner.tsx`: import order.

Vendored content, 4 errors: `.agents/skills/ux-writing/index.html` is linted even though it is third-party skill material.

**Recommendation:** Add `.agents` to Biome's ignore list so the signal is not diluted, then fix the source errors. The SVG title errors are genuine accessibility gaps.

### P2-F5: Test execution is not automated

**Severity:** Medium
**Where:** `.github/workflows` (empty), `apps/web/package.json` (no `test` script), `nx.json` (no `test` target)

The suite only runs when a developer remembers. There is no CI job for `bun test`, `bun run check` or typecheck, and the web app has no `test` script at all.

**Recommendation:** Add a workflow with install, `bun run check`, direct typecheck, `bun test` in both apps, and the RLS script against a service Postgres. That turns the green baseline into a gate.

### P2-F6: The integration suite has manual setup

**Severity:** Medium, tooling
**Where:** `apps/api/src/services/tenant-boundary.integration.test.ts`, `scripts/bootstrap-db.ts`

Creating `app_test`, running `db:setup` and passing the env vars are manual steps. There is no script that creates and migrates a disposable database, and no Nx target that runs the integration suite.

**Recommendation:** Add a `test:db` script that creates the database if needed, runs `db:setup`, runs the suite and optionally drops the database. Keep the safety gate that refuses anything not named `app_test`.

### P2-F7: September prints as "Sept"

**Severity:** Info
**Where:** `apps/web/src/lib/date.ts:19-21`

`Intl.DateTimeFormat("en-GB", { dateStyle: "medium" })` renders September as `9 Sept 2026` in this ICU build, not `9 Sep 2026`. The order is still day month year, so rule 24 is satisfied. The design documentation should not promise a three letter month for every month.

### P2-F8: The date test is intentionally timezone local

**Severity:** Info
**Where:** `apps/web/src/lib/date.test.ts`

The helpers format in the reader's local timezone, which is the correct product behaviour. The tests use local noon to avoid a midnight boundary and assert the day month year shape rather than a fixed UTC instant. An ISO string with a time is only asserted by year, because the local day can differ by timezone.

---

## 6. Coverage map

| Area | Before | Added | Current state |
|---|---|---|---|
| Organization roles, slug, name | none | 24 unit | Covered |
| Project roles and visibility | none | 30 unit, part of 37 integration | Covered |
| Milestone validation | none | 20 unit, part of 37 integration | Covered |
| Milestone authorization | none | part of 37 integration | Covered |
| Comment permissions | 10 unit | part of 37 integration | Covered |
| Upload policy and byte sniffing | none | 14 unit, 9 service, 4 sniff | Covered except the S3 happy path |
| Password policy | none | 8 unit | Covered |
| LIKE escaping | none | 5 unit | Covered |
| Auth error mapping | none | 8 unit | Covered |
| RLS boundary | 18 script checks | 4 automated DB tests, plus the script | Covered |
| SSRF allowlist | strong | unchanged | Covered |
| Rich text sanitizer | strong | unchanged | Covered |
| Mentions | strong | unchanged | Covered |
| Realtime protocol | strong | unchanged | Covered |
| Date display rule | none | 14 web tests | Covered |
| Viewer routing | none | 5 web tests | Covered |
| Cache and reconnect helpers | strong | unchanged | Covered |
| HTTP route contracts | none | none | Gap, deferred to phase 3 |
| Better Auth flows | none | none | Gap, needs live HTTP and Mailpit |
| WebSocket upgrade auth | none | none | Gap, needs a live server |
| Upload presign and worker | none | none | Gap, needs S3 and Redis |
| UI component and a11y | none | none | Gap, no testing library installed |
| Organization switch guard | none | none | Gap, needs a window and localStorage stub |

---

## 7. How to run

### Unit only, no database

```bash
cd apps/api && bun test
cd apps/web && bun test
```

The integration suite is skipped, so these are safe on any machine.

### Integration suite

The database is created once. `db:setup` is idempotent.

```bash
# once
docker exec ultra-dev-postgres-1 psql -U app -d postgres \
  -c "CREATE DATABASE app_test OWNER app"

cd apps/api
DATABASE_URL=postgres://app:app@localhost:5432/app_test \
DATABASE_APP_URL=postgres://app_tenant:tenant@localhost:5432/app_test \
bun run db:setup

# every run
TEST_DATABASE=1 \
DATABASE_URL=postgres://app:app@localhost:5432/app_test \
DATABASE_APP_URL=postgres://app_tenant:tenant@localhost:5432/app_test \
bun test
```

### RLS script

```bash
cd apps/api
DATABASE_URL=postgres://app:app@localhost:5432/app_test \
DATABASE_APP_URL=postgres://app_tenant:tenant@localhost:5432/app_test \
bun run db:verify-rls
```

### Typecheck and lint

The Nx target is broken (P2-F3), so use the direct commands for now.

```bash
cd apps/api && bunx tsc --noEmit -p tsconfig.json
cd apps/web && bunx tsc --noEmit -p tsconfig.json
cd packages/ui && bunx tsc --noEmit -p tsconfig.json
bun run check
```

---

## 8. Recommended next steps

1. Add CI with the unit suite, direct typecheck, Biome and the RLS script (P2-F5).
2. Fix the Nx typecheck target or replace it with the direct command (P2-F3).
3. Ignore `.agents` in Biome and fix the 13 source lint errors, starting with the five SVG titles (P2-F4).
4. Add `test:db` so the integration suite is one command (P2-F6).
5. Decide the viewer precedence and either fix the comment or the code (P2-F1).
6. Tighten the two target-only predicates so a future caller cannot forget the actor check (P2-F2).

Phase 3 should focus on the gaps above: live Better Auth flows through Mailpit, HTTP route contracts, WebSocket authorization, the upload happy path, admin and client journeys through the UI, and the a11y and responsive pass.

---

## Appendix: Files added in phase 2

```
apps/api/src/auth/permissions.test.ts
apps/api/src/auth/project-permissions.test.ts
apps/api/src/auth/milestone-permissions.test.ts
apps/api/src/lib/storage/config.test.ts
apps/api/src/lib/storage/image.test.ts
apps/api/src/lib/password.test.ts
apps/api/src/lib/query.test.ts
apps/api/src/lib/auth-error.test.ts
apps/api/src/services/upload.service.test.ts
apps/api/src/services/tenant-boundary.integration.test.ts
apps/web/src/lib/date.test.ts
apps/web/src/features/files/viewer-kind.test.ts
qa/phase-2-test-report.md
```

No application source file was modified. No dependency was added.
