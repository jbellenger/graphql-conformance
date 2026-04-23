'use strict';

const {
  escapeHtml,
  formatFailureCard: renderFailureCard,
  getFailureKey,
  computeReferenceDisplay,
} = window.GQLCRender;

const app = document.getElementById('app');
const expandedFailureKeys = new Set();
let currentDetailState = null;

function happyFaceImg(className) {
  return `<img src="icons/happy-face.svg" class="${className}" alt="">`;
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

function formatTimestamp(timestamp) {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return escapeHtml(String(timestamp));
  return escapeHtml(date.toLocaleString());
}

function formatFailureCard(failure) {
  return renderFailureCard(failure, {
    expanded: expandedFailureKeys.has(getFailureKey(failure)),
  });
}

function renderNoFailuresSection() {
  return `
    <section class="detail-section-card zero-failures-card">
      <div class="zero-failures-art" aria-hidden="true">
        ${happyFaceImg('zero-failures-art-img')}
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

  const refDisplay = computeReferenceDisplay(reference);
  const corpusTotal = refDisplay ? refDisplay.total : 0;
  const excludedCount = refDisplay ? refDisplay.excluded : 0;

  app.innerHTML = `
    <h2>Conformance Summary</h2>
    <div class="dashboard-layout">
      ${reference && refDisplay ? `
        <section class="reference-card" data-impl="${encodeURIComponent(reference.impl)}" tabindex="0" role="link" aria-label="View ${escapeHtml(reference.impl)} details">
          <div class="reference-card-header">
            <span class="reference-pill">Reference</span>
            <a class="reference-link" href="#/impl/${reference.impl}">${reference.impl}</a>
          </div>
          <div class="reference-rate">${refDisplay.passPct}%</div>
          <div class="reference-subtext">${refDisplay.total} total · ${refDisplay.failed} failed</div>
          ${refDisplay.failed > 0 ? `
            <div class="reference-note">Failed entries are excluded from conformance tests</div>
          ` : ''}
          <div class="bar-container reference-bar">
            <div class="bar-fill ${barClass(refDisplay.passPct)}" style="width: ${refDisplay.passPct}%"></div>
          </div>
          <div class="reference-meta">
            <div><span>Version</span><strong class="mono">${renderVersion(reference)}</strong></div>
          </div>
        </section>
      ` : ''}
      <div class="results-table-card">
        <table>
          <thead>
            <tr>
              <th>Implementation</th>
              <th class="pass-rate-column">Pass Rate</th>
              <th>Version</th>
            </tr>
          </thead>
          <tbody>
            ${implementations.map((s) => `
              <tr class="dashboard-row" data-impl="${encodeURIComponent(s.impl)}" tabindex="0" role="link" aria-label="View ${escapeHtml(s.impl)} details">
                <td><a href="#/impl/${s.impl}">${s.impl}</a></td>
                <td class="pass-rate-cell">
                  <div class="pass-rate-value">${s.passPct}%</div>
                  <div class="pass-rate-meta">${corpusTotal} total · ${excludedCount} excluded · ${s.failed} failed</div>
                  <div class="bar-container full-width-bar">
                    <div class="bar-fill ${barClass(s.passPct)}" style="width: ${s.passPct}%"></div>
                  </div>
                </td>
                <td class="mono">${renderVersion(s)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderVersion(item) {
  if (!item || !item.version) return 'unknown';
  const text = escapeHtml(item.version);
  if (item.versionUrl) return `<a href="${escapeHtml(item.versionUrl)}">${text}</a>`;
  return text;
}

function renderImplDetail(name, history, failures, summaryItem, exclusions = [], referenceSummary = null, options = {}) {
  if (options.resetExpanded) expandedFailureKeys.clear();
  currentDetailState = { name, history, failures, summaryItem, exclusions, referenceSummary };
  const isReference = !!summaryItem?.isReference;

  const displayHistory = isReference
    ? history.map((entry) => {
      const d = computeReferenceDisplay(entry);
      if (!d) return entry;
      return { ...entry, passPct: d.passPct, total: d.total, failed: d.failed };
    })
    : history;

  const hasChart = displayHistory.length > 1;
  const latest = displayHistory.length > 0 ? displayHistory[displayHistory.length - 1] : null;
  const refDisplay = isReference ? computeReferenceDisplay(summaryItem) : null;

  const items = isReference ? exclusions : failures;
  const heading = 'Failing Tests';
  const itemLabel = 'failures';
  const summaryRate = latest ? `${latest.passPct}%` : 'No data';

  const summarySubtext = latest
    ? (isReference
      ? `${refDisplay.total} total · ${refDisplay.failed} failed`
      : (referenceSummary
        ? `${referenceSummary.corpusTotal ?? latest.total} total · ${referenceSummary.excluded || 0} excluded · ${latest.failed} failed`
        : `${latest.total} total · ${latest.failed} failed`))
    : 'No history available';

  const failedHref = (count) => (count > 0 ? `#/impl/${name}/failures` : null);
  const metaItems = latest
    ? (isReference
      ? [
        { label: 'Run', value: formatTimestamp(summaryItem?.lastRun) },
        { label: 'Total', value: refDisplay.total },
        { label: 'Failed', value: refDisplay.failed, href: failedHref(refDisplay.failed) },
      ]
      : (referenceSummary
        ? [
          { label: 'Run', value: formatTimestamp(summaryItem?.lastRun) },
          { label: 'Total', value: referenceSummary.corpusTotal ?? latest.total },
          {
            label: 'Excluded',
            value: referenceSummary.excluded || 0,
            href: referenceSummary.excluded > 0 ? `#/impl/${referenceSummary.impl}/failures` : null,
          },
          { label: 'Failed', value: latest.failed, href: failedHref(latest.failed) },
        ]
        : [
          { label: 'Run', value: formatTimestamp(summaryItem?.lastRun) },
          { label: 'Total', value: latest.total },
          { label: 'Failed', value: latest.failed, href: failedHref(latest.failed) },
        ]))
    : [];

  const versionCell = renderVersion(summaryItem);
  const detailsSection = items.length === 0
    ? renderNoFailuresSection()
    : `
      <section id="failures" class="detail-section-card">
        <div class="detail-section-header">
          <h3>${heading}</h3>
          <p>${items.length} ${itemLabel} in the latest run.</p>
        </div>
        <div class="failure-list">
          ${items.map((f) => formatFailureCard(f)).join('')}
        </div>
      </section>
    `;

  const referenceNote = isReference && refDisplay && refDisplay.failed > 0
    ? '<div class="reference-note">Failed entries are excluded from conformance tests</div>'
    : '';

  app.innerHTML = `
    <div class="detail-page">
      <a class="back" href="#">&larr; Back to summary</a>

      <section class="detail-summary-card">
        <div class="detail-summary-header">
          <div>
            <h2>${name}${isReference ? ' <span class="reference-pill inline-pill">Reference</span>' : ''}</h2>
          </div>
        </div>

        <div class="detail-rate-row">
          <div>
            <div class="detail-rate">${summaryRate}</div>
            <div class="detail-subtext">${summarySubtext}</div>
            ${referenceNote}
          </div>
        </div>

        ${latest ? `
          <div class="bar-container detail-bar">
            <div class="bar-fill ${barClass(latest.passPct)}" style="width: ${latest.passPct}%"></div>
          </div>
        ` : ''}

        <div class="detail-meta-grid">
          ${metaItems.map((item) => {
            const emote = item.label === 'Failed' && item.value === 0
              ? happyFaceImg('detail-meta-emote')
              : '';
            const value = item.href
              ? `<a href="${item.href}">${item.value}</a>`
              : item.value;
            return `
              <div class="detail-meta-card">
                <span>${item.label}</span>
                <strong>${value}</strong>
                ${emote}
              </div>
            `;
          }).join('')}
          <div class="detail-meta-card">
            <span>Version</span>
            <strong class="mono">${versionCell}</strong>
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
            <div id="history-chart"></div>
          </div>
        </section>
      ` : ''}

      ${detailsSection}
    </div>
  `;

  if (hasChart) drawChart(displayHistory);
}

function rerenderCurrentDetail() {
  if (!currentDetailState) return;
  renderImplDetail(
    currentDetailState.name,
    currentDetailState.history,
    currentDetailState.failures,
    currentDetailState.summaryItem,
    currentDetailState.exclusions,
    currentDetailState.referenceSummary,
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

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

let copyResetTimer = null;
let copiedButton = null;

function resetCopyButton(button) {
  if (!button) return;
  const text = button.dataset.copyText;
  button.classList.remove('is-copied');
  if (text) {
    button.setAttribute('aria-label', `Copy ${text}`);
  }
  button.setAttribute('title', 'Copy test path');
}

async function handleCopyButton(button) {
  const text = button.dataset.copyText;
  if (!text) return;

  try {
    if (copyResetTimer) window.clearTimeout(copyResetTimer);
    if (copiedButton && copiedButton !== button) resetCopyButton(copiedButton);

    await copyText(text);
    button.classList.add('is-copied');
    button.setAttribute('aria-label', `Copied ${text}`);
    button.setAttribute('title', 'Copied');
    copiedButton = button;
    copyResetTimer = window.setTimeout(() => {
      resetCopyButton(button);
      if (copiedButton === button) copiedButton = null;
    }, 1200);
  } catch {
    button.setAttribute('title', 'Copy failed');
  }
}

function shouldToggleFailureCard(card, target) {
  if (!card || !target) return false;

  const expanded = card.getAttribute('aria-expanded') === 'true';
  if (!expanded) return true;

  if (target.closest('.failure-card-chip')) return true;
  if (target.closest('.json-diff') || target.closest('.detail-pre')) return false;
  return true;
}

let currentChart = null;

function buildVersionAnnotations(history) {
  const points = [];
  let lastVersion = null;
  for (const entry of history) {
    if (entry.version && entry.version !== lastVersion) {
      if (lastVersion !== null) {
        points.push({
          x: new Date(entry.date).getTime(),
          label: {
            text: `v${entry.version}`,
            borderColor: '#adb5bd',
            style: {
              color: '#1a1a2e',
              background: '#fff',
              fontSize: '11px',
              fontWeight: 500,
            },
          },
        });
      }
      lastVersion = entry.version;
    }
  }
  return points;
}

function drawChart(history) {
  const target = document.getElementById('history-chart');
  if (!target || typeof ApexCharts === 'undefined') return;

  if (currentChart) {
    currentChart.destroy();
    currentChart = null;
  }

  const series = history.map((d) => ({ x: new Date(d.date).getTime(), y: d.passPct }));
  const minValue = history.reduce((m, d) => Math.min(m, d.passPct), 100);
  const yMin = minValue >= 95 ? 90 : minValue >= 75 ? Math.max(0, Math.floor(minValue / 5) * 5 - 5) : 0;

  const options = {
    chart: {
      type: 'line',
      height: 260,
      toolbar: { show: false },
      zoom: { enabled: false },
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      animations: { enabled: false },
    },
    series: [{ name: 'Pass rate', data: series }],
    stroke: { curve: 'straight', width: 2.5, colors: ['#364fc7'] },
    markers: { size: 4, colors: ['#364fc7'], strokeColors: '#fff', strokeWidth: 2, hover: { size: 6 } },
    grid: { borderColor: '#e9ecef', strokeDashArray: 3, padding: { top: 0, right: 20, bottom: 0, left: 10 } },
    xaxis: {
      type: 'datetime',
      labels: {
        datetimeUTC: false,
        format: 'MMM d',
        style: { colors: '#868e96', fontSize: '12px' },
      },
      axisBorder: { color: '#dee2e6' },
      axisTicks: { color: '#dee2e6' },
    },
    yaxis: {
      min: yMin,
      max: 100,
      tickAmount: 5,
      labels: {
        formatter: (v) => `${Math.round(v)}%`,
        style: { colors: '#868e96', fontSize: '12px' },
      },
    },
    tooltip: {
      x: { format: 'MMM d, yyyy' },
      y: {
        formatter: (value, { dataPointIndex }) => {
          const entry = history[dataPointIndex] || {};
          const parts = [`${value}%`];
          if (entry.total != null) parts.push(`(${entry.total - entry.failed}/${entry.total})`);
          if (entry.version) parts.push(`v${entry.version}`);
          return parts.join(' ');
        },
      },
    },
    annotations: { xaxis: buildVersionAnnotations(history) },
  };

  currentChart = new ApexCharts(target, options);
  currentChart.render();
}

async function route() {
  const hash = location.hash || '#';

  try {
    if (hash.startsWith('#/impl/')) {
      const rest = hash.slice(7);
      const slashIdx = rest.indexOf('/');
      const name = decodeURIComponent(slashIdx === -1 ? rest : rest.slice(0, slashIdx));
      const section = slashIdx === -1 ? null : rest.slice(slashIdx + 1);
      const summary = await fetchJSON('data/summary.json');
      const summaryItem = summary.find((item) => item.impl === name) || null;
      const referenceSummary = summary.find((item) => item.isReference) || null;
      const [history, failures, exclusions] = await Promise.all([
        fetchJSON(`data/impls/${name}/history.json`),
        fetchJSON(`data/impls/${name}/failures.json`),
        summaryItem?.isReference
          ? fetchJSON(`data/impls/${name}/exclusions.json`)
          : Promise.resolve([]),
      ]);
      const isSameImpl = currentDetailState?.name === name;
      renderImplDetail(name, history, failures, summaryItem, exclusions, referenceSummary, { resetExpanded: !isSameImpl });
      if (section) {
        const target = document.getElementById(section);
        if (target) target.scrollIntoView();
      }
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

  const copyButton = target.closest('.failure-card-copy');
  if (copyButton) {
    event.preventDefault();
    handleCopyButton(copyButton);
    return;
  }

  if (target.closest('a')) return;

  const referenceCard = target.closest('.reference-card');
  if (referenceCard && referenceCard.dataset.impl) {
    location.hash = `#/impl/${decodeURIComponent(referenceCard.dataset.impl)}`;
    return;
  }

  const dashboardRow = target.closest('.dashboard-row');
  if (dashboardRow) {
    location.hash = `#/impl/${decodeURIComponent(dashboardRow.dataset.impl)}`;
    return;
  }

  const card = target.closest('.failure-card');
  if (!card || card.dataset.expandable !== 'true') return;
  if (!shouldToggleFailureCard(card, target)) return;
  toggleFailureCard(decodeURIComponent(card.dataset.failureKey));
});

app.addEventListener('keydown', (event) => {
  const target = getEventElement(event);
  if (!target) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (target.closest('.failure-card-copy')) return;
  if (target.closest('a')) return;

  const referenceCard = target.closest('.reference-card');
  if (referenceCard && referenceCard.dataset.impl) {
    event.preventDefault();
    location.hash = `#/impl/${decodeURIComponent(referenceCard.dataset.impl)}`;
    return;
  }

  const dashboardRow = target.closest('.dashboard-row');
  if (dashboardRow) {
    event.preventDefault();
    location.hash = `#/impl/${decodeURIComponent(dashboardRow.dataset.impl)}`;
    return;
  }

  const card = target.closest('.failure-card');
  if (!card || card.dataset.expandable !== 'true') return;
  event.preventDefault();
  toggleFailureCard(decodeURIComponent(card.dataset.failureKey));
});

window.addEventListener('hashchange', route);
route();
