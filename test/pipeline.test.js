// Run: node test/pipeline.test.js   (no network, no API keys)
const assert = require('assert');
const { runNode } = require('./harness');

const future = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
const past = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);

const notice = (id, extra = {}) => ({
  noticeId: id, title: `Notice ${id}`, solicitationNumber: `SOL-${id}`, fullParentPathName: 'DEPT OF VETERANS AFFAIRS.VA OFFICE',
  postedDate: '2026-10-27', type: 'Solicitation', active: 'Yes', responseDeadLine: `${future}T17:00:00-04:00`,
  naicsCode: '541511', typeOfSetAsideDescription: '', uiLink: `https://sam.gov/opp/${id}`,
  description: `https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=${id}`,
  placeOfPerformance: { city: { name: 'Washington' }, state: { code: 'DC' } }, ...extra,
});

// ---- build-query -----------------------------------------------------------
const queries = runNode('build-query.js');
assert.strictEqual(queries.length, 4);
assert.match(queries[0].json.postedFrom, /^\d{2}\/\d{2}\/\d{4}$/);

// ---- normalize & dedupe ----------------------------------------------------
const store = { analyzedNoticeIds: ['seen-1'] };
let out = runNode('normalize.js', {
  staticData: store,
  items: [
    { opportunitiesData: [notice('a'), notice('b', { type: 'Award Notice' }), notice('seen-1'), notice('exp', { responseDeadLine: `${past}T10:00:00-04:00` }), notice('off', { active: 'No' })] },
    { opportunitiesData: [notice('a'), notice('c', { responseDeadLine: null })] }, // overlap between NAICS searches
    { error: { message: 'HTTP 429' } }, // a failed search must not break the run
  ],
});
assert.deepStrictEqual(out.map((o) => o.json.noticeId).sort(), ['a', 'c']);
assert.strictEqual(out.find((o) => o.json.noticeId === 'a').json.agency, 'DEPT OF VETERANS AFFAIRS > VA OFFICE');
assert.deepStrictEqual(store.analyzedNoticeIds, ['seen-1'], 'normalize must not mark anything seen');

const many = Array.from({ length: 40 }, (_, i) => notice(`n${i}`));
assert.strictEqual(runNode('normalize.js', { items: [{ opportunitiesData: many }] }).length, 25, 'capped per run');

// ---- build-prompt ----------------------------------------------------------
const opp = runNode('normalize.js', { items: [{ opportunitiesData: [notice('a')] }] })[0].json;
const DOC = '<p>The Department of Veterans Affairs seeks a contractor to modernize the <b>Benefits Intake Portal</b>.</p><script>x()</script><p>Offerors must provide a cloud-native web application with &quot;WCAG 2.1 AA&quot; accessibility. ' + 'Padding sentence. '.repeat(30) + '</p>';
const prompt = runNode('build-prompt.js', { json: { description: DOC }, nodes: { 'Normalize & dedupe': opp } }).json;
assert.strictEqual(prompt.request.tool_choice.name, 'record_analysis');
assert.ok(!prompt.source_text.includes('<'), 'html stripped');
assert.ok(!prompt.source_text.includes('x()'), 'scripts removed');
assert.ok(prompt.source_text.includes('"WCAG 2.1 AA" accessibility'), 'entities decoded');
assert.strictEqual(prompt.thin_source, false);
assert.strictEqual(runNode('build-prompt.js', { json: { error: 'HTTP 404' }, nodes: { 'Normalize & dedupe': opp } }).json.thin_source, true, 'failed fetch -> thin source');

// ---- validate --------------------------------------------------------------
const goodAnalysis = {
  summary: 'Modernize the VA intake portal.', scope_type: 'modernization', fit_score: 88, recommendation: 'pursue',
  rationale: 'Strong match.', risks: ['Short timeline'], deadline_stated: future, set_aside: null, clearance_required: false,
  key_requirements: [
    { requirement: 'Cloud-native web app', evidence_quote: 'cloud-native web application' },
    { requirement: 'Accessibility', evidence_quote: 'WCAG 2.1 AA' },
  ],
};
const validate = (analysis, ctx = prompt, extra = {}, store = {}) =>
  runNode('validate.js', {
    json: analysis ? { content: [{ type: 'tool_use', name: 'record_analysis', input: analysis }], ...extra } : { error: 'HTTP 529' },
    nodes: { 'Build prompt': ctx }, staticData: store,
  }).json;

const seenStore = {};
let row = validate(goodAnalysis, prompt, {}, seenStore);
assert.strictEqual(row.recommendation, 'pursue');
assert.strictEqual(row.needs_review, false, row.review_reasons);
assert.deepStrictEqual(seenStore.analyzedNoticeIds, ['a'], 'marked seen after success');

// The model invents a quote: the unsupported requirement is dropped and "pursue" is downgraded.
row = validate({ ...goodAnalysis, key_requirements: [...goodAnalysis.key_requirements, { requirement: 'FedRAMP High', evidence_quote: 'must hold FedRAMP High authorization' }] });
assert.strictEqual(row.recommendation, 'review');
assert.ok(row.review_reasons.includes('ungrounded_quotes:1'));
assert.ok(!row.requirements.includes('FedRAMP'));

// Model disagrees with SAM.gov about the deadline: metadata wins and the row is flagged.
row = validate({ ...goodAnalysis, deadline_stated: '2030-01-01' });
assert.strictEqual(row.deadline, future);
assert.ok(row.review_reasons.includes('deadline_mismatch'));

// Schema violation, API failure, and truncated output are all flagged, never trusted or lost.
const failStore = {};
row = validate({ ...goodAnalysis, fit_score: 140 }, prompt, {}, failStore);
assert.ok(row.review_reasons.includes('schema_invalid:fit_score') && row.needs_review);
row = validate(null, prompt, {}, failStore);
assert.ok(row.review_reasons.includes('llm_call_failed') && row.recommendation === 'review');
assert.strictEqual(failStore.analyzedNoticeIds, undefined, 'failed analyses are retried next run');
row = validate(goodAnalysis, prompt, { stop_reason: 'max_tokens' });
assert.ok(row.review_reasons.includes('output_truncated'));

// A thin document caps the score and cannot be "pursue".
const thin = runNode('build-prompt.js', { json: { description: 'See attachment.' }, nodes: { 'Normalize & dedupe': opp } }).json;
row = validate({ ...goodAnalysis, key_requirements: [] }, thin);
assert.strictEqual(row.recommendation, 'review');
assert.ok(row.fit_score <= 60 && row.review_reasons.includes('thin_source'));

// ---- digest ----------------------------------------------------------------
const r = (over) => ({ title: 'T', agency: 'A', url: 'u', summary: 's', needs_review: false, review_reasons: '', deadline: '', fit_score: 50, recommendation: 'skip', ...over });
assert.deepStrictEqual(runNode('digest.js', { items: [r({}), r({ recommendation: 'review', fit_score: 40 })] }), [], 'nothing worth a human -> no email');
const mail = runNode('digest.js', {
  items: [r({ title: 'Low <b>', recommendation: 'pursue', fit_score: 70 }), r({ title: 'High', recommendation: 'pursue', fit_score: 95 }), r({ title: 'Broken', needs_review: true, review_reasons: 'llm_call_failed', fit_score: '', recommendation: 'review' })],
})[0].json;
assert.ok(mail.html.indexOf('High') < mail.html.indexOf('Low'), 'sorted by score');
assert.ok(mail.html.includes('Low &lt;b&gt;'), 'escaped');
assert.ok(mail.html.includes('llm_call_failed'), 'flagged items surfaced');
assert.strictEqual(mail.subject, 'RFP Scout: 2 to pursue, 1 to check');

console.log('pipeline tests passed');
