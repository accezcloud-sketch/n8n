// Step 2 of 2: combines the two Gemini answers into structured data:
// `frontmatter` (one object, English + Arabic fields) and `body`
// (English, <!-- AR -->, Arabic). The file itself is written later by
// "Quality Gate", so quoting and escaping are done in one place.
const arRaw = $input.first().json.text;
if (!arRaw || !String(arRaw).trim()) {
  throw new Error('No content received from Gemini (Arabic article). Check the AI model response.');
}
const enRaw = $('Check English Draft').first().json.englishDraft;
const topicData = $('Find First Pending Topic').first().json;

// ---- 1. Remove code fences and any chatter before the frontmatter ----
function unwrap(raw) {
  let text = String(raw || '').replace(/\r\n/g, '\n').trim();
  text = text.replace(/^```[a-zA-Z]*[ \t]*\n/, '').replace(/\n```[ \t]*$/, '').trim();
  const fmStart = text.search(/^---[ \t]*$/m);
  if (fmStart > 0) text = text.slice(fmStart);
  return text;
}

// ---- 2. Parse a frontmatter block line by line ----
// Values are read leniently (Gemini sometimes forgets quotes or escapes);
// they are written back strictly by "Quality Gate".
function parseValue(v) {
  v = v.trim();
  if (v.startsWith('[')) {
    try { const a = JSON.parse(v); if (Array.isArray(a)) return a.map(x => String(x).trim()).filter(Boolean); } catch (e) {}
    return v.replace(/^\[|\]$/g, '').split(',').map(s => s.trim().replace(/^["']|["']$/g, '').trim()).filter(Boolean);
  }
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    try { return String(JSON.parse(v)); } catch (e) {}
    return v.slice(1, -1).replace(/\\"/g, '"'); // e.g. "The "Best" Way" with unescaped inner quotes
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}
function parse(text, label, parseProblems) {
  const frontmatter = {};
  let body = text;
  const fm = text.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!fm) {
    parseProblems.push(label + ': no frontmatter block found at the top of the output');
    return { frontmatter, body };
  }
  body = text.slice(fm[0].length);
  let listKey = null; // for YAML block lists ("tags:" followed by "- a" lines)
  for (const line of fm[1].split('\n')) {
    if (!line.trim()) continue;
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && listKey) { frontmatter[listKey].push(String(parseValue(item[1]))); continue; }
    const m = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (!m) { parseProblems.push(label + ': unreadable frontmatter line: ' + line.trim().slice(0, 60)); continue; }
    listKey = null;
    if (m[2].trim() === '') { frontmatter[m[1]] = []; listKey = m[1]; continue; }
    frontmatter[m[1]] = parseValue(m[2]);
  }
  return { frontmatter, body };
}

const parseProblems = [];
const en = parse(unwrap(enRaw), 'English', parseProblems);
const ar = parse(unwrap(arRaw), 'Arabic', parseProblems);

// ---- 3. One frontmatter: English fields from step 1, Arabic fields from step 2 ----
const EN_KEYS = ['title', 'metaTitle', 'metaDescription', 'primaryKeyword', 'excerpt', 'tags'];
const AR_KEYS = ['titleAr', 'metaTitleAr', 'metaDescriptionAr', 'excerptAr', 'tagsAr'];
const KNOWN_KEYS = EN_KEYS.concat(AR_KEYS, ['date', 'author', 'authorAr', 'coverImage', 'coverImageAlt',
  'coverImageCredit', 'coverImageCreditUrl', 'category', 'categoryAr']);
const frontmatter = {};
for (const k of EN_KEYS) if (en.frontmatter[k] !== undefined) frontmatter[k] = en.frontmatter[k];
for (const k of AR_KEYS) {
  // The Arabic step sometimes drops the "Ar" suffix (title: "...").
  const v = ar.frontmatter[k] !== undefined ? ar.frontmatter[k] : ar.frontmatter[k.replace(/Ar$/, '')];
  if (v !== undefined) frontmatter[k] = v;
}
const droppedKeys = [
  ...Object.keys(en.frontmatter).filter(k => !KNOWN_KEYS.includes(k)),
  ...Object.keys(ar.frontmatter).filter(k => !KNOWN_KEYS.includes(k) && !EN_KEYS.includes(k))
]; // e.g. a made-up "coverImageAr"
for (const k of Object.keys(frontmatter)) {
  if (typeof frontmatter[k] === 'string') frontmatter[k] = frontmatter[k].replace(/\s+/g, ' ').trim();
}

// ---- 4. Values the workflow decides itself (not left to Gemini) ----
Object.assign(frontmatter, {
  date: $now.toFormat('yyyy-MM-dd'),
  author: 'Accez Team',
  authorAr: 'فريق أكسيز',
  coverImage: '/images/blog/pm-default.jpg',
  coverImageAlt: 'A row of suburban houses under a clear blue sky',
  category: 'Industry Insights',
  categoryAr: 'رؤى الصناعة'
});

// Keep the topic's colon. Titles were losing it ("Sustainability and Energy
// Efficiency Cutting Costs..."): if Gemini returned the topic minus its colon,
// use the topic as written in the sheet.
const flat = s => String(s || '').toLowerCase().replace(/[:\s]+/g, ' ').trim();
if (topicData.topic.includes(':') && frontmatter.title && !frontmatter.title.includes(':')
    && flat(frontmatter.title) === flat(topicData.topic)) {
  frontmatter.title = topicData.topic.trim();
}

// Search titles: fall back to the article title when Gemini's is over 60 characters.
if (frontmatter.metaTitle && frontmatter.metaTitle.length > 60 && frontmatter.title && frontmatter.title.length <= 60) {
  frontmatter.metaTitle = frontmatter.title;
}
if (frontmatter.metaTitleAr && frontmatter.metaTitleAr.length > 60 && frontmatter.titleAr && frontmatter.titleAr.length <= 60) {
  frontmatter.metaTitleAr = frontmatter.titleAr;
}

// Search descriptions over 155 characters: drop whole trailing sentences
// ("Learn more.") while that keeps at least 100 characters. Never cuts mid-sentence.
function trimDescription(s, max = 155, min = 100) {
  let out = String(s || '').trim();
  while (out.length > max) {
    const m = out.match(/^([\s\S]*[.!?؟])\s+[^.!?؟]+[.!?؟]?$/);
    if (!m || m[1].trim().length < min) break;
    out = m[1].trim();
  }
  return out;
}
if (frontmatter.metaDescription) frontmatter.metaDescription = trimDescription(frontmatter.metaDescription);
if (frontmatter.metaDescriptionAr) frontmatter.metaDescriptionAr = trimDescription(frontmatter.metaDescriptionAr);

// ---- 5. Bodies ----
const MARKER = /<!--\s*ar\s*-->/i;
let enBody = en.body.trim();
if (MARKER.test(enBody)) enBody = enBody.split(MARKER)[0].trim(); // step 1 wrote Arabic too: ignore it
let arBody = ar.body.trim();
if (MARKER.test(arBody)) arBody = arBody.split(MARKER).pop().trim(); // step 2 echoed the English first
// Gemini sometimes repeats a (translated) frontmatter block at the top of the body.
arBody = arBody.replace(/^---[ \t]*\n(?:[A-Za-z][\w-]*[ \t]*:.*\n|[ \t]*-[ \t].*\n|[ \t]*\n)+---[ \t]*(?:\n|$)/, '').trim();

// Arabic closing headings must be exactly these (the site and the brief use them verbatim).
arBody = arBody
  .replace(/^#{2,3}[ \t]+(?:ال)?أسئلة[ \t]+(?:ال)?(?:شائعة|متكررة)[ \t]*[:.]?[ \t]*$/gm, '## الأسئلة الشائعة')
  .replace(/^#{2,3}[ \t]+(?:(?:ال)?نقاط[ \t]+(?:ال)?رئيسية|(?:ال)?وجبات[ \t]+(?:ال)?رئيسية|(?:ال)?نتائج[ \t]+(?:ال)?رئيسية|أهم[ \t]+النقاط|أبرز[ \t]+النقاط(?:[ \t]+الرئيسية)?|(?:ال)?خلاصة|(?:ال)?استنتاجات[ \t]+(?:ال)?رئيسية)[ \t]*[:.]?[ \t]*$/gm, '## أبرز النقاط');

// Links to this site: English links never point at /ar/, Arabic links always do,
// and every page path ends with a slash (the site's canonical form).
function siteLinks(md, arabic) {
  return md.replace(/\]\((?:https?:\/\/(?:www\.)?accez\.cloud)?(\/[^)\s?#]*)([?#][^)\s]*)?\)/gi, (all, p, rest) => {
    let path = p.replace(/^\/ar(?=\/|$)/, '') || '/';
    if (!/\.[a-z0-9]+$/i.test(path) && !path.endsWith('/')) path += '/';
    if (arabic) path = '/ar' + (path === '/' ? '/' : path);
    return '](' + path + (rest || '') + ')';
  });
}
enBody = siteLinks(enBody, false);
arBody = siteLinks(arBody, true);

const body = enBody + '\n\n<!-- AR -->\n\n' + arBody;

// ---- 6. Image search query from the tags (brand names skipped) ----
const BRAND_BLOCKLIST = /airbnb|booking\.com|booking|expedia|accez|whatsapp|mada|sadad|ejar|gastat|zatca|fatoora/i;
let searchQuery = 'hospitality business';
const generic = (Array.isArray(frontmatter.tags) ? frontmatter.tags : []).filter(t => t && !BRAND_BLOCKLIST.test(t));
if (generic.length > 0) searchQuery = generic.slice(0, 2).join(' ').toLowerCase();

return [{
  json: {
    frontmatter,
    body,
    parseProblems,
    droppedKeys,
    articleTitle: frontmatter.title || topicData.topic,
    searchQuery,
    topic: topicData.topic,
    topicSlug: topicData.topicSlug,
    rowNumber: topicData.rowNumber,
    colA: topicData.colA,
    colB: topicData.colB,
    colC: topicData.colC
  }
}];
