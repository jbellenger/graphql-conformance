'use strict';

function normalizeHarnessError(result) {
  if (!result || !result.error) return null;

  const error = String(result.error);
  if (error === 'timeout') return { kind: 'timeout' };
  if (error === 'invalid JSON output' || error === 'invalid protocol output') {
    return { kind: 'invalid-output' };
  }

  const exitMatch = error.match(/^process exited with code (-?\d+)$/);
  if (exitMatch) {
    return { kind: 'exit', code: Number(exitMatch[1]) };
  }

  return { kind: 'runtime', message: error };
}

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

// Recursively checks whether two values have identical object-key orderings
// wherever both sides present the same keys. Assumes values already match
// under unordered equality. Returns false as soon as any object-level key
// ordering diverges.
function sameKeyOrder(a, b) {
  if (a === null || b === null) return true;
  if (typeof a !== typeof b) return true;

  if (Array.isArray(a)) {
    for (let i = 0; i < a.length; i += 1) {
      if (!sameKeyOrder(a[i], b[i])) return false;
    }
    return true;
  }

  if (typeof a === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return true;
    for (let i = 0; i < keysA.length; i += 1) {
      if (keysA[i] !== keysB[i]) return false;
    }
    for (const key of keysA) {
      if (!sameKeyOrder(a[key], b[key])) return false;
    }
    return true;
  }

  return true;
}

function compareResults(a, b) {
  const errorA = normalizeHarnessError(a);
  const errorB = normalizeHarnessError(b);

  if (errorA && errorB) {
    return { matches: deepEqual(errorA, errorB), quirks: [] };
  }
  if (errorA) return { matches: false, quirks: [] };
  if (errorB) return { matches: false, quirks: [] };

  if (!unorderedEqual(a.result, b.result)) {
    return { matches: false, quirks: [] };
  }

  const quirks = sameKeyOrder(a.result, b.result) ? [] : ['object-ordering'];
  return { matches: true, quirks };
}

module.exports = { deepEqual, unorderedEqual, sameKeyOrder, normalizeHarnessError, compareResults };
