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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(target, patch) {
  if (!isPlainObject(target) || !isPlainObject(patch)) return patch;
  for (const key of Object.keys(patch)) {
    target[key] = key in target ? deepMerge(target[key], patch[key]) : patch[key];
  }
  return target;
}

function navigate(root, path) {
  let current = root;
  for (const segment of path) {
    if (current == null) throw new Error(`cannot navigate into ${current} at segment ${segment}`);
    current = current[segment];
  }
  return current;
}

// Inserts streamed items into a list. Supports two spec forms:
//   - Direct path `["friends", 1]`: last segment is the insertion index; splice into parent.
//   - Pending-id resolved path `["friends"]` (no insertion index): append to the list itself.
function appendItemsAt(root, path, items) {
  if (path.length === 0) throw new Error('items patch path must not be empty');
  const last = path[path.length - 1];
  if (typeof last === 'number') {
    const parentPath = path.slice(0, -1);
    const parent = navigate(root, parentPath);
    if (!Array.isArray(parent)) {
      throw new Error(`items patch parent at ${JSON.stringify(parentPath)} is not an array`);
    }
    parent.splice(last, 0, ...items);
    return;
  }
  const target = navigate(root, path);
  if (!Array.isArray(target)) {
    throw new Error(`items patch target at ${JSON.stringify(path)} is not an array`);
  }
  target.push(...items);
}

// Merges a multipart GraphQL incremental-delivery response (initial + subsequent parts)
// into one `{data, errors?, extensions?}` object. `initial` is the parsed body of the
// first part; `parts` is an array of `{headers, body}` for the rest. See SPEC.md and
// https://github.com/graphql/graphql-over-http (Incremental Delivery).
function applyIncrementalMerge(initial, parts) {
  const result = {};
  if (initial && 'data' in initial) result.data = initial.data;
  const errors = Array.isArray(initial?.errors) ? [...initial.errors] : [];
  let extensions = isPlainObject(initial?.extensions) ? { ...initial.extensions } : undefined;

  const pendingPaths = new Map();
  if (Array.isArray(initial?.pending)) {
    for (const entry of initial.pending) {
      if (entry && entry.id != null && Array.isArray(entry.path)) {
        pendingPaths.set(String(entry.id), entry.path);
      }
    }
  }

  for (const part of parts) {
    const body = part && part.body;
    if (!body) continue;

    if (Array.isArray(body.pending)) {
      for (const entry of body.pending) {
        if (entry && entry.id != null && Array.isArray(entry.path)) {
          pendingPaths.set(String(entry.id), entry.path);
        }
      }
    }

    if (Array.isArray(body.errors)) errors.push(...body.errors);
    if (isPlainObject(body.extensions)) {
      extensions = { ...(extensions || {}), ...body.extensions };
    }

    if (!Array.isArray(body.incremental)) continue;
    for (const entry of body.incremental) {
      if (!entry) continue;

      let basePath = Array.isArray(entry.path) ? entry.path : null;
      if (basePath === null && entry.id != null) {
        basePath = pendingPaths.get(String(entry.id)) || null;
      }
      if (basePath === null) continue;
      const subPath = Array.isArray(entry.subPath) ? entry.subPath : [];
      const fullPath = basePath.concat(subPath);

      if (Array.isArray(entry.errors)) errors.push(...entry.errors);

      // Prefer `items` over `data` when both are present: some impls
      // (Hot Chocolate) emit `{"data": null, "items": [...]}` for @stream
      // patches, where the `data: null` is a placeholder that must not
      // overwrite the list slot.
      if (Array.isArray(entry.items)) {
        appendItemsAt(result.data, fullPath, entry.items);
      } else if ('data' in entry) {
        if (fullPath.length === 0) {
          result.data = isPlainObject(result.data) && isPlainObject(entry.data)
            ? deepMerge(result.data, entry.data)
            : entry.data;
        } else {
          const parentPath = fullPath.slice(0, -1);
          const key = fullPath[fullPath.length - 1];
          const parent = navigate(result.data, parentPath);
          if (parent == null) throw new Error(`deferred patch parent missing at ${JSON.stringify(parentPath)}`);
          parent[key] = isPlainObject(parent[key]) && isPlainObject(entry.data)
            ? deepMerge(parent[key], entry.data)
            : entry.data;
        }
      }
    }
  }

  if (errors.length > 0) result.errors = errors;
  if (extensions && Object.keys(extensions).length > 0) result.extensions = extensions;
  return result;
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
  applyIncrementalMerge,
};
