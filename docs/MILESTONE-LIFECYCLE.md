# Milestone Lifecycle, Locking and Change Requests

**Status:** Decided direction, not implemented.
**Date:** 10 November 2026.
**Supersedes:** the scope review workflow built on `vqw-scopeandreview`.

This document records the decision to replace the current scope review feature with a milestone lifecycle: development, testing and review statuses, a manual owner or admin lock, and a client change request space that stays open even while the milestone is locked.

It is a handoff for the next implementation session. The current branch contains the scope review work. Start from the base branch, keep the reusable pieces listed in section 8, and remove the review workflow.

---

## 1. The problem with the current scope review feature

The current feature treats the scope as a formal document with a submit, approve or request changes state machine and frozen revisions.

That is too heavy for daily work:

- the scope has to be submitted before it is useful
- the owner has to go through a confirmation editor to approve
- the workflow assumes a client exists
- the scope cannot move forward without a decision
- the history is a list of revisions, not a picture of the work

What the product actually needs is a working lifecycle:

- a scope that is written and edited like a document
- a milestone that moves through development, testing and review
- a manual lock when the scope should not move
- a client space for requested changes that works even when the milestone is locked
- a way to turn a large change request into a new milestone

---

## 2. The new milestone statuses

Replace `in_progress` with three working statuses.

| Status | Label | Meaning |
|---|---|---|
| `todo` | To do | Not started |
| `in_development` | In development | Replaces `in_progress` |
| `in_testing` | In testing | Built and being checked |
| `in_review` | In review | Ready for the client or team review |
| `done` | Done | Accepted and finished |
| `blocked` | Blocked | Cannot proceed, reason required |
| `cancelled` | Cancelled | Dropped |

Decisions:

- `in_progress` is removed.
- `in_development`, `in_testing` and `in_review` are new.
- `blocked` and `cancelled` stay for exceptions.
- Existing `in_progress` rows migrate to `in_development`.
- Any project member can change the status, including the client, unless the milestone is locked.
- The status is free to move in any direction. No hard transition graph is enforced.

Suggested flow:

```
todo -> in_development -> in_testing -> in_review -> done
          ^                  |              |
          |                  v              |
          +------ issues ----+              |
          +------ review changes -----------+
```

`blocked` and `cancelled` are reachable from any state.

---

## 3. Testing and review loops

The rhythm the product should support:

1. Work starts in `to do` or `in development`.
2. Development finishes and the milestone moves to `in testing`.
3. If testing finds issues, it moves back to `in development` and a member fixes them.
4. When testing passes, it moves to `in review`.
5. If review asks for changes, it moves back to `in development`.
6. When review is satisfied, it moves to `done`.

Any project member can test and review. There is no separate tester or reviewer role.

### Adding scope during testing

New work discovered during testing follows one of two paths:

- **Small work:** create a change request. If the milestone is unlocked, the agency can add it to the current scope directly. If it is locked, the owner or admin unlocks first.
- **Large work:** create a change request and turn it into a new milestone. The current milestone can still finish.

This answers the "new scope after testing" case without silently growing the current milestone.

---

## 4. Locking

A lock is an explicit owner or admin action. It is not tied to a status.

### Rules

- Project owner or admin can lock and unlock.
- While locked, no one can edit the milestone:
  - title
  - scope document
  - status
  - dates
  - estimate
  - assignees
- Comments and change requests stay open while locked.
- Deleting a locked milestone is refused. Unlock first.
- Every lock and unlock is recorded in the activity timeline with the actor and the time.
- The lock is the baseline. If the scope needs to change, the owner or admin unlocks, edits, then locks again.

### Open question: checklist progress

Earlier the product allowed checklist items to be ticked after the scope was approved. The new lock says no one can edit the milestone.

Recommendation: **treat checklist progress as an exception**. Ticking a checklist item is progress against the scope, not a change to the agreed text. The lock should freeze the document and the fields, not the progress ticks.

Decide this before implementation. If the answer is no, every tick is blocked until unlock.

### Data

Current lock state:

- `milestone.locked_at` timestamp, nullable
- `milestone.locked_by` user id, nullable

History:

- activity event rows in the existing comment timeline
- event types `milestone_locked` and `milestone_unlocked`
- the event body carries the optional reason

---

## 5. Client change requests

A new place, per milestone, called **Changes**.

The client can create a change request at any time, in any status, locked or unlocked.

### Each change request

- title
- rich text body, with the same editor, mentions and attachments as a comment or a scope
- requested by
- created at
- status
- decision note
- optional target milestone when it is moved

Statuses:

| Status | Meaning |
|---|---|
| `open` | Waiting for the agency |
| `accepted` | Added to the current scope |
| `declined` | Not doing it, with a reason |
| `moved` | Turned into a new milestone |
| `withdrawn` | The client pulled it back |

### Agency actions

- **Accept:** the request is marked accepted. If the milestone is unlocked, the agency can apply the text to the scope. If it is locked, the UI asks the owner or admin to unlock first.
- **Decline:** requires a reason.
- **Move to a new milestone:** opens the create milestone dialog prefilled with the request title and body. The request is marked moved and linked to the new milestone.
- **Accept part:** the agency accepts the request and edits the scope as needed. The request record stays intact, so the client can see what was asked and what was applied.

### Rules

- The client can create, edit while open, and withdraw their own request.
- Staff can create requests too, for internal follow-up.
- Only staff can accept, decline or move a request.
- A change request is not part of the locked milestone, so the lock never blocks it.
- The Changes tab shows the number of open requests.

### Discussion

Version 1 keeps discussion in the milestone Comments tab. A change request is a structured record, not a second thread.

If item-level threads are needed later, extend the existing comment target with a `change_request_id` and update the one-target check. Do not build a second comment system.

---

## 6. What happens to the current scope review feature

The following are removed or replaced:

- `scope_status` on the milestone
- the `scope_revision` table
- `scope.service.ts`, `scope-state.ts`, `scope-permissions.ts`, `routes/scope.ts`
- the submit, withdraw, approve and request changes actions
- the scope state card, the approval dialog and the revision history timeline
- the `scope_*` event types
- the on-behalf approval concept
- the approved scope lock, replaced by the manual milestone lock

The following are kept:

- the milestone rich text description as the scope document
- the rich text editor, mentions and attachments
- checklist items and checklist progress
- comments and the comment timeline
- realtime updates
- the milestone list and detail layout

If the current scope review code is already merged when this starts, remove it in a dedicated migration and cleanup commit. If it exists only on the stashed branch, discard it.

### Optional: snapshot on lock

If an audit of "what was locked" is needed, copy the scope body into a lock snapshot when the lock is applied. That is a small table, not the old revision workflow. It is optional and not required for the first version.

---

## 7. Data model

### Milestone changes

```
milestone
  status                 todo | in_development | in_testing | in_review |
                         done | blocked | cancelled
  locked_at              timestamp | null
  locked_by              user id | null
```

Remove:

```
milestone.scope_status
scope_revision
```

### Change request

```
change_request
  id
  organization_id
  project_id
  milestone_id
  title
  body                 jsonb (Plate)
  body_text            text mirror
  status               open | accepted | declined | moved | withdrawn
  requested_by         user id, set null on delete
  decided_by           user id, set null on delete
  decided_at           timestamp
  decision_note        short plain text excerpt
  target_milestone_id  nullable, set when moved
  created_at
  updated_at
```

Indexes:

- `(organization_id)`
- `(project_id, milestone_id, status)`
- `(target_milestone_id)`

RLS:

- `tenantIsolation(organization_id)`
- `.enableRLS()`
- add `change_request` to `TENANT_TABLES`
- include it in the RLS verification suite

### Activity events

Extend the existing comment event types:

- `milestone_locked`
- `milestone_unlocked`
- `change_request_created`
- `change_request_accepted`
- `change_request_declined`
- `change_request_moved`
- `change_request_withdrawn`

Keep the existing `status` event. Remove the `scope_*` events with the feature.

---

## 8. API

### Status

Use the existing milestone PATCH for status, with the new values. Reject unknown values.

### Lock

```
POST /orgs/:orgSlug/projects/:projectId/milestones/:milestoneId/lock
POST /orgs/:orgSlug/projects/:projectId/milestones/:milestoneId/unlock
```

Both owner or admin only. The unlock body may carry an optional reason.

When locked, every milestone write returns a readable 400:

> This milestone is locked. Ask a project owner or admin to unlock it before editing.

### Change requests

```
GET    /orgs/:orgSlug/projects/:projectId/milestones/:milestoneId/changes
POST   /orgs/:orgSlug/projects/:projectId/milestones/:milestoneId/changes
PATCH  /orgs/:orgSlug/projects/:projectId/milestones/:milestoneId/changes/:changeId
```

`PATCH` accepts a decision:

```json
{
  "status": "accepted",
  "note": "Optional"
}
```

or

```json
{
  "status": "declined",
  "note": "Required reason"
}
```

Create a new milestone from a request:

```
POST /orgs/:orgSlug/projects/:projectId/milestones/:milestoneId/changes/:changeId/to-milestone
```

This creates the milestone, copies the request title and body into it, and marks the request moved.

### Permissions

| Action | Who |
|---|---|
| Change status | Any project member, unless locked |
| Lock / unlock | Project owner or admin |
| Create change request | Client and staff |
| Edit or withdraw an open request | Its author |
| Accept, decline, move | Staff |
| Edit the milestone | Staff, unless locked |
| Comment | Every project member |

---

## 9. UI

### Milestone header

- status select with the new statuses
- lock badge when locked
- lock or unlock action for owner and admin
- a locked banner:
  > Locked by Huzaifa on 10 Nov 2026. Unlock to edit.

### Tabs

```
Overview | Scope | Changes | Comments
```

- **Overview:** status, estimate, dates, assignees, scope summary, a compact changes summary with the open count.
- **Scope:** the document and checklist progress. Editable unless locked. No submit, approve or revision history.
- **Changes:** the client request list and detail. New request action for the client. Decision actions for staff.
- **Comments:** the existing discussion timeline.

### Changes tab

List:

- title
- status chip
- requested by and date
- a short two-line preview

Detail:

- full rich text body
- decision actions for staff
- decision note when decided
- link to the new milestone when moved

Create:

- rich text editor with the same attachments and mentions as a comment
- the client can create even when the milestone is locked

### Locked state

- the scope editor becomes read-only
- status, dates, estimate and assignees are read-only
- comments and Changes stay available
- the lock badge is visible in the list row and the detail header

### Status guidance

A small stepper or status hint is optional. The status select must remain free to move, because testing and review both send work back to development.

---

## 10. Migration

1. Add `in_development`, `in_testing`, `in_review` to the status check.
2. Update existing `in_progress` rows to `in_development`.
3. Remove `in_progress` from the check.
4. Add `locked_at` and `locked_by`.
5. Create `change_request` with RLS and indexes.
6. Add `change_request` to `TENANT_TABLES`.
7. Extend the comment event check with the new activity types and remove the `scope_*` values.
8. Drop `scope_revision` and `milestone.scope_status` if the old feature is merged.
9. Remove `scope_revision` from the RLS tests, the orphan reconciler, project delete and milestone delete cleanup.
10. Run `db:generate`, `db:migrate`, `db:verify-rls` and the database suite.

Never edit `drizzle/` by hand.

---

## 11. Edge cases

- Locked milestone plus client change request: allowed.
- Locked milestone plus comment: allowed.
- Locked milestone plus status change: blocked.
- Locked milestone plus delete: blocked.
- Locked milestone plus checklist tick: decide in section 4. Recommended allowed.
- Client creates a request in any status: allowed.
- Client withdraws an open request: allowed.
- Agency accepts a request while locked: blocked until unlock, with a clear prompt.
- Change request moved to a new milestone: the new milestone is created, the request is linked and marked moved.
- Change request declined: a reason is required.
- A request accepted in part: the request is accepted and the scope is edited manually. The request record is never rewritten.
- Multiple change requests: allowed, no deduplication.
- A milestone with no client: everything works. The client-only actions simply do not appear.
- A project with no members: the owner or admin still works.
- Archived project: every write is blocked, change requests included, until the project is restored.

---

## 12. Open questions

Answer these before implementation:

1. Can the client change the milestone status, or only staff? The current decision says any project member. Confirm.
2. Does the lock freeze checklist ticks, or is progress exempt? Recommended exempt.
3. Does `done` require a client acceptance action, or is any member allowed to set it? The new model has no formal client signature.
4. Should accepting a change request insert its text into the scope automatically, or does the agency edit the scope manually after accepting?
5. Do change requests need their own comment thread in version 1, or is the milestone discussion enough?
6. Should a lock snapshot be kept for audit, or is the lock event history enough?

---

## 13. Build order

1. Status vocabulary, check constraint, migration from `in_progress`.
2. Lock and unlock: columns, service guard, routes, header and banner.
3. Change request table, service, routes, permissions and tests.
4. Changes tab: list, detail, create, accept, decline, withdraw.
5. Create milestone from a change request.
6. Activity events for lock, unlock, status and change decisions.
7. Remove the old scope review feature and its tests.
8. Status stepper or hints, list lock icon, Overview summaries.
9. Full test pass: API, database, RLS, typecheck, Biome.
10. Two-user walkthrough: owner, member, client, locked and unlocked.

---

## 14. Acceptance criteria

The direction is complete when:

- a milestone can move through development, testing and review, and back to development from either loop
- `in_progress` no longer exists
- an owner or admin can lock and unlock a milestone
- while locked, milestone fields and status cannot be edited through the API or the UI
- comments and change requests still work while locked
- a client can create a change request at any time
- staff can accept, decline or move a request
- moving a request creates a new milestone and links it
- the timeline shows lock, unlock, status and change decisions
- the old scope review UI, routes, tables and event types are gone
- the database suite, RLS checks, typecheck and Biome pass
