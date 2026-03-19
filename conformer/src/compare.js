'use strict';

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  if (typeof a === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key, i) => key === keysB[i] && deepEqual(a[key], b[key]));
  }

  return a === b;
}

function unorderedEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => unorderedEqual(item, b[i]));
  }

  if (typeof a === 'object') {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key, i) => key === keysB[i] && unorderedEqual(a[key], b[key]));
  }

  return a === b;
}

function compareResults(a, b) {
  if (a.error && b.error) return { matches: true };
  if (a.error) return { matches: false };
  if (b.error) return { matches: false };

  if (!deepEqual(a.result, b.result)) {
    if (unorderedEqual(a.result, b.result)) {
      return { matches: true };
    }
    return { matches: false };
  }

  return { matches: true };
}

module.exports = { deepEqual, unorderedEqual, compareResults };
