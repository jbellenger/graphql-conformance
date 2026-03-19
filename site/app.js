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

function formatFailureDetails(f) {
  const summary = f.error || (f.expected && f.actual ? 'output differs' : 'failed');

  const parts = [];
  if (f.stderr) {
    parts.push(`<div class="detail-label">stderr</div><pre class="detail-pre">${escapeHtml(f.stderr.trim())}</pre>`);
  }
  if (f.expected) {
    parts.push(`<div class="detail-label">expected</div><pre class="detail-pre">${escapeHtml(JSON.stringify(f.expected, null, 2))}</pre>`);
  }
  if (f.actual) {
    parts.push(`<div class="detail-label">actual</div><pre class="detail-pre">${escapeHtml(JSON.stringify(f.actual, null, 2))}</pre>`);
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
  summary.sort((a, b) => b.passPct - a.passPct || a.impl.localeCompare(b.impl));

  app.innerHTML = `
    <h2>Conformance Summary</h2>
    <table>
      <thead>
        <tr>
          <th>Implementation</th>
          <th>Pass Rate</th>
          <th></th>
          <th>Tests</th>
          <th>Failed</th>
          <th>SHA</th>
        </tr>
      </thead>
      <tbody>
        ${summary.map((s) => `
          <tr>
            <td><a href="#/impl/${s.impl}">${s.impl}</a></td>
            <td>${s.passPct}%</td>
            <td>
              <div class="bar-container">
                <div class="bar-fill ${barClass(s.passPct)}" style="width: ${s.passPct}%"></div>
              </div>
            </td>
            <td>${s.total}</td>
            <td>${s.failed}</td>
            <td class="mono">${s.repo ? `<a href="${s.repo}/commit/${s.sha}">${s.sha.slice(0, 7)}</a>` : s.sha.slice(0, 7)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderImplDetail(name, history, failures) {
  const hasChart = history.length > 1;

  app.innerHTML = `
    <a class="back" href="#">&larr; Back to summary</a>
    <h2>${name}</h2>

    ${hasChart ? `
      <div class="chart-container">
        <canvas id="history-chart" height="200"></canvas>
      </div>
    ` : `
      <p>Pass rate: <strong>${history.length > 0 ? history[history.length - 1].passPct : '—'}%</strong></p>
    `}

    <h3>Failing Tests (${failures.length})</h3>
    ${failures.length === 0
      ? '<p class="empty">All tests passing.</p>'
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
            ${failures.map((f) => `
              <tr>
                <td class="mono">${formatTestKey(f.testKey)}</td>
                <td>${formatFailureDetails(f)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `
    }
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
      const [history, failures] = await Promise.all([
        fetchJSON(`data/impls/${name}/history.json`),
        fetchJSON(`data/impls/${name}/failures.json`),
      ]);
      renderImplDetail(name, history, failures);
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
