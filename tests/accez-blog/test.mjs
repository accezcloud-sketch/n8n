// Offline tests for the Accez n8n workflow. No network, no n8n: every service
// (Gemini, GitHub, Sheets, Unsplash, Facebook, IndexNow) is mocked.
// Usage: node test.mjs <workflow.json> <original.json>
//   node test.mjs ../../workflows/accez-blog-auto-deploy.json accez-blog-auto-deploy.before.json
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const { runPipeline, REPO, FIXTURE_SLUGS, OTHER_SLUGS, SAMPLE_SLUG } = require('./pipeline.cjs');
const { runCode, evalExpr, loadWorkflow } = require('./harness.cjs');
const S = require('./samples.cjs');
const { TOPIC } = S;

const [, , WF, ORIG] = process.argv;
let failures = 0;
let count = 0;
const ok = (cond, msg) => { count++; console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures++; };
const section = title => console.log('\n# ' + title);
// Shaped like a real /search/photos result: id, size, raw and regular urls, download_location.
const photo = (id, alt, extra = {}) => ({ id, width: 4000, height: 2667, likes: 10,
  urls: { raw: 'https://images.unsplash.com/photo-' + id + '?ixid=x', regular: 'https://images.unsplash.com/photo-' + id + '?w=1080' },
  user: { name: 'Photographer ' + id }, links: { html: 'https://unsplash.com/photos/some-photo-' + id, download_location: 'https://api.unsplash.com/photos/' + id + '/download?ixid=x' },
  alt_description: alt, ...extra });
const UNSPLASH = { results: [{ ...photo('baXCV2qg9Ew', 'a field of green grass with wind turbines in the background'), user: { name: 'Zac "Z" Wolff' },
  links: { html: 'https://unsplash.com/photos/a-field-baXCV2qg9Ew', download_location: 'https://api.unsplash.com/photos/baXCV2qg9Ew/download?ixid=x' } }] };
const run = extra => runPipeline(WF, { topic: TOPIC, en: S.en, ar: S.ar, unsplash: UNSPLASH, ...extra });

const wf = JSON.parse(fs.readFileSync(WF, 'utf8'));
const orig = JSON.parse(fs.readFileSync(ORIG, 'utf8'));
const byName = name => wf.nodes.find(n => n.name === name);
const names = new Set(wf.nodes.map(n => n.name));

// =====================================================================
section('Graph, ids, credentials');
ok(names.size === wf.nodes.length, 'node names are unique');
ok(new Set(wf.nodes.map(n => n.id)).size === wf.nodes.length, 'node ids are unique');
const badConn = [];
for (const [from, c] of Object.entries(wf.connections)) {
  if (!names.has(from)) badConn.push('source ' + from);
  for (const outs of Object.values(c)) for (const list of outs) for (const t of list) if (!names.has(t.node)) badConn.push(from + ' -> ' + t.node);
}
ok(badConn.length === 0, 'every connection references existing nodes ' + badConn.join(', '));
const RENAMED = {
  'Schedule Every 2 Days at 09:00': 'Schedule Every 2 Days at 10:00',
  'Generate Blog Post with Gemini': 'Generate English Post with Gemini',
  'Strip Fences and Base64 Encode': 'Combine English and Arabic'
};
for (const o of orig.nodes) {
  if (o.name === 'Schedule Every 2 Days') { ok(!wf.nodes.some(n => n.name === o.name), 'duplicate 48h trigger removed'); continue; }
  const name = RENAMED[o.name] || o.name;
  const n = wf.nodes.find(x => x.id === o.id && x.name === name);
  ok(!!n, 'kept node "' + name + '" with id ' + o.id);
  if (n && o.credentials) ok(JSON.stringify(n.credentials) === JSON.stringify(o.credentials), 'credentials block unchanged on "' + name + '"');
}
const credIds = nodesList => new Set(nodesList.filter(n => n.credentials).flatMap(n => Object.entries(n.credentials).map(([type, c]) => type + ':' + c.id + ':' + c.name)));
const origCreds = credIds(orig.nodes);
ok([...credIds(wf.nodes)].every(c => origCreds.has(c)), 'no new credentials: every credential (type, id, name) is one the original already used');
const parents = {};
for (const [from, c] of Object.entries(wf.connections)) for (const outs of Object.values(c)) for (const list of outs) for (const t of list) (parents[t.node] = parents[t.node] || new Set()).add(from);
const ancestors = name => { const seen = new Set(); const st = [name]; while (st.length) { for (const p of parents[st.pop()] || []) if (!seen.has(p)) { seen.add(p); st.push(p); } } return seen; };
const refProblems = [];
for (const n of wf.nodes) {
  const text = JSON.stringify(n.parameters);
  for (const m of text.matchAll(/\$\(\\?['"]([^'"\\]+)\\?['"]\)/g)) {
    if (!names.has(m[1])) refProblems.push(n.name + ' -> missing ' + m[1]);
    else if (!ancestors(n.name).has(m[1])) refProblems.push(n.name + ' -> not upstream ' + m[1]);
  }
}
ok(refProblems.length === 0, "every $('Node') reference exists and runs earlier " + refProblems.join('; '));
const orphan = wf.nodes.filter(n => !/stickyNote|scheduleTrigger|lmChat/.test(n.type) && !parents[n.name]);
ok(orphan.length === 0, 'no disconnected nodes ' + orphan.map(n => n.name).join(', '));
for (const code of wf.nodes.filter(n => n.type === 'n8n-nodes-base.code')) {
  try { new Function('$input', '$', '$now', 'DateTime', 'items', 'return (function(){' + code.parameters.jsCode + '\n})'); ok(true, 'code compiles: ' + code.name); }
  catch (e) { ok(false, 'code compiles: ' + code.name + ' ' + e.message); }
}
for (const n of ['Generate English Post with Gemini', 'Generate Arabic Post with Gemini', 'Push Blog Post to GitHub', 'Push Image to GitHub', 'Download Unsplash Image', 'Search Unsplash', 'Search Unsplash Fallback', 'Post Blog to Facebook Page', 'Read Topics from Google Sheets', 'Mark Topic as Used in Sheet', 'Mark Topic as Skipped in Sheet', 'Mark Topic as Duplicate in Sheet', 'List Existing Blog Posts']) {
  const node = byName(n);
  ok(node.retryOnFail === true && node.maxTries === 3 && node.waitBetweenTries <= 5000, 'retry 3x on ' + n);
}

// =====================================================================
section('Nothing to set up: no failure-log tab, no error workflow, no new sheet columns');
ok(!wf.nodes.some(n => n.type === 'n8n-nodes-base.errorTrigger'), 'no Error Trigger node (it only runs once someone sets the error workflow)');
ok(!JSON.stringify(wf).includes('Run Errors'), 'no "Run Errors" sheet tab is used');
ok(!wf.settings.errorWorkflow, 'workflow settings name no error workflow');
const sheetsNodes = wf.nodes.filter(n => n.type === 'n8n-nodes-base.googleSheets');
ok(sheetsNodes.every(n => !n.parameters.operation || n.parameters.operation === 'update'), 'Google Sheets nodes only read or update (no append to another tab)');
ok(sheetsNodes.every(n => n.parameters.sheetName.value === 'Topics' && n.parameters.documentId.value === orig.nodes.find(o => o.name === 'Read Topics from Google Sheets').parameters.documentId.value), 'every Sheets node uses the same spreadsheet and the Topics tab');
const sticky = wf.nodes.filter(n => n.type === 'n8n-nodes-base.stickyNote').map(n => n.parameters.content).join('\n');
ok(!/setup \(one time\)|Error Workflow|add a tab/i.test(sticky), 'no sticky note asks the owner to set anything up');

// =====================================================================
section('Node parameters match the n8n node definitions (n8n-nodes-base 2.44.5, @n8n/n8n-nodes-langchain 2.44.5)');
// Parameter names read from the published node sources (Github.node.js, GoogleSheets v2 update/read,
// HttpRequestV3 Description, IfV2, SetV2, Code, ScheduleTrigger, StopAndError, Wait, ChainLlm, LmChatGoogleGemini).
const DEFS = {
  'n8n-nodes-base.github': { versions: [1, 1.1], keys: ['authentication', 'resource', 'operation', 'owner', 'repository', 'filePath', 'binaryData', 'fileContent', 'binaryPropertyName', 'commitMessage', 'additionalParameters', 'asBinaryProperty'] },
  'n8n-nodes-base.googleSheets': { versions: [4.7], keys: ['authentication', 'resource', 'operation', 'documentId', 'sheetName', 'columns', 'options', 'filtersUI', 'combineFilters'] },
  'n8n-nodes-base.httpRequest': { versions: [4.2], keys: ['method', 'url', 'authentication', 'nodeCredentialType', 'genericAuthType', 'sendQuery', 'specifyQuery', 'queryParameters', 'jsonQuery', 'sendHeaders', 'specifyHeaders', 'headerParameters', 'jsonHeaders', 'sendBody', 'contentType', 'specifyBody', 'bodyParameters', 'jsonBody', 'body', 'options'] },
  'n8n-nodes-base.if': { versions: [2.2], keys: ['conditions', 'looseTypeValidation', 'options'] },
  'n8n-nodes-base.set': { versions: [3.4], keys: ['mode', 'duplicateItem', 'assignments', 'includeOtherFields', 'include', 'options'] },
  'n8n-nodes-base.code': { versions: [2], keys: ['mode', 'language', 'jsCode'] },
  'n8n-nodes-base.scheduleTrigger': { versions: [1.3], keys: ['rule'] },
  'n8n-nodes-base.stopAndError': { versions: [1], keys: ['errorType', 'errorMessage', 'errorObject'] },
  'n8n-nodes-base.wait': { versions: [1.1], keys: ['resume', 'amount', 'unit'] },
  'n8n-nodes-base.stickyNote': { versions: [1], keys: ['content', 'height', 'width', 'color'] },
  '@n8n/n8n-nodes-langchain.chainLlm': { versions: [1.9], keys: ['promptType', 'text', 'hasOutputParser', 'messages', 'batching', 'needsFallback'] },
  '@n8n/n8n-nodes-langchain.lmChatGoogleGemini': { versions: [1], keys: ['modelName', 'options'] }
};
for (const n of wf.nodes) {
  const def = DEFS[n.type];
  if (!def) { ok(false, 'unknown node type ' + n.type + ' on ' + n.name); continue; }
  const unknown = Object.keys(n.parameters).filter(k => !def.keys.includes(k));
  ok(def.versions.includes(n.typeVersion) && unknown.length === 0, 'parameters of "' + n.name + '" (' + n.type.split('.').pop() + ' v' + n.typeVersion + ') ' + (unknown.length ? 'UNKNOWN: ' + unknown.join(', ') : 'are valid'));
}
const list = byName('List Existing Blog Posts').parameters;
ok(list.resource === 'file' && list.operation === 'list' && list.filePath === 'content/blog' && list.owner.mode === 'name' && list.owner.value === 'accezcloud-sketch' && list.repository.value === 'AccezWebsite' && !('returnAll' in list),
  'GitHub file:list = resource "file", operation "list", folder in "filePath" (the "Path" field; no returnAll for file:list)');
const listNode = byName('List Existing Blog Posts');
ok(listNode.onError === 'continueRegularOutput' && listNode.alwaysOutputData === true, 'GitHub listing is optional (continue on fail, always outputs)');
for (const name of ['Push Blog Post to GitHub', 'Push Image to GitHub']) {
  const p = byName(name).parameters;
  ok(p.resource === 'file' && (!p.operation || p.operation === 'create') && p.commitMessage && (p.binaryData === true ? true : !!p.fileContent), name + ': file create (default operation) with content and commit message');
}
for (const n of sheetsNodes.filter(n => n.parameters.operation === 'update')) {
  const c = n.parameters.columns;
  ok(c.mappingMode === 'autoMapInputData' && Array.isArray(c.matchingColumns) && c.matchingColumns.length === 1 && n.parameters.options.handlingExtraData === 'ignoreIt',
    n.name + ': update row, auto-map, match on the topic column, extra fields ignored');
}
const ix = byName('Notify IndexNow');
ok(ix.parameters.method === 'POST' && ix.parameters.url === 'https://api.indexnow.org/indexnow' && ix.parameters.sendBody === true && ix.parameters.contentType === 'json' && ix.parameters.specifyBody === 'json' && !ix.credentials,
  'IndexNow: POST JSON body to https://api.indexnow.org/indexnow, no credential needed');
ok(ix.onError === 'continueRegularOutput', 'IndexNow failure never stops the run (continue on fail)');
const wait = byName('Wait for Site Deploy');
ok(wait.parameters.resume === 'timeInterval' && wait.parameters.amount === 5 && wait.parameters.unit === 'minutes', 'Wait for Site Deploy: 5 minutes (time interval)');
ok(byName('Fail Run on GitHub Error').type === 'n8n-nodes-base.stopAndError' && !!byName('Fail Run on GitHub Error').parameters.errorMessage, 'Stop and Error has an error message');

// =====================================================================
section('Model: same Gemini model as the Wady workflow, both calls');
const wady = JSON.parse(fs.readFileSync(path.join(HERE, '../../workflows/wady-blog-auto-deploy.json'), 'utf8'));
const wadyModels = [...new Set(wady.nodes.filter(n => n.type.endsWith('lmChatGoogleGemini')).map(n => n.parameters.modelName))];
const models = wf.nodes.filter(n => n.type.endsWith('lmChatGoogleGemini'));
ok(models.length === 2 && models.every(m => wadyModels.includes(m.parameters.modelName)), 'both Gemini model nodes use the Wady model ' + wadyModels.join(', '));
const geminiCred = orig.nodes.find(n => n.name === 'Google Gemini Chat Model').credentials;
ok(models.every(m => JSON.stringify(m.credentials) === JSON.stringify(geminiCred)), 'both Gemini model nodes use the existing Gemini credential');
ok(models.every(m => JSON.stringify(m.parameters.options) === '{}'), 'no output cap on either model (options {} = model default; the node only applies its 1024-token default when "options" is missing)');
const aiTargets = Object.fromEntries(Object.entries(wf.connections).filter(([, c]) => c.ai_languageModel).map(([from, c]) => [from, c.ai_languageModel[0][0].node]));
ok(aiTargets['Google Gemini Chat Model'] === 'Generate English Post with Gemini' && aiTargets['Google Gemini Chat Model (Arabic)'] === 'Generate Arabic Post with Gemini', 'each chain has its own model sub-node');

// =====================================================================
section('Schedule: every 2 days at 10:00 Asia/Riyadh, one trigger');
const triggers = wf.nodes.filter(n => n.type === 'n8n-nodes-base.scheduleTrigger');
ok(triggers.length === 1 && triggers[0].name === 'Schedule Every 2 Days at 10:00', 'exactly one schedule trigger: ' + triggers[0].name);
const rule = triggers[0].parameters.rule.interval;
ok(rule.length === 1 && rule[0].field === 'days' && rule[0].daysInterval === 2, 'one rule: every 2 days');
ok(rule[0].triggerAtHour === 10 && rule[0].triggerAtMinute === 0, 'at 10:00 (minute set explicitly, otherwise n8n picks a random minute)');
ok(wf.settings.timezone === 'Asia/Riyadh', 'workflow timezone Asia/Riyadh');
// n8n fires the cron every day at 10:00 and its recurrenceCheck (ScheduleTrigger
// GenericFunctions.ts, typeInterval "days") only lets a run through when 2 or more
// days have passed since the last one. Same arithmetic, over month and year ends:
const fires = [];
let last;
for (let d = 0; d < 70; d++) {
  const day = new Date(Date.UTC(2026, 10, 7 + d));
  const doy = Math.round((day - Date.UTC(day.getUTCFullYear(), 0, 0)) / 86400000);
  if (last === undefined || (doy - last + 365) % 365 >= rule[0].daysInterval) { last = doy; fires.push(day.toISOString().slice(0, 10)); }
}
const gaps = fires.slice(1).map((f, i) => (Date.parse(f) - Date.parse(fires[i])) / 86400000);
ok(gaps.every(g => g === 2), 'runs every 2 days with no double run at month or year end: ' + fires.slice(10, 15).join(', ') + ' ... ' + fires.slice(-6).join(', '));

// =====================================================================
section('Two Gemini calls with mocked outputs');
const r = run();
ok(r.geminiCalls.length === 2 && r.geminiCalls[0].node === 'Generate English Post with Gemini' && r.geminiCalls[1].node === 'Generate Arabic Post with Gemini', 'English call first, then the Arabic call');
ok(r.prompt.includes(TOPIC) && r.prompt.includes('- /blog/hidden-costs-of-managing-properties-without-a-system/') && r.plan.relatedSlugs.every(s => OTHER_SLUGS.includes(s)) && !/400\+ booking|77%/.test(r.prompt), 'English prompt: topic + related posts that exist, no 400+/77%');
ok(!r.prompt.includes('{{') && !r.prompt.includes('undefined') && !r.promptAr.includes('{{') && !r.promptAr.includes('undefined'), 'both prompts have no unresolved expressions');
ok(r.prompt.includes('/solutions/property-managers/') && /CLOSING LINE/.test(r.prompt) && !/Visit portal\.accez\.cloud\]/.test(r.prompt), 'English prompt asks for the closing line to /solutions/property-managers/, not the portal');
ok(/What High Performers Do Differently/.test(r.prompt) && /What Breaks and Why/.test(r.prompt) && /Never use generic or template headings/.test(r.prompt), 'English prompt forbids the template headings');
ok(/Suggested format: (HOW-TO|CHECKLIST|EXPLAINER|COMPARISON|GLOSSARY)/.test(r.prompt) && /COMPARISON OF APPROACHES/.test(r.prompt) && /Never compare competitors/.test(r.prompt), 'English prompt carries a per-topic format (comparisons of approaches, not competitors)');
ok(/mada, Apple Pay, STC Pay/.test(r.prompt) && /e-signing/.test(r.prompt) && /say NOTHING about whether Accez complies/.test(r.prompt) && /WhatsApp integration/.test(r.prompt), 'English prompt carries the OWNER_DECISIONS never-claim list');
ok(!/reminders\)/.test(r.prompt) && /automatic reminders/.test(r.prompt), 'English prompt no longer lists "reminders" as a feature (owner: never claim automatic reminders)');
const draft = r.nodes['Check English Draft'][0].json.englishDraft;
ok(draft.startsWith('---\ntitle:') && !draft.includes('```') && !draft.includes('Here is the blog post'), 'Check English Draft strips the code fence and chatter');
ok(r.promptAr.includes(draft), 'Arabic prompt contains the full English article');
ok(r.promptAr.includes('## أبرز النقاط') && r.promptAr.includes('## الأسئلة الشائعة') && /not a literal translation/i.test(r.promptAr) && /Saudi/.test(r.promptAr), 'Arabic prompt: natural MSA for Saudi readers, exact Arabic headings');
ok(r.promptAr.includes('/ar/solutions/property-managers/') && r.promptAr.includes('حل أكسيز لإدارة العقارات'), 'Arabic prompt asks for the closing line to /ar/solutions/property-managers/');
const combined = r.combined;
ok(combined.frontmatter.title === TOPIC && combined.frontmatter.titleAr && combined.frontmatter.tagsAr.length === 5 && combined.frontmatter.tags.length === 5, 'combined frontmatter has the English fields (call 1) and Arabic fields (call 2)');
ok(combined.body.split('<!-- AR -->').length === 2, 'combined body: English, one <!-- AR --> marker, Arabic');
ok(combined.body.split('<!-- AR -->')[1].includes('](/ar/solutions/property-managers/)') && !/\]\(\/solutions\//.test(combined.body.split('<!-- AR -->')[1]), 'Arabic links to site pages get the /ar prefix');
for (const [label, en, ar] of [['English', '  ', S.ar], ['Arabic', S.en, '']]) {
  let msg = '';
  let x = null;
  try { x = run({ en, ar }); } catch (e) { msg = e.message; }
  ok(!msg && x && !x.pushed && /^skipped: /.test(x.sheet.Status) && (label === 'English' ? x.prompts.length >= 3 : x.promptsAr.length >= 3 && x.prompts.length === 2), 'empty ' + label + ' answer: no red run; Gemini is asked again (' + (label === 'English' ? 'whole post' : 'Arabic only') + '), then the topic is skipped ' + msg.slice(0, 60));
}
const noSuffix = S.ar.replace(/^(title|metaTitle|metaDescription|excerpt|tags)Ar:/gm, '$1:');
const ns = run({ ar: noSuffix });
ok(ns.gate.qualityPassed && ns.combined.frontmatter.titleAr === S.arDoc().match(/^titleAr: "(.*)"$/m)[1] && ns.combined.frontmatter.title === TOPIC, 'Arabic answer with "title:" instead of "titleAr:" still fills the Arabic fields, English title kept');
const echo = run({ ar: S.ar.replace(/\n---\n\n/, '\n---\n\n' + S.enBody + '\n\n<!-- AR -->\n\n') });
ok(echo.gate.qualityPassed && echo.combined.body.split('<!-- AR -->').length === 2, 'Arabic answer that repeats the English article before <!-- AR --> is cleaned');
const enWithAr = run({ en: S.en.replace(/```\n$/, '\n<!-- AR -->\n\nنص عربي زائد\n```\n') });
ok(enWithAr.gate.qualityPassed && !enWithAr.combined.body.includes('نص عربي زائد'), 'Arabic text the English call added after a marker is ignored');
const fencedAr = run({ ar: '```markdown\n' + S.ar + '```' });
ok(fencedAr.gate.qualityPassed, 'Arabic answer in a code fence is unwrapped');

// =====================================================================
section('Good sample end to end, read by the site\'s own parser');
const { createServer } = await import(path.join(REPO, 'node_modules/vite/dist/node/index.js'));
const server = await createServer({
  root: REPO, configFile: false, logLevel: 'error', appType: 'custom',
  cacheDir: path.join(os.tmpdir(), 'accez-n8n-vite-cache'),
  resolve: { alias: { '@': REPO } }, server: { middlewareMode: true, hmr: false, watch: null }
});
const blog = await server.ssrLoadModule('/lib/blog.ts');
const md = await server.ssrLoadModule('/lib/content/markdown.ts');
function siteParse(filePath, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'accez-site-'));
  const slug = path.basename(filePath, '.md');
  fs.writeFileSync(path.join(dir, slug + '.md'), content);
  const repo = blog.createBlogRepository(dir);
  const post = repo.getPostBySlug(slug);
  const all = repo.getAllPosts();
  fs.rmSync(dir, { recursive: true });
  return { post, all };
}
ok(r.gate.qualityPassed, 'good sample passes the gate: ' + r.gate.qualityReport);
const pushed = r.pushed;
ok(pushed && pushed.filePath === 'content/blog/sustainability-and-energy-efficiency-cutting-costs.md', 'pushed path ' + (pushed && pushed.filePath));
ok(r.imagePath === 'public/images/blog/sustainability-and-energy-efficiency-cutting-costs.jpg', 'image path matches slug ' + r.imagePath);
const { post, all } = siteParse(pushed.filePath, pushed.fileContent);
ok(post && all.length === 1, 'site parser (gray-matter + createBlogRepository) reads the file');
ok(post.title === TOPIC, 'title keeps its colon: ' + post.title);
ok(post.coverImage === '/images/blog/sustainability-and-energy-efficiency-cutting-costs.jpg', 'coverImage = pushed image path');
ok(post.coverImageAlt === 'A field of green grass with wind turbines in the background', 'alt text describes the Unsplash photo');
ok(post.coverImageCredit === 'Photo by Zac "Z" Wolff on Unsplash', 'credit with quotes survives YAML');
ok(post.date === '2026-10-28' && post.author === 'Accez Team' && post.authorAr === 'فريق أكسيز' && post.category === 'Industry Insights', 'date/author (Accez Team)/category set by workflow');
ok(Array.isArray(post.tags) && post.tags.length === 5 && post.tagsAr.length === 5, 'tags parsed as lists');
ok(post.metaTitle.length <= 60 && post.metaDescription.length <= 160 && post.metaTitleAr.length <= 60, 'meta lengths ' + post.metaTitle.length + '/' + post.metaDescription.length);
ok(post.content.length > 2000 && post.contentAr.length > 2000 && !post.contentAr.includes('<!-- AR -->'), 'body splits into EN and AR');
const htmlEn = md.renderArticle(post.content, { locale: 'en' });
const htmlAr = md.renderArticle(post.contentAr, { locale: 'ar' });
ok(htmlAr.toc.some(t => t.text === 'الأسئلة الشائعة') && htmlAr.toc.some(t => t.text === 'أبرز النقاط'), 'Arabic headings verbatim');
ok(htmlEn.html.includes('href="/solutions/property-managers/"') && htmlAr.html.includes('href="/ar/solutions/property-managers/"'), 'solution page links render (EN + /ar)');
ok(htmlEn.html.includes('href="/blog/utility-and-bill-management-across-a-rental-portfolio/"') && htmlAr.html.includes('href="/ar/blog/utility-and-bill-management-across-a-rental-portfolio/"'), 'related article links render (EN + /ar)');
ok(!/&lt;|```|^title:/m.test(htmlEn.html + htmlAr.html) && !/portal\.accez\.cloud/.test(pushed.fileContent), 'no escaped HTML / fences / YAML / portal link in the published file');
const lastLine = s => s.trim().split('\n').filter(Boolean).pop();
ok(lastLine(post.content) === S.CLOSE_EN && lastLine(post.contentAr) === S.CLOSE_AR, 'each language ends with its closing line to the solution page');
ok(/^coverImage:\s*"([^"]+)"/m.test(pushed.fileContent), 'optimize-blog-images.mjs regex still finds coverImage');
ok(r.facebookMessage.includes('https://www.accez.cloud/blog/sustainability-and-energy-efficiency-cutting-costs/') && r.facebookMessage.includes(TOPIC), 'Facebook message: title + correct URL');
ok(r.sheet.Status === 'used' && r.sheet.Topic === TOPIC && r.sheet['Date Used'] === '2026-10-28', 'sheet row marked used with the date');
ok(r.output.status === 'Success' && r.output.facebook === 'Facebook post published' && r.output.indexNow === 'IndexNow notified', 'Output Success reports Facebook and IndexNow');
const order = r.trace;
ok(order.indexOf('Mark Topic as Used in Sheet') < order.indexOf('Wait for Site Deploy') && order.indexOf('Wait for Site Deploy') < order.indexOf('Notify IndexNow') && order.indexOf('Notify IndexNow') < order.indexOf('Post Blog to Facebook Page'),
  'order after the push: sheet "used", wait for the deploy, IndexNow, Facebook');
fs.writeFileSync(path.join(HERE, 'good-output.md'), pushed.fileContent);

// =====================================================================
section('IndexNow request');
const KEY_FILE = '/Users/ali/Desktop/AccezWebsite/public/02fc2248f8f1fe4d7046ca50e2e5622e.txt';
const KEY = fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, 'utf8').trim() : '02fc2248f8f1fe4d7046ca50e2e5622e';
const slug = 'sustainability-and-energy-efficiency-cutting-costs';
ok(r.indexNow.method === 'POST' && r.indexNow.url === 'https://api.indexnow.org/indexnow', 'POST https://api.indexnow.org/indexnow');
ok(JSON.stringify(r.indexNow.body) === JSON.stringify({ host: 'www.accez.cloud', key: KEY, keyLocation: 'https://www.accez.cloud/' + KEY + '.txt', urlList: ['https://www.accez.cloud/blog/' + slug + '/', 'https://www.accez.cloud/ar/blog/' + slug + '/'] }),
  'body: host, key from notes/indexnow-key.txt, keyLocation, EN + AR URLs with trailing slash');
ok(typeof evalExpr(ix.parameters.jsonBody, { json: {}, nodes: r.nodes }) === 'string', 'jsonBody expression returns a JSON string (parsed by the HTTP node)');
const ixErr = run({ indexNowError: true });
ok(/^IndexNow FAILED/.test(ixErr.output.indexNow) && ixErr.output.status === 'Success' && ixErr.sheet.Status === 'used' && ixErr.output.facebook === 'Facebook post published', 'IndexNow failure: reported, run still succeeds, Facebook still posted');

// =====================================================================
section('Image, GitHub and Facebook failures');
for (const step of ['downloadError', 'pushError']) {
  const x = run({ imageStep: step });
  const p2 = siteParse(x.pushed.filePath, x.pushed.fileContent).post;
  ok(p2.coverImage === '/images/blog/accez-default-cover.jpg' && !p2.coverImageCredit && /Accez logo/.test(p2.coverImageAlt) && !/^"/.test(x.imageError), step + ': Accez default cover, no credit, readable error "' + x.imageError + '"');
}
const noImg = run({ unsplash: { results: [] }, fallbackUnsplash: { error: { message: 'rate limit' } } });
ok(noImg.pushed && noImg.prompts.length === 1 && noImg.sheet.Status === 'used' && siteParse(noImg.pushed.filePath, noImg.pushed.fileContent).post.coverImage === '/images/blog/accez-default-cover.jpg',
  'Unsplash gives nothing: published at once with the Accez default cover (no rewrite, no extra cost)');
ok(fs.existsSync(path.join(REPO, 'public/images/blog/accez-default-cover.jpg')) && fs.existsSync(path.join(REPO, 'public/images/blog/accez-default-cover.webp')), 'the default cover exists on the website (jpg and webp)');
const errSearch = run({ unsplash: { error: { message: '500' } }, fallbackUnsplash: UNSPLASH });
ok(errSearch.gate.hasImage === true, 'Unsplash search error -> fallback search used (no IF type error)');
const fbErr = run({ facebookError: true });
ok(/^Facebook post FAILED/.test(fbErr.output.facebook) && fbErr.sheet.Status === 'used', 'Facebook failure reported, sheet already marked used');
const ghErr = run({ pushError: true });
ok(ghErr.stopError && ghErr.stopError.type === 'n8n-nodes-base.stopAndError' && ghErr.stopError.failedJson.error === 'file already exists' && /file already exists/.test(ghErr.stopError.message) && !ghErr.sheet,
  'GitHub push failure ends in Stop and Error with the plain message, sheet untouched: ' + (ghErr.stopError && ghErr.stopError.message));
const noList = run({ githubList: 'error' });
ok(noList.prompt.includes('no related articles available') && noList.plan.existingSlugs === null && noList.pushed && noList.prompts.length === 1 && !/\]\((?:\/ar)?\/blog\//.test(noList.pushed.fileContent),
  'GitHub listing failed: no articles offered, any /blog/ link is unlinked (words kept), post published');

// YAML escaping: quotes, colon, backslash in the titles
const quoted = run({
  en: S.en.replace(/^title: .*$/m, 'title: "The "Green" Lease: Cutting Costs \\ Going Green"'),
  ar: S.ar.replace(/^titleAr: .*$/m, "titleAr: 'الإيجار \"الأخضر\": خفض التكاليف'")
});
const qp = quoted.pushed && siteParse(quoted.pushed.filePath, quoted.pushed.fileContent).post;
ok(qp && qp.title === 'The "Green" Lease: Cutting Costs \\ Going Green' && qp.titleAr === 'الإيجار "الأخضر": خفض التكاليف', 'unescaped quotes/colon/backslash in titles survive: ' + (qp && qp.title));

// =====================================================================
section('Fixed directly, no rewrite: each problem is corrected by code and the post is published');
const lastOf = s => s.trim().split('\n').filter(l => l.trim()).pop();
const REWRITE = ['no Arabic part', 'Arabic cut off (no closing line)', 'English cut off (no closing line)'];
const GONE = {
  '400+ channels': /400/, '77% statistic': /77%/, 'unlinked study': /recent study/, 'unlinked percentage': /23%/, 'em dash': /[—–]/,
  'spaced hyphen in title': /Sustainability - /, 'metaTitle too long': /metaTitle: "Sustainability and Energy Efficiency for Saudi Property Managers in 2026"/,
  'code fence in body': /console\.log|```/, 'YAML in body': /metaDescription: "duplicate"/, 'wrong Arabic heading': /ملخص المقال/,
  'link to missing article': /how-to-cut-energy-bills-in-riyadh/, 'Accez claims WhatsApp': /WhatsApp integration/, 'tenants book providers via Accez': /tenants book service providers/,
  'figure about Accez': /30%/, 'raw HTML': /<div/, 'vague link text': /\[here\]/, 'generic heading "Conclusion"': /## Conclusion/,
  'ends with "Visit portal.accez.cloud" instead of the solution link': /portal\.accez/, 'closing line links the wrong solution page': /\(\/solutions\/service-providers\/\) keeps/,
  'Arabic closing line links the wrong solution page': /\(\/ar\/solutions\/service-providers\/\) الذي/, 'portal.accez.cloud link inside the body': /portal\.accez/,
  'Accez claims mada, Apple Pay and STC Pay': /STC Pay/, 'Accez and ZATCA compliance': /fully compliant with ZATCA/, 'Accez and ZATCA non-compliance': /not yet certified/,
  'Accez claims e-signing': /e-sign leases/, 'Accez claims a tenant portal': /Tenant portal/, 'Accez claims dynamic pricing': /dynamic pricing that adjusts/,
  'Accez claims automatic reminders': /automatic rent reminders/, 'Accez claims minimum stay rules': /minimum stay rules per unit/, 'Accez claims inspection checklists': /inspection checklists make/,
  'Accez claims visitor management': /visitor management for gated/, 'Accez claims Ejar integration': /registers every lease with Ejar/, 'Accez claims a booking engine': /booking website builder/,
  'Accez claims a vendor directory': /vendor directory of approved/, 'Accez claims smart locks': /smart locks for keyless/, 'Accez claims AI features': /uses AI to predict/,
  'Arabic: Accez claims WhatsApp': /واتساب لمراسلة/, 'Arabic: Accez claims e-signing': /التوقيع الإلكتروني لعقود/, 'Arabic: Accez claims mada': /مدى وأبل باي/,
  'template heading "What High Performers Do Differently"': /Do Differently/, 'template heading "What Breaks and Why"': /What Breaks/, 'template heading "A Deep Dive into ..."': /Deep Dive/,
  'Arabic template heading "ما يفعله أصحاب الأداء العالي بشكل مختلف"': /يفعله أصحاب الأداء العالي بشكل مختلف/, 'Arabic template heading "ما الذي يتعطل ولماذا"': /ما الذي يتعطل ولماذا/
};
for (const [label, v] of Object.entries(S.bad).filter(([k]) => !REWRITE.includes(k))) {
  const b = run({ en: v.en, ar: v.ar });
  const file = b.pushed ? b.pushed.fileContent : '';
  const gone = GONE[label] ? !GONE[label].test(file) : false;
  const post = file && siteParse(b.pushed.filePath, file).post;
  ok(b.pushed && b.prompts.length === 1 && b.gate.qualityPassed && gone && post && post.metaTitle.length <= 60,
    'fixed directly: ' + label + (b.pushed ? ' (' + (b.gate.autoFixes || []).join(', ').slice(0, 90) + ')' : ' NOT PUBLISHED ' + (b.gate.qualityReport || '').slice(0, 150)));
}
section('Needs a new draft (only what code cannot fix): rewritten 3 times, then the topic is skipped and the next one written');
for (const label of REWRITE) {
  const v = S.bad[label];
  const b = run({ en: v.en, ar: v.ar });
  const arabicOnly = label !== 'English cut off (no closing line)';
  const callsOk = arabicOnly ? b.prompts.length === 2 && b.promptsAr.length === 6 : b.prompts.length === 6 && b.promptsAr.length === 6;
  ok(!b.gate.qualityPassed && !b.pushed && /^skipped: /.test(b.sheet.Status) && callsOk && b.topicsTried.join('|') === TOPIC + '|A Later Topic',
    'rewrite (' + (arabicOnly ? 'Arabic only, 1 call each' : 'whole post') + '), then skipped: ' + label + ' -> ' + (b.sheet && b.sheet.Status || '').slice(9, 90));
}
for (const [label, v] of Object.entries(S.allowed)) {
  const b = run({ en: v.en, ar: v.ar });
  ok(b.gate.qualityPassed, 'allowed: ' + label + ' ' + (b.gate.qualityPassed ? '' : b.gate.qualityReport));
}

// =====================================================================
section('Closing line follows the topic (property vs service business)');
const SP_TOPIC = 'Reducing No-Shows at Barbershops and Salons';
for (const label of ['closing line links the wrong solution page', 'Arabic closing line links the wrong solution page']) {
  const v = S.bad[label];
  const b = run({ en: v.en, ar: v.ar });
  const [enP, arP] = b.pushed ? b.pushed.fileContent.split('<!-- AR -->') : ['', ''];
  ok(b.gate.qualityPassed && lastOf(enP).includes('](/solutions/property-managers/)') && lastOf(arP).includes('](/ar/solutions/property-managers/)'), 'repaired, not blocked: ' + label + (b.gate.qualityPassed ? '' : ' ' + b.gate.qualityReport));
}
const sp = runPipeline(WF, { topic: SP_TOPIC, en: S.serviceProvider.en, ar: S.serviceProvider.ar, unsplash: UNSPLASH });
ok(sp.plan.solution === 'service-providers' && sp.prompt.includes('/solutions/service-providers/') && sp.promptAr.includes('/ar/solutions/service-providers/'), 'service business topic: prompts ask for /solutions/service-providers/ (and /ar/...)');
ok(sp.gate.qualityPassed, 'service business post ending with /solutions/service-providers/ passes ' + (sp.gate.qualityPassed ? '' : sp.gate.qualityReport));
const spWrong = runPipeline(WF, { topic: SP_TOPIC, en: S.en, ar: S.ar, unsplash: UNSPLASH });
ok(spWrong.gate.qualityPassed && lastOf(spWrong.pushed.fileContent.split('<!-- AR -->')[0]).includes('](/solutions/service-providers/)') && lastOf(spWrong.pushed.fileContent.split('<!-- AR -->')[1]).includes('](/ar/solutions/service-providers/)'), 'service business post ending with the property page: closing line replaced with the service provider page (EN and AR)');
const pmWrong = run({ en: S.serviceProvider.en, ar: S.serviceProvider.ar });
ok(pmWrong.gate.qualityPassed && lastOf(pmWrong.pushed.fileContent.split('<!-- AR -->')[0]).includes('](/solutions/property-managers/)') && lastOf(pmWrong.pushed.fileContent.split('<!-- AR -->')[1]).includes('](/ar/solutions/property-managers/)'), 'property post ending with the service provider page: closing line replaced (EN and AR)');
const { code } = loadWorkflow(WF);
const planFor = (topic, extra = {}) => runCode(code('Collect Existing Posts'), {
  input: (extra.slugs || OTHER_SLUGS).map(s => ({ json: { name: s + '.md' } })),
  nodes: { 'Find First Pending Topic': runCode(code('Find First Pending Topic'), { input: [{ json: { Topic: topic, Status: 'pending', 'Date Used': '', ...(extra.row || {}) } }] }) }
})[0].json;
for (const [topic, want] of [
  ['Running a Salon Waitlist Without Losing Walk-Ins', 'service-providers'], ['Loyalty Points and Gift Cards for Spas', 'service-providers'],
  ['Coaching Businesses: Taking Deposits for Appointments', 'service-providers'], ['Guest Messaging Templates for Serviced Apartments', 'property-managers'],
  ['Lease Renewals for Long-Term Tenants', 'property-managers'], ['Spa Amenities in Hotels: What Guests Expect', 'property-managers']
]) {
  const p = planFor(topic);
  ok(p.solution === want, 'solution page for "' + topic + '" = ' + p.solution);
}

// =====================================================================
section('Duplicate check before writing');
const sameSlug = run({ githubList: FIXTURE_SLUGS, topic: 'Preventive Maintenance: How to Stop Small Issues Becoming Big' });
ok(sameSlug.plan.isDuplicate && sameSlug.plan.duplicateOf === 'preventive-maintenance-how-to-stop-small-issues-becoming-big' && !sameSlug.geminiCalls.some(c => c.prompt.includes('Preventive Maintenance: How to Stop')),
  'same slug as an existing post: never written (no Gemini call for it)');
ok(sameSlug.sheet.Status === 'duplicate: preventive-maintenance-how-to-stop-small-issues-becoming-big' && sameSlug.sheet.Topic === sameSlug.plan.topic
  && sameSlug.topicsTried[1] === 'A Later Topic' && sameSlug.pushed && sameSlug.pushed.filePath === 'content/blog/a-later-topic.md' && sameSlug.output.status === 'Success',
  'row marked "duplicate: <existing slug>", then the run writes the next pending topic and publishes it');
const sample = run({ githubList: FIXTURE_SLUGS });
ok(sample.plan.isDuplicate && sample.plan.duplicateOf === SAMPLE_SLUG, 'the sample topic is a duplicate once its post is on the site (slug cut at 60 vs full slug): ' + sample.plan.duplicateReason);
for (const [topic, existing] of [
  ['Cash Flow Forecasting for Property Managers', 'cash-flow-forecasting-for-property-management-businesses'],
  ['Email Marketing to Past Guests', 'email-marketing-to-past-guests-turning-one-time-stays-into-repeat-bookings'],
  ['Utility Billing Across a Rental Portfolio', 'utility-and-bill-management-across-a-rental-portfolio'],
  ['Owner Reporting: Statements That Send Themselves', 'automated-owner-reporting-statements-that-send-themselves'],
  ['Dynamic Pricing 101: Stop Leaving Money on the Table', 'dynamic-pricing-101-how-to-stop-leaving-money-on-the-table-every-night'],
  ['How to Create and Manage Properties in Accez.Cloud', 'how-to-create-manage-properties-accez-cloud'],
  ['Sustainability and Energy Efficiency: Cutting Costs While Going Green', 'sustainability-and-energy-efficiency-cutting-costs-while-goi']
]) {
  const p = planFor(topic, { slugs: [...OTHER_SLUGS.filter(s => s !== existing), existing] });
  ok(p.isDuplicate && p.duplicateOf === existing, 'near duplicate: "' + topic + '" -> ' + p.duplicateOf + ' (' + p.duplicateReason + ')');
}
for (const topic of ['Preventive Maintenance Budgets for Compounds', 'Choosing Between In-House and Outsourced Cleaning', 'Reducing No-Shows at Barbershops and Salons',
  'Guest Communication Templates for Check-In Day', 'Rent Collection Reminders That Work', 'How to Create and Manage Leases in Accez.Cloud', 'Service Charges in Residential Compounds Explained']) {
  const p = planFor(topic);
  ok(!p.isDuplicate, 'not a duplicate: "' + topic + '"' + (p.isDuplicate ? ' (flagged as ' + p.duplicateOf + ')' : ''));
}
// Every live post's title against the other live posts: none may be flagged.
const SITE_DIR = path.join(REPO, 'content/blog');
const falsePositives = [];
if (fs.existsSync(SITE_DIR)) {
  for (const f of fs.readdirSync(SITE_DIR).filter(f => f.endsWith('.md'))) {
    const title = (fs.readFileSync(path.join(SITE_DIR, f), 'utf8').match(/^title:\s*"(.*)"\s*$/m) || [])[1];
    const p = planFor(title, { slugs: FIXTURE_SLUGS.filter(s => s + '.md' !== f) });
    if (p.isDuplicate) falsePositives.push(title + ' -> ' + p.duplicateOf);
  }
}
ok(fs.existsSync(SITE_DIR) && falsePositives.length === 0, 'no false duplicates: each of the ' + FIXTURE_SLUGS.length + ' live post titles vs the other posts ' + falsePositives.join('; '));

// =====================================================================
section('Article format per topic');
const fmt = (topic, row) => planFor(topic, { row });
ok(fmt('Choosing Between In-House and Outsourced Cleaning').format === 'comparison', 'comparison topic -> comparison format');
ok(fmt('7 Mistakes Owners Make With Deposits').format === 'checklist', 'numbered "mistakes" topic -> checklist');
ok(fmt('How to Set Up Owner Payouts').format === 'how-to', '"How to" topic -> how-to');
ok(fmt('Short-Term Rental Terms Every Owner Should Know: A Glossary').format === 'glossary', 'glossary topic -> glossary');
ok(fmt('What Is a Service Charge?').format === 'explainer', '"What is" topic -> explainer');
const fromSheet = fmt('Lease Renewals for Long-Term Tenants', { Format: 'Glossary' });
ok(fromSheet.format === 'glossary' && fromSheet.formatSource === 'sheet' && /chosen by the editor/.test(fromSheet.formatInstruction), 'optional "Format" column in the sheet wins');
const withFormatCol = runCode(code('Find First Pending Topic'), { input: [{ json: { row_number: 5, Topic: 'X topic', Format: 'checklist', Status: 'pending', 'Date Used': '' } }] })[0].json;
ok(withFormatCol.colA === 'Topic' && withFormatCol.colB === 'Status' && withFormatCol.colC === 'Date Used' && withFormatCol.format === 'checklist', 'a Format column (any position) does not shift the topic, status and date columns');
const plain = ['Lease Renewals for Long-Term Tenants', 'Owner Statements for Mixed Portfolios', 'Housekeeping Schedules for Serviced Apartments', 'Work Order Priorities for Compounds', 'Seasonal Demand Around Hajj and Umrah', 'Deposits for Holiday Homes', 'Staff Roles for a Growing Team', 'Add Ons That Guests Actually Buy'];
const formats = new Set(plain.map(t => fmt(t).format));
ok(formats.size >= 3, 'topics with no signal get varied formats (' + [...formats].join(', ') + '), not one template');

// =====================================================================
section('Sheet status values: plain text in the existing status column');
const review = run({ en: S.bad['English cut off (no closing line)'].en, ar: S.bad['English cut off (no closing line)'].ar });
for (const [label, rowOut, re] of [['used', r.sheet, /^used$/], ['skipped', review.sheet, /^skipped: .+/], ['duplicate', sameSlug.sheet, /^duplicate: [a-z0-9-]+$/]]) {
  const keys = Object.keys(rowOut).filter(k => !k.startsWith('_'));
  ok(JSON.stringify(keys.sort()) === JSON.stringify(['Date Used', 'Status', 'Topic']) && typeof rowOut.Status === 'string' && re.test(rowOut.Status), '"' + label + '" written as text to Status (no new columns): ' + rowOut.Status.slice(0, 50));
}

// =====================================================================
section('Slug cutter');
const topics = [
  'Sustainability and Energy Efficiency: Cutting Costs While Going Green',
  'Property Insurance and Liability: Covering the Risks Owners Forget',
  'Cash Flow Forecasting for Property Management Businesses',
  "Connecting Your Tools: Why API Integrations Matter for Property Managers",
  'Cybersecurity for Property Managers: Protecting Tenant and Owner Data',
  'Migrating From Spreadsheets and Legacy Software Without Losing Data',
  'Visitor and Access Management for Compounds and Gated Communities',
  "An Owner's Guide to Café-Style Amenities", 'Supercalifragilisticexpialidociousandevenlongerwordthatkeepsgoingonandon'
];
for (const t of topics) {
  const s = runCode(code('Find First Pending Topic'), { input: [{ json: { row_number: 2, Topic: t, Status: 'pending' } }] })[0].json.topicSlug;
  const full = t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const boundary = s === full || full[s.length] === '-' || !full.slice(0, 61).includes('-');
  ok(s.length <= 60 && boundary && !s.endsWith('-') && full.startsWith(s), 'slug ' + s + ' (' + s.length + ')');
}
const none = (() => { try { runCode(code('Find First Pending Topic'), { input: [{ json: { Topic: 'x', Status: 'used' } }] }); return false; } catch (e) { return /No pending topics/.test(e.message); } })();
ok(none, 'no pending topic -> error (run stops instead of calling Gemini with nothing)');

// =====================================================================
section('Cover photo choice (Nov 2026: a title search returned a scripture page)');
const withQuery = (q) => S.en.replace(/^tags: (.*)$/m, (l) => l + '\nimageQuery: "' + q + '"');
const qr = run({ en: withQuery('checklist notebook pen') });
ok(qr.searchQuery === 'checklist notebook pen', 'Unsplash is searched with Gemini\'s concrete photo subject, not the title: ' + qr.searchQuery);
ok(!/imageQuery/.test(qr.pushed.fileContent), 'imageQuery is not published in the post');
ok(r.searchQuery === r.combined.searchQuery, 'no imageQuery from Gemini: falls back to the tag words (' + r.searchQuery + ')');
const bible = photo('bibleAAAAAA', 'a close up of a page of a bible', { tags: [{ title: 'scripture' }] });
const notebook = photo('noteBBBBBBB', 'a hand writing a checklist in a notebook with a pen');
const pickRun = run({ en: withQuery('checklist notebook pen'), unsplash: { results: [bible, notebook] } });
ok(pickRun.gate.hasImage && pickRun.gate.photoId === 'noteBBBBBBB', 'first result is a scripture page: skipped, the checklist photo is used');
ok(pickRun.gate.imageUrl === 'https://images.unsplash.com/photo-noteBBBBBBB?ixid=x&w=1600&q=80&fm=jpg&fit=crop', '1600 px JPEG from the raw url: ' + pickRun.gate.imageUrl);
ok(pickRun.trackUrl === 'https://api.unsplash.com/photos/noteBBBBBBB/download?ixid=x', 'Unsplash download is reported (API rule): ' + pickRun.trackUrl);
ok(/^A hand writing a checklist/.test(siteParse(pickRun.pushed.filePath, pickRun.pushed.fileContent).post.coverImageAlt), 'alt text describes the chosen photo');
const office = photo('officeCCCCC', 'an empty office with desks and chairs');
const ranked = run({ en: withQuery('checklist notebook pen'), unsplash: { results: [office, notebook] } });
ok(ranked.gate.photoId === 'noteBBBBBBB', 'a photo matching the subject words beats the first result');
const usedRun = run({ en: withQuery('checklist notebook pen'), unsplash: { results: [notebook, office] }, usedCovers: { ids: ['noteBBBBBBB'] } });
ok(usedRun.gate.photoId === 'officeCCCCC', 'a photo another post already uses (from /blog/covers.json) is skipped');
ok(usedRun.usedCoversUrl === 'https://www.accez.cloud/blog/covers.json', 'used covers read from the site: ' + usedRun.usedCoversUrl);
const usedErr = run({ en: withQuery('checklist notebook pen'), unsplash: { results: [notebook] }, usedCovers: 'error' });
ok(usedErr.gate.hasImage && usedErr.gate.qualityPassed, 'site list unavailable: the run continues and still picks a photo');
const building = photo('buildDDDDDD', 'a modern apartment building with balconies');
const fb = run({ unsplash: { results: [bible, photo('noDesc11111', '', { alt_description: null })] }, fallbackUnsplash: { results: [building] } });
ok(fb.trace.includes('Search Unsplash Fallback') && fb.gate.photoId === 'buildDDDDDD', 'first search has only unsuitable photos: the safe fallback search is used');
ok(evalExpr(byName('Search Unsplash Fallback').parameters.queryParameters.parameters[0].value, { nodes: fb.nodes }) === 'modern apartment building exterior', 'fallback subject for property topics: modern apartment building exterior');
for (const [label, p] of [
  ['wine', photo('wineEEEEEEE', 'two glasses of red wine on a table')], ['pork', photo('baconFFFFFF', 'bacon and eggs breakfast')],
  ['portrait shape', photo('tallGGGGGGG', 'a checklist on a desk', { width: 2000, height: 3000 })], ['small file', photo('smallHHHHHH', 'a checklist on a desk', { width: 800, height: 600 })],
  ['Unsplash+', photo('plusIIIIIII', 'a checklist on a desk', { premium: true })], ['no description', photo('nodescJJJJJ', '', { alt_description: null })],
  ['brand logo', photo('logoKKKKKKK', 'a laptop showing a company logo')], ['church', photo('churchLLLLL', 'the inside of a church')]
]) {
  const x = run({ unsplash: { results: [p, notebook] } });
  ok(x.gate.photoId === 'noteBBBBBBB', 'skipped: ' + label);
}
const searchParams = Object.fromEntries(byName('Search Unsplash').parameters.queryParameters.parameters.map(q => [q.name, q.value]));
ok(searchParams.per_page === '20' && searchParams.content_filter === 'high' && searchParams.orientation === 'landscape', 'search: 20 results, safe content filter, landscape');
ok(JSON.stringify(byName('Track Unsplash Download').credentials) === JSON.stringify(byName('Search Unsplash').credentials) && byName('Track Unsplash Download').onError === 'continueRegularOutput' && byName('Read Used Cover Photos').onError === 'continueRegularOutput',
  'new steps reuse the Unsplash login and never stop the run');
ok(/imageQuery/.test(r.prompt) && /never anything religious/.test(r.prompt), 'English prompt asks for a concrete, non-religious photo subject');

// =====================================================================
section('Each language stays in its own half');
const arInEn = run({ en: S.en.replace('## Frequently Asked Questions', '## Frequently Asked Questions\n\n### كيف أعرف متى حان الوقت لتوظيف المزيد من موظفي إدارة العقارات؟\n\nفكر في التوظيف حين يعمل الفريق ساعات إضافية بانتظام وتطول أوقات الرد على الملاك.') });
ok(arInEn.pushed && arInEn.prompts.length === 1 && !/[\u0600-\u06FF]{3}/.test(arInEn.pushed.fileContent.split('<!-- AR -->')[0].split('\n---\n').pop()), 'Arabic question and answer in the English FAQ: removed by code, post published');
const arTerm = run({ en: S.en.replace(/^(## (?!Frequently)[^\n]*\n\n)([^\n#>-])/m, '$1Landlords often ask about the brokerage commission (السعي) and the lease documentation (توثيق العقد) before signing. $2') });
ok(arTerm.gate.qualityPassed && /السعي/.test(arTerm.pushed.fileContent.split('<!-- AR -->')[0]), 'an Arabic term inside an English sentence is allowed ' + (arTerm.gate.qualityPassed ? '' : arTerm.gate.qualityReport));
const enHeadInAr = run({ ar: S.ar.replace('## الأسئلة الشائعة', '## الأسئلة الشائعة\n\n### How do I know when it is time to hire more staff?\n\nفكر في التوظيف حين يعمل الفريق ساعات إضافية بانتظام.') });
ok(enHeadInAr.pushed && enHeadInAr.prompts.length === 1 && !/How do I know when it is time/.test(enHeadInAr.pushed.fileContent) && !/فكر في التوظيف حين يعمل الفريق ساعات إضافية بانتظام\./.test(enHeadInAr.pushed.fileContent), 'English question in the Arabic FAQ: question and its answer removed by code, post published');
const enLineInAr = run({ ar: S.ar.replace('## أبرز النقاط', '*This article is general information for property operators and is not legal advice.*\n\n## أبرز النقاط') });
ok(enLineInAr.pushed && enLineInAr.prompts.length === 1 && !/general information for property operators and is not legal advice/.test(enLineInAr.pushed.fileContent.split('<!-- AR -->')[1]) && /ليست استشارة قانونية/.test(enLineInAr.pushed.fileContent.split('<!-- AR -->')[1]), 'English disclaimer in the Arabic half: replaced by the Arabic one, published');
const allInOne = run({ en: S.en.replace(/^(- \*\*[^\n]*)$/m, '$1 Accez is an all-in-one platform.') });
ok(allInOne.pushed && allInOne.prompts.length === 1 && !/all-in-one/i.test(allInOne.pushed.fileContent), '"all-in-one" about Accez: the sentence is removed, published');
ok(/never call them hotels/.test(r.prompt) && /personal trainers/.test(r.prompt), 'prompt: serviced apartments (not hotels); providers include personal trainers');
ok(/Never leave an English heading/.test(r.promptAr), 'Arabic prompt: every heading and sentence in Arabic');

// =====================================================================
section('Addresses never end on a dangling word');
for (const [t, want] of [
  ['Building and Structuring a Property Management Team as You Grow', 'building-and-structuring-a-property-management-team'],
  ['Writing SOPs: The Playbooks That Keep Operations Consistent at Scale', 'writing-sops-the-playbooks-that-keep-operations-consistent'],
  ['Managing HOAs and Owners Associations: Beyond Single-Unit Rentals', 'managing-hoas-and-owners-associations-beyond-single-unit'],
  ['Sustainability and Energy Efficiency: Cutting Costs While Going Green', 'sustainability-and-energy-efficiency-cutting-costs'],
  ['Short Topic Under Sixty Characters Ends With And', 'short-topic-under-sixty-characters-ends-with-and']
]) {
  const s = runCode(code('Find First Pending Topic'), { input: [{ json: { row_number: 2, Topic: t, Status: 'pending' } }] })[0].json.topicSlug;
  ok(s === want, 'slug for "' + t + '" = ' + s);
}

// =====================================================================
section('The workflow decides by itself: rewrite, skip, next topic (owner, 7 Nov 2026)');
const badEm = S.bad['English cut off (no closing line)']; // needs a new draft (code cannot fix a cut off article)
const fixedOnSecond = run({ answers: [badEm, { en: S.en, ar: S.ar }] });
ok(fixedOnSecond.gate.qualityPassed && fixedOnSecond.pushed && fixedOnSecond.sheet.Status === 'used' && fixedOnSecond.geminiCalls.length === 4, 'first draft fails, Gemini rewrites it, the second draft is published (4 Gemini calls)');
ok(/YOUR PREVIOUS DRAFT WAS REJECTED/.test(fixedOnSecond.prompts[1]) && /Key Takeaways/.test(fixedOnSecond.prompts[1]) && !/REJECTED/.test(fixedOnSecond.prompts[0]), 'the rewrite prompt lists the exact problems; the first prompt does not');
ok(/THE PREVIOUS VERSION WAS REJECTED/.test(fixedOnSecond.promptsAr[1]) && !/REJECTED/.test(fixedOnSecond.promptsAr[0]), 'the Arabic step also gets the problems on a rewrite');
const thirdTime = run({ answers: [badEm, badEm, { en: S.en, ar: S.ar }] });
ok(thirdTime.pushed && thirdTime.sheet.Status === 'used' && thirdTime.prompts.length === 3, 'fails twice, published on the third attempt');
const skipThenNext = run({ answers: [badEm, badEm, badEm, { en: S.en, ar: S.ar }] });
ok(/^skipped: /.test(skipThenNext.sheet.Status) && skipThenNext.pushed && skipThenNext.pushed.filePath === 'content/blog/a-later-topic.md' && skipThenNext.sheetUpdates[1].Status === 'used',
  'three failures: topic skipped (not "needs review"), and the next pending topic is published in the same run');
ok(skipThenNext.prompts.length === 4 && !/REJECTED/.test(skipThenNext.prompts[3]), 'the next topic starts fresh (attempt count and problems do not carry over)');
const manyBad = run({ en: badEm.en, ar: badEm.ar, rows: [1, 2, 3, 4, 5].map(i => ({ json: { row_number: i + 1, Topic: 'Bad Topic Number ' + i, Status: 'pending', 'Date Used': '' } })) });
ok(manyBad.topicsTried.length === 3 && manyBad.prompts.length === 9 && !manyBad.pushed && manyBad.output.status === 'Nothing left to write', 'at most 3 topics per run (9 Gemini drafts), then the run ends quietly');
const legacy = run({ rows: [{ json: { row_number: 2, Topic: TOPIC, Status: 'needs review: Arabic part does not end with a closing line', 'Date Used': '2026-11-07' } }] });
ok(legacy.topicsTried[0] === TOPIC && legacy.pushed && legacy.sheet.Status === 'used', 'a "needs review" row left by the old workflow is tried again automatically and published');
const ejarTopic = 'How to Document a Residential Lease on Ejar, Step by Step';
const ejarRun = run({ topic: ejarTopic, ar: S.ar.trim().split('\n').filter(l => !l.includes('](/ar/solutions/property-managers/)')).join('\n') + '\n' });
ok(ejarRun.pushed && ejarRun.sheet.Status === 'used' && ejarRun.prompts.length === 1, 'the 7 Nov case (Arabic closing line missing) is published on the first attempt now');
ok(!byName('Output Needs Review') || false, 'no "Output Needs Review" step: nothing waits for a person');

// =====================================================================
section('First live run, 7 Nov 2026: Ejar lease topic stopped for review');
// The Arabic half did not end with the solution link, and the Accez section said "Ejar".
const arNoClose = S.ar.trim().split('\n').filter(l => !l.includes('](/ar/solutions/property-managers/)')).join('\n') + '\n';
const nc = run({ ar: arNoClose });
const ncAr = nc.pushed ? nc.pushed.fileContent.split('<!-- AR -->')[1] : '';
ok(nc.gate.qualityPassed && /^اكتشف كيف يجمع \[حل أكسيز لإدارة العقارات\]\(\/ar\/solutions\/property-managers\/\)/.test(lastOf(ncAr)), 'Arabic closing line missing: the standard one is added, post not stopped ' + (nc.gate.qualityPassed ? '' : nc.gate.qualityReport));
const arDiscAfter = S.ar.trim() + '\n\n*هذه المقالة معلومات عامة وليست استشارة قانونية أو ضريبية أو مالية.*\n';
const da = run({ ar: arDiscAfter });
ok(da.gate.qualityPassed && lastOf(da.pushed.fileContent.split('<!-- AR -->')[1]) === S.CLOSE_AR, 'disclaimer after the closing line: the closing line is moved back to the end');
const cut = run({ en: S.en.replace(/## Key Takeaways[\s\S]*?(?=\n```|$)/, '') });
ok(!cut.gate.qualityPassed && /Key Takeaways" heading is missing/.test(cut.gate.qualityReport), 'English cut off before Key Takeaways: still stopped (the repaired closing line cannot hide it)');
const accezSection = t => S.en.replace(/^(## [^\n]*Accez[^\n]*\n\n)/m, '$1' + t + '\n\n');
const ejarOk = run({ en: accezSection('Accez keeps each lease, its rent schedule and the Ejar contract number together, so the details are ready when you document the contract on Ejar.') });
ok(ejarOk.gate.qualityPassed, 'Accez section may mention Ejar (keeps the Ejar contract number) ' + (ejarOk.gate.qualityPassed ? '' : ejarOk.gate.qualityReport));
for (const claim of ['Accez registers every lease on Ejar for you.', '- **Ejar sync:** leases flow straight into Ejar.', 'Accez submits contracts directly to Ejar.', 'Leases are uploaded automatically to Ejar.']) {
  const b = run({ en: accezSection(claim) });
  ok(b.pushed && b.prompts.length === 1 && !b.pushed.fileContent.includes(claim.replace(/^- /, '')), 'Ejar claim removed, post published: "' + claim + '"');
}
const arEjarOk = run({ ar: S.ar.replace(/^(## [^\n]*(?:أكسيز|Accez)[^\n]*\n\n)/m, '$1تحفظ أكسيز كل عقد مع رقم عقد إيجار وجدول دفعاته، فتكون البيانات جاهزة حين توثّق العقد في منصة إيجار بنفسك.\n\n') });
ok(arEjarOk.gate.qualityPassed, 'Arabic Accez section may mention منصة إيجار ' + (arEjarOk.gate.qualityPassed ? '' : arEjarOk.gate.qualityReport));
const arEjarClaim = run({ ar: S.ar.replace(/^(## [^\n]*(?:أكسيز|Accez)[^\n]*\n\n)/m, '$1تتكامل أكسيز مع منصة إيجار وتوثّق العقود تلقائيًا في منصة إيجار.\n\n') });
ok(arEjarClaim.pushed && !/تتكامل أكسيز مع منصة إيجار/.test(arEjarClaim.pushed.fileContent), 'Arabic Ejar integration claim removed, post published');
ok(/never that Accez registers, documents, submits, uploads or syncs anything with Ejar/.test(r.prompt), 'English prompt explains how Ejar may be mentioned in the Accez section');

// =====================================================================
section('Red team: the three posts the old workflow published on 3, 5 and 7 Nov 2026');
// Each live post split back into the two Gemini answers it came from, then run
// through this workflow. Every one must be stopped for review, for the right reasons.
const RED = path.join(HERE, 'fixtures/redteam');
const splitPost = text => {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const lines = m[1].split('\n');
  const pick = re => lines.filter(l => re.test(l)).join('\n');
  const [enBody, arBody] = m[2].split('<!-- AR -->');
  return {
    title: (m[1].match(/^title: "(.*)"$/m) || [])[1],
    en: '---\n' + pick(/^(title|metaTitle|metaDescription|primaryKeyword|excerpt|tags):/) + '\n---\n\n' + enBody.trim() + '\n',
    ar: '---\n' + pick(/^(titleAr|metaTitleAr|metaDescriptionAr|excerptAr|tagsAr):/) + '\n---\n\n' + arBody.trim() + '\n'
  };
};
// The three bad live posts, run through the workflow: everything is fixed by code,
// the post is published on the first attempt, and none of the problems survives.
const RED_FIXES = {
  'writing-sops-the-playbooks-that-keep-operations-consistent-a.md': [/400\+ channels/, /unsourced statistic/, /claim Accez does not make/, /portal\.accez\.cloud/, /dashes/, /template heading/],
  'building-and-structuring-a-property-management-team-as-you-g.md': [/400\+ channels/, /unsourced statistic/, /claim Accez does not make/, /portal\.accez\.cloud/, /wrong language/, /template heading/],
  'managing-hoas-and-owners-associations-beyond-single-unit-ren.md': [/unsourced statistic/, /claim Accez does not make/, /portal\.accez\.cloud/, /template heading/]
};
const TEMPLATE_RE = /do(?:es)? differently|what (?:actually )?breaks|deep dive|navigating the saudi|بشكل مختلف|ما الذي (?:ينكسر|يتعطل)|الغوص العميق|التنقل في (?:ال)?مشهد/i;
for (const [file, want] of Object.entries(RED_FIXES)) {
  const post = splitPost(fs.readFileSync(path.join(RED, file), 'utf8'));
  const x = run({ topic: post.title, en: post.en, ar: post.ar, unsplash: { results: [notebook] } });
  const fixesSeen = x.gate.autoFixes || [];
  const missing = want.filter(re => !fixesSeen.some(f => re.test(f)));
  const text = x.pushed ? x.pushed.fileContent : '';
  const [enT, arT] = text.split('<!-- AR -->');
  const heads = (text.match(/^#{2,4}[ \t]+.*$/gm) || []);
  const problems = [];
  if (heads.some(h => TEMPLATE_RE.test(h))) problems.push('template heading left');
  if ((enT || '').split('\n---\n').pop().split('\n').some(l => /^#{2,4}\s/.test(l) && /[؀-ۿ]/.test(l))) problems.push('Arabic heading in English half');
  if ((arT || '').split('\n').some(l => /^#{2,4}\s/.test(l) && !/[؀-ۿ]/.test(l))) problems.push('English heading in Arabic half');
  if (/400\s?\+|\+\s?400|portal\.accez|77\s?[%٪]|[—–]|all-in-one/i.test(text)) problems.push('banned text left');
  // e-signing and WhatsApp may be discussed in general, never as something Accez does
  if (text.split(/(?<=[.!?؟])\s+|\n/).some(x => /accez|أكسيز/i.test(x) && /\be-?sign|التوقيع الإلكتروني|whatsapp|واتساب/i.test(x))) problems.push('Accez claim left');
  ok(x.pushed && x.prompts.length === 1 && missing.length === 0 && problems.length === 0,
    'red team ' + file.slice(0, 40) + ': published on the first attempt, ' + fixesSeen.length + ' kinds of fixes' + (missing.length ? ' MISSING ' + missing.join(' ') : '') + (problems.length ? ' PROBLEMS ' + problems.join(', ') : ''));
}

// =====================================================================
section('Red team: worst-case drafts against the fixes');
const allAtOnce = (() => {
  let en = S.en;
  const firstPara = en.split('\n\n').find(p => /^[A-Z]/.test(p) && p.length > 200);
  en = en.replace(firstPara, firstPara.replace(/\. /, ' — and more. ') + ' A recent study found most operators overspend. Smart meters cut bills by 23% on average. Sign in at [the Accez portal](https://portal.accez.cloud) to start. Accez lets owners e-sign leases in minutes. Read [here](/blog/utility-and-bill-management-across-a-rental-portfolio/) and [this guide](/blog/no-such-post/).\n\n<div>Tip</div>\n\n```js\nx()\n```\n\nmetaDescription: "x"');
  en = en.replace('- **Reservations and Channel Sync:**', '- **WhatsApp integration**: message guests.\n- **Channel sync across 400+ booking channels**: one calendar.\n- **Reservations and Channel Sync:**');
  en = en.replace('## Key Takeaways', '## Conclusion\n\nEfficiency pays, between 3–5 days.\n\n## Key Takeaways');
  en = en.replace(/^title: .*$/m, 'title: "Sustainability - Cutting Costs While Going Green"').replace(/^metaTitle: .*$/m, 'metaTitle: "Sustainability and Energy Efficiency for Saudi Property Managers in 2026 and Beyond"');
  let ar = S.ar;
  const firstAr = ar.split('\n\n').find(p => /^[ء-ي]/.test(p) && p.length > 200);
  ar = ar.replace(firstAr, firstAr + ' ويتيح أكسيز التوقيع الإلكتروني لعقود الإيجار. وتشير دراسة حديثة إلى أن 40٪ من الملاك يتأخرون.');
  ar = ar.replace('## أبرز النقاط', '*This article is general information for property operators and is not legal, tax, or financial advice.*\n\n## أبرز النقاط');
  return { en, ar };
})();
const worst = run(allAtOnce);
const wf2 = worst.pushed ? worst.pushed.fileContent : '';
const [wEn, wAr] = wf2.split('<!-- AR -->');
const wPost = wf2 && siteParse(worst.pushed.filePath, wf2).post;
ok(worst.pushed && worst.prompts.length === 1 && worst.gate.qualityPassed, 'a draft with 20 fixable problems at once is published on the first attempt (' + (worst.gate.autoFixes || []).length + ' fixes) ' + (worst.gate.qualityPassed ? '' : worst.gate.qualityReport));
ok(wf2 && !/[—–]|portal\.accez|e-sign|23%|recent study|WhatsApp integration|400|<div|```|^metaDescription: "x"|no-such-post|\[here\]|## Conclusion|التوقيع الإلكتروني|40٪|دراسة حديثة/m.test(wf2.split('\n---\n').slice(1).join('\n---\n')), 'none of the problems survives in the published text');
ok(wPost && wPost.title === 'Sustainability: Cutting Costs While Going Green' && wPost.metaTitle.length <= 60 && !/\s(?:and|the|in|for|of)$/i.test(wPost.metaTitle), 'title dash became a colon; long search title cut on a whole word: "' + (wPost && wPost.metaTitle) + '"');
ok(wEn && /between 3 to 5 days/.test(wEn) && /Airbnb, Booking\.com and Expedia/.test(wEn), 'number range "3–5" became "3 to 5"; "400+ channels" became the three real channels');
ok(wEn && /Read here and this guide\./.test(wEn) && !/\[here\]|no-such-post/.test(wEn), 'vague and broken links keep their words but lose the link');
ok(wAr && /ليست استشارة قانونية/.test(wAr) && lastOf(wAr).includes('](/ar/solutions/property-managers/)') && lastOf(wEn).includes('](/solutions/property-managers/)'), 'Arabic disclaimer in Arabic; both halves still end with the solution link');
const kept = run({ en: S.en.replace('## Frequently Asked Questions', 'GASTAT reports that 54% of households rent, see the [GASTAT housing statistics](https://www.stats.gov.sa/en/) for details.\n\n## Frequently Asked Questions') });
ok(kept.pushed && /54%/.test(kept.pushed.fileContent), 'a statistic WITH its official source linked in the same paragraph is kept');
const urlDash = run({ en: S.en.replace('## Frequently Asked Questions', 'See the [Ejar platform](https://ejar.sa/en/some-page-name) for the steps.\n\n## Frequently Asked Questions') });
ok(urlDash.pushed && /https:\/\/ejar\.sa\/en\/some-page-name/.test(urlDash.pushed.fileContent), 'hyphens inside link addresses are never touched');
const faqStat = run({ en: S.en.replace(/(## Frequently Asked Questions\n\n### [^\n]+\n\n)[^\n]+/, '$1Most owners see a 40% drop in vacancies.') });
ok(faqStat.pushed && faqStat.prompts.length === 1 && !/40% drop/.test(faqStat.pushed.fileContent), 'a FAQ answer that is only a statistic: answer and question removed, post still published');
const quoteBullets = run({ en: S.en.replace('## Frequently Asked Questions', '> - Price against real competitors, not against every listing.\n> - Review the set every quarter.\n\n## Frequently Asked Questions') });
ok(quoteBullets.pushed && quoteBullets.prompts.length === 1 && /> - Price against real competitors/.test(quoteBullets.pushed.fileContent), 'bullets inside a quote ("> - item") are not treated as dashes');
const arDiff = run({ ar: S.ar.replace('## الأسئلة الشائعة', '### تعامل مع الضائقة الحقيقية بشكل مختلف\n\nإذا مر المستأجر بظرف حقيقي فاتفق معه على جدول سداد مكتوب.\n\n## الأسئلة الشائعة') });
ok(arDiff.pushed && arDiff.prompts.length === 1, 'an Arabic heading that simply says "differently" is not a template heading');
const inOnePlace = run({ en: S.en.replace(/^(## [^\n]*Accez[^\n]*\n\n)/m, '$1Accez keeps reservations, leases and owner payouts all in one place.\n\n') });
ok(inOnePlace.pushed && /all in one place/.test(inOnePlace.pushed.fileContent), '"all in one place" in the Accez section is kept (only "all-in-one platform" is a claim)');
const vat = run({ en: S.en.replace('## Frequently Asked Questions', 'Add 15% VAT to commercial rent where it applies, and remember that property sales pay the 5% real estate transactions tax instead.\n\n## Frequently Asked Questions') });
ok(vat.pushed && /15% VAT/.test(vat.pushed.fileContent) && /5% real estate transactions tax/.test(vat.pushed.fileContent), 'official Saudi tax rates (VAT 15%, real estate transactions tax 5%) are kept');
const arabicTopic = run({ topic: 'كيف توثق عقد الإيجار في منصة إيجار', rows: [{ json: { row_number: 2, Topic: 'كيف توثق عقد الإيجار في منصة إيجار', Status: 'pending', 'Date Used': '' } }] });
ok(arabicTopic.pushed && /^content\/blog\/sustainability-and-energy-efficiency-cutting-costs\.md$/.test(arabicTopic.pushed.filePath), 'a topic written in Arabic: the address comes from the English title (' + (arabicTopic.pushed && arabicTopic.pushed.filePath) + ')');
const noFields = run({ en: S.en.replace(/^primaryKeyword: .*\n/m, '').replace(/^tags: .*\n/m, '').replace(/^metaDescription: .*$/m, 'metaDescription: "Too short."').replace(/^excerpt: .*$/m, 'excerpt: "Short."') });
const nf = noFields.pushed && siteParse(noFields.pushed.filePath, noFields.pushed.fileContent).post;
ok(nf && noFields.prompts.length === 1 && nf.primaryKeyword && nf.tags.length > 0 && nf.metaDescription.length >= 100 && nf.metaDescription.length <= 160, 'missing keyword and tags, too short description: filled from the title and the opening paragraph, no rewrite');
const longTitle = run({ en: S.en.replace(/^title: .*$/m, 'title: "' + 'Sustainability and Energy Efficiency for Property Managers Who Want to Cut Costs While Going Green Across Every Building They Run"') });
const lt = longTitle.pushed && siteParse(longTitle.pushed.filePath, longTitle.pushed.fileContent).post;
ok(lt && lt.title.length <= 110 && lt.metaTitle.length <= 60 && longTitle.prompts.length === 1, 'title over 110 characters: cut on a whole word, no rewrite');
const arOnly = run({ answers: [{ en: S.en, ar: S.arDoc('') }, { en: 'NOT USED', ar: S.ar }] });
ok(arOnly.pushed && arOnly.prompts.length === 1 && arOnly.promptsAr.length === 2 && /THE PREVIOUS VERSION WAS REJECTED/.test(arOnly.promptsAr[1]), 'only the Arabic half is broken: only the Arabic step is asked again (1 call, not 2), then published');
for (const [h, want] of [
  ["Navigating Saudi Arabia's Property Landscape", '## The Property Market in Saudi Arabia'],
  ['Navigating the Saudi STR Licensing Landscape: Vision 2030 and Beyond', '## STR Licensing in Saudi Arabia: Vision 2030 and Beyond'],
  ['Navigating the Saudi Arabian Vacation Rental Landscape with Precision', '## The Vacation Rental Market in Saudi Arabia'],
  ['What High Performers Do Differently', '## How High Performers Work'],
  ["Navigating Saudi Arabia's Digital Property Landscape Securely", '## The Digital Property Market in Saudi Arabia'],
  ["Navigating Saudi Arabia's Property Landscape with Accez.Cloud", '## The Property Market in Saudi Arabia'],
  ['Navigating the New Landscape of Tenant Data Protection', '## Tenant Data Protection Today'],
  ["Navigating Saudi Arabia's Dynamic Property Landscape", '## The Property Market in Saudi Arabia'],
  ['Saudi Arabia: Navigating a Unique Market Landscape', '## Saudi Arabia: How the Market Works'],
  ["Navigating Saudi Arabia's Property Operations Landscape with RBAC", '## The Property Operations Market in Saudi Arabia']
]) {
  const x = run({ en: S.en.replace('## Treating Efficiency as an Investment, Not an Expense', '## ' + h) });
  ok(x.pushed && x.prompts.length === 1 && x.pushed.fileContent.includes('\n' + want + '\n'), 'heading "' + h + '" becomes "' + want.slice(3) + '"');
}
const dhawi = run({ ar: S.ar.replace('## التعامل مع الكفاءة كاستثمار لا كنفقة', '## ما يفعله ذوو الأداء العالي بشكل مختلف') });
ok(dhawi.pushed && /\n## ممارسات ذوي الأداء العالي\n/.test(dhawi.pushed.fileContent), 'Arabic template heading becomes "ممارسات ذوي الأداء العالي" (correct grammar)');
const garbage = run({ en: 'Sorry, I cannot help with that.', ar: 'عذرًا.' });
ok(!garbage.pushed && /^skipped: /.test(garbage.sheet.Status) && garbage.prompts.length >= 3, 'Gemini returns a refusal or garbage: asked again, then skipped; no red run');
const allSkipped = run({ en: badEm.en, ar: badEm.ar });
ok(!allSkipped.pushed && allSkipped.output.status === 'Nothing left to write' && allSkipped.sheetUpdates.every(u => /^skipped: /.test(u.Status)), 'every pending topic fails: each is skipped and the run ends quietly (no red run)');

await server.close();
console.log('\n' + count + ' checks, ' + (failures ? failures + ' FAILED' : 'ALL PASSED'));
process.exit(failures ? 1 : 0);
