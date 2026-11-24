const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('frontend/index.html', 'utf8');
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(source => source.trim().length > 0);

if (inlineScripts.length !== 1) {
  throw new Error('Expected one inline application script, found ' + inlineScripts.length);
}

new vm.Script(inlineScripts[0], { filename: 'frontend/index.html:inline-script' });
console.log('Frontend inline JavaScript syntax: OK');
