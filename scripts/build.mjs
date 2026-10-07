// Generates the static site (English at /, Spanish at /es/) from data/state.json into dist/.
import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { LANGS, t } from './i18n.mjs';

const ROOT = new URL('../', import.meta.url);
const site = JSON.parse(await readFile(new URL('config/site.json', ROOT), 'utf8'));
const state = JSON.parse(await readFile(new URL('data/state.json', ROOT), 'utf8'));

const SITE_URL = (process.env.SITE_URL || site.url).replace(/\/?$/, '/');
const BASE = new URL(SITE_URL).pathname; // "/" or "/repo-name/"
const now = new Date(state.updatedAt ?? Date.now());
const WEEK = 7 * 86400000;

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const abs = (p) => SITE_URL + p;
const href = (p) => BASE + p;

// ---------- Data ----------
const games = Object.values(state.games)
  .filter((g) => Object.keys(g.codes).length)
  .map((g) => {
    const all = Object.values(g.codes);
    const active = all.filter((c) => c.status === 'active')
      .sort((a, b) => b.firstSeen.localeCompare(a.firstSeen) || a.code.localeCompare(b.code));
    const expired = all.filter((c) => c.status !== 'active')
      .sort((a, b) => (b.expiredAt ?? '').localeCompare(a.expiredAt ?? '') || a.code.localeCompare(b.code));
    return { ...g, active, expired };
  })
  .sort((a, b) => (b.active.length > 0) - (a.active.length > 0) || b.playing - a.playing);

const totalActive = games.reduce((n, g) => n + g.active.length, 0);
const isNew = (c) => !c.seeded && now - Date.parse(c.firstSeen) < WEEK;

// ---------- Helpers ----------
function fmt(L) {
  const num = new Intl.NumberFormat(L.locale, { notation: 'compact', maximumFractionDigits: 1 });
  const date = new Intl.DateTimeFormat(L.locale, { day: 'numeric', month: 'long', year: 'numeric' });
  const month = new Intl.DateTimeFormat(L.locale, { month: 'long', year: 'numeric' }).format(now);
  return { num: (n) => num.format(n), date: (d) => date.format(new Date(d)), month };
}

function layout({ lang, title, desc, path, alt, body, jsonld = [] }) {
  const L = LANGS[lang];
  const otherLang = lang === 'en' ? 'es' : 'en';
  const ads = site.adsenseClient
    ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(site.adsenseClient)}" crossorigin="anonymous"></script>` : '';
  const ga = site.analyticsId
    ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(site.analyticsId)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${esc(site.analyticsId)}');</script>` : '';
  const alternates = alt
    ? `<link rel="alternate" hreflang="en" href="${abs(alt.en)}"><link rel="alternate" hreflang="es" href="${abs(alt.es)}"><link rel="alternate" hreflang="x-default" href="${abs(alt.en)}">` : '';
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${abs(path)}">
${alternates}
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${abs(path)}">
<meta property="og:site_name" content="${esc(site.name)}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#0b0f17">
<link rel="icon" href="${href('assets/favicon.svg')}" type="image/svg+xml">
<link rel="stylesheet" href="${href('assets/style.css')}">
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join('\n')}
${ga}${ads}
</head>
<body>
<header class="top"><div class="wrap">
  <a class="logo" href="${href(L.homePath)}"><span class="logo-mark">◆</span> ${esc(site.name)}</a>
  ${alt ? `<a class="lang" href="${href(alt[otherLang])}" hreflang="${otherLang}">${L.switchTo}</a>` : ''}
</div></header>
<main class="wrap">
${body}
</main>
<footer class="foot"><div class="wrap">
  <p>${esc(L.footer)}</p>
  <p><a href="${href(L.homePath)}">${L.home}</a> · <a href="${href(L.privacyPath)}">${L.privacy}</a></p>
</div></footer>
<script src="${href('assets/app.js')}" defer></script>
</body>
</html>`;
}

const icon = (g, size) => g.icon
  ? `<img src="${esc(g.icon)}" alt="${esc(g.name)}" width="${size}" height="${size}" loading="lazy" decoding="async">`
  : `<span class="noicon" style="width:${size}px;height:${size}px">${esc(g.name[0])}</span>`;

function codeRow(c, L, f) {
  return `<li class="code">
  <div class="code-main">
    <code>${esc(c.code)}</code>${isNew(c) ? ` <span class="badge">${L.isNew}</span>` : ''}
    <div class="reward">${esc(c.reward || L.freeReward)}</div>
  </div>
  <button class="copy" data-code="${esc(c.code)}" data-done="${esc(L.copied)}">${L.copy}</button>
</li>`;
}

function gameCard(g, L, f) {
  return `<a class="card" href="${href(L.gamePath(g.slug))}" data-name="${esc(g.name.toLowerCase())}">
  ${icon(g, 64)}
  <div><strong>${esc(g.name)}</strong>
  <span class="${g.active.length ? 'ok' : 'muted'}">${g.active.length ? t(L.activeCount, { n: g.active.length }) : L.noActive}</span>
  <span class="muted">${t(L.playing, { n: f.num(g.playing) })}</span></div>
</a>`;
}

// ---------- Pages ----------
function homePage(lang) {
  const L = LANGS[lang], f = fmt(L);
  const fresh = games.flatMap((g) => g.active.filter(isNew).slice(0, 3).map((c) => ({ ...c, g })))
    .sort((a, b) => b.firstSeen.localeCompare(a.firstSeen)).slice(0, 12);
  const body = `
<section class="hero">
  <h1>${esc(t(L.homeH1, { month: f.month }))}</h1>
  <p>${esc(L.homeIntro)}</p>
  <p class="stats">${esc(t(L.statsLine, { active: totalActive, games: games.length, updated: f.date(now) }))}</p>
  <input id="q" type="search" placeholder="${esc(L.search)}" aria-label="${esc(L.search)}">
</section>
${fresh.length ? `<section><h2>${L.newCodes}</h2><ul class="codes">${fresh.map((c) => codeRow({ ...c, reward: `${c.g.name} · ${c.reward || L.freeReward}` }, L, f)).join('')}</ul></section>` : ''}
<section><h2>${L.allGames}</h2><div class="grid" id="games">${games.map((g) => gameCard(g, L, f)).join('')}</div></section>`;
  return layout({
    lang, path: L.homePath, alt: { en: LANGS.en.homePath, es: LANGS.es.homePath },
    title: t(L.homeTitle, { month: f.month }),
    desc: t(L.homeDesc, { active: totalActive, games: games.length }),
    body,
    jsonld: [{ '@context': 'https://schema.org', '@type': 'WebSite', name: site.name, url: abs(L.homePath), inLanguage: lang }],
  });
}

function gamePage(g, lang) {
  const L = LANGS[lang], f = fmt(L);
  const vars = { game: g.name, month: f.month, n: g.active.length, updated: f.date(now), creator: g.creator || 'Roblox', players: f.num(g.playing) };
  const sample = g.active.map((c) => c.reward).filter(Boolean).slice(0, 2).join(', ') || L.freeReward.toLowerCase();
  const rating = g.upVotes + g.downVotes ? Math.round((g.upVotes / (g.upVotes + g.downVotes)) * 100) + '%' : '—';
  const sources = [
    g.wiki && `<a href="https://${esc(g.wiki)}.fandom.com/wiki/${encodeURIComponent((g.wikiPage ?? 'Codes').replace(/ /g, '_'))}" rel="nofollow noopener" target="_blank">${esc(t(L.srcWiki, { wiki: g.name }))}</a>`,
    Object.values(g.codes).some((c) => c.source === 'description') && esc(L.srcDesc),
  ].filter(Boolean).join(', ');
  const related = games.filter((o) => o !== g && o.active.length).slice(0, 6);
  const playUrl = `https://www.roblox.com/games/${g.placeId}`;
  const faqs = L.faqs.map(([q, a]) => [t(q, vars), t(a, vars)]);

  const body = `
<nav class="crumbs"><a href="${href(L.homePath)}">${L.home}</a> › ${esc(g.name)}</nav>
<section class="game-head">
  ${icon(g, 96)}
  <div>
    <h1>${esc(t(L.gameH1, vars))}</h1>
    <p class="stats">${esc(t(L.updated, { date: f.date(now) }))} · <span class="${g.active.length ? 'ok' : 'muted'}">${g.active.length ? t(L.activeCount, { n: g.active.length }) : L.noActive}</span></p>
  </div>
</section>
<p class="intro">${esc(t(g.active.length ? L.gameIntro : L.gameIntroNone, vars))}</p>

<section>
  <h2>${esc(t(L.activeCodes, vars))}</h2>
  ${g.active.length ? `<ul class="codes">${g.active.map((c) => codeRow(c, L, f)).join('')}</ul>` : `<p class="empty">${L.noActive}</p>`}
</section>

<section class="howto">
  <h2>${esc(t(L.howTo, vars))}</h2>
  <ol>${L.howToSteps.map((s) => `<li>${esc(t(s, vars))}</li>`).join('')}</ol>
  <a class="btn" href="${playUrl}" rel="nofollow noopener" target="_blank">${esc(t(L.play, vars))} ↗</a>
</section>

${g.expired.length ? `<section>
  <h2>${esc(t(L.expiredCodes, vars))}</h2>
  <p class="muted">${esc(L.expiredNote)}</p>
  <details><summary>${esc(t(L.showExpired, { n: g.expired.length }))}</summary>
  <ul class="expired">${g.expired.map((c) => `<li><code>${esc(c.code)}</code>${c.reward ? ` <span class="muted">– ${esc(c.reward)}</span>` : ''}</li>`).join('')}</ul>
  </details>
</section>` : ''}

<section>
  <h2>${esc(t(L.aboutGame, vars))}</h2>
  <dl class="facts">
    <div><dt>${L.creator}</dt><dd>${esc(g.creator || '—')}</dd></div>
    <div><dt>${L.playingNow}</dt><dd>${f.num(g.playing)}</dd></div>
    <div><dt>${L.visits}</dt><dd>${f.num(g.visits)}</dd></div>
    <div><dt>${L.rating}</dt><dd>${rating}</dd></div>
    ${g.genre ? `<div><dt>${L.genre}</dt><dd>${esc(g.genre)}</dd></div>` : ''}
  </dl>
</section>

<section class="faq">
  <h2>${L.faq}</h2>
  ${faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
</section>

${sources ? `<p class="muted small">${t(esc(L.sources), { sources })}</p>` : ''}

${related.length ? `<section><h2>${L.related}</h2><div class="grid">${related.map((o) => gameCard(o, L, f)).join('')}</div></section>` : ''}`;

  return layout({
    lang, path: L.gamePath(g.slug), alt: { en: LANGS.en.gamePath(g.slug), es: LANGS.es.gamePath(g.slug) },
    title: t(g.active.length ? L.gameTitle : L.gameTitleNone, vars),
    desc: t(g.active.length ? L.gameDesc : L.gameDescNone, { ...vars, sample }),
    body,
    jsonld: [
      {
        '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
          { '@type': 'ListItem', position: 1, name: L.home, item: abs(L.homePath) },
          { '@type': 'ListItem', position: 2, name: t(L.gameH1, vars), item: abs(L.gamePath(g.slug)) },
        ],
      },
      {
        '@context': 'https://schema.org', '@type': 'FAQPage',
        mainEntity: faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
      },
    ],
  });
}

function simplePage(lang, path, alt, title, paragraphs) {
  return layout({
    lang, path, alt, title: `${title} – ${site.name}`, desc: paragraphs[0],
    body: `<section class="prose"><h1>${esc(title)}</h1>${paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}<p><a class="btn" href="${href(LANGS[lang].homePath)}">${LANGS[lang].home}</a></p></section>`,
  });
}

// ---------- Write ----------
const DIST = new URL('dist/', ROOT);
await rm(DIST, { recursive: true, force: true });
const out = async (p, content) => {
  const file = new URL(p.endsWith('/') || p === '' ? `${p}index.html` : p, DIST);
  await mkdir(new URL('./', file), { recursive: true });
  await writeFile(file, content);
};

const sitemap = [];
for (const lang of Object.keys(LANGS)) {
  const L = LANGS[lang];
  await out(L.homePath, homePage(lang));
  sitemap.push([L.homePath, now.toISOString().slice(0, 10)]);
  for (const g of games) {
    await out(L.gamePath(g.slug), gamePage(g, lang));
    sitemap.push([L.gamePath(g.slug), g.codesChangedAt]);
  }
  await out(L.privacyPath, simplePage(lang, L.privacyPath, { en: LANGS.en.privacyPath, es: LANGS.es.privacyPath }, L.privacyTitle, L.privacyBody));
}
await out('404.html', simplePage('en', '404.html', null, LANGS.en.notFound, [LANGS.en.notFoundText]));
await out('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemap.map(([p, d]) => `<url><loc>${abs(p)}</loc><lastmod>${d}</lastmod></url>`).join('\n')}
</urlset>
`);
await out('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${abs('sitemap.xml')}\n`);
await cp(new URL('public/', ROOT), DIST, { recursive: true });

console.log(`Built ${sitemap.length} pages (${games.length} games, ${totalActive} active codes) for ${SITE_URL}`);
