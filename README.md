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

- **Gmail**: Syncs emails via the Gmail REST API using OAuth2 client IDs configured in `.env`. The sign-in requests offline access so a refresh token is stored; expired access tokens are renewed automatically. If Google returns `client_secret is missing`, use a **Desktop app** OAuth client ID (PKCE, no secret) for Tauri/web. If you must use a Web application client, paste its client secret into the **Google Web client secret** field on the Accounts screen (stored on the device and used for both sign-in and token refresh); `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_SECRET` is also supported as a fallback. The Accounts screen has a **Reconnect** button for sessions whose refresh token was lost.
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

The web node editor has a node-type sidebar with tabs (Conditions, Logic, Inboxes). Clicking a type creates that node in the centre of the current view and opens its configuration dialog. Double-click a node to edit it again. To connect, drag from an **out** handle to an **in** handle, or click a node and then click a highlighted compatible target; the sidebar has a connection guide and incompatible links explain why they cannot be made. Configuration changes are saved automatically.

Folder nodes are purely configuration: they group virtual inboxes in the main view but never hide nodes or edges in the graph. Enable **Include catch-all / unsorted inboxes** on a folder to collect every virtual inbox created by a catch-all rule — including dynamic names derived from sender, subject or sender domain. Folders that already contain the catch-all rule's inbox name (for example, "Other") collect those inboxes automatically. Those folders show the real inbox and message counts and can be opened to read all their messages together.

Resolver suggestions include every message in the local mail cache, not only the most recent page, so older addresses without a specific rule can be routed at any time. Use **Refresh suggestions** in the editor to rescan.

### Main view

Virtual inboxes and folders can be searched and sorted by name, message count, or newest message. Column dividers can be dragged to resize columns (web), and each column can be collapsed with its header button; the layout is remembered between sessions.

### Storage

Settings and cached messages go through a quota-aware storage facade. Gmail bodies are capped and old cache entries are evicted when browser storage fills up, so saving node routes can no longer crash with "Quota exceeded" — a failed write is reported in the editor status instead.

The inbox view reloads rules/folders whenever it regains focus or a settings save event fires, so edits made in the node editor are applied immediately even though stack screens stay mounted.

## Scripts
- `pnpm start` — start the dev server
- `pnpm test` — run unit test suite
- `pnpm run web` — start the web target directly
- `pnpm run android` — start the Android target directly
- `pnpm run tauri:cli dev` — start the native Linux desktop shell
- `pnpm run build:nix` — build the NixOS package (wrapped binary, desktop entry and icon)

### NixOS/Linux native build

The default build target is NixOS, not Debian. `nix build .#uec` (or `pnpm run build:nix`) produces a wrapped application in `result/` with its GTK/WebKit libraries, a desktop entry and an icon; `nix run .` starts it. The build uses `tauri build --no-bundle` so no `.deb`/AppImage packaging is involved. npm and cargo dependencies are fetched during the build, so on a default multi-user NixOS setup use `--option sandbox false` (included in the script) or mark the builder as a trusted user.

The web app is exported as a **single-page app** (`web.output: "single"`): static prerendering cannot build routes that call OAuth/navigation hooks at render time. CI builds the same Nix package and uploads it as an artifact. For a quick non-Nix Linux build, `pnpm run tauri:cli build` still creates a `.deb`, and `pnpm run tauri:build:appimage` creates an AppImage with `APPIMAGE_EXTRACT_AND_RUN=1`.
