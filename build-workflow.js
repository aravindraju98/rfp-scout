// Assembles workflows/rfp-scout.json from the Code-node sources in code/.
// Run: node build-workflow.js
const fs = require('fs');
const path = require('path');

const read = (name) => fs.readFileSync(path.join(__dirname, 'code', name), 'utf8');
const RECIPIENT = 'aravindraju98@gmail.com';

let n = 0;
const id = () => `b2000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

const samAuth = { authentication: 'genericCredentialType', genericAuthType: 'httpQueryAuth' };

const nodes = [
  {
    parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 7 * * 1-5' }] } },
    name: 'Weekday mornings',
    type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2,
    position: [0, 0],
  },
  { parameters: {}, name: 'Run now', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 200] },
  {
    parameters: { jsCode: read('build-query.js') },
    name: 'Build query',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [260, 100],
  },
  {
    parameters: {
      ...samAuth,
      url: '={{ $json.url }}',
      sendQuery: true,
      queryParameters: {
        parameters: [
          { name: 'ncode', value: '={{ $json.ncode }}' },
          { name: 'postedFrom', value: '={{ $json.postedFrom }}' },
          { name: 'postedTo', value: '={{ $json.postedTo }}' },
          { name: 'limit', value: '100' },
        ],
      },
      options: { timeout: 60000 },
    },
    name: 'Search SAM.gov',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [520, 100],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 3000,
    onError: 'continueRegularOutput',
  },
  {
    parameters: { jsCode: read('normalize.js') },
    name: 'Normalize & dedupe',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [780, 100],
  },
  {
    parameters: { ...samAuth, url: '={{ $json.descriptionUrl }}', options: { timeout: 60000 } },
    name: 'Fetch description',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1040, 100],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 3000,
    onError: 'continueRegularOutput',
  },
  {
    parameters: { mode: 'runOnceForEachItem', jsCode: read('build-prompt.js') },
    name: 'Build prompt',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1300, 100],
  },
  {
    parameters: {
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'anthropic-version', value: '2023-06-01' }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.request) }}',
      options: { timeout: 120000 },
    },
    name: 'Analyse with Claude',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1560, 100],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    onError: 'continueRegularOutput',
  },
  {
    parameters: { mode: 'runOnceForEachItem', jsCode: read('validate.js') },
    name: 'Validate output',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1820, 100],
  },
  {
    parameters: {
      operation: 'append',
      documentId: { __rl: true, value: '', mode: 'id' },
      sheetName: { __rl: true, value: 'Opportunities', mode: 'name' },
      columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] },
      options: {},
    },
    name: 'Log to tracking sheet',
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5,
    position: [2080, 0],
  },
  {
    parameters: { jsCode: read('digest.js') },
    name: 'Build digest',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [2080, 200],
  },
  {
    parameters: {
      sendTo: RECIPIENT,
      subject: '={{ $json.subject }}',
      message: '={{ $json.html }}',
      options: { appendAttribution: false },
    },
    name: 'Email digest',
    type: 'n8n-nodes-base.gmail',
    typeVersion: 2.1,
    position: [2340, 200],
  },
  {
    parameters: {
      content:
        '## RFP Scout\nFinds new federal software notices, reads each one, and tells the bid team which are worth chasing.\n\n**Credentials to attach:** SAM.gov API key (query auth, param `api_key`), Anthropic key (header auth, `x-api-key`), Google Sheets, Gmail.',
      width: 520,
      height: 180,
    },
    name: 'Note: overview',
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [0, -260],
  },
  {
    parameters: {
      content:
        '## Why the validation step exists\nThe model answers through a forced tool call, then **Validate output** checks the schema, confirms every evidence quote really appears in the document, cross-checks the deadline against SAM.gov, and downgrades anything doubtful to *needs review*. A notice is only marked seen after a successful analysis, so failures retry on the next run.',
      width: 560,
      height: 200,
    },
    name: 'Note: validation',
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [1560, -260],
  },
].map((node) => ({ id: id(), ...node }));

const link = (to) => ({ main: [[{ node: to, type: 'main', index: 0 }]] });

const workflow = {
  name: 'RFP Scout',
  nodes,
  connections: {
    'Weekday mornings': link('Build query'),
    'Run now': link('Build query'),
    'Build query': link('Search SAM.gov'),
    'Search SAM.gov': link('Normalize & dedupe'),
    'Normalize & dedupe': link('Fetch description'),
    'Fetch description': link('Build prompt'),
    'Build prompt': link('Analyse with Claude'),
    'Analyse with Claude': link('Validate output'),
    'Validate output': {
      main: [
        [
          { node: 'Log to tracking sheet', type: 'main', index: 0 },
          { node: 'Build digest', type: 'main', index: 0 },
        ],
      ],
    },
    'Build digest': link('Email digest'),
  },
  settings: { executionOrder: 'v1' },
};

const out = path.join(__dirname, 'workflows', 'rfp-scout.json');
fs.writeFileSync(out, JSON.stringify(workflow, null, 2) + '\n');
console.log('wrote', out);
