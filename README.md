# UEC — Ultimate Email Client (Prototype)

This is a cross‑platform Expo app (Android + Web). On Linux desktop, run the Web build in your browser for a desktop experience.

Primary feature in this prototype: virtual inboxes grouped by the address an email was sent to (useful for users with many alias addresses pointing to one inbox). Future work includes a node‑based editor to map addresses to actual and virtual inboxes.

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npm start
   ```

3. Open on your target:
   - Web (Linux desktop): press "w" in the Expo CLI to open in the browser.
   - Android: press "a" for an emulator, or scan the QR code with Expo Go.

The app uses file‑based routing (expo-router). Main screens:
- Virtual Inboxes (app/index.tsx)
- Accounts (add Gmail or manual IMAP/POP/SMTP) (app/accounts.tsx)
- Inbox by address (app/inbox/[address].tsx)
- Message detail (app/mail/[id].tsx)
- Node Editor placeholder (app/editor/index.tsx)

## Accounts: Gmail & Manual IMAP/POP/SMTP

The Accounts screen lets you:
- Sign in with Google and store an OAuth access token (scopes include https://mail.google.com/). The app verifies the token by calling Google userinfo and stores the email when available.
- Add a manual account by entering incoming (IMAP/POP3) and outgoing (SMTP) server settings. These are stored securely using expo-secure-store.

### Configure Google OAuth
1. Create OAuth credentials in Google Cloud Console for your platforms (Web, Android, iOS).
2. Set the app scheme to `uec` (already set in app.json). Add authorized redirect URIs like:
   - Expo proxy: https://auth.expo.dev/@owo.computer/uec
   - Native: uec://redirect
   - Web dev: http://localhost:19006
3. Provide your client IDs in `app/accounts.tsx` inside `Google.useAuthRequest` (iosClientId, androidClientId, webClientId). Alternatively, use environment variables and read them here.
4. Run the app and tap "Sign in with Google" in Accounts.

## Scripts
- `npm start` — start the dev server
- `npm run web` — start the web target directly
- `npm run android` — start the Android target directly
