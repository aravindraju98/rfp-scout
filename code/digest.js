// n8n Code node (Run Once for All Items): one email per run, best bids first.
// Emits nothing when no opportunity needs a human, so quiet days send no email.
const MIN_REVIEW_SCORE = 60;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rows = $input.all().map((i) => i.json);

const score = (r) => (typeof r.fit_score === 'number' ? r.fit_score : -1);
const pursue = rows.filter((r) => r.recommendation === 'pursue').sort((a, b) => score(b) - score(a));
const maybe = rows
  .filter((r) => r.recommendation === 'review' && !r.needs_review && score(r) >= MIN_REVIEW_SCORE)
  .sort((a, b) => score(b) - score(a));
const flagged = rows.filter((r) => r.needs_review && r.recommendation !== 'skip' && !pursue.includes(r) && !maybe.includes(r));

if (pursue.length + maybe.length + flagged.length === 0) return [];

const item = (r) =>
  `<li><a href="${esc(r.url)}">${esc(r.title)}</a> &mdash; ${esc(r.agency)}` +
  `${r.fit_score !== '' ? ` <b>[${esc(r.fit_score)}]</b>` : ''}` +
  `${r.deadline ? `, due ${esc(r.deadline)}` : ''}<br>${esc(r.summary)}` +
  `${r.needs_review ? `<br><i>Check before trusting: ${esc(r.review_reasons)}</i>` : ''}</li>`;

const section = (heading, list) => (list.length ? `<h3>${heading} (${list.length})</h3><ul>${list.map(item).join('')}</ul>` : '');

const html =
  section('Pursue', pursue) +
  section('Worth a look', maybe) +
  section('Needs a human (model output could not be fully verified)', flagged) +
  `<p><small>${rows.length} notices analysed. Every row is logged in the tracking sheet.</small></p>`;

const total = pursue.length + maybe.length + flagged.length;
return [{ json: { subject: `RFP Scout: ${pursue.length} to pursue, ${total - pursue.length} to check`, html } }];
