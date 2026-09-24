# Multiplayer architecture foundation

The current React demo keeps the authoritative `GameState` in-process so local gameplay can be tested quickly. Real multiplayer must not send that object to clients.

## Trust boundary

The server owns:

- all `secretRole` values
- all night actions and protection/attack details
- all players' private Seer intel
- in-progress votes
- channel authorization
- phase transitions, timers and win evaluation
- monotonic room revision numbers

Clients receive only a viewer-scoped `ViewerGameSnapshot` produced by `src/multiplayer/snapshot.ts`.

A client sends commands such as `vote.submit` or `night.submit`. It never sends a replacement game state and never decides whether a command is valid.

## Reconnect model

Each accepted authoritative mutation increments the room revision. A reconnecting client sends its last seen revision. The server may later respond with either missed events or, initially, a fresh viewer snapshot.

Do not use local browser state as the source of truth for role, phase, vote, death or channel access.

## Privacy invariants

Before game end, a snapshot must never contain:

- another player's role
- authoritative `nightActions`
- `privateIntel` for other players
- in-progress `dayVotes`
- protected or attacked player ids from the night resolution
- Vampire chat for an unauthorized viewer
- Ghost chat for a living viewer

At game end, roles may be intentionally returned through `revealedRoles`.

## Next implementation layer

1. Create a room/session service around authoritative `GameState`.
2. Add command validation/dispatch on the server.
3. Increment revision after every accepted mutation.
4. Broadcast a separately generated viewer snapshot to each connected player.
5. Add reconnect identity and room membership.
6. Move phase deadlines to server time.
