// Minimal stand-in for the n8n runtime: runs Code-node JavaScript and {{ }} expressions
// against fake node outputs. No network, no n8n.
const fs = require('fs');

const NOW = new Date(Date.UTC(2026, 9, 28, 6, 0, 0)); // 2026-10-28 09:00 Asia/Riyadh
const pad = n => String(n).padStart(2, '0');
const $now = {
  toFormat(fmt) {
    const d = new Date(NOW.getTime() + 3 * 3600 * 1000); // Riyadh = UTC+3
    return fmt.replace('yyyy', d.getUTCFullYear()).replace('MM', pad(d.getUTCMonth() + 1)).replace('dd', pad(d.getUTCDate()))
      .replace('HH', pad(d.getUTCHours())).replace('mm', pad(d.getUTCMinutes())).replace('ss', pad(d.getUTCSeconds()));
  }
};
const DateTime = { now: () => $now };

function dollar(nodes) {
  return name => {
    if (!(name in nodes)) throw new Error('Referenced node "' + name + '" has not run');
    const items = nodes[name];
    return { first: () => items[0], last: () => items[items.length - 1], all: () => items, item: items[0], isExecuted: true };
  };
}

/** Runs a Code node ("Run Once for All Items") and returns its output items. */
function runCode(jsCode, { input = [], nodes = {}, runIndex = 0 } = {}) {
  const $input = { all: () => input, first: () => input[0], last: () => input[input.length - 1], item: input[0] };
  // Like n8n, the node's code runs in its own function scope (it may redeclare `items`).
  // $runIndex: how many times this node already ran in this execution (loops).
  const fn = new Function('$input', '$', '$now', 'DateTime', 'items', '$runIndex', 'return (function () {\n' + jsCode + '\n})();');
  const out = fn($input, dollar(nodes), $now, DateTime, input, runIndex);
  if (!Array.isArray(out)) throw new Error('Code node must return an array');
  for (const item of out) if (!item || typeof item.json !== 'object') throw new Error('Code node item without json');
  return out;
}

/** Evaluates an n8n parameter value ("={{ ... }}" or plain). */
function evalExpr(value, { json = {}, nodes = {} } = {}) {
  if (typeof value !== 'string' || !value.startsWith('=')) return value;
  const tpl = value.slice(1);
  const $ = dollar(nodes);
  const parts = [];
  let last = 0;
  const re = /\{\{([\s\S]*?)\}\}/g;
  let m;
  while ((m = re.exec(tpl))) {
    parts.push(tpl.slice(last, m.index));
    const v = new Function('$json', '$', '$now', 'return (' + m[1] + ');')(json, $, $now);
    parts.push(typeof v === 'object' ? JSON.stringify(v) : String(v));
    last = re.lastIndex;
  }
  parts.push(tpl.slice(last));
  // A value that is only one expression keeps its type, like n8n.
  if (/^\{\{[\s\S]*\}\}$/.test(tpl.trim()) && (tpl.match(/\{\{/g) || []).length === 1) {
    const inner = tpl.trim().slice(2, -2);
    return new Function('$json', '$', '$now', 'return (' + inner + ');')(json, $, $now);
  }
  return parts.join('');
}

function loadWorkflow(file) {
  const wf = JSON.parse(fs.readFileSync(file, 'utf8'));
  const node = name => {
    const n = wf.nodes.find(x => x.name === name);
    if (!n) throw new Error('no node ' + name);
    return n;
  };
  return { wf, node, code: name => node(name).parameters.jsCode };
}

module.exports = { runCode, evalExpr, loadWorkflow, $now };
