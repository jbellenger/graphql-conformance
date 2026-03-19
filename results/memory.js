'use strict';

class MemoryData {
  constructor() {
    this._store = new Map();
  }

  get(key) {
    const value = this._store.get(key);
    return value !== undefined ? JSON.parse(JSON.stringify(value)) : null;
  }

  put(key, value) {
    this._store.set(key, JSON.parse(JSON.stringify(value)));
  }

  list(prefix) {
    const p = prefix + '/';
    return [...this._store.keys()]
      .filter((k) => k.startsWith(p))
      .map((k) => k.slice(p.length))
      .sort();
  }
}

module.exports = { MemoryData };
