# UEC — Ultimate Email Client (Prototype)

This is a cross-platform Expo app packaged as a Tauri desktop application. Android remains available through Expo, while Linux desktop uses the Tauri native shell (with a Nix/NixOS-compatible build environment).

Primary feature in this prototype: virtual inboxes grouped by the address an email was sent to (useful for users with many alias addresses pointing to one inbox). The node editor maps incoming alias addresses to named virtual inboxes and persists those routes across sessions.

## Get started

1. Install dependencies

   ```bash
   pnpm install
   ```

2. Start the app

   ```bash
   pnpm start
   ```

3. Open on your target:
   - Web preview: `pnpm run web`
   - Android: `pnpm run android` for an emulator, or scan the QR code with Expo Go.
   - Linux desktop: `pnpm run tauri:cli dev` (requires GTK/WebKitGTK; Nix users can use the CI shell or the shell example below).

The app uses file‑based routing (expo-router). Main screens:
- Virtual Inboxes (`app/index.tsx`)
- Accounts (add Gmail or manual IMAP/POP) (`app/accounts.tsx`)
- Inbox by address (`app/inbox/[address].tsx`)
- Message detail (`app/mail/[id].tsx`)
- Alias Node Editor (`app/editor/index.tsx`)

## Accounts: Gmail & Manual IMAP/POP

- **Gmail**: Syncs emails via the Gmail REST API using OAuth2 client IDs configured in `.env`.
- **Manual (IMAP/POP)**: Stores credentials securely in `expo-secure-store` / `AsyncStorage`. Note: Direct TCP/TLS sockets for IMAP/POP cannot be opened in browser/React Native sandboxes without a backend daemon or native socket layer. The UI clearly displays configured manual accounts.

## Virtual Inbox Routing & Pattern Matching

The Alias Node Editor supports flexible routing types:
- **Exact**: Matches exact email address (e.g. `billing@domain.com` → `Finance`).
- **Domain**: Matches full domain (e.g. `@github.com` or `company.org` → `Work`).
- **Prefix**: Matches address prefixes before `+` tags (e.g. `newsletter` matches `newsletter+tech@...` → `News`).
- **Contains**: Substring matching across recipient addresses.
- **Regex**: Full regular expression matching (e.g. `^app-[0-9]+@.*` → `CI/CD`).

An interactive test resolver is built directly into the node editor so you can verify addresses instantly.

### Node editor

The web node editor has a node-type sidebar with tabs (Conditions, Logic, Inboxes). Clicking a type creates that node in the centre of the current view and opens its configuration dialog. Double-click a node to edit it again; drag between handles to connect nodes. Configuration changes are saved automatically.

Folder nodes are purely configuration: they group virtual inboxes in the main view but never hide nodes or edges in the graph. Enable **Include catch-all / unsorted inboxes** on a folder to collect every virtual inbox created by a catch-all rule — including dynamic names derived from sender, subject or sender domain. Folders that already contain the catch-all rule's inbox name (for example, "Other") collect those inboxes automatically. Those folders show the real inbox and message counts and can be opened to read all their messages together.

Resolver suggestions include every message in the local mail cache, not only the most recent page, so older addresses without a specific rule can be routed at any time. Use **Refresh suggestions** in the editor to rescan.

### Main view

Virtual inboxes and folders can be searched and sorted by name, message count, or newest message. Column dividers can be dragged to resize columns (web), and each column can be collapsed with its header button; the layout is remembered between sessions.

### Storage

Settings and cached messages go through a quota-aware storage facade. Gmail bodies are capped and old cache entries are evicted when browser storage fills up, so saving node routes can no longer crash with "Quota exceeded" — a failed write is reported in the editor status instead.

## Scripts
- `pnpm start` — start the dev server
- `pnpm test` — run unit test suite
- `pnpm run web` — start the web target directly
- `pnpm run android` — start the Android target directly
- `pnpm run tauri:cli dev` — start the native Linux desktop shell
- `pnpm run tauri:cli build` — build native Linux installers

### NixOS/Linux native build

The Tauri build needs Rust, Node.js, pnpm, GTK3, WebKitGTK 4.1, and the standard Linux packaging tools. The CI workflow in `.github/workflows/build-tauri.yml` declares these dependencies in its Nix shell; on NixOS, run the same commands inside a `nix-shell`/`nix develop` environment, then use `pnpm install --frozen-lockfile` and `pnpm run tauri:cli build`.
