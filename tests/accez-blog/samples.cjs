// Mocked Gemini outputs for the two writing calls, built from a real cleaned post
// (fixtures/sample-post.md, copied from the site repo's content/blog):
//   en: what "Generate English Post with Gemini" returns (English frontmatter + body)
//   ar: what "Generate Arabic Post with Gemini" returns (Arabic frontmatter + body)
// Each one ends with the closing line the prompts ask for (solution page link,
// no portal.accez.cloud). `bad` holds variants that the Quality Gate must block.
const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, 'fixtures/sample-post.md');
const TOPIC = 'Sustainability and Energy Efficiency: Cutting Costs While Going Green';

const raw = fs.readFileSync(SOURCE, 'utf8');
const [, fmBlock, body] = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
const fmLine = key => fmBlock.split('\n').find(l => l.startsWith(key + ':'));
const EN_KEYS = ['title', 'metaTitle', 'metaDescription', 'primaryKeyword', 'excerpt', 'tags'];
const AR_KEYS = ['titleAr', 'metaTitleAr', 'metaDescriptionAr', 'excerptAr', 'tagsAr'];

let [enBody, arBody] = body.split('<!-- AR -->').map(s => s.trim());
const CLOSE_EN = 'See how the [Accez property management solution](/solutions/property-managers/) keeps work orders, billing and owner statements in one place.';
const CLOSE_AR = 'تعرّف على [حل أكسيز لإدارة العقارات](/ar/solutions/property-managers/) الذي يجمع أوامر العمل والفوترة وكشوف الملاك في مكان واحد.';
const swap = (text, from, to) => { if (!text.includes(from)) throw new Error('sample anchor missing: ' + String(from).slice(0, 50)); return text.replace(from, to); };
enBody = swap(enBody, '[Visit portal.accez.cloud](https://portal.accez.cloud)', CLOSE_EN);
arBody = swap(arBody, '[قم بزيارة portal.accez.cloud](https://portal.accez.cloud)', CLOSE_AR);
// Gemini often forgets the /ar prefix in the Arabic part: "Combine English and Arabic" adds it.
arBody = swap(arBody, '](/ar/solutions/property-managers/)', '](/solutions/property-managers/)');

const enDoc = (b = enBody, keys = EN_KEYS.map(fmLine)) => '---\n' + keys.join('\n') + '\n---\n\n' + b + '\n';
const arDoc = (b = arBody, keys = AR_KEYS.map(fmLine)) => '---\n' + keys.join('\n') + '\n---\n\n' + b + '\n';
// The English answer arrives wrapped in chatter and a code fence, as Gemini often does.
const en = 'Here is the blog post:\n\n```markdown\n' + enDoc() + '```\n';
const ar = arDoc();

const firstEnPara = enBody.split('\n\n').find(p => /^[A-Z]/.test(p) && p.length > 200);
const firstArPara = arBody.split('\n\n').find(p => /^[ء-ي]/.test(p) && p.length > 200);
const enWith = (from, to) => ({ en: swap(en, from, to), ar });
const arWith = (from, to) => ({ en, ar: swap(ar, from, to) });
const enAddPara = text => enWith(firstEnPara, firstEnPara + ' ' + text);
const enAddBullet = text => enWith('- **Reservations and Channel Sync:**', text + '\n- **Reservations and Channel Sync:**');

// Each must FAIL the gate (label = the reason).
const bad = {
  '400+ channels': enAddBullet('- **Channel sync across 400+ booking channels**: one calendar.'),
  '77% statistic': enAddPara('WhatsApp use in the Kingdom exceeds 77% according to GASTAT.'),
  'unlinked study': enAddPara('A recent study found that most operators overspend on energy.'),
  'unlinked percentage': enAddPara('Smart thermostats cut energy bills by 23% on average.'),
  'em dash': enWith(firstEnPara, firstEnPara.replace(/\. /, ' — and more. ')),
  'spaced hyphen in title': enWith(fmLine('title'), 'title: "Sustainability - Cutting Costs While Going Green"'),
  'metaTitle too long': enWith(fmLine('metaTitle'), 'metaTitle: "Sustainability and Energy Efficiency for Saudi Property Managers in 2026"'),
  'no Arabic part': { en, ar: arDoc('') },
  'Arabic cut off (no closing line)': { en, ar: arDoc(arBody.slice(0, arBody.indexOf('## الأسئلة الشائعة'))) },
  'English cut off (no closing line)': { en: enDoc(enBody.slice(0, enBody.indexOf('## Key Takeaways'))), ar },
  'code fence in body': enWith(firstEnPara, firstEnPara + '\n\n```js\nconsole.log(1)\n```'),
  'YAML in body': enWith('## Frequently Asked Questions', 'metaDescription: "duplicate"\n\n## Frequently Asked Questions'),
  'wrong Arabic heading': arWith('## أبرز النقاط', '## ملخص المقال'),
  'link to missing article': enWith('(/blog/utility-and-bill-management-across-a-rental-portfolio/)', '(/blog/how-to-cut-energy-bills-in-riyadh/)'),
  'Accez claims WhatsApp': enAddBullet('- **WhatsApp integration**: message guests from Accez.'),
  'tenants book providers via Accez': enAddPara('With Accez, tenants book service providers directly from their portal.'),
  'figure about Accez': enAddPara('Accez customers cut energy costs by 30% in the first year.'),
  'raw HTML': enWith(firstEnPara, firstEnPara + '\n\n<div class="note">Tip</div>'),
  'vague link text': enWith('[utility and bill management across the portfolio]', '[here]'),
  // Template headings (the old prompt's structure)
  'template heading "What High Performers Do Differently"': enWith('## Treating Efficiency as an Investment, Not an Expense', '## What High Performers Do Differently'),
  'template heading "What Breaks and Why"': enWith('## Where Energy and Water Waste Hits Your Margins', '## The Hidden Costs: What Breaks and Why'),
  'template heading "A Deep Dive into ..."': enWith('## Where Energy and Water Waste Hits Your Margins', '## A Deep Dive into Energy Waste'),
  'Arabic template heading "ما يفعله أصحاب الأداء العالي بشكل مختلف"': arWith('## التعامل مع الكفاءة كاستثمار لا كنفقة', '## ما يفعله أصحاب الأداء العالي بشكل مختلف'),
  'Arabic template heading "ما الذي يتعطل ولماذا"': arWith('## كيف يؤثر هدر الطاقة والمياه على أرباحك', '## ما الذي يتعطل ولماذا'),
  'generic heading "Conclusion"': enWith('## Key Takeaways', '## Conclusion\n\nEfficiency pays.\n\n## Key Takeaways'),
  // Closing line
  'ends with "Visit portal.accez.cloud" instead of the solution link': enWith(CLOSE_EN, '[Visit portal.accez.cloud](https://portal.accez.cloud)'),
  'closing line links the wrong solution page': enWith('(/solutions/property-managers/) keeps', '(/solutions/service-providers/) keeps'),
  'Arabic closing line links the wrong solution page': arWith('(/ar/solutions/property-managers/) الذي', '(/ar/solutions/service-providers/) الذي'),
  'portal.accez.cloud link inside the body': enAddPara('Sign in at [the Accez portal](https://portal.accez.cloud) to start.'),
  // OWNER_DECISIONS "never claim" list, outside and inside the Accez section, EN and AR
  'Accez claims mada, Apple Pay and STC Pay': enAddBullet('- **Payments:** collect rent in Accez through mada, Apple Pay and STC Pay.'),
  'Accez and ZATCA compliance': enAddPara('Accez is fully compliant with ZATCA e-invoicing rules.'),
  'Accez and ZATCA non-compliance': enAddPara('Note that Accez is not yet certified for ZATCA Fatoora.'),
  'Accez claims e-signing': enAddPara('Accez lets owners e-sign leases in minutes.'),
  'Accez claims a tenant portal': enAddBullet('- **Tenant portal:** residents report issues from their own Accez app.'),
  'Accez claims dynamic pricing': enAddPara('Accez also offers dynamic pricing that adjusts rates every night.'),
  'Accez claims automatic reminders': enAddPara('Accez sends automatic rent reminders before each due date.'),
  'Accez claims minimum stay rules': enAddBullet('- **Stay rules:** set minimum stay rules per unit in Accez.'),
  'Accez claims inspection checklists': enAddPara('Accez inspection checklists make move out checks faster.'),
  'Accez claims visitor management': enAddPara('Accez includes visitor management for gated compounds.'),
  'Accez claims Ejar integration': enAddPara('Accez registers every lease with Ejar for you.'),
  'Accez claims a booking engine': enAddPara('Accez gives you a direct booking website builder.'),
  'Accez claims a vendor directory': enAddPara('Accez has a vendor directory of approved contractors.'),
  'Accez claims smart locks': enAddPara('Accez connects to smart locks for keyless check in.'),
  'Accez claims AI features': enAddPara('Accez uses AI to predict which units need repairs.'),
  'Arabic: Accez claims WhatsApp': arWith(firstArPara, firstArPara + ' ويتكامل Accez مع واتساب لمراسلة النزلاء.'),
  'Arabic: Accez claims e-signing': arWith(firstArPara, firstArPara + ' ويتيح أكسيز التوقيع الإلكتروني لعقود الإيجار.'),
  'Arabic: Accez claims mada': arWith(firstArPara, firstArPara + ' ويقبل Accez الدفع عبر مدى وأبل باي.')
};

// Variants that must still PASS: the topics may be discussed, just not as Accez features.
const allowed = {
  'ZATCA discussed in general': enAddPara('ZATCA requires VAT registered businesses to issue e-invoices through compliant systems.'),
  'mada and WhatsApp discussed in general': enAddPara('Many guests in the Kingdom pay with mada cards and message hosts on WhatsApp.'),
  'Arabic: Ejar discussed in general': arWith(firstArPara, firstArPara + ' وتوثّق منصة إيجار عقود الإيجار السكنية في المملكة.')
};

// A service business topic: the closing lines must link the service provider solution.
const toServiceProvider = s => s
  .replace('[Accez property management solution](/solutions/property-managers/) keeps work orders, billing and owner statements', '[Accez service provider solution](/solutions/service-providers/) keeps bookings, staff and customer records')
  .replace('[حل أكسيز لإدارة العقارات](/ar/solutions/property-managers/) الذي يجمع أوامر العمل والفوترة وكشوف الملاك', '[حل أكسيز لمقدمي الخدمات](/ar/solutions/service-providers/) الذي يجمع الحجوزات والفريق وسجلات العملاء');
const serviceProvider = { en: toServiceProvider(en), ar: toServiceProvider(ar) };

module.exports = { en, ar, enDoc, arDoc, enBody, arBody, bad, allowed, serviceProvider, TOPIC, SOURCE, CLOSE_EN, CLOSE_AR };
