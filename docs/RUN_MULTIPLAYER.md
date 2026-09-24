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

The current multiplayer handoff stops after the secure role-reveal snapshot. Day/night/vote UI still uses the local demo `GameState`; migrating those screens to `ViewerGameSnapshot` is the next boundary.
