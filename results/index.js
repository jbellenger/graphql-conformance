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
}

// ResultsStore owns the on-disk Repository-shaped layout that the site reads
// directly. The writer is the sole producer of these files; `site/` never
// reshapes them at build time.
//
// On-disk layout (relative to baseDir):
//   impls.json                                — Impl[]
//   runs.json                                 — Run[] (newest first)
//   runs/<runId>/summary.json                 — Run + _conformerMeta
//   runs/<runId>/results/<implId>.json        — Result[] (non-pass only)
//   impls/<implId>/history.json               — ImplHistoryPoint[]
//
// `_conformerMeta` lives only on per-run summary files. It carries the
// imageDigest / corpusFingerprint that incremental-skip needs and that the
// site does not. Keeping it out of runs.json keeps the public list lean.
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

  // Write a complete run in one shot. Inputs:
  //   run              — Run, with resultsByImpl buckets carrying
  //                      {total, passed, failed, errored, falloutAfter}
  //                      counts and empty results: [].
  //   resultsByImpl    — Record<implId, Result[]> of non-pass results.
  //   conformerMeta    — { corpusFingerprint,
  //                        implMeta: { [implId]: { imageDigest, version } } }
  //   impls            — Impl[] (current, ordered; reference first).
  writeRun({ run, resultsByImpl, conformerMeta, impls }) {
    if (!run || !run.id) throw new Error('writeRun: run.id is required');

    this._data.put(`runs/${run.id}/summary`, {
      ...run,
      _conformerMeta: conformerMeta,
    });
    for (const [implId, results] of Object.entries(resultsByImpl ?? {})) {
      this._data.put(`runs/${run.id}/results/${implId}`, results);
    }

    const runs = this._loadRunsIndex();
    const idx = runs.findIndex((r) => r.id === run.id);
    if (idx >= 0) runs.splice(idx, 1);
    runs.push(run);
    runs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    this._data.put('runs', runs);

    this._data.put('impls', impls ?? []);

    for (const impl of impls ?? []) {
      const history = this._computeImplHistory(impl.id, runs);
      this._data.put(`impls/${impl.id}/history`, history);
    }
  }

  // Return the latest run (Run + non-pass results + conformerMeta), or null.
  loadLatestRun() {
    const runs = this._loadRunsIndex();
    if (runs.length === 0) return null;
    return this._loadRunFull(runs[0].id);
  }

  // For parity with the old API.
  loadRun(id) {
    return this._loadRunFull(id);
  }

  listRuns() {
    return this._loadRunsIndex();
  }

  _loadRunsIndex() {
    return this._data.get('runs') || [];
  }

  _loadRunFull(id) {
    const summary = this._data.get(`runs/${id}/summary`);
    if (!summary) return null;
    const { _conformerMeta, ...run } = summary;
    const resultsByImpl = {};
    for (const implId of Object.keys(run.resultsByImpl || {})) {
      resultsByImpl[implId] = this._data.get(`runs/${id}/results/${implId}`) || [];
    }
    return { run, resultsByImpl, conformerMeta: _conformerMeta || null };
  }

  _computeImplHistory(implId, runsNewestFirst) {
    return runsNewestFirst
      .filter((r) => r.resultsByImpl && r.resultsByImpl[implId])
      .map((r) => {
        const bucket = r.resultsByImpl[implId];
        return {
          runId: r.id,
          timestamp: r.timestamp,
          total: bucket.total || 0,
          passed: bucket.passed || 0,
          failed: bucket.failed || 0,
          errored: bucket.errored || 0,
          falloutAfter: bucket.falloutAfter ?? null,
        };
      });
  }
}

module.exports = { ResultsStore, FileData, MemoryData };
