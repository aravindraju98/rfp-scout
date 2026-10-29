// n8n Code node (Run Once for All Items): flatten SAM.gov search responses into one
// item per opportunity worth analysing. Read-only against the "seen" list: a notice is
// only marked seen after it has been analysed (see validate.js), so a failed run retries.
const KEEP_TYPES = new Set([
  'Solicitation',
  'Combined Synopsis/Solicitation',
  'Presolicitation',
  'Sources Sought',
]);
const MAX_PER_RUN = 25; // bounds LLM spend on a busy day; the rest are picked up next run

const seen = new Set($getWorkflowStaticData('global').analyzedNoticeIds || []);
const now = Date.now();
const byId = new Map();

for (const item of $input.all()) {
  for (const o of item.json.opportunitiesData || []) {
    if (!o.noticeId || byId.has(o.noticeId) || seen.has(o.noticeId)) continue;
    if (o.active !== 'Yes' || !KEEP_TYPES.has(o.type)) continue;
    const deadline = o.responseDeadLine || null;
    if (deadline && Date.parse(deadline) < now) continue;

    const place = o.placeOfPerformance || {};
    byId.set(o.noticeId, {
      noticeId: o.noticeId,
      title: o.title || '(untitled)',
      solicitationNumber: o.solicitationNumber || '',
      agency: (o.fullParentPathName || '').split('.').filter(Boolean).join(' > '),
      postedDate: o.postedDate || '',
      noticeType: o.type,
      deadline,
      naics: o.naicsCode || '',
      setAside: o.typeOfSetAsideDescription || '',
      location: [place.city && place.city.name, place.state && place.state.code].filter(Boolean).join(', '),
      uiLink: o.uiLink || '',
      descriptionUrl: typeof o.description === 'string' && o.description.startsWith('http') ? o.description : '',
    });
  }
}

return [...byId.values()]
  .sort((a, b) => b.postedDate.localeCompare(a.postedDate))
  .slice(0, MAX_PER_RUN)
  .map((json) => ({ json }));
