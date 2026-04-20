'use strict';

const fs = require('fs');
const http = require('http');

function buildRequestBody(test) {
  const schema = fs.readFileSync(test.schemaPath, 'utf8');
  const query = fs.readFileSync(test.queryPath, 'utf8');
  const body = { schema, query };
  if (test.variablesPath) {
    body.variables = JSON.parse(fs.readFileSync(test.variablesPath, 'utf8'));
  }
  return body;
}

function parseContentType(headerValue) {
  if (!headerValue) return { type: '', params: {} };
  const [type, ...paramParts] = headerValue.split(';').map((p) => p.trim());
  const params = {};
  for (const part of paramParts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    let value = part.slice(eq + 1);
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    params[part.slice(0, eq).toLowerCase()] = value;
  }
  return { type: type.toLowerCase(), params };
}

function parseMultipartMixed(buf, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = 0;
  while (start < buf.length) {
    const idx = buf.indexOf(delimiter, start);
    if (idx === -1) break;
    if (start !== idx) parts.push(buf.slice(start, idx));
    start = idx + delimiter.length;
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break; // closing --
    if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
    else if (buf[start] === 0x0a) start += 1;
  }

  const results = [];
  for (const part of parts) {
    const raw = part.toString('utf8');
    const headerEnd = raw.search(/\r?\n\r?\n/);
    if (headerEnd === -1) continue;
    const headerBlock = raw.slice(0, headerEnd);
    const matchLen = /\r?\n\r?\n/.exec(raw.slice(headerEnd))[0].length;
    const bodyText = raw.slice(headerEnd + matchLen).replace(/(\r?\n)+$/, '');
    if (!bodyText) continue;
    try {
      results.push({ headers: headerBlock, body: JSON.parse(bodyText) });
    } catch {
      // ignore non-JSON parts
    }
  }
  return results;
}

function applyIncrementalMerge(initial, parts) {
  // Minimal merge: collect all incremental entries. For now, just return the initial payload
  // augmented with an `incremental` array so comparisons can be added later.
  // TODO(phase-1-followup): full defer/stream assembly once corpus contains such tests.
  const assembled = { ...initial };
  const incremental = [];
  for (const part of parts) {
    if (!part || !part.body) continue;
    if (part.body.incremental) incremental.push(...part.body.incremental);
  }
  if (incremental.length > 0) assembled.incremental = incremental;
  return assembled;
}

function executeHttp({ host, port, path: execPath, body, timeoutMs }) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  const options = {
    host,
    port,
    path: execPath,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': payload.length,
      Accept: 'application/json, multipart/mixed',
    },
    timeout: timeoutMs,
  };

  return new Promise((resolve) => {
    let settled = false;
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (settled) return;
        settled = true;
        const buf = Buffer.concat(chunks);
        const { type, params } = parseContentType(res.headers['content-type']);
        if (type === 'multipart/mixed' && params.boundary) {
          const parts = parseMultipartMixed(buf, params.boundary);
          if (parts.length === 0) {
            resolve({ error: 'empty multipart response' });
            return;
          }
          const initial = parts[0].body;
          const assembled = applyIncrementalMerge(initial, parts.slice(1));
          resolve({ result: assembled, status: res.statusCode });
          return;
        }
        const text = buf.toString('utf8');
        const status = res.statusCode;
        if (status >= 500) {
          let message = `driver returned status ${status}`;
          try {
            const parsed = JSON.parse(text);
            if (parsed && Array.isArray(parsed.errors) && parsed.errors[0] && parsed.errors[0].message) {
              message = parsed.errors[0].message;
            }
          } catch { /* body not JSON */ }
          resolve({ error: message, status, stderr: text });
          return;
        }
        try {
          resolve({ result: JSON.parse(text), status });
        } catch (err) {
          resolve({ error: `invalid JSON from driver: ${err.message}`, status, body: text });
        }
      });
    });

    req.on('timeout', () => {
      if (!settled) {
        settled = true;
        req.destroy();
        resolve({ error: 'timeout' });
      }
    });

    req.on('error', (err) => {
      if (!settled) {
        settled = true;
        resolve({ error: err.message });
      }
    });

    req.write(payload);
    req.end();
  });
}

async function checkHealth({ host, port, path: healthPath, timeoutMs = 2000 }) {
  return new Promise((resolve) => {
    let settled = false;
    const req = http.request({
      host, port, path: healthPath, method: 'GET', timeout: timeoutMs,
    }, (res) => {
      res.on('data', () => { });
      res.on('end', () => {
        if (settled) return;
        settled = true;
        resolve(res.statusCode === 200);
      });
    });
    req.on('timeout', () => {
      if (!settled) { settled = true; req.destroy(); resolve(false); }
    });
    req.on('error', () => {
      if (!settled) { settled = true; resolve(false); }
    });
    req.end();
  });
}

module.exports = {
  buildRequestBody,
  executeHttp,
  checkHealth,
  parseContentType,
  parseMultipartMixed,
};
