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
