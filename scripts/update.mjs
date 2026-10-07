// Fetches popular Roblox games, their codes (Fandom wiki + game description)
// and merges everything into data/state.json, keeping history between runs.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseWikiCodes, descriptionCodes } from './lib/extract.mjs';
import { cleanGameName, slugify, normalize } from './lib/text.mjs';

const ROOT = new URL('../', import.meta.url);
const UA = 'Mozilla/5.0 (compatible; RobloxCodesBot/1.0)';
const DAY = 86400000;
const today = new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const readJSON = async (p, fallback) => {
  try { return JSON.parse(await readFile(new URL(p, ROOT), 'utf8')); } catch { return fallback; }
};

async function getJSON(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, redirect: 'follow' });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) return null;
      const text = await r.text();
      try { return JSON.parse(text); } catch { return null; } // HTML error pages etc.
    } catch (e) {
      if (i === tries - 1) { console.warn(`  ! ${url} -> ${e.message}`); return null; }
      await sleep(2000 * (i + 1));
    }
  }
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// ---------- 1. Load config & previous state ----------
const config = await readJSON('config/games.json', { maxDiscovered: 100, sorts: [], pinned: [] });
const manual = await readJSON('config/manual.json', {});
const state = await readJSON('data/state.json', { updatedAt: null, games: {} });

// ---------- 2. Discover popular games ----------
console.log('Discovering games…');
const discovered = [];
const explore = await getJSON(`https://apis.roblox.com/explore-api/v1/get-sorts?sessionId=${crypto.randomUUID()}&device=computer&country=all`);
for (const sort of explore?.sorts ?? []) {
  if (!config.sorts.includes(sort.sortId)) continue;
  for (const g of sort.games ?? []) if (g.universeId) discovered.push(g.universeId);
}
const discoveredIds = [...new Set(discovered)].slice(0, config.maxDiscovered);
console.log(`  ${discoveredIds.length} games from explore`);

const pinnedByUniverse = {};
for (const p of config.pinned) {
  let id = p.universeId;
  if (!id && p.placeId) id = (await getJSON(`https://apis.roblox.com/universes/v1/places/${p.placeId}/universe`))?.universeId;
  if (id) pinnedByUniverse[id] = p; else console.warn(`  ! could not resolve pinned game`, p);
}

// Keep tracking games that already have codes, even if they leave the charts (stable URLs for SEO).
const knownWithCodes = Object.entries(state.games)
  .filter(([, g]) => Object.keys(g.codes ?? {}).length)
  .map(([id]) => Number(id));
const allIds = [...new Set([...Object.keys(pinnedByUniverse).map(Number), ...discoveredIds, ...knownWithCodes])];

// ---------- 3. Game details, votes and icons ----------
console.log(`Fetching details for ${allIds.length} games…`);
const details = {}, votes = {}, icons = {};
for (const ids of chunk(allIds, 50)) {
  const q = ids.join(',');
  for (const g of (await getJSON(`https://games.roblox.com/v1/games?universeIds=${q}`))?.data ?? []) details[g.id] = g;
  for (const v of (await getJSON(`https://games.roblox.com/v1/games/votes?universeIds=${q}`))?.data ?? []) votes[v.id] = v;
  for (const t of (await getJSON(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${q}&size=256x256&format=Webp&isCircular=false`))?.data ?? [])
    if (t.state === 'Completed') icons[t.targetId] = t.imageUrl;
}

// ---------- 4. Fandom wiki lookup ----------
async function findWiki(name) {
  const base = slugify(name);
  const candidates = [...new Set([base, base.replace(/-/g, ''), `${base}-roblox`, `roblox-${base}`])];
  for (const sub of candidates) {
    const info = await getJSON(`https://${sub}.fandom.com/api.php?action=query&meta=siteinfo&format=json`, 1);
    await sleep(250);
    const site = info?.query?.general?.sitename;
    if (!site) continue;
    const a = normalize(site.replace(/wiki$/i, '')), b = normalize(name);
    if (a && b && (a === b || a.includes(b) || b.includes(a))) return sub;
  }
  return null;
}

async function wikiCodes(sub, pages) {
  for (const page of pages) {
    const j = await getJSON(`https://${sub}.fandom.com/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json&redirects=1`);
    await sleep(300);
    const wt = j?.parse?.wikitext?.['*'];
    if (!wt) continue;
    const codes = parseWikiCodes(wt);
    if (codes.length) return { page: j.parse.title, codes };
  }
  return null;
}

// ---------- 5. Merge ----------
const usedSlugs = new Set(Object.values(state.games).map((g) => g.slug));
let newCodes = 0;

for (const id of allIds) {
  const d = details[id];
  if (!d) continue;
  const pin = pinnedByUniverse[id];
  const prev = state.games[id] ?? { codes: {} };
  const name = pin?.name ?? cleanGameName(d.name);

  let slug = prev.slug;
  if (!slug) {
    slug = pin?.slug ?? slugify(name);
    if (!slug) continue;
    if (usedSlugs.has(slug)) slug = `${slug}-${id}`;
    usedSlugs.add(slug);
  }

  // Wiki: pinned override > cached > probe (negative results re-checked weekly)
  let wiki = pin?.wiki ?? prev.wiki ?? null;
  let wikiCheckedAt = prev.wikiCheckedAt;
  if (!wiki && (!wikiCheckedAt || Date.now() - Date.parse(wikiCheckedAt) > 7 * DAY)) {
    wiki = await findWiki(name);
    wikiCheckedAt = today;
    if (wiki) console.log(`  + wiki for ${name}: ${wiki}.fandom.com`);
  }

  const found = new Map(); // lowercased code -> {code, reward, status, source}
  let wikiOk = false, wikiPage = prev.wikiPage;
  if (wiki) {
    const res = await wikiCodes(wiki, pin?.wikiPages ?? ['Codes', 'Promo Codes', 'Promo codes', 'Code']);
    if (res) {
      wikiOk = true; wikiPage = res.page;
      for (const c of res.codes) found.set(c.code.toLowerCase(), { ...c, source: 'wiki' });
    }
  }
  for (const code of descriptionCodes(d.description ?? '', name)) {
    const k = code.toLowerCase();
    if (!found.has(k)) found.set(k, { code, reward: '', status: 'active', source: 'description' });
  }

  const codes = { ...prev.codes };
  // On a game's first scan we can't tell which codes are actually new, so none get the NEW badge.
  const firstScan = !Object.keys(prev.codes).length;
  for (const [k, c] of found) {
    const old = codes[k];
    if (!old) {
      codes[k] = { code: c.code, reward: c.reward, status: c.status, source: c.source, firstSeen: today, lastSeen: today };
      if (firstScan) codes[k].seeded = true;
      else if (c.status === 'active') newCodes++;
      if (c.status === 'expired') codes[k].expiredAt = today;
    } else {
      old.lastSeen = today;
      if (c.reward) old.reward = c.reward;
      if (c.status === 'expired' && old.status !== 'expired') { old.status = 'expired'; old.expiredAt = today; }
      if (c.status === 'active' && old.status === 'expired' && c.source === 'wiki') { old.status = 'active'; delete old.expiredAt; }
    }
  }
  // Codes that vanished from a source that was read successfully are considered expired.
  for (const [k, c] of Object.entries(codes)) {
    if (c.status !== 'active' || found.has(k) || c.source === 'manual') continue;
    const sourceRead = c.source === 'description' || (c.source === 'wiki' && wikiOk);
    if (sourceRead) { c.status = 'expired'; c.expiredAt = today; }
  }

  // Manual overrides from config/manual.json
  const m = manual[slug];
  for (const a of m?.add ?? []) {
    const k = a.code.toLowerCase();
    codes[k] = { firstSeen: today, ...codes[k], code: a.code, reward: a.reward ?? codes[k]?.reward ?? '', status: 'active', source: 'manual', lastSeen: today };
  }
  for (const code of m?.expire ?? []) {
    const c = codes[code.toLowerCase()];
    if (c && c.status !== 'expired') { c.status = 'expired'; c.expiredAt = today; }
  }
  for (const code of m?.remove ?? []) delete codes[code.toLowerCase()];

  const changed = JSON.stringify(codes) !== JSON.stringify(prev.codes);
  state.games[id] = {
    slug, name, universeId: id, placeId: d.rootPlaceId,
    creator: d.creator?.name ?? '', genre: d.genre ?? '',
    playing: d.playing ?? 0, visits: d.visits ?? 0, favorites: d.favoritedCount ?? 0,
    upVotes: votes[id]?.upVotes ?? 0, downVotes: votes[id]?.downVotes ?? 0,
    icon: icons[id] ?? prev.icon ?? '', gameUpdated: d.updated,
    trending: discoveredIds.includes(id),
    wiki, wikiPage, wikiCheckedAt,
    codesChangedAt: changed ? today : prev.codesChangedAt ?? today,
    codes: Object.fromEntries(Object.entries(codes).sort(([a], [b]) => a.localeCompare(b))),
  };
}

// Drop games that never had codes and are no longer trending or pinned (keeps the file small).
for (const [id, g] of Object.entries(state.games)) {
  if (!Object.keys(g.codes).length && !allIds.includes(Number(id))) delete state.games[id];
}

state.updatedAt = new Date().toISOString();
await mkdir(new URL('data/', ROOT), { recursive: true });
await writeFile(new URL('data/state.json', ROOT), JSON.stringify(state, null, 1) + '\n');

const withCodes = Object.values(state.games).filter((g) => Object.values(g.codes).some((c) => c.status === 'active'));
console.log(`Done. ${Object.keys(state.games).length} games tracked, ${withCodes.length} with active codes, ${newCodes} new active codes.`);
