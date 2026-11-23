# UEC — Ultimate Email Client (Prototype)

This is a cross-platform Expo app packaged as a Tauri desktop application. Android remains available through Expo, while Linux desktop uses the Tauri native shell (with a Nix/NixOS-compatible build environment).

Primary feature in this prototype: virtual inboxes grouped by the address an email was sent to (useful for users with many alias addresses pointing to one inbox). Future work includes a node‑based editor to map addresses to actual and virtual inboxes.

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
- Virtual Inboxes (app/index.tsx)
- Accounts (add Gmail or manual IMAP/POP/SMTP) (app/accounts.tsx)
- Inbox by address (app/inbox/[address].tsx)
- Message detail (app/mail/[id].tsx)
- Node Editor placeholder (app/editor/index.tsx)

## Accounts: Gmail and Manual IMAP/POP/SMTP

The Accounts screen supports Gmail OAuth and manual incoming (IMAP/POP3) plus outgoing (SMTP) server settings. Gmail sync uses the Gmail API; manual server settings are stored using expo-secure-store on native platforms and AsyncStorage on web. The manual transport itself still requires a backend or native socket implementation.

## Scripts
- `pnpm start` — start the dev server
- `pnpm run web` — start the web target directly
- `pnpm run android` — start the Android target directly
- `pnpm run tauri:cli dev` — start the native Linux desktop shell
- `pnpm run tauri:cli build` — build native Linux installers

### NixOS/Linux native build

The Tauri build needs Rust, Node.js, pnpm, GTK3, WebKitGTK 4.1, and the standard Linux packaging tools. The CI workflow in `.github/workflows/build-tauri.yml` declares these dependencies in its Nix shell; on NixOS, run the same commands inside a `nix-shell`/`nix develop` environment, then use `pnpm install --frozen-lockfile` and `pnpm run tauri:cli build`.
