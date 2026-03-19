'use strict';

const fs = require('fs');
const path = require('path');
const { MemoryData } = require('./memory');

class FileData {
  constructor(baseDir) {
    this.baseDir = baseDir;
  }

  get(key) {
    const filePath = path.join(this.baseDir, `${key}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  put(key, value) {
    const filePath = path.join(this.baseDir, `${key}.json`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
  }

  list(prefix) {
    const dir = path.join(this.baseDir, prefix);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
  }
}

class ResultsStore {
  constructor(data) {
    this._data = data;
  }

  static fromDirectory(baseDir) {
    return new ResultsStore(new FileData(baseDir));
  }

  static inMemory() {
    return new ResultsStore(new MemoryData());
  }

  recordRun(runResult) {
    const conformants = {};
    for (const [name, conformant] of Object.entries(runResult.conformants)) {
      const tests = conformant.tests;
      // Use pre-computed totals if provided (e.g. for skipped conformants
      // whose tests map only contains failures).
      const total = conformant.total != null
        ? conformant.total
        : Object.keys(tests).length;
      const passed = conformant.passed != null
        ? conformant.passed
        : Object.values(tests).filter((t) => t.matches).length;

      conformants[name] = { sha: conformant.sha, total, passed };

      const failures = [];
      for (const [testKey, result] of Object.entries(tests)) {
        if (!result.matches) {
          failures.push({ testKey, quirks: result.quirks });
        }
      }

      if (failures.length > 0) {
        this._data.put(`failures/${name}/${runResult.id}`, failures);
      }
    }

    // Store reference failures if any
    const ref = runResult.reference;
    if (ref.failures && ref.failures.length > 0) {
      this._data.put(`failures/${ref.name}/${runResult.id}`, ref.failures);
    }

    this._data.put(`runs/${runResult.id}`, {
      id: runResult.id,
      timestamp: runResult.timestamp,
      reference: {
        name: ref.name,
        sha: ref.sha,
        total: ref.total || 0,
        errors: ref.errors || 0,
      },
      conformants,
    });
  }

  listRuns() {
    return this._data.list('runs')
      .reverse()
      .map((id) => {
        const run = this._data.get(`runs/${id}`);
        return { id: run.id, timestamp: run.timestamp, reference: run.reference };
      });
  }

  getSummary() {
    const runs = this._loadAllRuns();
    if (runs.length === 0) return [];

    const latest = runs[0];
    return Object.entries(latest.conformants).map(([name, c]) => ({
      impl: name,
      passPct: c.total > 0 ? Math.round((c.passed / c.total) * 1000) / 10 : 100,
      total: c.total,
      failed: c.total - c.passed,
      lastRun: latest.timestamp,
      sha: c.sha,
    }));
  }

  getImplHistory(name) {
    return this._loadAllRuns()
      .filter((r) => r.conformants[name])
      .reverse()
      .map((r) => {
        const c = r.conformants[name];
        return {
          date: r.timestamp.slice(0, 10),
          passPct: c.total > 0 ? Math.round((c.passed / c.total) * 1000) / 10 : 100,
          total: c.total,
          failed: c.total - c.passed,
        };
      });
  }

  getImplFailures(name) {
    const runs = this._loadAllRuns();
    if (runs.length === 0) return [];

    const latestRun = runs[0];
    return this._data.get(`failures/${name}/${latestRun.id}`) || [];
  }

  getTestStatus(testKey) {
    const runs = this._loadAllRuns();
    if (runs.length === 0) return [];

    const latestRun = runs[0];
    const results = [];

    for (const [name] of Object.entries(latestRun.conformants)) {
      const failures = this.getImplFailures(name);
      const failure = failures.find((f) => f.testKey === testKey);
      results.push({
        impl: name,
        passes: !failure,
        quirks: failure ? failure.quirks : [],
      });
    }

    return results;
  }

  loadLatestRun() {
    const runs = this._loadAllRuns();
    if (runs.length === 0) return null;

    const latest = runs[0];
    // Reconstruct reference failures from stored data
    const refFailures = latest.reference.name
      ? (this._data.get(`failures/${latest.reference.name}/${latest.id}`) || [])
      : [];
    const result = {
      id: latest.id,
      timestamp: latest.timestamp,
      reference: { ...latest.reference, failures: refFailures },
      conformants: {},
    };

    for (const [cName, c] of Object.entries(latest.conformants)) {
      const failures = this.getImplFailures(cName);
      const tests = {};
      for (const f of failures) {
        tests[f.testKey] = { matches: false, quirks: f.quirks };
      }
      result.conformants[cName] = { sha: c.sha, tests, total: c.total, passed: c.passed };
    }

    return result;
  }

  _loadAllRuns() {
    return this._data.list('runs')
      .reverse()
      .map((id) => this._data.get(`runs/${id}`));
  }
}

module.exports = { ResultsStore, FileData, MemoryData };
