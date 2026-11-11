'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { applyTextEdits } = require('../functions/textEdits');

test('applyTextEdits changes exactly the named passage', () => {
  const text = 'Read the Method `abc`.\nThen write.\nThen write again.';
  assert.equal(applyTextEdits(text, [{ find: 'Method `abc`', replace: 'Chat Skill `xyz`' }], 'edits'), 'Read the Chat Skill `xyz`.\nThen write.\nThen write again.');
  assert.equal(applyTextEdits(text, [{ find: '\nThen write again.', replace: '' }], 'edits'), 'Read the Method `abc`.\nThen write.');
  assert.equal(applyTextEdits('a b', [{ find: 'a', replace: 'b' }, { find: 'b b', replace: 'c' }], 'edits'), 'c', 'edits apply in order');
});

test('applyTextEdits refuses anything ambiguous', () => {
  assert.throws(() => applyTextEdits('one two', [{ find: 'three', replace: 'x' }], 'edits'), /text not found/);
  assert.throws(() => applyTextEdits('Then write. Then write.', [{ find: 'Then write.', replace: 'x' }], 'edits'), /more than once/);
  assert.throws(() => applyTextEdits('abc', [], 'edits'), /non-empty array/);
  assert.throws(() => applyTextEdits('abc', [{ find: '', replace: 'x' }], 'edits'), /find is required/);
  assert.throws(() => applyTextEdits('abc', [{ find: 'a' }], 'edits'), /replace must be a string/);
});
