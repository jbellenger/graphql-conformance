'use strict';

const app = document.getElementById('app');

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

const REPO_URL = 'https://github.com/jbellenger/graphql-conformance/blob/master';

function formatTestKey(testKey) {
  const parts = testKey.split('/');
  const schema = parts[0];
  const query = parts[1];
  const vars = parts[2];

  const schemaLink = `<a href="${REPO_URL}/corpus/${schema}/schema.graphqls">${schema}</a>`;
  const queryLink = `<a href="${REPO_URL}/corpus/${schema}/${query}/query.graphql">${query}</a>`;
  const varsLink = vars
    ? `/<a href="${REPO_URL}/corpus/${schema}/${query}/${vars}/variables.json">${vars}</a>`
    : '';

  return `corpus/${schemaLink}/${queryLink}${varsLink}`;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatTimestamp(timestamp) {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return escapeHtml(String(timestamp));
  return escapeHtml(date.toLocaleString());
}

function formatJsonWithHighlight(value) {
  const json = escapeHtml(JSON.stringify(value, null, 2));
  return json.replace(
    /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = 'json-number';
      if (match.startsWith('"')) {
        cls = match.endsWith(':') ? 'json-key' : 'json-string';
      } else if (match === 'true' || match === 'false') {
        cls = 'json-boolean';
      } else if (match === 'null') {
        cls = 'json-null';
      }
      return `<span class="${cls}">${match}</span>`;
    },
  );
}

function formatFailureDetails(f) {
  const summary = f.error || (f.expected && f.actual ? 'output differs' : 'failed');

  const parts = [];
  if (f.stderr) {
    parts.push(`<div class="detail-label">stderr</div><pre class="detail-pre">${escapeHtml(f.stderr.trim())}</pre>`);
  }
  if (f.expected) {
    parts.push(`<div class="detail-label">expected</div><pre class="detail-pre detail-json">${formatJsonWithHighlight(f.expected)}</pre>`);
  }
  if (f.actual) {
    parts.push(`<div class="detail-label">actual</div><pre class="detail-pre detail-json">${formatJsonWithHighlight(f.actual)}</pre>`);
  }

  if (parts.length === 0) {
    return `<span>${escapeHtml(summary)}</span>`;
  }

  return `<details><summary>${escapeHtml(summary)}</summary><div class="detail-body">${parts.join('')}</div></details>`;
}

function barClass(pct) {
  if (pct >= 95) return 'bar-pass';
  if (pct >= 80) return 'bar-warn';
  return 'bar-fail';
}

function renderDashboard(summary) {
  const reference = summary.find((item) => item.isReference) || null;
  const implementations = summary
    .filter((item) => !item.isReference)
    .sort((a, b) => b.passPct - a.passPct || a.impl.localeCompare(b.impl));

  app.innerHTML = `
    <h2>Conformance Summary</h2>
    <p>Pass rate is scored on runnable reference cases only.</p>
    <div class="dashboard-layout">
      ${reference ? `
        <section class="reference-card">
          <div class="reference-card-header">
            <span class="reference-pill">Reference</span>
            <a class="reference-link" href="#/impl/${reference.impl}">${reference.impl}</a>
          </div>
          <div class="reference-rate">${reference.passPct}%</div>
          <div class="reference-subtext">${reference.total} runnable · ${reference.excluded || 0} excluded</div>
          <div class="bar-container reference-bar">
            <div class="bar-fill ${barClass(reference.passPct)}" style="width: ${reference.passPct}%"></div>
          </div>
          <div class="reference-meta">
            <div><span>Corpus</span><strong>${reference.corpusTotal ?? reference.total}</strong></div>
            <div><span>SHA</span><strong class="mono">${reference.repo ? `<a href="${reference.repo}/commit/${reference.sha}">${reference.sha.slice(0, 7)}</a>` : reference.sha.slice(0, 7)}</strong></div>
          </div>
        </section>
      ` : ''}
      <div class="results-table-card">
        <table>
          <thead>
            <tr>
              <th>Implementation</th>
              <th class="pass-rate-column">Pass Rate</th>
              <th>SHA</th>
            </tr>
          </thead>
          <tbody>
            ${implementations.map((s) => `
              <tr>
                <td><a href="#/impl/${s.impl}">${s.impl}</a></td>
                <td class="pass-rate-cell">
                  <div class="pass-rate-value">${s.passPct}%</div>
                  <div class="pass-rate-meta">${s.total} runnable · ${s.failed} failed</div>
                  <div class="bar-container full-width-bar">
                    <div class="bar-fill ${barClass(s.passPct)}" style="width: ${s.passPct}%"></div>
                  </div>
                </td>
                <td class="mono">${s.repo ? `<a href="${s.repo}/commit/${s.sha}">${s.sha.slice(0, 7)}</a>` : s.sha.slice(0, 7)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderImplDetail(name, history, failures, summaryItem, exclusions = []) {
  const hasChart = history.length > 1;
  const latest = history.length > 0 ? history[history.length - 1] : null;
  const isReference = !!summaryItem?.isReference;
  const items = isReference ? exclusions : failures;
  const heading = isReference ? 'Excluded Tests' : 'Failing Tests';
  const emptyMessage = isReference ? 'No tests were excluded in the latest run.' : 'All runnable tests passing.';
  const summaryRate = latest ? `${latest.passPct}%` : 'No data';
  const summarySubtext = latest
    ? (isReference
      ? `${latest.total} runnable · ${latest.excluded || 0} excluded`
      : `${latest.total} runnable · ${latest.failed} failed`)
    : 'No history available';
  const metaItems = latest
    ? (isReference
      ? [
        { label: 'Run', value: formatTimestamp(summaryItem?.lastRun) },
        { label: 'Runnable', value: latest.total },
        { label: 'Excluded', value: latest.excluded || 0 },
        { label: 'Corpus', value: latest.corpusTotal ?? latest.total },
      ]
      : [
        { label: 'Run', value: formatTimestamp(summaryItem?.lastRun) },
        { label: 'Runnable', value: latest.total },
        { label: 'Failed', value: latest.failed },
      ])
    : [];
  const repoLink = summaryItem?.repo
    ? `<a href="${summaryItem.repo}/commit/${summaryItem.sha}">${summaryItem.sha.slice(0, 7)}</a>`
    : (summaryItem?.sha ? summaryItem.sha.slice(0, 7) : 'unknown');

  app.innerHTML = `
    <div class="detail-page">
      <a class="back" href="#">&larr; Back to summary</a>

      <section class="detail-summary-card">
        <div class="detail-summary-header">
          <div>
            <h2>${name}${isReference ? ' <span class="reference-pill inline-pill">Reference</span>' : ''}</h2>
            <p class="detail-subtitle">${isReference ? 'Reference implementation scored on runnable corpus cases.' : 'Implementation conformance on runnable reference cases.'}</p>
          </div>
        </div>

        <div class="detail-rate-row">
          <div>
            <div class="detail-rate">${summaryRate}</div>
            <div class="detail-subtext">${summarySubtext}</div>
          </div>
        </div>

        ${latest ? `
          <div class="bar-container detail-bar">
            <div class="bar-fill ${barClass(latest.passPct)}" style="width: ${latest.passPct}%"></div>
          </div>
        ` : ''}

        <div class="detail-meta-grid">
          ${metaItems.map((item) => `
            <div class="detail-meta-card">
              <span>${item.label}</span>
              <strong>${item.value}</strong>
            </div>
          `).join('')}
          <div class="detail-meta-card">
            <span>SHA</span>
            <strong class="mono">${repoLink}</strong>
          </div>
        </div>
      </section>

      ${hasChart ? `
        <section class="detail-section-card chart-card">
          <div class="detail-section-header">
            <h3>History</h3>
            <p>Pass rate over recorded runs.</p>
          </div>
          <div class="chart-container">
            <canvas id="history-chart" height="200"></canvas>
          </div>
        </section>
      ` : ''}

      <section class="detail-section-card">
        <div class="detail-section-header">
          <h3>${heading}</h3>
          <p>${items.length} failure${items.length === 1 ? '' : 's'} in the latest run.</p>
        </div>
        ${items.length === 0
          ? `<p class="empty">${emptyMessage}</p>`
          : `
            <table class="failures">
              <colgroup>
                <col class="test-id">
                <col class="details">
              </colgroup>
              <thead>
                <tr><th>Test ID</th><th>Details</th></tr>
              </thead>
              <tbody>
                ${items.map((f) => `
                  <tr>
                    <td class="mono">${formatTestKey(f.testKey)}</td>
                    <td>${formatFailureDetails(f)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `
        }
      </section>
    </div>
  `;

  if (hasChart) drawChart(history);
}

function drawChart(history) {
  const canvas = document.getElementById('history-chart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const pad = { top: 20, right: 20, bottom: 40, left: 50 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const dates = history.map((d) => d.date);
  const values = history.map((d) => d.passPct);
  const minY = Math.max(0, Math.min(...values) - 5);
  const maxY = 100;

  function x(i) { return pad.left + (i / (dates.length - 1)) * plotW; }
  function y(v) { return pad.top + (1 - (v - minY) / (maxY - minY)) * plotH; }

  // Grid
  ctx.strokeStyle = '#dee2e6';
  ctx.lineWidth = 0.5;
  for (let pct = Math.ceil(minY / 10) * 10; pct <= maxY; pct += 10) {
    const yy = y(pct);
    ctx.beginPath();
    ctx.moveTo(pad.left, yy);
    ctx.lineTo(w - pad.right, yy);
    ctx.stroke();

    ctx.fillStyle = '#868e96';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${pct}%`, pad.left - 8, yy + 4);
  }

  // X labels
  ctx.textAlign = 'center';
  ctx.fillStyle = '#868e96';
  const step = Math.max(1, Math.floor(dates.length / 6));
  for (let i = 0; i < dates.length; i += step) {
    ctx.fillText(dates[i], x(i), h - pad.bottom + 20);
  }

  // Line
  ctx.strokeStyle = '#364fc7';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < values.length; i++) {
    const px = x(i);
    const py = y(values[i]);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Dots
  ctx.fillStyle = '#364fc7';
  for (let i = 0; i < values.length; i++) {
    ctx.beginPath();
    ctx.arc(x(i), y(values[i]), 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

async function route() {
  const hash = location.hash || '#';

  try {
    if (hash.startsWith('#/impl/')) {
      const name = decodeURIComponent(hash.slice(7));
      const summary = await fetchJSON('data/summary.json');
      const summaryItem = summary.find((item) => item.impl === name) || null;
      const [history, failures, exclusions] = await Promise.all([
        fetchJSON(`data/impls/${name}/history.json`),
        fetchJSON(`data/impls/${name}/failures.json`),
        summaryItem?.isReference
          ? fetchJSON(`data/impls/${name}/exclusions.json`)
          : Promise.resolve([]),
      ]);
      renderImplDetail(name, history, failures, summaryItem, exclusions);
    } else {
      const summary = await fetchJSON('data/summary.json');
      renderDashboard(summary);
    }
  } catch (err) {
    app.innerHTML = `<p class="empty">Error loading data: ${err.message}</p>`;
  }
}

window.addEventListener('hashchange', route);
route();
