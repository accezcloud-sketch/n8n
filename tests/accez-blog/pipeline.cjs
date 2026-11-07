// Walks the workflow with fake service responses, following the workflow's own
// connections and running its own Code nodes and expressions. No network:
// Gemini, GitHub, Sheets, Unsplash, Facebook and IndexNow are all mocked here.
const fs = require('fs');
const path = require('path');
const { runCode, evalExpr, loadWorkflow } = require('./harness.cjs');

// The website repo (only its parser is used, by test.mjs). Override with ACCEZ_SITE.
const REPO = process.env.ACCEZ_SITE || '/Users/ali/Desktop/AccezWebsite';
// What "List Existing Blog Posts" returns: the posts on the site (fixture copy).
const FIXTURE_SLUGS = fs.readFileSync(path.join(__dirname, 'fixtures/existing-slugs.txt'), 'utf8').trim().split('\n');
// The sample post (fixtures/sample-post.md) is the one being written, so by default
// the mocked listing is the site WITHOUT it (otherwise it is, rightly, a duplicate).
const SAMPLE_SLUG = 'sustainability-and-energy-efficiency-cutting-costs-while-going-green';
const OTHER_SLUGS = FIXTURE_SLUGS.filter(s => s !== SAMPLE_SLUG);

function next(wf, from, outputIndex = 0) {
  const c = wf.connections[from];
  const list = (c && c.main && c.main[outputIndex]) || [];
  return list.map(x => x.node);
}
function expectNext(wf, from, to, outputIndex = 0) {
  const got = next(wf, from, outputIndex);
  if (got.length !== 1 || got[0] !== to) throw new Error('"' + from + '" output ' + outputIndex + ' should lead to "' + to + '", got ' + JSON.stringify(got));
}
// The IF node's single boolean condition, evaluated like n8n (strict boolean "is true").
function ifOutput(node, json, nodes) {
  const cond = node.parameters.conditions.conditions[0];
  const v = evalExpr(cond.leftValue, { json, nodes });
  if (typeof v !== 'boolean') throw new Error(node.name + ': condition is not a boolean (strict type validation would fail): ' + v);
  return v ? 0 : 1;
}
const setOutput = (node, json, nodes) => Object.fromEntries(node.parameters.assignments.assignments.map(a => [a.name, evalExpr(a.value, { json, nodes })]));

/**
 * opts: topic, en, ar (the first pair of Gemini answers), answers (optional list of
 *       {en, ar} pairs used in order for every writing attempt, the last one repeats),
 *       unsplash, fallbackUnsplash, usedCovers,
 *       rows (sheet rows; default: one used row, the topic pending, one later pending),
 *       githubList ('ok' | 'error' | array of slugs), imageStep ('ok' | 'downloadError' | 'pushError'),
 *       pushError, facebookError, indexNowError
 * The run follows the workflow's loops: a failed Quality Gate goes to "Decide Retry"
 * (rewrite, then skip), and a skipped or duplicate topic goes back to the sheet for
 * the next pending topic, exactly as the connections say.
 */
function runPipeline(workflowFile, opts) {
  const { wf, node, code } = loadWorkflow(workflowFile);
  const nodes = {};
  const trace = [];
  const geminiCalls = [];
  const runs = {};
  const set = (name, items) => { nodes[name] = items; trace.push(name); runs[name] = (runs[name] || 0) + 1; return items; };
  const exec = (name, input) => set(name, runCode(code(name), { input, nodes, runIndex: runs[name] || 0 }));
  const result = { trace, nodes, geminiCalls, gate: null, pushed: null, sheet: null, sheetUpdates: [], output: null, prompts: [], promptsAr: [], topicsTried: [] };
  const rows = (opts.rows || [
    { json: { row_number: 2, Topic: 'An Older Topic', Status: 'used', 'Date Used': '2026-10-26' } },
    { json: { row_number: 3, Topic: opts.topic, Status: 'pending', 'Date Used': '' } },
    { json: { row_number: 4, Topic: 'A Later Topic', Status: 'pending', 'Date Used': '' } }
  ]).map(r => ({ json: { ...r.json } }));
  const answers = opts.answers || [{ en: opts.en, ar: opts.ar }];
  let answerIndex = 0;
  const nextAnswer = () => answers[Math.min(answerIndex++, answers.length - 1)];
  const applySheet = upd => {
    result.sheetUpdates.push(upd);
    const row = rows.find(r => r.json.Topic === upd.Topic);
    if (row) { row.json.Status = upd.Status; row.json['Date Used'] = upd['Date Used']; }
  };
  const finish = () => {
    result.sheet = result.sheetUpdates.find(u => u.Topic === opts.topic) || result.sheetUpdates[result.sheetUpdates.length - 1] || null;
    return result;
  };

  const trigger = wf.nodes.find(n => n.type === 'n8n-nodes-base.scheduleTrigger');
  expectNext(wf, trigger.name, 'Read Topics from Google Sheets');
  for (let pass = 0; pass < 10; pass++) {
    set('Read Topics from Google Sheets', rows.map(r => ({ json: { ...r.json } })));
    expectNext(wf, 'Read Topics from Google Sheets', 'Find First Pending Topic');
    const found = exec('Find First Pending Topic', nodes['Read Topics from Google Sheets']);
    if (found.length === 0) { result.output = result.output || { status: 'Nothing left to write' }; return finish(); }
    result.topicsTried.push(found[0].json.topic);

    // ---- existing posts + duplicate check ----
    expectNext(wf, 'Find First Pending Topic', 'List Existing Blog Posts');
    const slugs = Array.isArray(opts.githubList) ? opts.githubList : OTHER_SLUGS;
    // On failure the GitHub node (continueRegularOutput) outputs { error: '<message>' }.
    const listItems = opts.githubList === 'error'
      ? [{ json: { error: 'Bad credentials' } }]
      : slugs.map(s => ({ json: { name: s + '.md', path: 'content/blog/' + s + '.md', type: 'file' } }));
    set('List Existing Blog Posts', listItems);
    expectNext(wf, 'List Existing Blog Posts', 'Collect Existing Posts');
    exec('Collect Existing Posts', listItems);
    const plan = nodes['Collect Existing Posts'][0].json;
    if (!result.plan) result.plan = plan;
    expectNext(wf, 'Collect Existing Posts', 'If Duplicate Topic');
    const dupOut = ifOutput(node('If Duplicate Topic'), plan, nodes);
    set('If Duplicate Topic', nodes['Collect Existing Posts']);
    if (dupOut === 0) {
      expectNext(wf, 'If Duplicate Topic', 'Prepare Duplicate Sheet Update', 0);
      exec('Prepare Duplicate Sheet Update', nodes['Collect Existing Posts']);
      applySheet(nodes['Prepare Duplicate Sheet Update'][0].json);
      expectNext(wf, 'Prepare Duplicate Sheet Update', 'Mark Topic as Duplicate in Sheet');
      set('Mark Topic as Duplicate in Sheet', nodes['Prepare Duplicate Sheet Update']);
      expectNext(wf, 'Mark Topic as Duplicate in Sheet', 'Read Topics from Google Sheets');
      continue;
    }
    expectNext(wf, 'If Duplicate Topic', 'Generate English Post with Gemini', 1);

    // ---- write, check, and rewrite until it passes or is skipped ----
    let writeInput = plan;
    let skipped = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const answer = nextAnswer();
      const llmEn = node('Generate English Post with Gemini');
      const promptEn = evalExpr(llmEn.parameters.text, { json: writeInput, nodes });
      geminiCalls.push({ node: llmEn.name, prompt: promptEn });
      result.prompts.push(promptEn);
      if (!result.prompt) result.prompt = promptEn;
      set(llmEn.name, [{ json: { text: answer.en } }]);
      expectNext(wf, llmEn.name, 'Check English Draft');
      exec('Check English Draft', nodes[llmEn.name]);

      expectNext(wf, 'Check English Draft', 'Generate Arabic Post with Gemini');
      const llmAr = node('Generate Arabic Post with Gemini');
      const promptAr = evalExpr(llmAr.parameters.text, { json: nodes['Check English Draft'][0].json, nodes });
      geminiCalls.push({ node: llmAr.name, prompt: promptAr });
      result.promptsAr.push(promptAr);
      if (!result.promptAr) result.promptAr = promptAr;
      set(llmAr.name, [{ json: { text: answer.ar } }]);
      expectNext(wf, llmAr.name, 'Combine English and Arabic');
      exec('Combine English and Arabic', nodes[llmAr.name]);
      result.combined = nodes['Combine English and Arabic'][0].json;

      // ---- covers already used on the site (/blog/covers.json; on failure the HTTP node outputs { error }) ----
      expectNext(wf, 'Combine English and Arabic', 'Read Used Cover Photos');
      set('Read Used Cover Photos', [{ json: opts.usedCovers === 'error' ? { error: { message: '404' } } : (opts.usedCovers || { ids: [] }) }]);
      result.usedCoversUrl = node('Read Used Cover Photos').parameters.url;

      // ---- Unsplash search + "Has Unsplash Results?" ----
      expectNext(wf, 'Read Used Cover Photos', 'Search Unsplash');
      result.searchQuery = evalExpr(node('Search Unsplash').parameters.queryParameters.parameters[0].value, { nodes });
      set('Search Unsplash', [{ json: opts.unsplash || { results: [] } }]);
      const hasRes = node('Has Unsplash Results?').parameters.conditions.conditions[0];
      const count = evalExpr(hasRes.leftValue, { json: nodes['Search Unsplash'][0].json, nodes });
      if (typeof count !== 'number') throw new Error('Has Unsplash Results? left value is not a number: ' + count);
      let unsplashOut;
      if (count === 0) {
        evalExpr(node('Search Unsplash Fallback').parameters.queryParameters.parameters[0].value, { nodes });
        unsplashOut = set('Search Unsplash Fallback', [{ json: opts.fallbackUnsplash || { results: [] } }]);
      } else unsplashOut = nodes['Search Unsplash'];

      exec('Process Unsplash Result', unsplashOut);
      expectNext(wf, 'Process Unsplash Result', 'Quality Gate');
      exec('Quality Gate', nodes['Process Unsplash Result']);
      const gate = nodes['Quality Gate'][0].json;
      result.gate = gate;
      expectNext(wf, 'Quality Gate', 'If Quality Passed');
      if (ifOutput(node('If Quality Passed'), gate, nodes) === 0) break;

      // ---- failed: rewrite or skip ----
      expectNext(wf, 'If Quality Passed', 'Decide Retry', 1);
      exec('Decide Retry', [{ json: gate }]);
      const decision = nodes['Decide Retry'][0].json;
      expectNext(wf, 'Decide Retry', 'Retry Writing?');
      const retryOut = ifOutput(node('Retry Writing?'), decision, nodes);
      // An IF node's true output (what $('Retry Writing?').first(0) reads): the item, or nothing.
      set('Retry Writing?', retryOut === 0 ? [{ json: decision }] : []);
      if (retryOut === 0) {
        expectNext(wf, 'Retry Writing?', 'Generate English Post with Gemini', 0);
        writeInput = decision;
        continue;
      }
      expectNext(wf, 'Retry Writing?', 'Prepare Skipped Sheet Update', 1);
      exec('Prepare Skipped Sheet Update', []);
      applySheet(nodes['Prepare Skipped Sheet Update'][0].json);
      expectNext(wf, 'Prepare Skipped Sheet Update', 'Mark Topic as Skipped in Sheet');
      set('Mark Topic as Skipped in Sheet', nodes['Prepare Skipped Sheet Update']);
      expectNext(wf, 'Mark Topic as Skipped in Sheet', 'Read Topics from Google Sheets');
      skipped = true;
      break;
    }
    if (skipped) continue;
    const gate = result.gate;
    expectNext(wf, 'If Quality Passed', 'If Has Image', 0);

    let toPush; // the item arriving at "Push Blog Post to GitHub"
    if (gate.hasImage) {
      const dl = node('Download Unsplash Image');
      evalExpr(dl.parameters.url, { json: gate, nodes });
      if (opts.imageStep === 'downloadError') {
        set('Download Unsplash Image', [{ json: { error: { message: 'timeout' } } }]);
        const [fallback] = next(wf, 'Download Unsplash Image', 1);
        toPush = exec(fallback, nodes['Download Unsplash Image'])[0];
        result.imageError = toPush.json.imageError;
      } else {
        set('Download Unsplash Image', [{ json: gate, binary: { data: {} } }]);
        if (next(wf, 'Download Unsplash Image', 0).includes('Track Unsplash Download')) {
          result.trackUrl = evalExpr(node('Track Unsplash Download').parameters.url, { json: gate, nodes });
        }
        const img = node('Push Image to GitHub');
        result.imagePath = evalExpr(img.parameters.filePath, { json: gate, nodes });
        evalExpr(img.parameters.commitMessage, { json: gate, nodes });
        if (opts.imageStep === 'pushError') {
          // The GitHub node's continue-on-fail item: { error: '<message>' }
          set('Push Image to GitHub', [{ json: { error: 'sha missing' } }]);
          const [fallback] = next(wf, 'Push Image to GitHub', 1);
          toPush = exec(fallback, nodes['Push Image to GitHub'])[0];
          result.imageError = toPush.json.imageError;
        } else {
          toPush = set('Push Image to GitHub', [{ json: { content: { path: result.imagePath }, commit: { sha: 'abc' } } }])[0];
        }
      }
    } else {
      toPush = { json: gate };
    }

    const push = node('Push Blog Post to GitHub');
    result.pushed = {
      filePath: evalExpr(push.parameters.filePath, { json: toPush.json, nodes }),
      fileContent: evalExpr(push.parameters.fileContent, { json: toPush.json, nodes }),
      commitMessage: evalExpr(push.parameters.commitMessage, { json: toPush.json, nodes })
    };
    if (opts.pushError) {
      set('Push Blog Post to GitHub', [{ json: { error: 'file already exists' } }]);
      expectNext(wf, 'Push Blog Post to GitHub', 'GitHub Push Failed', 1);
      const failed = node('GitHub Push Failed');
      const failedJson = setOutput(failed, nodes['Push Blog Post to GitHub'][0].json, nodes);
      set(failed.name, [{ json: failedJson }]);
      expectNext(wf, failed.name, 'Fail Run on GitHub Error');
      const stop = node('Fail Run on GitHub Error');
      result.stopError = { type: stop.type, message: evalExpr(stop.parameters.errorMessage, { json: failedJson, nodes }), failedJson };
      return finish();
    }
    set('Push Blog Post to GitHub', [{ json: { content: { path: result.pushed.filePath } } }]);

    // ---- sheet first, then wait for the deploy, then IndexNow and Facebook ----
    expectNext(wf, 'Push Blog Post to GitHub', 'Prepare Sheet Update', 0);
    exec('Prepare Sheet Update', nodes['Push Blog Post to GitHub']);
    applySheet(nodes['Prepare Sheet Update'][0].json);
    expectNext(wf, 'Prepare Sheet Update', 'Mark Topic as Used in Sheet');
    set('Mark Topic as Used in Sheet', nodes['Prepare Sheet Update']);
    expectNext(wf, 'Mark Topic as Used in Sheet', 'Wait for Site Deploy');
    set('Wait for Site Deploy', nodes['Mark Topic as Used in Sheet']); // a Wait node passes its input on
    expectNext(wf, 'Wait for Site Deploy', 'Notify IndexNow');
    const ix = node('Notify IndexNow');
    const ixBody = evalExpr(ix.parameters.jsonBody, { json: nodes['Wait for Site Deploy'][0].json, nodes });
    result.indexNow = { method: ix.parameters.method, url: ix.parameters.url, body: typeof ixBody === 'string' ? JSON.parse(ixBody) : ixBody };
    set('Notify IndexNow', [{ json: opts.indexNowError ? { error: { message: '403 - Key not valid' } } : {} }]);
    expectNext(wf, 'Notify IndexNow', 'Build Facebook Message');
    const fb = node('Build Facebook Message');
    result.facebookMessage = evalExpr(fb.parameters.assignments.assignments[0].value, { json: {}, nodes });
    set('Build Facebook Message', [{ json: { facebookMessage: result.facebookMessage } }]);
    expectNext(wf, 'Build Facebook Message', 'Post Blog to Facebook Page');
    set('Post Blog to Facebook Page', [{ json: opts.facebookError ? { error: { message: 'token expired' } } : { id: '1_2' } }]);
    expectNext(wf, 'Post Blog to Facebook Page', 'Output Success');
    result.output = setOutput(node('Output Success'), {}, nodes);
    return finish();
  }
  throw new Error('run did not end after 10 passes');
}

module.exports = { runPipeline, REPO, FIXTURE_SLUGS, OTHER_SLUGS, SAMPLE_SLUG };
