'use strict';

(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.GQLCRender = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const FAILURE_PREVIEW_ROWS = 4;
  const STDERR_PREVIEW_LINES = 3;
  const REPO_URL = 'https://github.com/jbellenger/graphql-conformance/blob/master';

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

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

  function getTestPathText(testKey) {
    return `corpus/${testKey}`;
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

  function formatJsonSingle(value, options = {}) {
    const lines = JSON.stringify(value, null, 2).split('\n');
    const maxRows = Number.isInteger(options.maxRows) ? options.maxRows : null;
    const visibleLines = maxRows === null ? lines : lines.slice(0, maxRows);
    const truncated = visibleLines.length < lines.length;
    const header = typeof options.header === 'string' ? options.header : 'Response';
    return {
      truncated,
      html: `
        <div class="json-diff json-diff-single">
          <div class="json-diff-header">${escapeHtml(header)}</div>
          ${visibleLines.map((line) => `
            <div class="json-diff-line diff-same">${line ? highlightJsonText(line) : '&nbsp;'}</div>
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

  function computeReferenceDisplay(reference) {
    if (!reference) return null;
    const corpus = reference.corpusTotal != null ? reference.corpusTotal : (reference.total || 0);
    const excluded = reference.excluded || 0;
    const errors = reference.failed || 0;
    const failed = errors + excluded;
    const passed = Math.max(0, corpus - failed);
    const passPct = corpus > 0 ? Math.round((passed / corpus) * 1000) / 10 : 100;
    return { total: corpus, excluded, failed, passed, passPct };
  }

  function referenceResponseFromFailure(failure) {
    if (failure.response !== undefined && failure.response !== null) return failure.response;
    if (Array.isArray(failure.errors) && failure.errors.length > 0) {
      return { data: null, errors: failure.errors };
    }
    return null;
  }

  function canExpandFailure(failure) {
    if (failure.expected && failure.actual) {
      const diffRows = buildJsonDiffRows(failure.expected, failure.actual);
      if (diffRows.length > FAILURE_PREVIEW_ROWS) return true;
    }

    const response = referenceResponseFromFailure(failure);
    if (response) {
      const lines = JSON.stringify(response, null, 2).split('\n');
      if (lines.length > FAILURE_PREVIEW_ROWS) return true;
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

    const referenceResponse = referenceResponseFromFailure(failure);
    if (referenceResponse) {
      const response = formatJsonSingle(referenceResponse, {
        header: 'Response',
        maxRows: expanded ? null : FAILURE_PREVIEW_ROWS,
      });
      parts.push(`<div class="failure-diff-block">${response.html}</div>`);
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

  function formatFailureCard(failure, options = {}) {
    const expanded = Boolean(options.expanded);
    const expandable = canExpandFailure(failure);
    const content = formatFailureContent(failure, expanded);
    const hasReferenceResponse = referenceResponseFromFailure(failure) !== null;
    const summary = failure.error
      || (failure.expected && failure.actual ? 'Output differs' : (hasReferenceResponse ? 'Reference response' : 'Failed'));
    const collapsed = expandable && !expanded;
    const testPath = getTestPathText(failure.testKey);
    const failureKey = getFailureKey(failure);

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
            <div class="failure-card-title-row">
              <div class="failure-card-title mono">${formatTestKey(failure.testKey)}</div>
              <button
                type="button"
                class="failure-card-copy"
                data-copy-text="${escapeHtml(testPath)}"
                aria-label="Copy ${escapeHtml(testPath)}"
                title="Copy test path"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <path d="M7 3.5A2.5 2.5 0 0 1 9.5 1h5A2.5 2.5 0 0 1 17 3.5v7A2.5 2.5 0 0 1 14.5 13h-5A2.5 2.5 0 0 1 7 10.5z" />
                  <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H6v1.5h-.5A1 1 0 0 0 4.5 7.5v7a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V14H13v.5A2.5 2.5 0 0 1 10.5 17h-5A2.5 2.5 0 0 1 3 14.5z" />
                </svg>
              </button>
            </div>
          </div>
          ${expandable ? `<span class="failure-card-chip">${expanded ? 'Collapse' : 'Expand'}</span>` : ''}
        </div>
        <div class="failure-card-summary">${escapeHtml(summary)}</div>
        ${content.html ? `<div class="failure-card-body">${content.html}</div>` : ''}
      </article>
    `;
  }

  return {
    FAILURE_PREVIEW_ROWS,
    STDERR_PREVIEW_LINES,
    REPO_URL,
    escapeHtml,
    formatTestKey,
    getTestPathText,
    getFailureKey,
    highlightJsonText,
    formatJsonWithHighlight,
    buildJsonDiffRows,
    renderCharDiff,
    renderJsonDiffLine,
    formatJsonDiff,
    formatJsonSingle,
    formatTextPreview,
    computeReferenceDisplay,
    referenceResponseFromFailure,
    canExpandFailure,
    formatFailureContent,
    formatFailureCard,
  };
});
