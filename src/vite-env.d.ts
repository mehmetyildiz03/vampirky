/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MULTIPLAYER_HTTP_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
