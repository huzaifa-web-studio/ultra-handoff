# QA Plan: Group Channels

Date: 26 Nov 2026
Branch: `feature/group-messages`
Migrations: `0035_last_mastermind.sql`, `0036_needy_dracula.sql`, `0037_special_havok.sql`

## Verdict

Implementation complete. Automated checks pass. The manual cases below still
need a two or three user run on a migrated dev stack before release, because the
new access rules and the realtime fan out cannot be exercised by unit tests.

## Automated checks run

| Check | Result |
|---|---|
| API typecheck (`tsc --noEmit`) | Pass |
| Web typecheck (`tsc --noEmit`) | Pass |
| API unit suite (`bun test`) | 534 pass, 151 skip, 0 fail |
| Web unit suite (`bun test`) | 142 pass, 0 fail |
| Biome (`bun run check`) | Clean |
| Format (`bun run format`) | Clean |

New or updated tests:

- `apps/api/src/services/conversation/channels/validate.test.ts` covers name,
  topic, visibility and member id rules.
- `apps/api/src/lib/notification-copy.test.ts` covers the `group_message` copy
  and href.
- `apps/web/src/features/messages/cache.test.ts` covers channel activity and
  channel unread reducers.

## Manual cases

Run with one owner, one member and one outsider, after
`bun run db:setup` (or the dev compose migrate job).

### Channel creation and directory

| ID | Steps | Expected |
|---|---|---|
| CH-01 | Create a public channel named ` Design Review ` | Name stored as `Design Review`, appears in the rail and in Browse |
| CH-02 | Create a second channel with the same name, different case | 400 with "A channel with that name already exists." |
| CH-03 | Create a private channel | Appears in the creator rail, absent from Browse for the outsider |
| CH-04 | Open Browse as the outsider | Public channels listed with member count, private absent |
| CH-05 | Join a public channel as the outsider | Channel appears in the rail and the channel opens |
| CH-06 | Archive a channel as the owner | Leaves the rail and Browse, header becomes read only |
| CH-07 | Restore it as the owner | Returns to the rail with members and messages intact |

### Access rules

| ID | Steps | Expected |
|---|---|---|
| CH-08 | As the outsider, call the channel detail or messages endpoint for a private channel | 404 |
| CH-09 | As the outsider, call the same endpoints for a public channel not joined | 404 on detail, public row visible only through Browse |
| CH-10 | Remove the outsider from a private channel | Their open pane returns to the empty state after the realtime event |
| CH-11 | Leave a public channel as a member and reopen it from Browse | Rejoin works, previous read position is kept |
| CH-12 | As the last owner, leave | 400 asking to promote another owner or archive |
| CH-13 | As an owner, remove yourself with the member remove action | 400 asking to use leave |
| CH-14 | As a member, try rename, add, remove, promote, archive | 403 |
| CH-15 | As an author, edit and delete a message | Allowed |
| CH-16 | As an owner, edit or delete another person's message | Not offered, and the API rejects it |

### Messages, threads and read state

| ID | Steps | Expected |
|---|---|---|
| CH-17 | Send from two members at once | Both appear, no duplicate for the author on reconnect |
| CH-18 | Post a root and a reply in a thread | Reply count and thread unread dot update in the channel |
| CH-19 | Open the channel without opening the thread | Root is read, reply stays unread |
| CH-20 | Send in an archived channel | 400, composer is read only |
| CH-21 | Search inside a channel | Only that channel's matches, jump opens the right page |
| CH-22 | Mute a channel, send a message from another member | Unread still rises, no bell row and no push |

### Realtime and notifications

| ID | Steps | Expected |
|---|---|---|
| CH-23 | Two tabs as the same person, send in one | Other tab patches the timeline and the rail |
| CH-24 | Member A types, members B and C watch | Both see a typing line; with two typers it names both |
| CH-25 | Rename the channel while a member has it open | Header and rail update without a reload |
| CH-26 | Add a member from the settings panel | Their rail shows the channel without a reload |
| CH-27 | Bell row for a channel message | One row per channel, body names the channel, click opens the channel or the thread |
| CH-28 | Rename the channel, open the old bell row | The body uses the new name |

### RLS probes

Run as `app_tenant` with `app.current_org_id` and `app.current_user_id` set.

| ID | Query | Expected |
|---|---|---|
| RLS-01 | Select a private channel row as a non-participant | 0 rows |
| RLS-02 | Select a public channel row as a non-participant | 1 row |
| RLS-03 | Select `conversation_message` for a channel after `left_at` is set | 0 rows |
| RLS-04 | Select another member's `conversation_participant` row as a non-participant | 0 rows |
| RLS-05 | Update another member's role as a non-owner | 0 rows affected |
| RLS-06 | Insert a participant row for a private channel as a non-owner | Rejected by the service; note the workspace scoped insert policy |

## Known limits

- 100 members per channel. The send transaction writes one notification upsert
  per notifiable recipient.
- No per person read receipt in a channel. The direct chat keeps its "Seen"
  marker.
- No @mention notifications in chat, matching the current composer.
- A member removed from the workspace is skipped for notifications and fan out,
  but their participant row and the denormalised member count are not rewritten
  until the next membership change.
- Channels are workspace scoped only. Project channels remain a reserved scope,
  not a surface yet.
