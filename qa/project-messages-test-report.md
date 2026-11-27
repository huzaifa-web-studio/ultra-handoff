# Project Messages QA Report

- **Build:** `feature/project-level-messages`, feature commit `ff97db2`, fixes applied and retested on 27 Nov 2026
- **Environment:** local dev stack, web `http://localhost:3000`, API `http://localhost:3001`, Postgres `app`
- **Method:** code review, API and database assertions, Chrome DevTools browser sessions as four real users
- **Verdict:** all 37 cases pass after the fixes below. The four findings and the one observed regression are closed, and no data exposure or access-control bypass was found.

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
- Archived thread behavior, deep link cleanup, and cache isolation between users.

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
| Archive project | `Room QA Retest Archive 1795772794`, archived and restored during the retest |
| Concurrency project | `Room QA Retest Concurrent 1795772794`, five parallel opens, then deleted |
| Pre-archived project | `Room QA Retest Pre 1795772794`, archived before its first room open |
| No-room project | `Room QA Retest NoRoom 1795772794`, used to prove the unread endpoint never creates a room |
| Empty room project | `Room QA Retest Empty 1795772794`, used for lazy creation, unread dot, and thread unread |

The four users are new fixture accounts created for this feature. The fixture workspace and projects remain in the dev database for inspection. No existing account, project, or workspace was modified.

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
| TC-008 | Send a message in the room | Type and send as the owner and as the member | Message renders with the sender and the time, the composer resets, and a `conversation_message` row is written | Critical | Functional | Pass |
| TC-009 | Thread reply in the room | Open Reply in thread on a root message and send | Thread panel shows the reply and the root shows a reply count | High | Functional | Pass |
| TC-010 | Search inside the room | Type a word from a message into the room search | Matching results appear with sender, date, and preview, including thread replies | Medium | Functional | Pass |
| TC-011 | Room is absent from the inbox | Open `/{org}/messages` | The project room is not listed in channels or direct messages | High | Regression | Pass |
| TC-012 | Project message notification | Send as the owner, inspect the bell and the database | Type `project_message`, copy names the project and sender, one row per recipient, sender excluded, `project_id` and `conversation_id` set | High | Functional | Pass |
| TC-013 | Notification dedupe | Send several messages to the same room | One notification row per recipient, preview and thread root updated on the latest message | Medium | Edge case | Pass |
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
| TC-024 | Restore in place | Restore the project while the Messages tab is open | Room becomes writable without a reload | Medium | Functional | Pass |
| TC-025 | Edit in an archived room | Edit a message while the project is archived | Edit is blocked | Medium | Negative | Pass |
| TC-026 | Edit error copy in a project room | Trigger the archived edit | Error says the project is archived | Low | Copy | Pass |
| TC-027 | Removed member loses access | Remove the client from the project, then open the project URL and the room route as the client | Project page shows `That project no longer exists.`, open and message reads return 404 | Critical | Security | Pass |
| TC-028 | Removal updates the room | Remove the client, inspect `conversation_participant` and `member_count` | `left_at` set, row kept, active count decremented | High | Data | Pass |
| TC-029 | Re-add reactivates without losing history | Add the client back, open the room | `left_at` is null, cursor unchanged, full history visible, missed messages shown as unread | High | Functional | Pass |
| TC-030 | Role change syncs | Change the project member to admin, then back to member | Conversation role becomes `owner` then `member` | Medium | Data | Pass |
| TC-031 | Project delete cascades | Delete a project with a room and messages | Room, participants, and messages are all gone | High | Data | Pass |
| TC-032 | Outsider cannot open the room | Signed-in user outside the workspace opens the room and unread routes | 404 on both, no data leaked | Critical | Security | Pass |
| TC-033 | Removed member cannot read messages | Removed client calls the conversation messages route | 404 `That conversation no longer exists.` | Critical | Security | Pass |
| TC-034 | Room header identity | Open the room | Header names the project, not the conversation, and shows the active member count | Low | Functional | Pass |
| TC-035 | Invalid thread parameter | Load `?thread=not-a-uuid` | The invalid value is ignored and the room opens without a thread error | Low | Negative | Pass |
| TC-036 | Tab current state | Inspect all four tab links while on Messages | Exactly one link exposes `aria-current="page"` | Medium | Accessibility | Pass |
| TC-037 | Archived room actions | Inspect message actions while archived | Edit and Delete are hidden or disabled | Low | UX | Pass |
| TC-038 | Archived thread is read only | Open a thread in an archived room | The thread composer is replaced by the notice, and no reply, edit, or delete action is offered | High | Functional | Pass |
| TC-039 | Closing a deep-linked thread | Open `?thread=<rootId>`, then close the panel | The `thread` parameter is removed from the URL | Medium | Edge case | Pass |
| TC-040 | Stale thread id | Load `?thread=<random UUID>` | The panel closes on 404 and the parameter is removed | Low | Negative | Pass |
| TC-041 | No cache leak between users | Sign out and sign in as a user with fewer projects in the same tab | The previous user's projects are not shown before a reload | High | Security | Pass |

## Fixes

### PM-QA-01 (Medium) Restore left the room read only until a reload

- **Cause:** the room surface reads its header from the messages cache, while the archive and unarchive mutations invalidated only the projects prefix.
- **Fix:** archive, unarchive, delete, and the bulk archive flows invalidate both the projects and messages prefixes (`apps/web/src/features/projects/hooks.ts`).
- **Retest:** restored the project from the header while the Messages tab and a thread panel were open. The status changed to `1 members`, the room and thread composers returned, and the message actions reappeared with no reload.

### PM-QA-02 (Low) Archived room offered Edit and Delete, and the error named a channel

- **Cause:** the update service used the channel copy for both scopes, and message rows did not consider the archived state.
- **Fix:** the update service returns the project copy for a project room (`apps/api/src/services/conversation/update.ts`). The timeline, thread panel, and dedicated thread view hide every write action when archived and replace the composer with a scoped notice (`message-item.tsx`, `message-list.tsx`, `thread-panel.tsx`, `thread-view.tsx`, `archived.ts`).
- **Retest:** archived a room with a thread, then checked the DOM. No reply, edit, or delete button, no timeline composer, and no thread composer were present. Direct API edit and delete returned 400 `This project is archived and is read only.`. Restore brought every control back.

### PM-QA-03 (Low) Two tabs exposed `aria-current="page"` at once

- **Cause:** the router link applied prefix active matching and set `aria-current` itself, while the component's visual check was exact for Overview.
- **Fix:** each tab link passes its own exactness through `activeOptions`, so the router's current state matches the visual state (`project-tabs.tsx`).
- **Retest:** on Overview only Overview was current; on Messages only Messages was current.

### PM-QA-04 (Low) The thread parameter accepted any string

- **Cause:** the route validator checked only string length, and closing a deep-linked panel did not clear the parameter.
- **Fix:** the parameter must match the message id shape (`$orgSlug.projects.$projectSlug.messages.tsx`). Closing the panel clears the parameter, and a 404 on the thread closes the panel through the same path (`conversation-view.tsx`, `project-messages-page.tsx`, `thread-panel.tsx`).
- **Retest:** `?thread=not-a-uuid` was dropped and the room opened normally. A random well-formed UUID opened briefly, closed on 404, and cleared the parameter. Closing a real deep-linked thread also cleared it.

### OBS-01 (Outside the feature) Project cache leaked across user switches

- **Cause:** React Query keys are not user scoped, and the cache survived a client-side sign out.
- **Fix:** a settled user change clears the query cache once (`apps/web/src/routes/__root.tsx`).
- **Retest:** signed out as the client (a member of the retest project) and signed in as the member (not a member of it). The sidebar showed only the member's project immediately, with no stale row.

## Retest Verification

- Biome check passed: 706 files.
- API and web TypeScript checks passed.
- Full API suite passed: 684 tests, 0 failures, including the extended project room integration test for archived edit and delete copy.
- API and web production builds completed.
- No console errors on the project room pages during the retest.

## Verified Data Evidence

- Room row created with id `project-66f526c9-d88e-438e-9a9e-e4d12d8d1d9c`, scope `project`, `member_count` 3.
- Five parallel opens returned 200 with the same room id; one room and one participant row existed afterward.
- Notification rows: one per recipient, type `project_message`, dedupe key `project:<conversationId>`, thread root captured on a thread reply.
- Removal set `left_at` and kept `last_read_at`; re-add cleared `left_at` and preserved `last_read_at`.
- Archived project room mirrored `archived_at`; a pre-archived project opened read only.
- Deleting the concurrency project removed its room, participants, and any messages.
- Archived edit and delete both returned 400 with the project copy.
- A removed client got 404 on the room open and on the message read; an outsider got 404 on the room open.

## Conclusion

The feature is functionally complete and the four reported defects plus the cross-user cache regression are fixed and retested. Server-side guarantees held in every negative case: membership is derived and revoked, archived writes are rejected, and non-members see nothing. All 37 planned cases and the four added regression cases pass on the dev stack.
