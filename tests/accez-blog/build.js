// Builds the Accez n8n workflow from the original export plus the sources in code/.
// Usage: node build.js <original.json> <out.json>
//   node build.js accez-blog-auto-deploy.before.json ../../workflows/accez-blog-auto-deploy.json
// Credentials blocks and credential ids are copied from the original, never written here.
const fs = require('fs');
const path = require('path');
const [, , inFile, outFile] = process.argv;
const CODE = path.join(__dirname, 'code');
const code = f => fs.readFileSync(path.join(CODE, f), 'utf8');
const prompt = f => code(f).replace(/\n$/, '');
const clone = v => JSON.parse(JSON.stringify(v));

// Public by design (IndexNow checks it at keyLocation), so not a secret.
const INDEXNOW_KEY = '02fc2248f8f1fe4d7046ca50e2e5622e';
const SITE = 'https://www.accez.cloud';

const wf = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const byName = name => {
  const n = wf.nodes.find(x => x.name === name);
  if (!n) throw new Error('node not found: ' + name);
  return n;
};
const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };
// Insert keys right after "position" so the node reads like the others.
function setProps(node, props, removeKeys = []) {
  for (const k of removeKeys) delete node[k];
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k in props) continue;
    out[k] = v;
    if (k === 'position') Object.assign(out, props);
  }
  for (const k of Object.keys(node)) delete node[k];
  Object.assign(node, out);
}
// Rename a node and every $('Old') reference and connection that points at it.
function rename(from, to) {
  byName(from).name = to;
  const quoted = new RegExp("\\$\\('" + from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'\\)", 'g');
  for (const n of wf.nodes) n.parameters = JSON.parse(JSON.stringify(n.parameters).replace(quoted, "$('" + to + "')"));
  if (wf.connections[from]) { wf.connections[to] = wf.connections[from]; delete wf.connections[from]; }
  for (const c of Object.values(wf.connections)) for (const outs of Object.values(c)) for (const list of outs) for (const t of list) if (t.node === from) t.node = to;
}

// ---------- Workflow settings ----------
// The schedule fires in the workflow's own timezone, whatever the server default is.
wf.settings = { ...wf.settings, timezone: 'Asia/Riyadh' };
delete wf.settings.errorWorkflow; // nothing to set up: failed runs show in n8n's Executions list

// ---------- 1. Schedule: Sunday and Wednesday at 09:00, one trigger only ----------
// The old "Schedule Every 2 Days" (every 48 h) trigger was also connected, so the
// workflow could run twice; both shared the node id "schedule-trigger".
wf.nodes = wf.nodes.filter(n => n.name !== 'Schedule Every 2 Days');
delete wf.connections['Schedule Every 2 Days'];
rename('Schedule Every 2 Days at 09:00', 'Schedule Sun and Wed at 09:00');
byName('Schedule Sun and Wed at 09:00').parameters = {
  rule: { interval: [{ field: 'weeks', weeksInterval: 1, triggerAtDay: [0, 3], triggerAtHour: 9, triggerAtMinute: 0 }] }
};

// ---------- 2. Sheet, topic, existing posts, duplicate check ----------
setProps(byName('Read Topics from Google Sheets'), RETRY, ['onError']);
const find = byName('Find First Pending Topic');
find.parameters.jsCode = code('find-pending.js');
delete find.onError; // "No pending topics" must stop the run, not feed an empty topic to Gemini

// ---------- 3. Two Gemini steps: English article, then the Arabic version ----------
rename('Generate Blog Post with Gemini', 'Generate English Post with Gemini');
const llmEn = byName('Generate English Post with Gemini');
llmEn.parameters.text = prompt('prompt-en.txt');
setProps(llmEn, RETRY, ['onError']);
// Same model as the owner's Wady workflow (proven on this Gemini account).
const MODEL = 'models/gemini-2.5-flash-lite';
const modelEn = byName('Google Gemini Chat Model');
modelEn.parameters.modelName = MODEL;

rename('Strip Fences and Base64 Encode', 'Combine English and Arabic');
const combine = byName('Combine English and Arabic');
combine.parameters.jsCode = code('combine.js');
delete combine.onError;

// ---------- 4. Images ----------
setProps(byName('Search Unsplash'), RETRY);
byName('Has Unsplash Results?').parameters.conditions.conditions[0].leftValue = '={{ ($json.results || []).length }}';
setProps(byName('Search Unsplash Fallback'), { ...RETRY, onError: 'continueRegularOutput' });
const proc = byName('Process Unsplash Result');
proc.parameters.jsCode = code('process-unsplash.js');
delete proc.onError;
setProps(byName('Download Unsplash Image'), { ...RETRY, onError: 'continueErrorOutput' });
setProps(byName('Push Image to GitHub'), { ...RETRY, onError: 'continueErrorOutput' });

// ---------- 5. Push, sheet, IndexNow, Facebook ----------
const pushPost = byName('Push Blog Post to GitHub');
pushPost.parameters.filePath = "={{ 'content/blog/' + $('Quality Gate').first().json.topicSlug + '.md' }}";
pushPost.parameters.fileContent = "={{ $json.fileContent || $('Quality Gate').first().json.fileContent }}";
pushPost.parameters.commitMessage = "={{ 'feat: add blog post - ' + $('Quality Gate').first().json.topic }}";
setProps(pushPost, RETRY);
pushPost.notes = 'fileContent comes from "Use Default Cover" when the image step failed, otherwise from "Quality Gate".';

byName('Build Facebook Message').parameters.assignments.assignments[0].value =
  "={{ '📝 New Blog Post: ' + $('Quality Gate').first().json.articleTitle + '\\n\\n' + $('Quality Gate').first().json.excerpt + '\\n\\nRead more: " + SITE + "/blog/' + $('Quality Gate').first().json.topicSlug + '/\\n\\n#AccezCloud #PropTech #RealEstate' }}";
setProps(byName('Post Blog to Facebook Page'), { ...RETRY, onError: 'continueRegularOutput' });

delete byName('Prepare Sheet Update').onError;
setProps(byName('Mark Topic as Used in Sheet'), RETRY, ['onError']);

const success = byName('Output Success').parameters.assignments.assignments;
success.push(
  {
    id: 'field-facebook',
    name: 'facebook',
    value: "={{ $('Post Blog to Facebook Page').first().json.error ? 'Facebook post FAILED: ' + JSON.stringify($('Post Blog to Facebook Page').first().json.error) : 'Facebook post published' }}",
    type: 'string'
  },
  {
    id: 'field-indexnow',
    name: 'indexNow',
    value: "={{ $('Notify IndexNow').first().json.error ? 'IndexNow FAILED (search engines will still find the post through the sitemap): ' + JSON.stringify($('Notify IndexNow').first().json.error) : 'IndexNow notified' }}",
    type: 'string'
  },
  {
    id: 'field-live-urls',
    name: 'liveUrls',
    value: "={{ '" + SITE + "/blog/' + $('Quality Gate').first().json.topicSlug + '/ and " + SITE + "/ar/blog/' + $('Quality Gate').first().json.topicSlug + '/' }}",
    type: 'string'
  }
);

const ghFailed = byName('GitHub Push Failed');
ghFailed.parameters.assignments.assignments[1].value = 'GitHub push failed. Nothing was published and the Google Sheet was NOT updated (the topic stays pending).';
// The GitHub node puts the message in `error` as text.
ghFailed.parameters.assignments.assignments[2].value = "={{ typeof $json.error === 'string' ? $json.error : ($json.error ? ($json.error.message || JSON.stringify($json.error)) : 'Unknown error during GitHub push') }}";

// ---------- New nodes ----------
const ghCreds = pushPost.credentials;
const sheetCreds = byName('Mark Topic as Used in Sheet').credentials;
const geminiCreds = modelEn.credentials;
const markUsed = byName('Mark Topic as Used in Sheet');
const sheetUpdate = () => clone(markUsed.parameters); // same sheet, same row match, same status column
const setNode = (id, name, assignments) => ({
  parameters: { assignments: { assignments }, options: {} },
  id, name, type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [0, 0]
});
const ifTrue = (id, name, left) => ({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{ id, leftValue: left, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      combinator: 'and'
    },
    options: {}
  },
  id: id.replace(/^cond-/, 'if-'), name, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [0, 0]
});
const codeNode = (id, name, file) => ({
  parameters: { jsCode: code(file) }, id, name, type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0]
});

wf.nodes.push(
  {
    parameters: {
      resource: 'file',
      operation: 'list',
      owner: { __rl: true, mode: 'name', value: 'accezcloud-sketch' },
      repository: { __rl: true, mode: 'name', value: 'AccezWebsite' },
      filePath: 'content/blog'
    },
    id: 'list-blog-posts',
    name: 'List Existing Blog Posts',
    type: 'n8n-nodes-base.github',
    typeVersion: 1.1,
    position: [0, 0],
    ...RETRY,
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
    notes: 'Optional: if this fails the post is written without links to other articles and without the duplicate check (GitHub still refuses to overwrite an existing post).',
    credentials: clone(ghCreds)
  },
  codeNode('collect-posts', 'Collect Existing Posts', 'collect-posts.js'),
  ifTrue('cond-is-duplicate', 'If Duplicate Topic', '={{ $json.isDuplicate }}'),
  codeNode('prepare-duplicate', 'Prepare Duplicate Sheet Update', 'prepare-duplicate.js'),
  {
    parameters: sheetUpdate(),
    id: 'update-sheet-duplicate',
    name: 'Mark Topic as Duplicate in Sheet',
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.7,
    position: [0, 0],
    ...RETRY,
    credentials: clone(sheetCreds)
  },
  setNode('duplicate-output', 'Output Duplicate', [
    { id: 'duplicate-status', name: 'status', value: 'Duplicate', type: 'string' },
    { id: 'duplicate-message', name: 'message', value: "={{ 'Nothing was written. The topic \"' + $('Collect Existing Posts').first().json.topic + '\" repeats the existing post /blog/' + $('Collect Existing Posts').first().json.duplicateOf + '/ (' + $('Collect Existing Posts').first().json.duplicateReason + '). The sheet row is marked \"duplicate: ' + $('Collect Existing Posts').first().json.duplicateOf + '\".' }}", type: 'string' }
  ]),
  codeNode('check-english', 'Check English Draft', 'check-english.js'),
  {
    parameters: { promptType: 'define', text: prompt('prompt-ar.txt'), batching: {} },
    id: 'llm-chain-ar',
    name: 'Generate Arabic Post with Gemini',
    type: llmEn.type,
    typeVersion: llmEn.typeVersion,
    position: [0, 0],
    ...RETRY
  },
  {
    parameters: { modelName: MODEL, options: {} },
    id: 'gemini-model-ar',
    name: 'Google Gemini Chat Model (Arabic)',
    type: modelEn.type,
    typeVersion: modelEn.typeVersion,
    position: [0, 0],
    credentials: clone(geminiCreds)
  },
  codeNode('quality-gate', 'Quality Gate', 'quality-gate.js'),
  ifTrue('cond-quality-passed', 'If Quality Passed', '={{ $json.qualityPassed }}'),
  codeNode('use-default-cover', 'Use Default Cover', 'use-default-cover.js'),
  {
    parameters: {
      errorMessage: "={{ 'GitHub push failed for \"' + $('Quality Gate').first().json.topic + '\": ' + $json.error }}"
    },
    id: 'stop-github-failed',
    name: 'Fail Run on GitHub Error',
    type: 'n8n-nodes-base.stopAndError',
    typeVersion: 1,
    position: [0, 0]
  },
  codeNode('prepare-review', 'Prepare Review Sheet Update', 'prepare-review.js'),
  {
    parameters: sheetUpdate(),
    id: 'update-sheet-review',
    name: 'Mark Topic as Needs Review in Sheet',
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.7,
    position: [0, 0],
    ...RETRY,
    credentials: clone(sheetCreds)
  },
  setNode('review-output', 'Output Needs Review', [
    { id: 'review-status', name: 'status', value: 'Needs review', type: 'string' },
    { id: 'review-message', name: 'message', value: "={{ 'Post NOT published. The sheet row is marked \"needs review\". Set it back to \"pending\" to try this topic again. Topic: ' + $('Quality Gate').first().json.topic }}", type: 'string' },
    { id: 'review-reasons', name: 'reasons', value: "={{ $('Quality Gate').first().json.qualityReport }}", type: 'string' },
    { id: 'review-draft', name: 'draft', value: "={{ $('Quality Gate').first().json.fileContent }}", type: 'string' }
  ]),
  {
    parameters: { resume: 'timeInterval', amount: 5, unit: 'minutes' },
    id: 'wait-site-deploy',
    name: 'Wait for Site Deploy',
    type: 'n8n-nodes-base.wait',
    typeVersion: 1.1,
    position: [0, 0],
    webhookId: 'd1f0c6a2-8b4e-4c39-9f57-2a6e1b3c7d40',
    notes: 'The site rebuilds after the push; search engines and Facebook should only see the post once it is live.'
  },
  {
    parameters: {
      method: 'POST',
      url: 'https://api.indexnow.org/indexnow',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: "={{ JSON.stringify({ host: 'www.accez.cloud', key: '" + INDEXNOW_KEY + "', keyLocation: '" + SITE + '/' + INDEXNOW_KEY + ".txt', urlList: ['" + SITE + "/blog/' + $('Quality Gate').first().json.topicSlug + '/', '" + SITE + "/ar/blog/' + $('Quality Gate').first().json.topicSlug + '/'] }) }}",
      options: {}
    },
    id: 'indexnow-ping',
    name: 'Notify IndexNow',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [0, 0],
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 5000,
    onError: 'continueRegularOutput',
    notes: 'Tells Bing and other IndexNow engines about the new EN and AR URLs. Optional: a failure is reported in Output Success and never stops the run.'
  }
);

// ---------- Connections ----------
const link = (from, to, outputIndex = 0) => {
  const c = (wf.connections[from] = wf.connections[from] || { main: [] });
  while (c.main.length <= outputIndex) c.main.push([]);
  c.main[outputIndex].push({ node: to, type: 'main', index: 0 });
};
const relink = (from, outputs) => { wf.connections[from] = { main: outputs.map(list => list.map(to => ({ node: to, type: 'main', index: 0 }))) }; };

relink('Find First Pending Topic', [['List Existing Blog Posts']]);
relink('List Existing Blog Posts', [['Collect Existing Posts']]);
relink('Collect Existing Posts', [['If Duplicate Topic']]);
relink('If Duplicate Topic', [['Prepare Duplicate Sheet Update'], ['Generate English Post with Gemini']]);
relink('Prepare Duplicate Sheet Update', [['Mark Topic as Duplicate in Sheet']]);
relink('Mark Topic as Duplicate in Sheet', [['Output Duplicate']]);
relink('Generate English Post with Gemini', [['Check English Draft']]);
relink('Check English Draft', [['Generate Arabic Post with Gemini']]);
wf.connections['Google Gemini Chat Model (Arabic)'] = { ai_languageModel: [[{ node: 'Generate Arabic Post with Gemini', type: 'ai_languageModel', index: 0 }]] };
relink('Generate Arabic Post with Gemini', [['Combine English and Arabic']]);
relink('Process Unsplash Result', [['Quality Gate']]);
relink('Quality Gate', [['If Quality Passed']]);
relink('If Quality Passed', [['If Has Image'], ['Prepare Review Sheet Update']]);
relink('Download Unsplash Image', [['Push Image to GitHub'], ['Use Default Cover']]);
relink('Push Image to GitHub', [['Push Blog Post to GitHub'], ['Use Default Cover']]);
relink('Use Default Cover', [['Push Blog Post to GitHub']]);
// Success: mark the row used first, wait for the site to rebuild, then tell IndexNow and Facebook.
relink('Push Blog Post to GitHub', [['Prepare Sheet Update'], ['GitHub Push Failed']]);
relink('Prepare Sheet Update', [['Mark Topic as Used in Sheet']]);
relink('Mark Topic as Used in Sheet', [['Wait for Site Deploy']]);
relink('Wait for Site Deploy', [['Notify IndexNow']]);
relink('Notify IndexNow', [['Build Facebook Message']]);
relink('Build Facebook Message', [['Post Blog to Facebook Page']]);
relink('Post Blog to Facebook Page', [['Output Success']]);
relink('GitHub Push Failed', [['Fail Run on GitHub Error']]);
relink('Prepare Review Sheet Update', [['Mark Topic as Needs Review in Sheet']]);
relink('Mark Topic as Needs Review in Sheet', [['Output Needs Review']]);

// ---------- Layout ----------
const LAYOUT = {
  'Schedule Sun and Wed at 09:00': [0, 304],
  'Read Topics from Google Sheets': [260, 304],
  'Find First Pending Topic': [520, 304],
  'List Existing Blog Posts': [780, 304],
  'Collect Existing Posts': [1040, 304],
  'If Duplicate Topic': [1300, 304],
  'Prepare Duplicate Sheet Update': [1560, 840],
  'Mark Topic as Duplicate in Sheet': [1820, 840],
  'Output Duplicate': [2080, 840],
  'Generate English Post with Gemini': [1560, 304],
  'Google Gemini Chat Model': [1560, 528],
  'Check English Draft': [1860, 304],
  'Generate Arabic Post with Gemini': [2120, 304],
  'Google Gemini Chat Model (Arabic)': [2120, 528],
  'Combine English and Arabic': [2420, 304],
  'Search Unsplash': [2680, 304],
  'Has Unsplash Results?': [2940, 304],
  'Search Unsplash Fallback': [3200, 480],
  'Process Unsplash Result': [3460, 304],
  'Quality Gate': [3720, 304],
  'If Quality Passed': [3980, 304],
  'If Has Image': [4240, 304],
  'Download Unsplash Image': [4500, 480],
  'Push Image to GitHub': [4760, 480],
  'Use Default Cover': [5020, 640],
  'Push Blog Post to GitHub': [5280, 304],
  'Prepare Sheet Update': [5540, 304],
  'Mark Topic as Used in Sheet': [5800, 304],
  'Wait for Site Deploy': [6060, 304],
  'Notify IndexNow': [6320, 304],
  'Build Facebook Message': [6580, 304],
  'Post Blog to Facebook Page': [6840, 304],
  'Output Success': [7100, 304],
  'GitHub Push Failed': [5540, 560],
  'Fail Run on GitHub Error': [5800, 560],
  'Prepare Review Sheet Update': [4240, 880],
  'Mark Topic as Needs Review in Sheet': [4500, 880],
  'Output Needs Review': [4760, 880]
};
for (const [name, pos] of Object.entries(LAYOUT)) byName(name).position = pos;

// ---------- Sticky notes ----------
const sticky = (name, position, width, height, content, id) => {
  let n = wf.nodes.find(x => x.name === name);
  if (!n) { // a note this build adds
    n = { parameters: {}, id, name, type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position };
    wf.nodes.push(n);
  }
  n.position = position;
  Object.assign(n.parameters, { content, width, height });
};
sticky('Sticky Note', [-60, 100], 280, 180, '## 1. Schedule\nSunday and Wednesday at 09:00 (Asia/Riyadh, set in the workflow settings). One trigger only.');
sticky('Sticky Note1', [220, 100], 1300, 180, "## 2. Topic, existing posts, duplicate check\nFirst row whose status (column B) is `pending`. Optional `Format` column: how-to, checklist, explainer, comparison or glossary.\nLists `content/blog` on GitHub: Gemini may link only to posts that exist, and a topic that repeats an existing post is NOT written. Its row is marked `duplicate: <existing slug>` (bottom branch).");
sticky('Sticky Note2', [1520, 100], 860, 180, '## 3. Writing (two Gemini calls)\n**English** first (format chosen per topic, confirmed product facts, no unsourced statistics, closing link to the matching solution page), then the **Arabic** version written from it as natural Modern Standard Arabic with the exact headings `## أبرز النقاط` and `## الأسئلة الشائعة`. Model: ' + MODEL + '. 3 tries each.');
sticky('Sticky Note3', [2380, 100], 280, 180, '## 4. Combine\nOne frontmatter + English body + `<!-- AR -->` + Arabic body. Fixes /ar links and the Arabic headings.');
sticky('Sticky Note4', [2660, 100], 1560, 180, '## 5. Cover image + Quality Gate\nUnsplash search by title (fallback: tags); the alt text comes from Unsplash. No result: `/images/blog/pm-default.jpg`.\n**Quality Gate** writes the file and checks it (meta lengths, AR marker, headings, dashes, unsourced figures, unconfirmed Accez features, links, closing line). Any failed check: nothing is pushed and the row is marked `needs review: <reasons>`.');
sticky('Sticky Note5', [4220, 100], 1040, 180, '## 6. Download & push image\nPushes `public/images/blog/<slug>.jpg`. If the download or the push fails, **Use Default Cover** switches the post to the default cover, so it never points at a missing image.');
sticky('Sticky Note6', [5260, 100], 260, 180, '## 7. Push post\nCreates `content/blog/<slug>.md`. On error the run is marked FAILED (red) and the topic stays pending.');
sticky('Sticky Note7', [5520, 100], 1560, 180, "## 8. Sheet, IndexNow, Facebook\nMarks the row `used` with today's date, waits 5 minutes for the site to rebuild, tells IndexNow about the EN and AR URLs, then posts to Facebook. IndexNow and Facebook failures never stop the run; they are reported in **Output Success**.");
sticky('Sticky Note8', [7080, 100], 280, 180, '## 9. Output\nSuccess: URLs, topic, Facebook and IndexNow results.');
sticky('Sticky Note9', [4200, 720], 840, 140, '## Needs review (quality gate failed)\nNothing was pushed. **Output Needs Review** holds the reasons and the full draft. Set the row back to `pending` to try again.', 'sticky-review');
sticky('Sticky Note10', [5520, 720], 540, 160, "## When a run fails\nGemini or GitHub still failing after 3 tries, no pending topic, or a sheet error: the run turns red in n8n's **Executions** list and the topic stays `pending`, so the next scheduled run tries again. Nothing to set up.", 'sticky-error');
sticky('Sticky Note11', [1520, 680], 820, 140, '## Duplicate topic\nNothing was written. The row is marked `duplicate: <existing slug>`. Reword the topic and set it back to `pending` to write it anyway.', 'sticky-duplicate');

// Every node must have a position from the layout above.
for (const n of wf.nodes) if (n.position[0] === 0 && n.position[1] === 0 && !n.type.includes('stickyNote')) throw new Error('no position for ' + n.name);

fs.writeFileSync(outFile, JSON.stringify(wf, null, 2) + '\n');
console.log('written', outFile, wf.nodes.length, 'nodes');
