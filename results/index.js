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
      const tests = conformant.tests || null;
      const failuresByTestKey = conformant.failuresByTestKey || {};
      const failures = Object.keys(failuresByTestKey).length > 0
        ? Object.values(failuresByTestKey)
        : (tests ? this._collectFailuresFromTests(tests) : []);
      const total = conformant.total != null
        ? conformant.total
        : (tests ? Object.keys(tests).length : failures.length);
      const passed = conformant.passed != null
        ? conformant.passed
        : (tests ? Object.values(tests).filter((t) => t.matches).length : total - failures.length);

      conformants[name] = { sha: conformant.sha, total, passed };

      if (failures.length > 0) {
        this._data.put(`failures/${name}/${runResult.id}`, failures);
      }
    }

    // Store reference failures if any
    const ref = runResult.reference;
    if (ref.failures && ref.failures.length > 0) {
      this._data.put(`failures/${ref.name}/${runResult.id}`, ref.failures);
    }
    if (ref.exclusions && ref.exclusions.length > 0) {
      this._data.put(`exclusions/${ref.name}/${runResult.id}`, ref.exclusions);
    }

    this._data.put(`runs/${runResult.id}`, {
      id: runResult.id,
      timestamp: runResult.timestamp,
      reference: {
        name: ref.name,
        sha: ref.sha,
        scoringModel: ref.scoringModel || null,
        corpusTotal: ref.corpusTotal != null ? ref.corpusTotal : (ref.total || 0),
        total: ref.total || 0,
        errors: ref.errors || 0,
        excluded: ref.excluded || 0,
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
    return this._getFailuresForRun(name, latestRun.id);
  }

  getReferenceExclusions() {
    const runs = this._loadAllRuns();
    if (runs.length === 0) return [];

    const latestRun = runs[0];
    const refName = latestRun.reference?.name;
    if (!refName) return [];
    return this._getExclusionsForRun(refName, latestRun.id);
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
      });
    }

    return results;
  }

  loadLatestRunSummary() {
    const runs = this._loadAllRuns();
    if (runs.length === 0) return null;

    const latest = runs[0];
    const refFailures = latest.reference.name
      ? this._getFailuresForRun(latest.reference.name, latest.id)
      : [];
    const refExclusions = latest.reference.name
      ? this._getExclusionsForRun(latest.reference.name, latest.id)
      : [];
    const result = {
      id: latest.id,
      timestamp: latest.timestamp,
      reference: {
        ...latest.reference,
        hasExclusionMetadata: latest.reference.scoringModel === 'runnable-set-v1',
        corpusTotal: latest.reference.corpusTotal != null
          ? latest.reference.corpusTotal
          : (latest.reference.total || 0),
        excluded: latest.reference.excluded != null ? latest.reference.excluded : refExclusions.length,
        failures: refFailures,
        exclusions: refExclusions,
      },
      conformants: {},
    };

    for (const [cName, c] of Object.entries(latest.conformants)) {
      const failures = this._getFailuresForRun(cName, latest.id);
      result.conformants[cName] = {
        sha: c.sha,
        total: c.total,
        passed: c.passed,
        failuresByTestKey: this._indexFailuresByTestKey(failures),
      };
    }

    return result;
  }

  loadLatestRun() {
    return this.loadLatestRunSummary();
  }

  getReferenceHistory() {
    return this._loadAllRuns().reverse().map((r) => {
      const total = r.reference.total || 0;
      const errors = r.reference.errors || 0;
      const passed = total - errors;
      const excluded = r.reference.excluded || 0;
      const corpusTotal = r.reference.corpusTotal != null ? r.reference.corpusTotal : total;
      return {
        date: r.timestamp.slice(0, 10),
        passPct: total > 0 ? Math.round((passed / total) * 1000) / 10 : 100,
        total,
        failed: errors,
        excluded,
        corpusTotal,
      };
    });
  }

  _loadAllRuns() {
    return this._data.list('runs')
      .reverse()
      .map((id) => this._data.get(`runs/${id}`));
  }

  _getFailuresForRun(name, runId) {
    return this._data.get(`failures/${name}/${runId}`) || [];
  }

  _getExclusionsForRun(name, runId) {
    return this._data.get(`exclusions/${name}/${runId}`) || [];
  }

  _collectFailuresFromTests(tests) {
    const failures = [];
    for (const [testKey, result] of Object.entries(tests)) {
      if (!result.matches) {
        const failure = { testKey };
        if (result.expected) failure.expected = result.expected;
        if (result.actual) failure.actual = result.actual;
        if (result.error) failure.error = result.error;
        if (result.stderr) failure.stderr = result.stderr;
        failures.push(failure);
      }
    }
    return failures;
  }

  _indexFailuresByTestKey(failures) {
    return Object.fromEntries(failures.map((failure) => [failure.testKey, failure]));
  }
}

module.exports = { ResultsStore, FileData, MemoryData };
