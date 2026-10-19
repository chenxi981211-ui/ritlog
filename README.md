# Ritlog: company-car trip logger

A small web app for iPhone that logs trips straight into the existing Google Sheet. The interface works in Dutch and English.

## What it does

| | |
|---|---|
| **Ride number (Rit-nr)** | Each day's rides are numbered 1, 2, 3… The next number is filled in automatically, the rides already logged that day are listed, and a missing number (e.g. a forgotten ride 2) can be used with one tap. It's placed in the right row of the Sheet, even when logged later. |
| **One-tap trips** | Big buttons for *Huis → Werk* / *Werk → Huis*. The suggestion follows the day's rides: no ride yet → Home → Work, after a ride to work → Work → Home. His most frequent routes appear too. |
| **Saved places** | Home, work, colleague and clients, each with nicknames for voice input. Edit them under *Instellingen*. |
| **Automatic distance** | Distances he has driven before come from his history. New routes are calculated with PDOK (Dutch address lookup) and OSRM (route planner), both free with no key. |
| **Smart defaults** | Date = today, ride number = next for that day. The next trip starts at the last destination. Odometer start = last odometer end, and end = start + km. Description, car, plate, driver and trip type are filled in. |
| **Voice input** | Example: *"gisteren rit 2 van werk naar Coolsingel 40 Rotterdam, klacht afhandelen bij klant"*. It understands dates (vandaag/gisteren/maandag/15 oktober), ride numbers (rit 3, tweede rit), places, odometer readings, privé/zakelijk and a description. |
| **Current location** | The ⌖ button fills in the address where he is now. |
| **Google Sheet sync** | Each trip is inserted in date and ride-number order (newest on top, like now), with the same formatting. The totals row at the bottom keeps counting. Editing or deleting a trip in the app also changes it in the Sheet. |
| **Offline** | Without signal, trips are queued and sent automatically once he's online again. |
| **Export** | CSV per month in the same columns (opens in Excel), or *copy* to paste into Google Sheets. |
| **History & summary** | Trips per month (tap one to edit, delete or repeat it), total km, € reimbursement, business vs. private, and the most-driven routes. |
| **Home screen app** | Opens full-screen like a normal app, with its own icon. |
| **English / Dutch** | Tap **NL EN** at the top to switch the app's language. It's remembered on each phone. Anything written to the Google Sheet stays Dutch, so his records stay consistent. |

## Connecting the Google Sheet (3 steps, on a computer, once)

The app shows these same steps on its first screen, with a **Copy script** button.

1. Open the Google Sheet → **Extensions → Apps Script**. Delete everything, paste the script (**Copy script** in the app, or `apps-script/Code.gs`) and click **Save**. Nothing needs editing.
2. Click **Deploy → New deployment** → type **Web app**, set **Who has access** to **Anyone** → **Deploy** → allow access. If Google says the app "isn't verified", choose **Advanced → Go to … (unsafe)**. That's normal for your own script.
3. Click the **Web app link** Google shows. A page with a QR code opens: scan it with the iPhone camera and Ritlog connects.

After connecting, the app reads the existing trips and fills in **home, work, frequent addresses, the latest odometer reading and known distances** by itself. Nothing else needs setting up.

- **Ritlog installed on the home screen?** On the QR page, tap **Copy link**, open Ritlog and paste the link in the box on the first screen.
- **Need the QR code again later?** The Sheet now has a **Ritlog → Telefoon koppelen** menu that shows it.
- **Security:** the Web app link is the key, so only share it with your own phones. (An extra code can still be set in `TOKEN` at the top of the script, but it isn't needed.)
- **Changed the script later?** Use **Deploy → Manage deployments → Edit → New version** so the link stays the same.

The script follows the Sheet's own columns by name, so columns can be added, removed or reordered. Trips get a **Rit-nr** (trip number of the day) automatically when that column exists.

## Privacy: what's public and what isn't

The code is public on GitHub Pages, but it contains **no personal data**: no addresses, car, plate, name or Sheet connection. The app gets those from his own Sheet once it's connected, and keeps them on the phone. The connect link (and the older `#setup=…` link) only lives after `#`, which is never sent to GitHub. Treat these links like keys and share them privately.

The original personal values are in `private/` on this Mac. That folder is git-ignored and never uploaded.

## Putting it on his iPhone

Live at **https://chenxi981211-ui.github.io/ritlog/**

1. Open that address in **Safari** → **Share → Add to Home Screen**.
2. Open **Ritlog** from the home screen and paste the connect link in the box on the first screen.

(An app on the iPhone home screen has its own storage, separate from Safari. That's why the link is pasted inside the installed app.)

If speech recognition isn't available in the installed app, tapping *Inspreken* opens a text box. Use the 🎙 microphone on the iPhone keyboard there, then tap *Invullen*.

## Files

- `index.html`, `styles.css`, `app.js`: the app
- `config.js`: generic defaults only. Personal values come from the setup link.
- `private/`: his personal config and setup link (git-ignored, Mac only)
- `sw.js`, `manifest.webmanifest`, `icons/`: offline support and home-screen icon
- `apps-script/Code.gs`: the Google Sheet connection
