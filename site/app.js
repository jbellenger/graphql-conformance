'use strict';

const app = document.getElementById('app');
const expandedFailureKeys = new Set();
const FAILURE_PREVIEW_ROWS = 4;
const STDERR_PREVIEW_LINES = 3;
let currentDetailState = null;
const BUILD_VERSION = (() => {
  const scriptSrc = document.currentScript?.src;
  if (!scriptSrc) return '';
  try {
    return new URL(scriptSrc, window.location.href).searchParams.get('v') || '';
  } catch {
    return '';
  }
})();

function withBuildVersion(url) {
  if (!BUILD_VERSION) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${encodeURIComponent(BUILD_VERSION)}`;
}

async function fetchJSON(url) {
  const res = await fetch(withBuildVersion(url));
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

function getFailureKey(failure) {
  return failure.testKey;
}

function highlightJsonText(text) {
  const json = escapeHtml(text);
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

function formatJsonWithHighlight(value) {
  return highlightJsonText(JSON.stringify(value, null, 2));
}

function buildJsonDiffRows(expected, actual) {
  const leftLines = JSON.stringify(expected, null, 2).split('\n');
  const rightLines = JSON.stringify(actual, null, 2).split('\n');
  const dp = Array.from({ length: leftLines.length + 1 }, () => Array(rightLines.length + 1).fill(0));

  for (let i = leftLines.length - 1; i >= 0; i -= 1) {
    for (let j = rightLines.length - 1; j >= 0; j -= 1) {
      if (leftLines[i] === rightLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < leftLines.length && j < rightLines.length) {
    if (leftLines[i] === rightLines[j]) {
      ops.push({ type: 'same', leftText: leftLines[i], rightText: rightLines[j] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'removed', leftText: leftLines[i], rightText: '' });
      i += 1;
    } else {
      ops.push({ type: 'added', leftText: '', rightText: rightLines[j] });
      j += 1;
    }
  }

  while (i < leftLines.length) {
    ops.push({ type: 'removed', leftText: leftLines[i], rightText: '' });
    i += 1;
  }

  while (j < rightLines.length) {
    ops.push({ type: 'added', leftText: '', rightText: rightLines[j] });
    j += 1;
  }

  const rows = [];
  for (let index = 0; index < ops.length; index += 1) {
    const op = ops[index];
    if (op.type !== 'removed') {
      if (op.type === 'same') {
        rows.push({
          leftText: op.leftText,
          rightText: op.rightText,
          leftClass: 'diff-same',
          rightClass: 'diff-same',
          mode: 'same',
        });
      } else {
        rows.push({
          leftText: '',
          rightText: op.rightText,
          leftClass: 'diff-empty',
          rightClass: 'diff-added',
          mode: 'added',
        });
      }
      continue;
    }

    const removedBlock = [];
    while (index < ops.length && ops[index].type === 'removed') {
      removedBlock.push(ops[index].leftText);
      index += 1;
    }

    const addedBlock = [];
    while (index < ops.length && ops[index].type === 'added') {
      addedBlock.push(ops[index].rightText);
      index += 1;
    }

    const paired = Math.min(removedBlock.length, addedBlock.length);
    for (let pairIndex = 0; pairIndex < paired; pairIndex += 1) {
      rows.push({
        leftText: removedBlock[pairIndex],
        rightText: addedBlock[pairIndex],
        leftClass: 'diff-removed',
        rightClass: 'diff-added',
        mode: 'modified',
      });
    }

    for (let pairIndex = paired; pairIndex < removedBlock.length; pairIndex += 1) {
      rows.push({
        leftText: removedBlock[pairIndex],
        rightText: '',
        leftClass: 'diff-removed',
        rightClass: 'diff-empty',
        mode: 'removed',
      });
    }

    for (let pairIndex = paired; pairIndex < addedBlock.length; pairIndex += 1) {
      rows.push({
        leftText: '',
        rightText: addedBlock[pairIndex],
        leftClass: 'diff-empty',
        rightClass: 'diff-added',
        mode: 'added',
      });
    }

    index -= 1;
  }

  return rows;
}

function renderCharDiff(text, otherText, variant) {
  let prefix = 0;
  while (
    prefix < text.length &&
    prefix < otherText.length &&
    text[prefix] === otherText[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < text.length - prefix &&
    suffix < otherText.length - prefix &&
    text[text.length - 1 - suffix] === otherText[otherText.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const start = text.slice(0, prefix);
  const changed = text.slice(prefix, text.length - suffix);
  const end = suffix > 0 ? text.slice(text.length - suffix) : '';

  return [
    start ? highlightJsonText(start) : '',
    changed ? `<span class="diff-char diff-char-${variant}">${highlightJsonText(changed)}</span>` : '',
    end ? highlightJsonText(end) : '',
  ].join('');
}

function renderJsonDiffLine(text, otherText, mode) {
  if (!text) return '&nbsp;';
  if (mode === 'modified-left') return renderCharDiff(text, otherText, 'removed');
  if (mode === 'modified-right') return renderCharDiff(text, otherText, 'added');
  return highlightJsonText(text);
}

function formatJsonDiff(expected, actual, options = {}) {
  const rows = buildJsonDiffRows(expected, actual);
  const maxRows = Number.isInteger(options.maxRows) ? options.maxRows : null;
  const visibleRows = maxRows === null ? rows : rows.slice(0, maxRows);
  const hiddenRows = rows.length - visibleRows.length;
  const truncated = hiddenRows > 0;
  return {
    truncated,
    html: `
      <div class="json-diff">
        <div class="json-diff-header">Expected</div>
        <div class="json-diff-header">Actual</div>
        ${visibleRows.map((row) => `
          <div class="json-diff-line ${row.leftClass}">${renderJsonDiffLine(row.leftText, row.rightText, row.mode === 'modified' ? 'modified-left' : row.mode)}</div>
          <div class="json-diff-line ${row.rightClass}">${renderJsonDiffLine(row.rightText, row.leftText, row.mode === 'modified' ? 'modified-right' : row.mode)}</div>
        `).join('')}
      </div>
    `,
  };
}

function formatTextPreview(text, options = {}) {
  const lines = text.trim().split('\n');
  const maxLines = Number.isInteger(options.maxLines) ? options.maxLines : null;
  const visibleLines = maxLines === null ? lines : lines.slice(0, maxLines);
  const hiddenLines = lines.length - visibleLines.length;
  const truncated = hiddenLines > 0;

  return {
    truncated,
    html: `<pre class="${options.className || 'detail-pre'}">${escapeHtml(visibleLines.join('\n'))}</pre>`,
  };
}

function canExpandFailure(failure) {
  if (failure.expected && failure.actual) {
    const diffRows = buildJsonDiffRows(failure.expected, failure.actual);
    if (diffRows.length > FAILURE_PREVIEW_ROWS) return true;
  }

  if (failure.stderr) {
    const stderrLines = failure.stderr.trim().split('\n');
    if (stderrLines.length > STDERR_PREVIEW_LINES) return true;
  }

  return false;
}

function formatFailureContent(failure, expanded) {
  const parts = [];

  if (failure.expected && failure.actual) {
    const diff = formatJsonDiff(failure.expected, failure.actual, {
      maxRows: expanded ? null : FAILURE_PREVIEW_ROWS,
    });
    parts.push(`<div class="failure-diff-block">${diff.html}</div>`);
  } else {
    const jsonParts = [];

    if (failure.expected) {
      jsonParts.push(`
        <div class="failure-json-block">
          <div class="detail-label">Expected</div>
          <pre class="detail-pre detail-json">${formatJsonWithHighlight(failure.expected)}</pre>
        </div>
      `);
    }

    if (failure.actual) {
      jsonParts.push(`
        <div class="failure-json-block">
          <div class="detail-label">Actual</div>
          <pre class="detail-pre detail-json">${formatJsonWithHighlight(failure.actual)}</pre>
        </div>
      `);
    }

    if (jsonParts.length > 0) {
      parts.push(`<div class="failure-json-grid">${jsonParts.join('')}</div>`);
    }
  }

  if (failure.stderr) {
    const stderr = formatTextPreview(failure.stderr, {
      maxLines: expanded ? null : STDERR_PREVIEW_LINES,
    });
    parts.push(`
      <div class="failure-extra-block">
        <div class="detail-label">stderr</div>
        ${stderr.html}
      </div>
    `);
  }

  return { html: parts.join('') };
}

function formatFailureCard(failure) {
  const failureKey = getFailureKey(failure);
  const expanded = expandedFailureKeys.has(failureKey);
  const expandable = canExpandFailure(failure);
  const content = formatFailureContent(failure, expanded);
  const summary = failure.error || (failure.expected && failure.actual ? 'Output differs' : 'Failed');
  const collapsed = expandable && !expanded;

  return `
    <article
      class="failure-card${expanded ? ' is-expanded' : ''}${collapsed ? ' is-collapsed' : ''}${expandable ? ' is-interactive' : ''}"
      data-failure-key="${encodeURIComponent(failureKey)}"
      data-expandable="${expandable ? 'true' : 'false'}"
      ${expandable ? `tabindex="0" role="button" aria-expanded="${expanded ? 'true' : 'false'}"` : 'role="group"'}
    >
      <div class="failure-card-header">
        <div class="failure-card-heading">
          <div class="failure-card-label">Test</div>
          <div class="failure-card-title mono">${formatTestKey(failure.testKey)}</div>
        </div>
        ${expandable ? `<span class="failure-card-chip">${expanded ? 'Collapse' : 'Expand'}</span>` : ''}
      </div>
      <div class="failure-card-summary">${escapeHtml(summary)}</div>
      ${content.html ? `<div class="failure-card-body">${content.html}</div>` : ''}
    </article>
  `;
}

function renderNoFailuresSection() {
  return `
    <section class="detail-section-card zero-failures-card">
      <div class="zero-failures-art" aria-hidden="true">
        <svg viewBox="0 0 96 96" role="presentation">
          <defs>
            <linearGradient id="zero-failures-glow" x1="0%" x2="100%" y1="0%" y2="100%">
              <stop offset="0%" stop-color="#d3f9d8" />
              <stop offset="100%" stop-color="#e7f5ff" />
            </linearGradient>
            <linearGradient id="zero-failures-face" x1="0%" x2="100%" y1="0%" y2="100%">
              <stop offset="0%" stop-color="#fffef5" />
              <stop offset="100%" stop-color="#f8fff8" />
            </linearGradient>
          </defs>
          <circle cx="48" cy="48" r="34" fill="url(#zero-failures-glow)" />
          <circle cx="48" cy="48" r="23" fill="url(#zero-failures-face)" stroke="#2b8a3e" stroke-width="3" />
          <circle cx="39.5" cy="43" r="2.7" fill="#1a1a2e" />
          <circle cx="56.5" cy="43" r="2.7" fill="#1a1a2e" />
          <path d="M39 53.5c2.2 3 5.5 4.5 9 4.5s6.8-1.5 9-4.5" fill="none" stroke="#1a1a2e" stroke-linecap="round" stroke-width="3.4" />
          <circle cx="33.5" cy="50" r="3" fill="#ffa8a8" opacity="0.7" />
          <circle cx="62.5" cy="50" r="3" fill="#ffa8a8" opacity="0.7" />
          <path d="M28.5 28.5 34.5 34.5 45 24" fill="none" stroke="#3b5bdb" stroke-linecap="round" stroke-linejoin="round" stroke-width="4.5" />
          <path d="M24 68h8M28 64v8M67 25h6M70 22v6M70 69h8M74 65v8" fill="none" stroke="#3b5bdb" stroke-linecap="round" stroke-width="3.5" />
        </svg>
      </div>
      <div class="zero-failures-copy">
        <h3>No failures in this run</h3>
        <p>All tests passed.</p>
      </div>
    </section>
  `;
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
              <tr class="dashboard-row" data-impl="${encodeURIComponent(s.impl)}" tabindex="0" role="link" aria-label="View ${escapeHtml(s.impl)} details">
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

function renderImplDetail(name, history, failures, summaryItem, exclusions = [], options = {}) {
  if (options.resetExpanded) expandedFailureKeys.clear();
  currentDetailState = { name, history, failures, summaryItem, exclusions };
  const hasChart = history.length > 1;
  const latest = history.length > 0 ? history[history.length - 1] : null;
  const isReference = !!summaryItem?.isReference;
  const items = isReference ? exclusions : failures;
  const heading = isReference ? 'Excluded Tests' : 'Failing Tests';
  const emptyMessage = isReference ? 'No tests were excluded in the latest run.' : 'All runnable tests passing.';
  const itemLabel = isReference ? 'exclusions' : 'failures';
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
  const detailsSection = !isReference && items.length === 0
    ? renderNoFailuresSection()
    : `
      <section class="detail-section-card">
        <div class="detail-section-header">
          <h3>${heading}</h3>
          <p>${items.length} ${itemLabel} in the latest run.</p>
        </div>
        ${items.length === 0
          ? `<p class="empty">${emptyMessage}</p>`
          : `
            <div class="failure-list">
              ${items.map((f) => formatFailureCard(f)).join('')}
            </div>
          `
        }
      </section>
    `;

  app.innerHTML = `
    <div class="detail-page">
      <a class="back" href="#">&larr; Back to summary</a>

      <section class="detail-summary-card">
        <div class="detail-summary-header">
          <div>
            <h2>${name}${isReference ? ' <span class="reference-pill inline-pill">Reference</span>' : ''}</h2>
            ${isReference ? '<p class="detail-subtitle">Reference implementation scored on runnable corpus cases.</p>' : ''}
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

      ${detailsSection}
    </div>
  `;

  if (hasChart) drawChart(history);
}

function rerenderCurrentDetail() {
  if (!currentDetailState) return;
  renderImplDetail(
    currentDetailState.name,
    currentDetailState.history,
    currentDetailState.failures,
    currentDetailState.summaryItem,
    currentDetailState.exclusions,
    { resetExpanded: false },
  );
}

function toggleFailureCard(failureKey) {
  if (expandedFailureKeys.has(failureKey)) expandedFailureKeys.delete(failureKey);
  else expandedFailureKeys.add(failureKey);
  rerenderCurrentDetail();
  const card = document.querySelector(`[data-failure-key="${encodeURIComponent(failureKey)}"]`);
  if (card && typeof card.focus === 'function') card.focus();
}

function getEventElement(event) {
  if (event.target instanceof Element) return event.target;
  if (event.target && event.target.parentElement) return event.target.parentElement;
  return null;
}

function shouldToggleFailureCard(card, target) {
  if (!card || !target) return false;

  const expanded = card.getAttribute('aria-expanded') === 'true';
  if (!expanded) return true;

  if (target.closest('.failure-card-chip')) return true;
  if (target.closest('.json-diff') || target.closest('.detail-pre')) return false;
  return true;
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
      renderImplDetail(name, history, failures, summaryItem, exclusions, { resetExpanded: true });
    } else {
      currentDetailState = null;
      expandedFailureKeys.clear();
      const summary = await fetchJSON('data/summary.json');
      renderDashboard(summary);
    }
  } catch (err) {
    currentDetailState = null;
    app.innerHTML = `<p class="empty">Error loading data: ${err.message}</p>`;
  }
}

app.addEventListener('click', (event) => {
  const target = getEventElement(event);
  if (!target) return;
  if (!target.closest('.dashboard-row') && target.closest('a')) return;

  const dashboardRow = target.closest('.dashboard-row');
  if (dashboardRow) {
    location.hash = `#/impl/${decodeURIComponent(dashboardRow.dataset.impl)}`;
    return;
  }

  if (target.closest('a')) return;
  const card = target.closest('.failure-card');
  if (!card || card.dataset.expandable !== 'true') return;
  if (!shouldToggleFailureCard(card, target)) return;
  toggleFailureCard(decodeURIComponent(card.dataset.failureKey));
});

app.addEventListener('keydown', (event) => {
  const target = getEventElement(event);
  if (!target) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;

  const dashboardRow = target.closest('.dashboard-row');
  if (dashboardRow) {
    if (target.closest('a')) return;
    event.preventDefault();
    location.hash = `#/impl/${decodeURIComponent(dashboardRow.dataset.impl)}`;
    return;
  }

  if (target.closest('a')) return;
  const card = target.closest('.failure-card');
  if (!card || card.dataset.expandable !== 'true') return;
  event.preventDefault();
  toggleFailureCard(decodeURIComponent(card.dataset.failureKey));
});

window.addEventListener('hashchange', route);
route();
