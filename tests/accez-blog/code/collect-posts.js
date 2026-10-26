// Turns the GitHub listing of content/blog into ONE item for the writing steps:
// - existingSlugs: every post that exists (Quality Gate rejects /blog/ links to anything else)
// - duplicateOf: an existing post this topic repeats (then nothing is written)
// - relatedPostsList: up to 6 existing articles Gemini may link to
// - solution: which solution page the post ends with (property managers or service providers)
// - formatInstruction: which article format to use, so posts do not all share one template
const topicData = $('Find First Pending Topic').first().json;

const files = $input.all()
  .map(item => item.json || {})
  .filter(f => typeof f.name === 'string' && f.name.endsWith('.md'));

// null = the listing failed (see the node's error output); then no /blog/ links are allowed
// and the duplicate check is skipped (GitHub still refuses to overwrite an existing file).
const existingSlugs = files.length > 0 ? files.map(f => f.name.replace(/\.md$/, '')) : null;

// ---------- Words of a title or slug, normalised ----------
const STOP = new Set(('a an and are as at be by for from how in into is it its of on or that the their this to what when where which why with without your you vs versus '
  + 'while going more less make get getting guide tips ways best practices complete ultimate simple step steps '
  + 'create creating manage use using run running set setup new your accez cloud '
  + 'property properties management manager managers managing rental rentals saudi arabia ksa kingdom').split(' '));
const stem = w => w.replace(/ies$/, 'y').replace(/(?<=\w{4})ing$/, '').replace(/(?<=\w{3})(?<!s)s$/, '');
const words = text => String(text).toLowerCase()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/['’]/g, '')
  .split(/[^a-z0-9]+/)
  .filter(w => w.length > 2 && !STOP.has(w))
  .map(stem);

// ---------- 1. Duplicate check (slug and title against every existing post) ----------
// Near duplicate = strong word overlap once filler and generic property words are dropped:
// 3 or more shared words with a Jaccard overlap of 0.6 or more, or every word of the
// shorter one shared (3 words or more, or 2 words with an overlap of 0.5 or more),
// or 3 or more shared words with an overlap of 0.75 when only grammar words are dropped.
const topicWords = new Set([...words(topicData.topic), ...words(topicData.topicSlug.replace(/-/g, ' '))]);
const GRAMMAR = new Set('a an and are as at be by for from in into is it its of on or the their this to with your you'.split(' '));
const lightWords = text => String(text).toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !GRAMMAR.has(w)).map(stem);
const topicLight = new Set(lightWords(topicData.topicSlug));
function overlap(slug) {
  const ws = words(slug.replace(/-/g, ' '));
  // Old slugs were cut mid-word at 60 characters ("...-while-goi"): a cut last word
  // matches the topic word it starts.
  if (slug.length >= 55 && ws.length) {
    const last = ws[ws.length - 1];
    const full = [...topicWords].find(w => w !== last && w.startsWith(last));
    if (full) ws[ws.length - 1] = full;
  }
  const own = new Set(ws);
  const shared = [...own].filter(w => topicWords.has(w)).length;
  const union = new Set([...own, ...topicWords]).size;
  // Same check with only grammar words dropped, for titles made mostly of generic words
  // ("How to Create and Manage Properties in Accez.Cloud").
  const lightOwn = new Set(lightWords(slug));
  const lightShared = [...lightOwn].filter(w => topicLight.has(w)).length;
  const lightUnion = new Set([...lightOwn, ...topicLight]).size;
  return {
    slug, shared, jaccard: union ? shared / union : 0, smaller: Math.min(own.size, topicWords.size),
    lightShared, lightJaccard: lightUnion ? lightShared / lightUnion : 0
  };
}
let duplicateOf = null;
let duplicateReason = '';
if (existingSlugs) {
  if (existingSlugs.includes(topicData.topicSlug)) {
    duplicateOf = topicData.topicSlug;
    duplicateReason = 'same URL slug';
  } else {
    const best = existingSlugs.map(overlap)
      .filter(o => (o.shared >= 3 && (o.jaccard >= 0.6 || o.shared === o.smaller))
        || (o.shared >= 2 && o.shared === o.smaller && o.jaccard >= 0.5)
        || (o.lightShared >= 3 && o.lightJaccard >= 0.75))
      .sort((a, b) => b.jaccard - a.jaccard || b.lightJaccard - a.lightJaccard || b.shared - a.shared)[0];
    if (best) {
      duplicateOf = best.slug;
      duplicateReason = Math.max(best.shared, best.lightShared) + ' shared words (overlap '
        + Math.round(Math.max(best.jaccard, best.lightJaccard) * 100) + '%)';
    }
  }
}

// ---------- 2. Related articles Gemini may link to ----------
const candidates = (existingSlugs || [])
  .filter(slug => slug !== topicData.topicSlug)
  .map(slug => ({ slug, score: overlap(slug).shared }))
  .filter(c => c.score > 0)
  .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
  .slice(0, 6);
const relatedPostsList = candidates.length > 0
  ? candidates.map(c => '- /blog/' + c.slug + '/ (about: ' + c.slug.replace(/-/g, ' ') + ')').join('\n')
  : '(no related articles available: do not link to any /blog/ article)';

// ---------- 3. Matching solution page (the post's closing link) ----------
// Appointment businesses (barbers, salons, spas, coaches, clinics...) -> service provider
// solution; everything else -> property management solution.
const SERVICE_SIGNALS = /\b(barbers?|barbershops?|salons?|spas?|beauty|nails?|coach(es|ing)?|personal trainers?|fitness|gyms?|clinics?|tutors?|groomers?|appointments?|walk[\s-]?ins?|no[\s-]?shows?|service (business|businesses|providers?)|loyalty points?|gift cards?|waitlists?|promo codes?)\b/gi;
const PROPERTY_SIGNALS = /\b(propert(y|ies)|tenants?|landlords?|leases?|rent|rents|rental|rentals|owners?|units?|buildings?|compounds?|hotels?|serviced apartments?|guests?|airbnb|booking\.com|expedia|vacation|short[\s-]term|long[\s-]term|occupancy|portfolios?|developers?|off[\s-]plan|maintenance|work orders?|housekeeping|check[\s-]?ins?)\b/gi;
const count = re => (topicData.topic.match(re) || []).length;
const solution = count(SERVICE_SIGNALS) > count(PROPERTY_SIGNALS) ? 'service-providers' : 'property-managers';
const SOLUTIONS = {
  'property-managers': { name: 'Accez property management solution', nameAr: 'حل أكسيز لإدارة العقارات', readers: 'property managers, owners and operators in Saudi Arabia' },
  'service-providers': { name: 'Accez service provider solution', nameAr: 'حل أكسيز لمقدمي الخدمات', readers: 'owners and managers of appointment businesses (barbers, salons, spas, coaches) in Saudi Arabia' }
};
const solutionPath = '/solutions/' + solution + '/';
const solutionPathAr = '/ar' + solutionPath;

// ---------- 4. Article format ----------
const FORMATS = {
  'how-to': 'HOW-TO GUIDE: after the opening, one short section on what to prepare first, then the steps in order as ### headings under one or two ## sections. Each step heading starts with a verb and names the action for this topic. Finish the body with a section on the mistakes that undo the steps.',
  'checklist': 'CHECKLIST: group the checks into 3 to 5 ## sections by stage or area of this topic. Inside each section, every check is a bullet that starts with a short bold action, followed by one or two sentences on why it matters and how to confirm it is done.',
  'explainer': 'EXPLAINER: answer, in this order, what the subject is, why it matters to operators in Saudi Arabia, how it works in practice (with a worked example), and what the reader has to decide. Each ## heading is a specific statement or question about this topic.',
  'comparison': 'COMPARISON OF APPROACHES: compare 2 or 3 ways of handling this topic (for example in house versus outsourced, manual versus software, monthly versus yearly). Never compare competitors and never name other software products. Include exactly one markdown table comparing the approaches on 4 to 6 criteria, then a section on which approach suits which kind of operator.',
  'glossary': 'GLOSSARY STYLE GUIDE: a short opening, then the key terms of this topic as ### headings grouped under 2 or 3 ## sections; define each term in plain language with an example from operations in Saudi Arabia. End the body with a section showing how the terms fit together in practice.'
};
const ALIASES = { 'how-to': /^how[\s-]*to$|^howto$|^guide$|^step/i, 'checklist': /^check[\s-]*list/i, 'explainer': /^expla/i, 'comparison': /^compar/i, 'glossary': /^gloss/i };
const fromSheet = Object.keys(ALIASES).find(k => ALIASES[k].test(String(topicData.format || '').trim())) || null;
const t = topicData.topic.toLowerCase();
let suggested = /\b(glossary|terms|terminology|jargon|a to z)\b/.test(t) ? 'glossary'
  : /\b(vs\.?|versus|compar\w*|pros and cons|choosing between|which is better|in[\s-]house|outsourc\w*)\b/.test(t) ? 'comparison'
  : /\b(checklist|signs|mistakes|red flags|audit)\b|^\d+\s/.test(t) ? 'checklist'
  : /^(how to|how do|how can)\b|\b(step by step|setting up|set up|getting started|playbook)\b/.test(t) ? 'how-to'
  : /^(what is|what are|why|understanding)\b|\bexplained\b/.test(t) ? 'explainer'
  : null;
if (!suggested) {
  // No signal in the topic: rotate by the slug so consecutive posts do not share one template.
  const rotation = ['how-to', 'checklist', 'explainer', 'comparison'];
  let h = 0;
  for (const ch of topicData.topicSlug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  suggested = rotation[h % rotation.length];
}
const format = fromSheet || suggested;
const formatInstruction = fromSheet
  ? 'Use this format (chosen by the editor): ' + FORMATS[format]
  : 'Suggested format: ' + FORMATS[format] + '\nUse it unless one of these other formats clearly fits the topic better:\n'
    + Object.keys(FORMATS).filter(k => k !== format).map(k => '- ' + FORMATS[k]).join('\n');

return [{
  json: {
    topic: topicData.topic,
    topicSlug: topicData.topicSlug,
    existingSlugs,
    isDuplicate: duplicateOf !== null,
    duplicateOf,
    duplicateReason,
    relatedSlugs: candidates.map(c => c.slug),
    relatedPostsList,
    relatedPostsListAr: relatedPostsList.replace(/- \/blog\//g, '- /ar/blog/'),
    solution,
    solutionPath,
    solutionPathAr,
    solutionName: SOLUTIONS[solution].name,
    solutionNameAr: SOLUTIONS[solution].nameAr,
    readers: SOLUTIONS[solution].readers,
    format,
    formatSource: fromSheet ? 'sheet' : 'workflow',
    formatInstruction
  }
}];
