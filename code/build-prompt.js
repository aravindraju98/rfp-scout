// n8n Code node (Run Once for Each Item): turn one opportunity plus its fetched
// description into an Anthropic Messages request. The model must answer through a
// forced tool call, so the output is structured JSON rather than prose to be parsed.
// eval/run-eval.js loads this same file, so the eval always tests the production prompt.
const MODEL = 'claude-sonnet-5-5';
const MAX_SOURCE_CHARS = 24000;

// Who "we" are. Change this and the scoring changes with it.
const COMPANY_PROFILE = `We are a software vendor that replaces legacy federal systems with modern web
applications: citizen-facing portals, benefits and case-management systems, ticketing and
marketplace platforms, and AI-assisted document workflows. We are strongest at custom software
development, modernization, system integration, and data/analytics work. We are not a hardware
reseller, staffing agency, or facilities contractor. Contracts needing an active security clearance
are out of reach for us unless the document says otherwise.`;

const SYSTEM = `You do the first-pass read of a US federal procurement notice for a bid team.
Use ONLY the document and metadata provided. If something is not stated, answer null. Never guess a
deadline, set-aside, or requirement. Every requirement you list must carry a short evidence_quote
copied VERBATIM from the document. A bid team will act on your recommendation, so be conservative:
prefer "review" over "pursue" when the document is thin or ambiguous.

Company profile:
${COMPANY_PROFILE}`;

const TOOL = {
  name: 'record_analysis',
  description: 'Record the first-pass analysis of a procurement notice.',
  input_schema: {
    type: 'object',
    required: ['summary', 'scope_type', 'key_requirements', 'fit_score', 'recommendation', 'rationale', 'risks'],
    properties: {
      summary: { type: 'string', description: 'What the agency wants, in at most 50 words.' },
      scope_type: {
        type: 'string',
        enum: ['software_development', 'modernization', 'integration', 'data_analytics', 'ai_ml', 'infrastructure', 'staffing', 'hardware', 'other'],
      },
      key_requirements: {
        type: 'array',
        maxItems: 6,
        items: {
          type: 'object',
          required: ['requirement', 'evidence_quote'],
          properties: {
            requirement: { type: 'string' },
            evidence_quote: { type: 'string', description: 'Verbatim excerpt from the document supporting this requirement.' },
          },
        },
      },
      deadline_stated: { type: ['string', 'null'], description: 'Response deadline as YYYY-MM-DD if the document states one, else null.' },
      set_aside: { type: ['string', 'null'] },
      clearance_required: { type: ['boolean', 'null'] },
      fit_score: { type: 'integer', minimum: 0, maximum: 100 },
      recommendation: { type: 'string', enum: ['pursue', 'review', 'skip'] },
      rationale: { type: 'string', description: 'Two sentences on why, referring to the company profile.' },
      risks: { type: 'array', maxItems: 4, items: { type: 'string' } },
    },
  },
};

const opp = $('Normalize & dedupe').item.json;
const raw = String($json.description ?? $json.data ?? '');

const text = raw
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, ' ')
  .replace(/\n\s*\n+/g, '\n')
  .trim();

const truncated = text.length > MAX_SOURCE_CHARS;
const source_text = truncated ? text.slice(0, MAX_SOURCE_CHARS) : text;
const thin_source = source_text.length < 300;

const metadata = [
  `Title: ${opp.title}`,
  `Agency: ${opp.agency}`,
  `Notice type: ${opp.noticeType}`,
  `Solicitation number: ${opp.solicitationNumber}`,
  `NAICS: ${opp.naics}`,
  `Set-aside (from metadata): ${opp.setAside || 'none listed'}`,
  `Response deadline (from metadata): ${opp.deadline || 'none listed'}`,
  `Place of performance: ${opp.location || 'not listed'}`,
].join('\n');

const content =
  `<metadata>\n${metadata}\n</metadata>\n\n<document>\n${source_text || '(no description text was available)'}\n</document>`;

return {
  json: {
    opp,
    source_text,
    truncated,
    thin_source,
    request: {
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'record_analysis' },
      messages: [{ role: 'user', content }],
    },
  },
};
