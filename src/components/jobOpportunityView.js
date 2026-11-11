// Display helpers for 仕事DB records.
//
// Records are written by several agents over time, so the same attribute can arrive as a
// string, a list, or a nested object (e.g. locationEligibility: {selector, explicitRequirement}).
// Rendering an object as a React child throws and blanks the whole page, so every value that
// reaches the screen goes through toText / toList first.

export function toText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(' / ');
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, inner]) => {
        const text = toText(inner);
        return text ? key + ': ' + text : '';
      })
      .filter(Boolean)
      .join('; ');
  }
  return String(value);
}

export function toList(value) {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) return value.map(toText).filter(Boolean);
  const text = toText(value);
  return text ? [text] : [];
}

// Older records use locationEligibility/jobType/workload…; newer ones use location/employmentType/schedule….
export function pick(attrs, ...keys) {
  for (const key of keys) {
    const text = toText(attrs?.[key]);
    if (text) return attrs[key];
  }
  return undefined;
}
