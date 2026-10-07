# CodeRadar – Self-updating Roblox codes

Static site in **English (`/`) and Spanish (`/es/`)** that updates itself every 3 hours with a GitHub Action and is published for free on GitHub Pages.

## How it updates itself

`scripts/update.mjs` (every 3 hours):
1. **Discovers popular games** with Roblox's public API (top playing, trending, up-and-coming…).
2. **Gets data** for each game: players online, visits, rating and icon.
3. **Finds codes** in two sources:
   - The game's **Fandom wiki** "Codes" page (detected automatically, separating active and expired codes).
   - The game's **official description** on Roblox (for example "Use code RELEASE").
4. **Keeps a history** in `data/state.json`: new codes get the NEW badge for 7 days, and codes that disappear are moved to "expired".

`scripts/build.mjs` generates the HTML pages, `sitemap.xml`, `robots.txt`, hreflang, canonical tags and schema.org in `dist/`.

## Publishing it (once, about 10 minutes)

1. Create a **public** repository on GitHub (for example `roblox-codes`) and upload this folder:
   ```bash
   git init && git add . && git commit -m "Initial site" && git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/roblox-codes.git && git push -u origin main
   ```
2. On GitHub: **Settings → Pages → Source: GitHub Actions**.
3. **Actions → "Update codes & deploy" → Run workflow**. In 2–3 minutes it will be live at `https://YOUR_USERNAME.github.io/roblox-codes/`.
4. From then on it updates itself every 3 hours.

### Custom domain (recommended for SEO and AdSense)
1. Buy a domain (for example on Cloudflare or Namecheap) and add it under **Settings → Pages → Custom domain**.
2. Under **Settings → Secrets and variables → Actions → Variables**, create `SITE_URL` = `https://yourdomain.com/`.
3. Register the domain in **Google Search Console** and submit `https://yourdomain.com/sitemap.xml`.

## Configuration

| File | What it's for |
|---|---|
| `config/site.json` | Site name, `adsenseClient` (ca-pub-…) and `analyticsId` (G-…) |
| `config/games.json` | Games always tracked (`pinned`, with their `wiki` if not detected automatically) and how many popular games to discover |
| `config/manual.json` | Manual fixes per game slug: `add` codes, mark them as `expire`, or `remove` false positives |
| `scripts/i18n.mjs` | All site text in EN and ES (titles, meta descriptions, FAQ…) |

## Commands (requires Node 20+)

```bash
npm run update   # download the latest codes
npm run dev      # build and serve at http://localhost:8080
```
