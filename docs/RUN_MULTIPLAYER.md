# Running real multiplayer locally

The production-safe lobby and WebSocket layers are opt-in so the static GitHub Pages demo keeps working without a backend.

1. Start the backend:

```bash
npm run server:dev
```

2. Create `.env.local`:

```
VITE_MULTIPLAYER_HTTP_URL=http://localhost:8787
```

3. Start Vite:

```bash
npm run dev
```

With the variable configured, **Oda Kur** and **Odaya Katıl** use the real server-authoritative lobby:

- create/join by player name
- stable opaque session token
- WebSocket reconnect
- live connected/disconnected status
- ready/not-ready
- host-only start
- minimum six players
- roles assigned only on the server when the host starts

Without the environment variable, those menu items intentionally open the existing local demo lobby.

The real multiplayer path now continues through the full server-authoritative phase loop:

- role reveal readiness
- night actions and private Vampire chat
- server-timed night resolution
- dawn
- village discussion and public claims
- host early-vote control
- voting
- day resolution
- subsequent nights
- end-of-game role reveal

The browser multiplayer UI reads only `ViewerGameSnapshot` and sends intent commands. It does not reconstruct or receive the authoritative `GameState`.

The local Quick Game demo remains intentionally separate and still uses the in-browser engine for fast single-device testing.


## Player-private deduction state

Multiplayer deduction marks and per-player notes are stored per authenticated session on the server. They are attached only to that viewer's scoped game snapshot and are never room-broadcast to other players. Private changes do not increment the public game revision. Notes are capped at 220 characters and survive reconnects while the in-memory room exists.

## Lobby timing configuration

The host can configure discussion, night, and voting durations within the same validated ranges used by the local demo. The authoritative runtime receives the selected values when the game starts. Any timing change clears all players' ready state so settings cannot be changed silently after everyone has confirmed readiness.


## Restart recovery and persistence

The default multiplayer server now persists room state to
`.data/vampirky-state.json`. Override the location with
`VAMPIRKY_STATE_FILE`.

Persisted data includes active authoritative game state, lobby settings,
revisions, server phase deadlines, ready confirmations, opaque session tokens,
accepted request IDs for idempotent retries, and player-private deduction data.
Lobby connection presence is intentionally **not** persisted; every player starts
offline after a process restart until their WebSocket session reconnects.

Writes use a temporary file followed by an atomic rename. The state file and its
directory are created with restrictive filesystem permissions where supported.
The server flushes queued writes during graceful shutdown and restores state
before it begins listening for clients. If a server-owned phase deadline expired
while the process was offline, startup immediately applies the overdue phase
transition.

The persistence file contains sensitive material: session tokens, secret roles,
private role intel, and private deduction notes. Keep it outside source control,
back it with a private durable volume, and do not serve it as a static asset.

This JSON store is designed for a **single authoritative server process**. Do
not mount the same file for multiple concurrent server instances. Horizontal
scaling will require a transactional shared store/room coordinator rather than
a shared JSON file.


## Room lifecycle and cleanup

The single-process server now owns room cleanup as part of the same authoritative
250 ms tick that advances game phases. Defaults:

- reconnect grace for a disconnected **lobby guest**: 120 seconds
- completely offline lobby TTL: 900 seconds
- active game with every session offline: 3600 seconds
- finished game retention: 1800 seconds

Configure them with
`VAMPIRKY_RECONNECT_GRACE_SECONDS`,
`VAMPIRKY_EMPTY_LOBBY_TTL_SECONDS`,
`VAMPIRKY_ABANDONED_GAME_TTL_SECONDS`, and
`VAMPIRKY_FINISHED_GAME_TTL_SECONDS`.

A disconnected lobby guest may reclaim the same session during the grace
window. After grace, the non-host seat and its token are removed and the seat
becomes available again. The host seat is not individually evicted; if the
whole lobby remains offline, the room-level lobby TTL removes the complete room.

Active matches never remove individual players because doing so would change
role counts and game semantics. They are removed only when **all** sessions have
been offline for the abandoned-game TTL. Server-driven phase transitions do not
reset that offline timer. Finished games are deleted after their own retention
TTL, including their persisted secret/private state.

Room deletion revokes every session token and rewrites persistence without the
deleted room. Connected sockets for an expired room receive a session rejection
and are closed.

The WebSocket server also uses a 30-second ping/pong heartbeat so silent broken
connections eventually become real disconnects and cannot keep rooms alive
forever.


## Production deployment

The backend is container-ready. It listens on Railway's injected `PORT`,
binds to `0.0.0.0`, serves `GET /health`, derives WebSocket traffic from
`/ws`, and flushes queued persisted state on `SIGTERM` / `SIGINT`.

Recommended single-instance Railway setup:

1. Connect this GitHub repository as the service source.
2. Set `RAILWAY_DOCKERFILE_PATH=Railway.Dockerfile`.
3. Attach one persistent volume mounted at `/data`.
4. Set `VAMPIRKY_STATE_FILE=/data/vampirky-state.json`.
5. Set `VAMPIRKY_ALLOWED_ORIGINS=https://mehmetyildiz03.github.io`.
6. Configure the health check path as `/health`.
7. Keep the service at **one replica** while JSON-file persistence is used.
8. Generate a public Railway domain. Railway terminates TLS; the browser client
   given an `https://` backend URL automatically derives `wss://.../ws`.

The GitHub Pages workflow reads the repository variable
`VAMPIRKY_MULTIPLAYER_HTTP_URL` and exposes it to Vite as
`VITE_MULTIPLAYER_HTTP_URL`. Once the Railway public URL exists, set that
repository variable to the HTTPS backend origin and rerun Deploy Pages.

Do not mount the same `/data` volume into multiple replicas. Horizontal
scaling requires replacing the JSON state store with a transactional shared
store.


### Container CI smoke test

CI now builds the production Docker image, mounts a real host directory at
`/data`, creates a lobby, destroys the container, starts a fresh container
against the same volume, and joins the pre-existing room. This catches both
container boot regressions and persistent-volume permission problems before
deployment.


## Six-client production full-match E2E

`npm run e2e:production -- https://<backend>` drives six independent
WebSocket sessions through the same public HTTP/WSS interfaces used by real
players. It does not read server memory or use a test-only endpoint.

The scenario verifies a two-round match:

- six-player lobby create/join, connection presence and ready state
- secure per-viewer role reveal with the 6-player role-pack counts
- no public `secretRole` leakage before game end
- Vampire private chat visibility
- Vampire / Seer / Protector night commands
- protection preventing a planned night death
- Seer private intel
- public Village chat
- a structured claim sourced from a real Village message
- host-driven discussion -> voting transition
- round-one Villager elimination
- dead-player Ghost chat plus living-player Ghost privacy
- second night and discussion
- final Vampire elimination
- Village victory and post-game full role reveal consistency

The GitHub Actions workflow `Production Full Match` runs this against the live
Railway backend on every `main` push and can also be started manually.
