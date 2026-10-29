// n8n Code node (Run Once for Each Item): never trust the model's output as-is.
// Checks the schema, verifies every evidence quote actually appears in the source
// document, cross-checks the deadline against SAM.gov metadata, and downgrades
// anything it cannot stand behind. Anything doubtful is flagged needs_review
// instead of being silently trusted or silently dropped.
const SCOPES = ['software_development', 'modernization', 'integration', 'data_analytics', 'ai_ml', 'infrastructure', 'staffing', 'hardware', 'other'];
const RECS = ['pursue', 'review', 'skip'];
const MAX_REMEMBERED = 5000;

const ctx = $('Build prompt').item.json;
const opp = ctx.opp;
const reasons = [];

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
const haystack = norm(ctx.source_text);

const block = ($json.content || []).find((b) => b.type === 'tool_use' && b.name === 'record_analysis');
let a = block ? block.input : null;
if (!a) reasons.push('llm_call_failed');
if ($json.stop_reason === 'max_tokens') reasons.push('output_truncated');

let requirements = [];
if (a) {
  const bad = [];
  if (typeof a.summary !== 'string') bad.push('summary');
  if (!SCOPES.includes(a.scope_type)) bad.push('scope_type');
  if (!Number.isInteger(a.fit_score) || a.fit_score < 0 || a.fit_score > 100) bad.push('fit_score');
  if (!RECS.includes(a.recommendation)) bad.push('recommendation');
  if (typeof a.rationale !== 'string') bad.push('rationale');
  if (!Array.isArray(a.key_requirements)) bad.push('key_requirements');
  if (bad.length) {
    reasons.push(`schema_invalid:${bad.join('+')}`);
    a = null;
  }
}

if (a) {
  // Grounding check: a quote that is not in the document means the model made it up.
  let ungrounded = 0;
  for (const r of a.key_requirements) {
    const quote = r && typeof r.evidence_quote === 'string' ? norm(r.evidence_quote) : '';
    if (quote.length >= 8 && haystack.includes(quote)) requirements.push(r.requirement);
    else ungrounded += 1;
  }
  if (ungrounded) reasons.push(`ungrounded_quotes:${ungrounded}`);

  if (ctx.thin_source) {
    reasons.push('thin_source');
    a.fit_score = Math.min(a.fit_score, 60);
    if (a.recommendation === 'pursue') a.recommendation = 'review';
  }
  if (ungrounded && a.recommendation === 'pursue') a.recommendation = 'review';
  if (ctx.truncated) reasons.push('document_truncated');
  if (a.clearance_required === true) reasons.push('clearance_required');
}

// Metadata from SAM.gov is authoritative for the deadline; the model only fills gaps.
let deadline = opp.deadline ? opp.deadline.slice(0, 10) : '';
if (a && a.deadline_stated) {
  if (!deadline) deadline = a.deadline_stated;
  else if (deadline !== a.deadline_stated) reasons.push('deadline_mismatch');
}

// Only remember a notice once it was actually analysed, so failed runs retry it.
if (a) {
  const store = $getWorkflowStaticData('global');
  store.analyzedNoticeIds = [...(store.analyzedNoticeIds || []), opp.noticeId].slice(-MAX_REMEMBERED);
}

return {
  json: {
    notice_id: opp.noticeId,
    title: opp.title,
    agency: opp.agency,
    solicitation_number: opp.solicitationNumber,
    posted: opp.postedDate,
    deadline,
    naics: opp.naics,
    set_aside: (a && a.set_aside) || opp.setAside || '',
    scope_type: a ? a.scope_type : '',
    fit_score: a ? a.fit_score : '',
    recommendation: a ? a.recommendation : 'review',
    needs_review: reasons.length > 0,
    review_reasons: reasons.join('; '),
    summary: a ? a.summary : '',
    requirements: requirements.join(' | '),
    rationale: a ? a.rationale : '',
    risks: a && Array.isArray(a.risks) ? a.risks.join(' | ') : '',
    url: opp.uiLink,
    analyzed_at: new Date().toISOString(),
  },
};
