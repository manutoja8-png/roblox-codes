// "[🎃 UPD] Adopt Me! 🏡" -> "Adopt Me!"
export function cleanGameName(name) {
  return name
    .replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】/g, ' ')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️]/gu, ' ')
    .replace(/\b(UPD(ATE)?|NEW|SALE|EVENT|BETA|ALPHA|RELEASE|x\d+)\b!?/gi, ' ')
    .replace(/[|~•]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || name.trim();
}

export function slugify(s) {
  return s
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export const normalize = (s) => slugify(s).replace(/-/g, '');
