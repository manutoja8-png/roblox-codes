// Code extraction from Fandom wikitext and from Roblox game descriptions.

const NOT_CODES = new Set([
  'code', 'codes', 'reward', 'rewards', 'status', 'date', 'released', 'release', 'release date', 'expired',
  'active', 'working', 'none', 'n/a', 'na', 'tba', 'tbd', 'unknown', 'yes', 'no', 'level', 'requirement',
  'notes', 'note', 'source', 'image', 'item', 'items', 'added', 'removed', 'expires',
]);

// Turns wiki markup into plain text.
export function cleanText(s = '') {
  let t = String(s)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '')
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, '$1')
    .replace(/\[https?:\/\/[^\]]*\]/g, '');
  // Templates, innermost first: {{Money|1,000}} -> "1,000", {{EXP}} -> "EXP"
  for (let i = 0; i < 10 && /\{\{[^{}]*\}\}/.test(t); i++) {
    t = t.replace(/\{\{([^{}]*)\}\}/g, (_, inner) => {
      const parts = inner.split('|').map((p) => p.trim());
      const unnamed = parts.slice(1).filter((p) => !/^[\w\s-]+=/.test(p));
      if (!unnamed.length) return parts[0];
      const last = unnamed[unnamed.length - 1];
      // quantity templates: {{Diamond|15}} -> "15 Diamond"
      return unnamed.length === 1 && /^[\d.,]+[kKmM]?$/.test(last) ? `${last} ${parts[0]}` : last;
    });
  }
  return t
    .replace(/<br\s*\/?>/gi, ', ')
    .replace(/<[^>]+>/g, '')
    .replace(/(^|\s)\*+\s+/g, ', ')
    .replace(/'{2,}/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[\s,]+|[\s,]+$/g, '');
}

export function cleanCode(raw) {
  let c = cleanText(raw)
    .replace(/\((new|case[- ]sensitive)[^)]*\)/gi, '')
    .replace(/\s*\bNEW!?$/i, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
  if (!/^[A-Za-z0-9_!@#$%&*.\-?']{3,40}$/.test(c)) return null;
  if (/^\d+$/.test(c) || !/[A-Za-z]/.test(c)) return null;
  if (NOT_CODES.has(c.toLowerCase())) return null;
  return c;
}

function classify(label) {
  const l = cleanText(label).toLowerCase();
  if (/expired|inactive|invalid|past|old|discontinued|retired|unavailable|no longer|removed|patched/.test(l)) return 'expired';
  if (/\b(active|working|valid|current|available|new)\b/.test(l) || /^(promo )?codes?( list)?$/.test(l)) return 'active';
  return null;
}

// Splits a table row on "||"/"!!" (outside [[ ]] and {{ }}) and strips "attr=value |" prefixes.
function splitCells(line) {
  const cells = [];
  let depth = 0, cur = '';
  for (let i = 0; i < line.length; i++) {
    const two = line.slice(i, i + 2);
    if (two === '[[' || two === '{{') { depth++; cur += two; i++; continue; }
    if ((two === ']]' || two === '}}') && depth > 0) { depth--; cur += two; i++; continue; }
    if (depth === 0 && (two === '||' || two === '!!')) { cells.push(cur); cur = ''; i++; continue; }
    cur += line[i];
  }
  cells.push(cur);
  return cells.map((c) => {
    // attribute prefix: `style="..." | content`
    let d = 0;
    for (let i = 0; i < c.length; i++) {
      const two = c.slice(i, i + 2);
      if (two === '[[' || two === '{{') { d++; i++; continue; }
      if ((two === ']]' || two === '}}') && d > 0) { d--; i++; continue; }
      if (d === 0 && c[i] === '|' && /=/.test(c.slice(0, i))) return c.slice(i + 1);
    }
    return c;
  });
}

export function parseWikiCodes(wikitext) {
  const text = wikitext
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  const out = new Map();
  let status = null, row = [], inTable = 0;

  const add = (code, reward, st) => {
    if (!code || !st) return;
    const k = code.toLowerCase();
    if (out.has(k) && out.get(k).status === 'expired') return; // expired wins if listed twice
    out.set(k, { code, reward: cleanText(reward ?? '').slice(0, 300), status: st });
  };
  const flush = () => {
    if (row.length) {
      // Some tables have a per-row status column ("Active" / "Expired") that beats the section heading.
      const rowStatus = row.slice(1).map((c) => cleanText(c).toLowerCase()).find((c) => /^(active|working|valid|expired|inactive|invalid)$/.test(c));
      const st = rowStatus ? (/^(active|working|valid)$/.test(rowStatus) ? 'active' : 'expired') : status;
      add(cleanCode(row[0]), row[1], st);
    }
    row = [];
  };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const heading = line.match(/^(={2,6})\s*(.+?)\s*\1$/);
    const tabber = !heading && line.match(/^(?:\|-\|)?\s*([^=|{}<>[\]]{2,50}?)\s*=\s*$/);
    if (heading || (tabber && /code|active|working|expired|inactive/i.test(tabber[1]))) {
      flush();
      status = classify(heading ? heading[2] : tabber[1]);
      continue;
    }
    if (line.startsWith('{|')) { flush(); inTable++; continue; }
    if (line.startsWith('|}')) { flush(); inTable = Math.max(0, inTable - 1); continue; }
    if (inTable) {
      if (line.startsWith('|-')) { flush(); continue; }
      if (line.startsWith('|+')) continue;
      if (line.startsWith('|') || line.startsWith('!')) { row.push(...splitCells(line.slice(1))); continue; }
      if (line && row.length) row[row.length - 1] += ' ' + line; // multi-line cell
      continue;
    }
    // Bullet lists: "* CODE - reward"
    const bullet = status && line.match(/^\*+\s*(.+)$/);
    if (bullet) {
      const [, code, reward] = bullet[1].match(/^(.+?)(?:\s*(?:[-–—:]|&ndash;|&mdash;)\s+(.*))?$/) ?? [];
      add(cleanCode(code), reward, status);
    }
  }
  flush();
  return [...out.values()];
}

const DESC_STOP = new Set(['CODE', 'CODES', 'NEW', 'FREE', 'UPDATE', 'LIKE', 'LIKES', 'DISCORD', 'GROUP', 'TWITTER',
  'YOUTUBE', 'ROBLOX', 'VIP', 'EXP', 'XP', 'OP', 'GEMS', 'COINS', 'CASH', 'MENU', 'SHOP', 'SETTINGS', 'REWARD', 'REWARDS',
  'JOIN', 'FAVORITE', 'FOLLOW', 'SERVER', 'TIKTOK', 'THE', 'AND', 'FOR', 'USE', 'REDEEM', 'ENTER', 'HERE', 'BELOW', 'NOW',
  'MORE', 'LIMITED', 'TIME', 'EVENT', 'BOOST', 'DOUBLE', 'LUCK', 'PETS', 'PET', 'SPINS', 'SPIN', 'ACTIVE', 'EXPIRED', 'TWITCH']);

// Pulls codes developers put in the game description, e.g. "Use code RELEASE for 500 gems!"
export function descriptionCodes(desc, gameName = '') {
  const nameWords = new Set(gameName.toUpperCase().split(/[^A-Z0-9]+/));
  const found = new Set();
  const isCode = (t) =>
    t.length >= 4 && t.length <= 30 && /[A-Z]/.test(t) &&
    (t === t.toUpperCase() || /\d/.test(t) || /[a-z][A-Z]/.test(t)) &&
    !/^\d/.test(t) && !DESC_STOP.has(t.toUpperCase()) && !nameWords.has(t.toUpperCase()) && !/^https?/i.test(t);

  const lines = desc.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/\bcodes?\b\s*[:\-–=]?\s*(.*)$/i);
    if (!m || /\b(no|expired|old)\s+codes?\b|codes?\s+(expired|ended)/i.test(line)) continue;
    let tokens = m[1].split(/[\s,;/|]+/).slice(0, 8);
    // "CODES:" header followed by a list on the next lines
    if (!m[1].trim()) tokens = lines.slice(i + 1, i + 8).filter((l) => l.trim()).map((l) => l.replace(/^[^A-Za-z0-9]+/, '').split(/[\s:\-–]+/)[0]);
    for (let t of tokens) {
      t = t.replace(/^["'“”‘’(«]+|["'“”‘’)»!.,]+$/g, '');
      if (/^(for|to|gives?|=|-|→|➜)$/i.test(t)) break;
      if (isCode(t)) found.add(t);
    }
  }
  return [...found];
}
