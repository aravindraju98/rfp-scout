// Runs an n8n Code-node source file outside n8n, with the globals it expects.
const fs = require('fs');
const path = require('path');

function runNode(file, { json = {}, items = [], nodes = {}, staticData = {} } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'code', file), 'utf8');
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`test did not provide upstream node "${name}"`);
    return { item: { json: nodes[name] }, all: () => [{ json: nodes[name] }] };
  };
  const $input = { all: () => items.map((j) => ({ json: j })), item: { json } };
  const fn = new Function('$json', '$input', '$', '$getWorkflowStaticData', source);
  return fn(json, $input, $, () => staticData);
}

module.exports = { runNode };
