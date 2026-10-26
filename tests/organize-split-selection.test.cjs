const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('converter.html', 'utf8');
const start = html.indexOf('window.orgApplySplitPages=');
const end = html.indexOf('window.orgSplitZip=', start);
const input = {value: '1, 3, 5–8'};
const context = {window: {}, organizeOrder: [0,1,2,3,4,5,6,7], organizeSelected: new Set(),
  $: () => input, L: en => en, renderOrganizeGrid() {}, showError(message) { this.error = message; }};
context.showError = message => { context.error = message; };
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);
assert.equal(context.window.orgApplySplitPages(), true);
assert.deepEqual([...context.organizeSelected], [0,2,4,5,6,7]);
for (const value of ['0', '9', '4-2', '1,', 'abc', '1-999999999']) {
  input.value = value;
  assert.equal(context.window.orgApplySplitPages(), false, value);
  assert.deepEqual([...context.organizeSelected], [0,2,4,5,6,7], 'invalid input keeps selection');
}
context.organizeOrder = [7,5,2];
input.value = '1, 3, 3';
assert.equal(context.window.orgApplySplitPages(), true);
assert.deepEqual([...context.organizeSelected], [7,2], 'current arrangement, duplicates removed');
console.log('PASS split ranges: arbitrary pages, ranges, invalid input, arranged order');
