'use strict';

// Exact-match partial edits for long stored texts (job instructions, skill bodies, the Agent Guide).
// Agents otherwise have to resend the whole text to change one sentence, which invites silent
// transcription errors. Every `find` must occur exactly once so an edit can never land in the wrong place.
function applyTextEdits(source, edits, label) {
  if (!Array.isArray(edits) || !edits.length) throw new Error(label + ' must be a non-empty array of {find, replace}');
  if (edits.length > 40) throw new Error(label + ' accepts at most 40 edits');
  let text = String(source === undefined || source === null ? '' : source);
  edits.forEach((edit, index) => {
    const find = edit && typeof edit.find === 'string' ? edit.find : '';
    if (!find) throw new Error(label + '[' + index + '].find is required');
    if (typeof edit.replace !== 'string') throw new Error(label + '[' + index + '].replace must be a string (use "" to delete)');
    const first = text.indexOf(find);
    if (first === -1) throw new Error(label + '[' + index + ']: text not found. Read the current text and copy the passage exactly.');
    if (text.indexOf(find, first + find.length) !== -1) throw new Error(label + '[' + index + ']: text occurs more than once. Include more surrounding text to make it unique.');
    text = text.slice(0, first) + edit.replace + text.slice(first + find.length);
  });
  return text;
}

const EDITS_SCHEMA = {
  type: 'array', minItems: 1, maxItems: 40,
  items: {
    type: 'object',
    properties: {
      find: { type: 'string', minLength: 1, maxLength: 4000, description: 'Exact passage of the current text. Must occur exactly once.' },
      replace: { type: 'string', maxLength: 8000, description: 'Replacement text. Empty string deletes the passage.' },
    },
    required: ['find', 'replace'], additionalProperties: false,
  },
};

module.exports = { applyTextEdits, EDITS_SCHEMA };
