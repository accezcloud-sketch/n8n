// QUALITY GATE: writes the final markdown file and checks it before anything
// is pushed. Every failed check is listed in `qualityIssues`. If there is any,
// "If Quality Passed" sends the run to the "needs review" branch: nothing is
// pushed to GitHub and the sheet row is marked "needs review: <reasons>".
// The limits below are the only knobs.
const META_TITLE_MAX = 60;
const META_DESCRIPTION_MIN = 100; // the brief asks Gemini for 140 to 155
const META_DESCRIPTION_MAX = 160; // Google and the site cut longer descriptions
const TITLE_MAX = 110;
const MIN_WORDS_EN = 500;
const MIN_WORDS_AR = 400;

const data = $input.first().json;
const fm = data.frontmatter || {};
const body = String(data.body || '');
const plan = $('Collect Existing Posts').first().json;
const existingSlugs = plan.existingSlugs; // null if the GitHub listing failed
const issues = [];
const fail = msg => { if (!issues.includes(msg)) issues.push(msg); };

// ---------- Write the file (one quoting rule for every value) ----------
// Each value is a JSON string, which is also a valid YAML double-quoted
// string, so quotes, colons and backslashes inside a title can never break the frontmatter.
const ORDER = ['title', 'titleAr', 'metaTitle', 'metaTitleAr', 'metaDescription', 'metaDescriptionAr',
  'primaryKeyword', 'excerpt', 'excerptAr', 'date', 'author', 'authorAr', 'coverImage', 'coverImageAlt',
  'coverImageCredit', 'coverImageCreditUrl', 'category', 'categoryAr', 'tags', 'tagsAr'];
const yamlValue = v => Array.isArray(v)
  ? '[' + v.map(x => JSON.stringify(String(x))).join(', ') + ']'
  : JSON.stringify(String(v));
const fmLines = ORDER.filter(k => fm[k] !== undefined && fm[k] !== null).map(k => k + ': ' + yamlValue(fm[k]));
const fileContent = '---\n' + fmLines.join('\n') + '\n---\n\n' + body.trim() + '\n';

// ---------- 1. Frontmatter ----------
for (const p of (data.parseProblems || [])) fail('frontmatter: ' + p);
const REQUIRED = ['title', 'titleAr', 'metaTitle', 'metaTitleAr', 'metaDescription', 'metaDescriptionAr',
  'primaryKeyword', 'excerpt', 'excerptAr', 'date', 'author', 'authorAr', 'coverImage', 'coverImageAlt',
  'category', 'categoryAr', 'tags', 'tagsAr'];
for (const k of REQUIRED) {
  const v = fm[k];
  if (Array.isArray(v) ? v.length === 0 : !String(v == null ? '' : v).trim()) fail('frontmatter: "' + k + '" is missing or empty');
}
for (const k of ['tags', 'tagsAr']) if (fm[k] !== undefined && !Array.isArray(fm[k])) fail('frontmatter: "' + k + '" is not a list');
if (fm.date && !/^\d{4}-\d{2}-\d{2}$/.test(fm.date)) fail('frontmatter: date is not yyyy-MM-dd');
// Re-read what was written: every line must be `key: <valid JSON>`.
const written = fileContent.match(/^---\n([\s\S]*?)\n---\n/);
if (!written) fail('frontmatter: block not written');
else for (const line of written[1].split('\n')) {
  const m = line.match(/^([A-Za-z]\w*): (.*)$/);
  try { if (!m) throw new Error(); JSON.parse(m[2]); } catch (e) { fail('frontmatter: invalid line ' + line.slice(0, 40)); }
}
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.topicSlug || '') || data.topicSlug.length > 60) {
  fail('URL slug "' + (data.topicSlug || '') + '" is empty or invalid (write the topic in English)');
}

// ---------- 2. Lengths ----------
const len = k => String(fm[k] || '').length;
if (len('title') > TITLE_MAX) fail('title is ' + len('title') + ' characters (max ' + TITLE_MAX + ')');
if (len('titleAr') > TITLE_MAX) fail('titleAr is ' + len('titleAr') + ' characters (max ' + TITLE_MAX + ')');
for (const k of ['metaTitle', 'metaTitleAr']) {
  if (len(k) > META_TITLE_MAX) fail(k + ' is ' + len(k) + ' characters (max ' + META_TITLE_MAX + ')');
}
for (const k of ['metaDescription', 'metaDescriptionAr']) {
  if (len(k) && (len(k) < META_DESCRIPTION_MIN || len(k) > META_DESCRIPTION_MAX)) {
    fail(k + ' is ' + len(k) + ' characters (allowed ' + META_DESCRIPTION_MIN + ' to ' + META_DESCRIPTION_MAX + ')');
  }
}

// ---------- 3. Body structure ----------
const markerCount = body.split('<!-- AR -->').length - 1;
if (markerCount !== 1) fail('the <!-- AR --> marker appears ' + markerCount + ' times (must be exactly 1)');
const at = body.indexOf('<!-- AR -->');
const en = at === -1 ? body : body.slice(0, at);
const ar = at === -1 ? '' : body.slice(at + '<!-- AR -->'.length);
const words = s => (s.match(/\S+/g) || []).length;
if (words(en) < MIN_WORDS_EN) fail('English part has only ' + words(en) + ' words');
const arLetters = (ar.match(/[ء-ي]/g) || []).length;
const latinLetters = (ar.match(/[A-Za-z]/g) || []).length;
if (words(ar) < MIN_WORDS_AR || arLetters < 4 * latinLetters) fail('Arabic part is missing, too short or not in Arabic');
// Closing line: the last line of each language links the matching solution page
// (property topics -> /solutions/property-managers/, service businesses ->
// /solutions/service-providers/). It also shows the output was not cut off.
const lastLine = s => (s.trim().split('\n').filter(l => l.trim()).pop() || '');
const linksIn = s => [...s.matchAll(/\]\(([^)\s]+)[^)]*\)/g)].map(m => m[1].replace(/^https?:\/\/(?:www\.)?accez\.cloud(?=\/)/i, ''));
const wantEn = plan.solutionPath;
const wantAr = plan.solutionPathAr;
const endsWith = (s, want) => linksIn(lastLine(s)).some(u => u.replace(/\/?$/, '/') === want);
if (!endsWith(en, wantEn)) {
  fail('English part does not end with a closing line linking ' + wantEn + ' (wrong solution page, or the output was cut off)');
}
if (!endsWith(ar, wantAr)) {
  fail('Arabic part does not end with a closing line linking ' + wantAr + ' (wrong solution page, or the output was cut off)');
}
if (/portal\.accez\.cloud/i.test(body + JSON.stringify(fm))) fail('links to or mentions portal.accez.cloud (posts end with the solution page link instead)');
if (!/^## الأسئلة الشائعة[ \t]*$/m.test(ar)) fail('Arabic FAQ heading is not exactly "## الأسئلة الشائعة"');
if (!/^## أبرز النقاط[ \t]*$/m.test(ar)) fail('Arabic takeaways heading is not exactly "## أبرز النقاط"');
if (/^[ \t]*(```|~~~)/m.test(body)) fail('body contains a code fence');
if (/^(title|titleAr|metaTitle|metaTitleAr|metaDescription|metaDescriptionAr|primaryKeyword|excerpt|excerptAr|date|author|authorAr|coverImage\w*|category|categoryAr|tags|tagsAr)[ \t]*:/m.test(body)) {
  fail('body contains frontmatter (YAML) lines');
}
if (/<\/?[a-zA-Z][^>]*>/.test(body)) fail('body contains raw HTML tags');
if (/!\[[^\]]*\]\(/.test(body)) fail('body contains an image (Gemini cannot know real image URLs)');

// ---------- 3b. Headings must describe their section ----------
// Template headings that every old post repeated (EN and AR variants).
const TEMPLATE_HEADING = /\bdo(?:es)?\s+(?:things\s+)?differently\b|\bwhat\s+(?:actually\s+)?breaks\b|\bdeep\s+dive\b|\bnavigating\s+the\s+saudi(?:\s+arabian)?\s+[\w\s]*landscape\b|بشكل\s+مختلف|ما\s+الذي\s+(?:ينكسر|يتعطل|ينهار|يفسد|يحدث\s+(?:بشكل\s+)?خطأ)|ما\s+(?:ينكسر|يتعطل|ينهار)\s+ولماذا|الغوص\s+العميق|التنقل\s+في\s+(?:ال)?مشهد/i;
const GENERIC_HEADING = /^(?:introduction|overview|conclusion|in\s+conclusion|final\s+thoughts|summary|wrapping\s+up|مقدمة|المقدمة|نظرة\s+عامة|الخلاصة|خلاصة|الخاتمة|خاتمة|ملخص|الملخص|أفكار\s+ختامية)$/i;
for (const h of body.match(/^#{2,4}[ \t]+.*$/gm) || []) {
  const text = h.replace(/^#+[ \t]+/, '').replace(/[*_]/g, '').replace(/[:.؟?!]+$/, '').trim();
  if (TEMPLATE_HEADING.test(text)) fail('uses a template heading instead of one that describes the section: "' + text.slice(0, 60) + '"');
  else if (GENERIC_HEADING.test(text)) fail('uses a generic heading: "' + text + '"');
}

// ---------- 4. Punctuation: no dashes (EN and AR, frontmatter and body) ----------
const noUrls = s => s.replace(/\]\([^)]*\)/g, ']').replace(/https?:\/\/\S+/g, '');
const copy = [ORDER.filter(k => !['coverImage', 'coverImageCreditUrl', 'date'].includes(k))
  .map(k => [].concat(fm[k] || []).join(' ')).join('\n'), body].join('\n');
const proseLines = noUrls(copy).split('\n');
if (proseLines.some(l => /[—–]/.test(l))) fail('uses an em dash or en dash');
if (proseLines.some(l => /\S[ \t]+-[ \t]+\S/.test(l.replace(/^\s*-\s+/, '')))) fail('uses a spaced hyphen " - " as punctuation');

// ---------- 5. Facts and statistics ----------
const all = noUrls(body) + '\n' + [].concat(fm.title, fm.titleAr, fm.metaDescription, fm.metaDescriptionAr, fm.excerpt, fm.excerptAr).join('\n');
if (/\+\s?(400|٤٠٠)(?![\d٠-٩])|(?<![\d٠-٩])(400|٤٠٠)\s?\+|(?<![\d٠-٩])(400|٤٠٠)\s+(booking\s+)?(channels|قناة|قنوات)/i.test(all)) {
  fail('mentions "400+" channels (Accez connects Airbnb, Booking.com and Expedia only)');
}
if (/(?<![\d٠-٩.])(77|٧٧)\s?(%|٪|per\s?cent|بالمائة|في المائة|في المئة)|(%|٪)\s?(77|٧٧)(?![\d٠-٩])/i.test(all)) {
  fail('contains the planted "77%" statistic');
}
const EXTERNAL_LINK = /\]\(https?:\/\/(?!(?:www\.|portal\.)?accez\.cloud)[^)]+\)/i;
const STUDY = /\b(?:a|one|another|recent|new)\s+(?:recent\s+|new\s+)?(?:study|survey)\b|\bstudies\s+(?:show|suggest|find|found|indicate)|\bresearch\s+(?:shows|suggests|finds|found|indicates)\b|\baccording\s+to\s+(?:a|recent|industry)\s+(?:study|survey|research|report)|(?:أظهرت|تشير|وجدت|كشفت|تؤكد)\s+(?:دراسة|الدراسات|دراسات|الأبحاث|أبحاث|استطلاع)|وفق(?:ًا|ا)\s+ل(?:دراسة|استطلاع|بحث)|دراسة\s+حديثة|استطلاع\s+حديث/i;
const PERCENT = /[\d٠-٩]\s?(?:%|٪)|(?:%|٪)\s?[\d٠-٩]|\bper\s?cent\b|بالمائة|في المائة|في المئة/i;
for (const block of body.split(/\n[ \t]*\n/)) {
  if (EXTERNAL_LINK.test(block)) continue; // the source is linked in the same paragraph
  const snippet = block.replace(/\s+/g, ' ').trim().slice(0, 70);
  if (STUDY.test(block)) fail('cites a study or research without linking the source: "' + snippet + '"');
  else if (PERCENT.test(block)) fail('states a percentage without linking the source: "' + snippet + '"');
}

// ---------- 6. Claims about Accez ----------
const ACCEZ = /accez|أكسيز|اكسيز/i;
for (const line of body.split('\n')) {
  if (ACCEZ.test(line) && /[\d٠-٩]\s?(%|٪)|[\d٠-٩][\d٠-٩,.]*\s*\+?\s*(customers|clients|users|operators|companies|عميل|عملاء|مستخدم|شركة|شركات)/i.test(noUrls(line))) {
    fail('states a figure or result about Accez: "' + line.trim().slice(0, 70) + '"');
  }
}
const NOT_OFFERED = /whatsapp|\bejar\b|zatca|fatoora|smart[\s-]?locks?|keyless|tenant\s+screening|credit\s+checks?|background\s+checks?|mobile\s+app|\bAI\b|artificial\s+intelligence|machine\s+learning|\bvrbo\b|\bgdpr\b|on[\s-]?prem|metered|metering|واتساب|واتس\s?اب|منصة\s+إيجار|زاتكا|فاتورة\s+الإلكترونية|الفوترة\s+الإلكترونية|الأقفال\s+الذكية|أقفال\s+ذكية|بدون\s+مفتاح|فحص\s+المستأجرين|التحقق\s+الائتماني|الذكاء\s+الاصطناعي|تطبيق\s+(?:ال)?جوال/i;
// OWNER_DECISIONS.md "never claim" list (2026-10-26), English and Arabic.
const NEVER_CLAIM = new RegExp([
  'whatsapp', 'واتساب', 'واتس\\s?اب',
  '\\bmada\\b', '(?:بطاقات?|بطاقة|شبكة|نظام|مدفوعات|دفع|عبر)\\s+مدى(?![\\u0600-\\u06FF])', 'مدى\\s+(?:و|أو)\\s*(?:apple|آبل|أبل|stc|اس|إس)', 'apple\\s*pay', 'آبل\\s*باي', 'أبل\\s*باي', 'stc\\s*pay', 'اس\\s*تي\\s*سي\\s*باي', 'إس\\s*تي\\s*سي\\s*باي',
  '\\bzatca\\b', 'fatoora', '\\be[\\s-]?invoic\\w*', 'زاتكا', 'هيئة\\s+الزكاة', 'فاتورة\\s+الإلكترونية', 'الفوترة\\s+الإلكترونية', 'الفواتير\\s+الإلكترونية',
  '\\be[\\s-]?sign(?:ing|ature|atures|ed)?\\b', '(?:electronic|digital)\\s+signatures?', 'التوقيع\\s+(?:ال)?(?:إلكتروني|رقمي)', 'توقيع\\s+(?:إلكتروني|رقمي)',
  '(?:tenant|resident|guest)s?\\s+(?:portal|app)', 'بوابة\\s+(?:ال)?(?:مستأجر|مستأجرين|سكان|ضيوف)', 'تطبيق\\s+(?:ال)?(?:مستأجر|مستأجرين|سكان|ضيوف)',
  'booking\\s+engine', 'direct\\s+booking\\s+(?:website|site|engine)', 'website\\s+builder', 'محرك\\s+(?:ال)?حجز', 'منشئ\\s+(?:ال)?مواقع',
  '(?:dynamic|automatic|automated|smart)\\s+pricing', 'التسعير\\s+(?:ال)?(?:ديناميكي|تلقائي|آلي|ذكي)',
  'vendor\\s+(?:directory|marketplace)', 'دليل\\s+(?:ال)?موردين',
  'visitor\\s+(?:management|access|passes?|logs?|module)', 'gate\\s+access', 'إدارة\\s+(?:ال)?زوار', '(?:دخول|تصاريح)\\s+(?:ال)?زوار',
  'smart[\\s-]?locks?', 'keyless', 'الأقفال\\s+الذكية', 'أقفال\\s+ذكية',
  'inspection\\s+(?:checklists?|reports?|app)', '(?:قوائم|قائمة)\\s+(?:ال)?فحص', 'تقارير\\s+(?:ال)?فحص',
  'minimum[\\s-]?stay', 'الحد\\s+الأدنى\\s+(?:ل)?(?:مدة\\s+)?(?:ال)?إقامة',
  'automat\\w*\\s+(?:rent\\s+|payment\\s+)?reminders?', 'auto[\\s-]?reminders?', 'reminders?\\s+(?:are\\s+)?sent\\s+automatically', 'تذكيرات?\\s+(?:تلقائية|آلية)', 'التذكير\\s+(?:ال)?(?:تلقائي|آلي)',
  '\\bejar\\b', 'منصة\\s+إيجار', 'إيجار\\s+الإلكترونية',
  '\\bAI\\b', 'artificial\\s+intelligence', 'الذكاء\\s+الاصطناعي'
].join('|'), 'i');
const BOOK_PROVIDERS = /(tenants?|residents?|guests?)\b[^.\n]{0,80}\bbook\w*\b[^.\n]{0,60}\b(service\s+providers?|providers?|barbers?|salons?|spas?|cleaners?)|(المستأجر|المستأجرين|السكان|النزلاء|الضيوف)[^.\n]{0,80}(يحجز|حجز)[^.\n]{0,60}(مقدمي\s+الخدمات|مزودي\s+الخدمات)/i;
const accezSections = [];
let current = null;
for (const line of body.split('\n')) {
  if (/^##\s/.test(line)) { current = ACCEZ.test(line) ? [line] : null; if (current) accezSections.push(current); continue; }
  if (current) current.push(line);
}
for (const section of accezSections) {
  const text = noUrls(section.join('\n'));
  const hit = text.match(NOT_OFFERED) || text.match(NEVER_CLAIM);
  if (hit) fail('the Accez section claims a feature Accez does not offer ("' + hit[0] + '")');
  if (BOOK_PROVIDERS.test(text)) fail('says tenants or guests book service providers through Accez');
}
// Anywhere else: a sentence that names Accez must not claim an unconfirmed feature
// (OWNER_DECISIONS "never claim" list), nor say anything about Accez and ZATCA.
for (const sentence of noUrls(body).split(/(?<=[.!?؟])\s+|\n+/)) {
  if (!ACCEZ.test(sentence)) continue;
  if (BOOK_PROVIDERS.test(sentence)) fail('says tenants or guests book service providers through Accez');
  const hit = sentence.match(NEVER_CLAIM) || sentence.match(NOT_OFFERED);
  if (hit) fail('claims or discusses an unconfirmed Accez feature ("' + hit[0] + '"): "' + sentence.trim().slice(0, 70) + '"');
}

// ---------- 7. Links ----------
const ALLOWED_PAGES = new Set(['', 'solutions/property-managers', 'solutions/service-providers',
  'pricing/property-managers', 'pricing/service-providers', 'faq', 'blog']);
const VAGUE_ANCHOR = /^(here|click here|this|this article|this post|read more|link|learn more|هنا|اضغط هنا|انقر هنا|اقرأ المزيد)$/i;
for (const m of body.matchAll(/\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g)) {
  const anchor = m[1].trim();
  const url = m[2].trim();
  if (VAGUE_ANCHOR.test(anchor.replace(/[.!؟?]+$/, ''))) fail('link text is not descriptive: "' + anchor + '"');
  if (/^https:\/\/portal\.accez\.cloud\/?$/i.test(url)) continue;
  const own = url.match(/^(?:https?:\/\/(?:www\.)?accez\.cloud)?(\/[^?#]*)?(?:[?#].*)?$/i);
  if (own && (url.startsWith('/') || /^https?:\/\/(www\.)?accez\.cloud/i.test(url))) {
    const path = (own[1] || '/').replace(/^\/ar(?=\/|$)/, '').replace(/^\/+|\/+$/g, '');
    const blog = path.match(/^blog\/([^/]+)$/);
    if (blog) {
      if (!existingSlugs || !existingSlugs.includes(blog[1])) fail('links to an article that does not exist: ' + url);
    } else if (!ALLOWED_PAGES.has(path)) {
      fail('links to an unknown site page: ' + url);
    }
    continue;
  }
  if (!/^https?:\/\//i.test(url)) fail('link is not a full URL or a site path: ' + url);
}

return [{
  json: {
    qualityPassed: issues.length === 0,
    qualityIssues: issues,
    qualityReport: issues.length ? issues.join('; ') : 'all checks passed',
    fileContent,
    contentLength: fileContent.length,
    articleTitle: fm.title || data.topic,
    excerpt: fm.excerpt || '',
    topic: data.topic,
    topicSlug: data.topicSlug,
    rowNumber: data.rowNumber,
    colA: data.colA,
    colB: data.colB,
    colC: data.colC,
    hasImage: data.hasImage === true,
    imageUrl: data.imageUrl,
    coverImagePath: data.coverImagePath,
    imageFilePath: data.imageFilePath,
    photographerName: data.photographerName,
    photoUrl: data.photoUrl
  }
}];
