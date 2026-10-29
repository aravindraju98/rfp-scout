// Runs the PRODUCTION prompt (code/build-prompt.js) and PRODUCTION validator (code/validate.js)
// against labelled cases and reports how often the model is right and how often the
// validator had to step in.
//   $env:ANTHROPIC_API_KEY = "sk-ant-..."; node eval/run-eval.js
const { runNode } = require('../test/harness');
const cases = require('./cases.json');

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('Set ANTHROPIC_API_KEY to run the eval (it makes one API call per case).');
  process.exit(1);
}

async function main() {
  let agree = 0, flagged = 0, quoteTotal = 0, quoteBad = 0, nullFail = 0;

  for (const c of cases) {
    const prompt = runNode('build-prompt.js', { json: { description: c.text }, nodes: { 'Normalize & dedupe': c.opp } }).json;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(prompt.request),
    });
    const body = await res.json();
    const tool = (body.content || []).find((b) => b.type === 'tool_use');

    const row = runNode('validate.js', { json: body, nodes: { 'Build prompt': prompt } }).json;
    const ok = c.expect.includes(row.recommendation);
    if (ok) agree += 1;
    if (row.needs_review) flagged += 1;

    // Raw model behaviour, before validation: how many quotes were fabricated?
    const raw = tool ? tool.input.key_requirements || [] : [];
    const hay = prompt.source_text.toLowerCase().replace(/\s+/g, ' ');
    for (const r of raw) {
      quoteTotal += 1;
      if (!hay.includes(String(r.evidence_quote).toLowerCase().replace(/\s+/g, ' '))) quoteBad += 1;
    }
    if (c.mustBeNull && tool && tool.input[c.mustBeNull] != null) nullFail += 1;

    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(34)} got=${row.recommendation.padEnd(7)} score=${String(row.fit_score).padEnd(4)} flags=[${row.review_reasons}]`);
  }

  console.log('\n' + `recommendation agreement : ${agree}/${cases.length}`);
  console.log(`rows flagged for review  : ${flagged}/${cases.length}`);
  console.log(`fabricated quotes (raw)  : ${quoteBad}/${quoteTotal}`);
  console.log(`invented values for null : ${nullFail}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
