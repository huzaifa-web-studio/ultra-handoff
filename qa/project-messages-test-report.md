# Project Messages QA Report

- **Build:** `ff97db2 feat: add project-level message rooms` on `feature/project-level-messages`
- **Date:** 27 Nov 2026
- **Environment:** local dev stack, web `http://localhost:3000`, API `http://localhost:3001`, Postgres `app`
- **Method:** code review, API and database assertions, Chrome DevTools browser session as four real users
- **Verdict:** functional and safe for the covered flows, with two medium or low UX defects and two low accessibility or input-handling defects. No data exposure or access-control bypass was found.

## Scope

Covered:
- One room per project, created on first open and not on project create.
- Project members plus organization owners as participants, clients included.
- The project Messages tab, unread dot, and read-only state.
- Sending, replying in a thread, search, and notification deep links.
- Membership reconciliation on add, remove, re-add, and role change.
- Project archive, restore, and delete.
- Access control for a removed member and for a workspace outsider.
- Realtime unread updates and mobile tab rendering.

Not covered:
- Bulk add and bulk remove member flows in the browser (unit and integration tests exist).
- Organization member removal while a project room is open.
- Push notification and email delivery.
- Attachments, image upload, and mentions inside a project room (shared composer, not new to this feature).
- Full history pagination in a project room.
- A complete screen-reader or keyboard-only pass.

## Test Data

| Item | Value |
|---|---|
| Workspace | `qa-rooms-1795772794` (name `QA Rooms 1795772794`) |
| Owner | `qa.room.owner.1795772794@example.test` |
| Member | `qa.room.member.1795772794@example.test` |
| Client | `qa.room.client.1795772794@example.test` |
| Outsider (signed in, not in the workspace) | `qa.room.outsider.1795772794@example.test` |
| Main project | `Room QA Project 1795772794`, three members, room id `project-66f526c9-d88e-438e-9a9e-e4d12d8d1d9c` |
| Archive project | `Room QA Archive 1795772794`, archived and restored during the run |
| Concurrency project | `Room QA Concurrent 1795772794`, deleted after the cascade test |
| Pre-archived project | `Room QA PreArchived 1795772794`, archived before its first room open |
| No-room project | `Room QA NoRoom 1795772794`, used to prove the unread endpoint never creates a room |

The four users are new fixture accounts created for this run. The fixture workspace and projects remain in the dev database for inspection. No existing account, project, or workspace was modified.

## Test Cases

| ID | Title | Steps | Expected | Priority | Type | Result |
|---|---|---|---|---|---|---|
| TC-001 | Messages tab is present on a project | Open a project as a member | Tabs read Overview, Milestones, Messages, Settings, and Messages sits between Milestones and Settings | High | Functional | Pass |
| TC-002 | No unread dot before any message | Open the project Overview for a room that never existed | Messages tab has no dot, and no room row exists in the database | High | Functional | Pass |
| TC-003 | First open creates the room | Click Messages | One `conversation` row with id `project-<projectId>`, scope `project`, and an empty state | Critical | Functional | Pass |
| TC-004 | Participants mirror the project | Open a room with owner, member, and client | Three active participants, owner role `owner`, member and client role `member`, `member_count` is 3 | Critical | Functional | Pass |
| TC-005 | Concurrent opens stay single | Fire five parallel open requests for a fresh project | All return 200 with the same room id; one room row and one participant row | High | Edge case | Pass |
| TC-006 | Unread read never creates a room | Call `GET .../conversation/unread` for a project without a room | `{ conversationId: null, unread: 0 }`, and still no room after the call | High | Functional | Pass |
| TC-007 | Unread endpoint answers for a missing project | Call the unread route for a random project id | 404 | Medium | Negative | Pass |
| TC-008 | Send a message in the room | Type and send as the owner | Message renders with the sender and the time, the composer resets, and a `conversation_message` row is written | Critical | Functional | Pass |
| TC-009 | Thread reply in the room | Open Reply in thread on a root message and send | Thread panel shows the reply and the root shows a reply count | High | Functional | Pass |
| TC-010 | Search inside the room | Type a word from a message into the room search | Matching result appears with sender, date, and preview | Medium | Functional | Pass |
| TC-011 | Room is absent from the inbox | Open `/{org}/messages` | The project room is not listed in channels or direct messages | High | Regression | Pass |
| TC-012 | Project message notification | Send as the owner, inspect the bell and the database | Type `project_message`, copy names the project and sender, one row per recipient, sender excluded, `project_id` and `conversation_id` set | High | Functional | Pass |
| TC-013 | Notification dedupe | Send three messages to the same room | One notification row per recipient, preview and thread root updated on the latest message | Medium | Edge case | Pass |
| TC-014 | Thread notification deep link | Click the thread reply notification | Navigates to `/{org}/projects/{slug}/messages?thread=<rootId>` and opens the correct thread | High | Functional | Pass |
| TC-015 | Reading clears the notification | Open the room, then the unread thread | Bell count decreases and the notification `read_at` is set | Medium | Functional | Pass |
| TC-016 | Realtime unread dot | Sit on the project Overview as the client, send as the owner from another session | Messages tab gains the dot and the accessible unread name without a reload | High | Functional | Pass |
| TC-017 | Unread dot accessibility | Inspect the tab link with a dot | Dot is decorative and a screen-reader suffix `, unread messages` is present | Medium | Accessibility | Pass |
| TC-018 | Mobile tab row | Resize to 390x844 with an unread room | Labels collapse to icons and the dot stays visible next to the Messages icon | Medium | Responsive | Pass |
| TC-019 | Unread thread keeps the dot | Read the room but leave a thread reply unread | Dot stays until the thread is opened, then clears | Medium | Edge case | Pass |
| TC-020 | Archived room is read only | Archive the project, open its Messages tab | Header shows Archived, the composer is replaced by a read-only notice, and send is rejected with 400 `This project is archived and is read only.` | Critical | Functional | Pass |
| TC-021 | Archive mirror on the room | Archive the project, read `conversation.archived_at` | Room `archived_at` equals the project archive time | High | Data | Pass |
| TC-022 | Archived before first open | Archive a project that never opened its room, then open it | Room is created already archived and read only | Medium | Edge case | Pass |
| TC-023 | Restore after reload | Restore the project, reload the room | Composer returns and send works | High | Functional | Pass |
| TC-024 | Restore in place | Restore the project while the Messages tab is open | Room becomes writable without a reload | Medium | Functional | **Fail** |
| TC-025 | Edit in an archived room | Edit a message while the project is archived | Edit is blocked | Medium | Negative | Pass |
| TC-026 | Edit error copy in a project room | Trigger the archived edit | Error says the project is archived | Low | Copy | **Fail** |
| TC-027 | Removed member loses access | Remove the client from the project, then open the project URL and the room route as the client | Project page shows `That project no longer exists.`, open and message reads return 404 | Critical | Security | Pass |
| TC-028 | Removal updates the room | Remove the client, inspect `conversation_participant` and `member_count` | `left_at` set, row kept, active count decremented | High | Data | Pass |
| TC-029 | Re-add reactivates without losing history | Add the client back, open the room | `left_at` is null, cursor unchanged, full history visible, missed messages shown as unread | High | Functional | Pass |
| TC-030 | Role change syncs | Change the project member to admin, then back to member | Conversation role becomes `owner` then `member` | Medium | Data | Pass |
| TC-031 | Project delete cascades | Delete a project with a room and messages | Room, participants, and messages are all gone | High | Data | Pass |
| TC-032 | Outsider cannot open the room | Signed-in user outside the workspace opens the room and unread routes | 404 on both, no data leaked | Critical | Security | Pass |
| TC-033 | Removed member cannot read messages | Removed client calls the conversation messages route | 404 `That conversation no longer exists.` | Critical | Security | Pass |
| TC-034 | Room header identity | Open the room | Header names the project, not the conversation, and shows the active member count | Low | Functional | Pass |
| TC-035 | Invalid thread parameter | Load `?thread=not-a-uuid` | The invalid value is ignored and the room opens without a thread error | Low | Negative | **Fail** |
| TC-036 | Tab current state | Inspect all four tab links while on Messages | Exactly one link exposes `aria-current="page"` | Medium | Accessibility | **Fail** |
| TC-037 | Archived room actions | Inspect message actions while archived | Edit and Delete are hidden or disabled | Low | UX | **Fail** |

## Findings

### PM-QA-01 (Medium) Restore leaves the room read only until a reload

- **Repro:** open the Messages tab of an archived project, restore the project from the header, stay on the tab.
- **Observed:** project badge changes to Active, but the room header still says `Archived` and the read-only notice remains. It clears only after a reload or a remount.
- **Cause (likely):** the room surface reads the conversation detail from the messages query key, while the archive and unarchive mutations invalidate the projects prefix. The project detail refreshes, the conversation detail does not, and `refetchOnWindowFocus` is off for the open call.
- **Impact:** an owner who restores a project is told the room is read only and cannot send until a reload. No data loss and no write is accepted while the server believes it is archived.
- **Suggested fix direction:** invalidate the conversation detail key (or the messages prefix) after archive and unarchive, or derive read-only from the project query already being refetched.

### PM-QA-02 (Low) Archived room still offers Edit and Delete, and the error names a channel

- **Repro:** archive a project, open Messages, click Edit message, change the text, Save.
- **Observed:** the edit control is available, the editor opens, and Save fails with `This channel is archived and is read only.`
- **Cause:** the update service in `apps/api/src/services/conversation/update.ts` uses the channel copy for both scopes, and the message item does not hide author actions when the room is archived.
- **Impact:** a dead control with the wrong noun for project rooms. The write is correctly blocked.
- **Suggested fix direction:** scope the copy, and hide or disable Edit and Delete when the conversation is archived.

### PM-QA-03 (Low) Two tabs expose `aria-current="page"` at once

- **Repro:** open a project child route such as Messages, inspect the tab links.
- **Observed:** both Overview and Messages expose `aria-current="page"`; only Messages is visually active.
- **Cause:** TanStack Link applies prefix active matching by default and sets `aria-current` itself, while the component's own exact check only controls the visual classes. This pattern predates the Messages tab and also affects Milestones and Settings.
- **Impact:** screen readers announce two current pages in the project sections navigation.
- **Suggested fix direction:** set `activeOptions={{ exact: true }}` on each link, or let the component own `aria-current` and stop the router default.

### PM-QA-04 (Low) The thread parameter accepts any string

- **Repro:** open `.../messages?thread=not-a-uuid`.
- **Observed:** the room opens and the thread panel shows `Could not load the thread.` with Try again. Closing the panel leaves `?thread=not-a-uuid` in the URL, so a reload repeats the failure.
- **Cause:** `validateSearch` checks only that the string is 1 to 64 characters, while the comment says the check keeps a hand edited or stale link from reaching the thread request.
- **Impact:** a stale or edited link produces an avoidable error panel and a retry loop against an invalid id.
- **Suggested fix direction:** validate a UUID shape, or drop the parameter when the thread lookup answers 404.

### Observation outside this feature

- Signing out and signing in as a different user in the same tab can briefly show the previous user's project list in the sidebar until a reload. It was reproduced during user switching and cleared on refresh. The React Query cache does not appear to be cleared on sign-out. This is not specific to project messages and needs separate confirmation.

## Verified Data Evidence

- Room row created with id `project-66f526c9-d88e-438e-9a9e-e4d12d8d1d9c`, scope `project`, `member_count` 3.
- Five parallel opens returned 200 with the same room id; one room and one participant row existed afterward.
- Notification rows: one per recipient, type `project_message`, dedupe key `project:project-66f526c9-d88e-438e-9a9e-e4d12d8d1d9c`, thread root captured on a thread reply.
- Removal set `left_at` and kept `last_read_at`; re-add cleared `left_at` and preserved `last_read_at`.
- Archived project room mirrored `archived_at`; a pre-archived project opened read only.
- Deleting the concurrency project removed its room, participants, and any messages.

## Conclusion

The feature works for the intended flow: one room per project, project-derived membership, a project-only tab, an unread dot, read-only archive behaviour, notifications with thread deep links, and correct access revocation. The server-side guarantees held in every negative case tested; the failures are client state and copy issues, not data or access control issues.

The two items worth fixing before calling it done are PM-QA-01 (restore leaves a stale read-only room) and PM-QA-02 (archived actions and channel copy). PM-QA-03 and PM-QA-04 are small cleanups.
