# The Trust Pulse

Live audience voting for *"The Art of the Con: Legacy of Deception"*: the audience votes on 6 social-engineering dilemmas (4 answers each, one safe) from their phones, and each vote reshapes a real-time Three.js cyber shield on the projector.

## Setup

```bash
npm install
# (fresh project: npm install firebase three @types/three qrcode @types/qrcode)
cp .env.local.example .env.local   # fill in your Firebase web app values
npm run dev
```

1. Firebase console → create a project → **Realtime Database** (e.g. europe-west1).
2. Project settings → add a **Web app** → copy the config into `.env.local`.
3. Realtime Database → **Rules** → paste `database.rules.json`.

## Routes

| Route    | Purpose                                                        |
|----------|----------------------------------------------------------------|
| `/`      | Audience phone view (vote, see confirmation & explanation)     |
| `/stage` | Projector view (3D shield, live gauge, presenter control bar)  |

## Stage keyboard shortcuts

`0`–`6` switch scenario · `R` toggle reveal · `Q` QR code · `Esc` close modal.
The control bar is dimmed until hovered.

## Deploy (GitHub Pages)

1. Repo → Settings → Pages → Source: **Deploy from a branch**, branch `gh-pages` / root (set automatically on first publish).
2. Repo → Settings → Secrets and variables → Actions → add the 7 `NEXT_PUBLIC_FIREBASE_*` secrets.
3. Push to `main` (or run the workflow manually). The site goes live at `https://<user>.github.io/<repo>/`, stage view at `/<repo>/stage/`.

The app is a fully static export, so it also deploys as-is to Vercel/Netlify. Open `/stage` on the presenter laptop in full screen (F11); the QR code points to the deployed origin automatically.

> Note: `/stage` controls are not authenticated — anyone who knows the URL can change the scenario or reset the votes.
