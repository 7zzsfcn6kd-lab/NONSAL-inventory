# NONSAL Inventory Capture (PWA MVP)

Simple iPhone-friendly inventory capture app:
- Capture photo
- Set room
- Add/edit description (voice-to-text or keyboard)
- Save locally (IndexedDB)
- Export to XLSX with inline thumbnails

## Run locally

Open `index.html` directly for quick testing.

For full PWA behavior (service worker + install to home screen), serve over HTTPS.

## Ask Codex to create an HTTPS tunnel

In this same Codex thread, ask:

`help me serve this over to https`

Codex will typically run:

1. Local static server

```bash
cd "/Users/jasonharker/Documents/Playground/NONSAL inventory"
python3 -m http.server 8000
```

2. HTTPS tunnel

```bash
cd "/Users/jasonharker/Documents/Playground/NONSAL inventory"
npx --yes localtunnel --port 8000
```

Then use the generated `https://...loca.lt` URL in iPhone Safari.

## Install on iPhone

1. Open the HTTPS URL in Safari.
2. Share -> Add to Home Screen.
3. Launch from Home Screen.
4. After initial load, test offline/airplane mode.

## Export workflow

- Tap **Export XLSX** for a spreadsheet with inline thumbnails.
- Tap **Download Photos** for separate full-size photo files.
- Transfer exported files to desktop from Files/iCloud.
