# Ritlog: company-car trip logger

A small web app for iPhone that logs trips straight into the existing Google Sheet. The interface works in Dutch and English.

## What it does

| | |
|---|---|
| **One-tap trips** | Big buttons for *Huis → Werk* / *Werk → Huis*. The suggested route is picked by time of day, and his most frequent routes appear too. |
| **Saved places** | Home, work, colleague and clients, each with nicknames for voice input. Edit them under *Instellingen*. |
| **Automatic distance** | Distances he has driven before come from his history. New routes are calculated with PDOK (Dutch address lookup) and OSRM (route planner), both free with no key. |
| **Smart defaults** | Date = today, end time = now, start time = now minus travel time. The next trip starts at the last destination. Odometer start = last odometer end, and end = start + km. Description, car, plate, driver and trip type are filled in. |
| **Voice input** | Example: *"gisteren van werk naar Coolsingel 40 Rotterdam van 5 tot half 6, klacht afhandelen bij klant"*. It understands dates (vandaag/gisteren/maandag/15 oktober), times (half 6, kwart over 9, 17:30), places, odometer readings, privé/zakelijk and a description. |
| **Current location** | The ⌖ button fills in the address where he is now. |
| **Google Sheet sync** | Each trip is inserted as row 2 (newest on top, like now), with the same formatting. The totals row at the bottom keeps counting. Editing or deleting a trip in the app also changes it in the Sheet. |
| **Offline** | Without signal, trips are queued and sent automatically once he's online again. |
| **Export** | CSV per month in the same columns (opens in Excel), or *copy* to paste into Google Sheets. |
| **History & summary** | Trips per month (tap one to edit, delete or repeat it), total km, € reimbursement, business vs. private, and the most-driven routes. |
| **Home screen app** | Opens full-screen like a normal app, with its own icon. |
| **English / Dutch** | Tap **NL EN** at the top to switch the app's language. It's remembered on each phone. Anything written to the Google Sheet stays Dutch, so his records stay consistent. |

## One-time setup (≈5 minutes, in his Google account)

1. Open the Google Sheet → **Extensies → Apps Script**.
2. Delete what's there and paste in all of `apps-script/Code.gs`.
3. On line 8, change `TOKEN` to a secret code of his own (e.g. `rit-7f3k9q`).
4. Click **Implementeren → Nieuwe implementatie** → type **Web-app**.
   - *Uitvoeren als:* **Ik**
   - *Wie heeft toegang:* **Iedereen**
5. Click **Implementeren**, approve access with his Google account, and copy the **Web-app URL** (ends in `/exec`).
6. In the app: **Instellingen → Google Sheet**: paste the URL and the code → **Opslaan & testen**. It should say *✓ Verbonden met tabblad "…"* and pull in his existing trips.
7. Tap **Instellingen → Kopieer mijn link** to get an updated personal link that includes the Sheet connection. Keep it somewhere private, e.g. Notes or a message to himself.

> Only someone with the secret code can write to the Sheet. If the script changes later, use **Implementeren → Implementaties beheren → Bewerken → Nieuwe versie** so the URL stays the same.

## Privacy: what's public and what isn't

The code is public on GitHub Pages, but it contains **no personal data**: no addresses, car, plate, name or Sheet connection. Those live in a **personal setup link** (`…/ritlog/#setup=…`). Everything after `#` stays on the phone and is never sent to GitHub. Treat the link like a key: whoever has it gets his places and can write to the Sheet. Only send it privately.

The original personal values are in `private/` on this Mac. That folder is git-ignored and never uploaded.

## Putting it on his iPhone

Live at **https://chenxi981211-ui.github.io/ritlog/**

1. Open that address in **Safari** → **Share → Zet op beginscherm**.
2. Open **Ritlog** from the home screen → **Instellingen** → paste the personal setup link → **Laden**.

(An app on the iPhone home screen has its own storage, separate from Safari. That's why the link is pasted inside the installed app.)

If speech recognition isn't available in the installed app, tapping *Inspreken* opens a text box. Use the 🎙 microphone on the iPhone keyboard there, then tap *Invullen*.

## Files

- `index.html`, `styles.css`, `app.js`: the app
- `config.js`: generic defaults only. Personal values come from the setup link.
- `private/`: his personal config and setup link (git-ignored, Mac only)
- `sw.js`, `manifest.webmanifest`, `icons/`: offline support and home-screen icon
- `apps-script/Code.gs`: the Google Sheet connection
