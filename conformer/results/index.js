'use strict';

const fs = require('fs');
const path = require('path');

class ResultsStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.runsDir = path.join(baseDir, 'runs');
    this.failuresDir = path.join(baseDir, 'failures');
  }

  recordRun(runResult) {
    fs.mkdirSync(this.runsDir, { recursive: true });

    const conformants = {};
    for (const [name, conformant] of Object.entries(runResult.conformants)) {
      const tests = conformant.tests;
      const total = Object.keys(tests).length;
      const passed = Object.values(tests).filter((t) => t.matches).length;

      conformants[name] = { sha: conformant.sha, total, passed };

      const failures = [];
      for (const [testKey, result] of Object.entries(tests)) {
        if (!result.matches) {
          failures.push({ testKey, quirks: result.quirks });
        }
      }

      if (failures.length > 0) {
        const implFailuresDir = path.join(this.failuresDir, name);
        fs.mkdirSync(implFailuresDir, { recursive: true });
        fs.writeFileSync(
          path.join(implFailuresDir, `${runResult.id}.json`),
          JSON.stringify(failures, null, 2) + '\n'
        );
      }
    }

    const runFile = {
      id: runResult.id,
      timestamp: runResult.timestamp,
      reference: runResult.reference,
      conformants,
    };

    fs.writeFileSync(
      path.join(this.runsDir, `${runResult.id}.json`),
      JSON.stringify(runFile, null, 2) + '\n'
    );
  }

  listRuns() {
    if (!fs.existsSync(this.runsDir)) return [];

    return fs.readdirSync(this.runsDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()
      .map((f) => {
        const run = JSON.parse(fs.readFileSync(path.join(this.runsDir, f), 'utf8'));
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
        const failed = c.total - c.passed;
        return {
          date: r.timestamp.slice(0, 10),
          passPct: c.total > 0 ? Math.round((c.passed / c.total) * 1000) / 10 : 100,
          total: c.total,
          failed,
        };
      });
  }

  getImplFailures(name) {
    const runs = this._loadAllRuns();
    if (runs.length === 0) return [];

    const latestRun = runs[0];
    const failuresFile = path.join(this.failuresDir, name, `${latestRun.id}.json`);
    if (!fs.existsSync(failuresFile)) return [];

    return JSON.parse(fs.readFileSync(failuresFile, 'utf8'));
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
    const result = {
      id: latest.id,
      timestamp: latest.timestamp,
      reference: latest.reference,
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
    if (!fs.existsSync(this.runsDir)) return [];

    return fs.readdirSync(this.runsDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()
      .map((f) => JSON.parse(fs.readFileSync(path.join(this.runsDir, f), 'utf8')));
  }
}

module.exports = { ResultsStore };
