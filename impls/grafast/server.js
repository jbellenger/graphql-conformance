'use strict';

const http = require('http');
const crypto = require('crypto');
const graphql = require('graphql');
const { grafast, makeGrafastSchema, constant } = require('grafast');

const PORT = Number(process.env.PORT || 8080);

const {
  GraphQLNonNull,
  GraphQLList,
  GraphQLScalarType,
  GraphQLEnumType,
  GraphQLObjectType,
  GraphQLUnionType,
  GraphQLInterfaceType,
  GraphQLInt,
  GraphQLFloat,
  GraphQLString,
  GraphQLBoolean,
  GraphQLID,
} = graphql;

function compareByName(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function resolveValue(type, schema) {
  if (type instanceof GraphQLNonNull) return resolveValue(type.ofType, schema);
  if (type instanceof GraphQLList) return [resolveValue(type.ofType, schema), resolveValue(type.ofType, schema)];
  if (type === GraphQLInt) return 2;
  if (type === GraphQLFloat) return 3.14;
  if (type === GraphQLString) return 'str';
  if (type === GraphQLBoolean) return true;
  if (type === GraphQLID) return 'id';
  if (type instanceof GraphQLEnumType) return type.getValues()[0].value;
  if (type instanceof GraphQLObjectType) return {};
  if (type instanceof GraphQLUnionType) {
    const members = type.getTypes().slice().sort(compareByName);
    return { __typename: members[0].name };
  }
  if (type instanceof GraphQLInterfaceType) {
    const impls = schema.getImplementations(type).objects;
    if (impls.length === 0) return null;
    const sorted = impls.slice().sort(compareByName);
    return { __typename: sorted[sorted.length - 1].name };
  }
  if (type instanceof GraphQLScalarType) return 'str';
  return null;
}

function buildObjectPlans(schema) {
  const objects = {};
  for (const type of Object.values(schema.getTypeMap())) {
    if (!(type instanceof GraphQLObjectType) || type.name.startsWith('__')) continue;
    const plans = {};
    for (const [fieldName, field] of Object.entries(type.getFields())) {
      plans[fieldName] = function planField() {
        return constant(resolveValue(field.type, schema));
      };
    }
    objects[type.name] = { plans };
  }
  return objects;
}

function buildAbstractPlans(schema) {
  const interfaces = {};
  const unions = {};
  for (const type of Object.values(schema.getTypeMap())) {
    if (type.name.startsWith('__')) continue;
    const resolveType = (obj) => (obj && typeof obj.__typename === 'string' ? obj.__typename : null);
    if (type instanceof GraphQLInterfaceType) interfaces[type.name] = { resolveType };
    else if (type instanceof GraphQLUnionType) unions[type.name] = { resolveType };
  }
  return { interfaces, unions };
}

function buildHarnessSchema(schemaText, baseSchema) {
  const { interfaces, unions } = buildAbstractPlans(baseSchema);
  return makeGrafastSchema({
    typeDefs: schemaText,
    objects: buildObjectPlans(baseSchema),
    interfaces,
    unions,
  });
}

// grafast emits the older GraphQL incremental-delivery wire format: each
// subsequent payload is `{data, path, hasNext, errors?}` directly (no
// `incremental[]` wrapper). The conformer's merger expects the newer shape
// `{incremental: [{path, data|items}], hasNext}`. We translate here so the
// rest of the pipeline sees a consistent shape regardless of source impl.
function translateGrafastPatch(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (!('path' in payload)) return payload;
  const { data, path, errors, hasNext, extensions, label } = payload;
  const last = path[path.length - 1];
  const entry = typeof last === 'number' ? { path, items: [data] } : { path, data };
  if (errors) entry.errors = errors;
  if (label !== undefined) entry.label = label;
  const out = { incremental: [entry] };
  if (hasNext !== undefined) out.hasNext = hasNext;
  if (extensions !== undefined) out.extensions = extensions;
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleExecute(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ errors: [{ message: `invalid JSON body: ${err.message}` }] }));
    return;
  }

  const { schema: schemaText, query: queryText, variables, operationName } = body || {};
  if (typeof schemaText !== 'string' || typeof queryText !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ errors: [{ message: 'schema and query are required strings' }] }));
    return;
  }

  let baseSchema;
  let document;
  try {
    baseSchema = graphql.buildSchema(schemaText);
    document = graphql.parse(queryText);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ errors: [{ message: err.message }] }));
    return;
  }

  const schemaErrors = graphql.validateSchema(baseSchema);
  if (schemaErrors.length > 0) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ errors: schemaErrors }));
    return;
  }

  const validationErrors = graphql.validate(baseSchema, document);
  if (validationErrors.length > 0) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ errors: validationErrors }));
    return;
  }

  let schema;
  try {
    schema = buildHarnessSchema(schemaText, baseSchema);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ errors: [{ message: err.message }] }));
    return;
  }

  const result = await grafast({
    schema,
    source: queryText,
    variableValues: variables ?? undefined,
    operationName: operationName ?? undefined,
  });

  if (result && typeof result.next === 'function') {
    await writeMultipart(res, result);
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}

async function writeMultipart(res, iterator) {
  const boundary = crypto.randomBytes(16).toString('hex');
  res.writeHead(200, { 'Content-Type': `multipart/mixed; boundary=${boundary}` });
  const header = `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`;
  const trailer = `\r\n--${boundary}--\r\n`;

  let first = true;
  while (true) {
    const next = await iterator.next();
    if (next.done) break;
    const payload = first ? next.value : translateGrafastPatch(next.value);
    first = false;
    res.write(header);
    res.write(JSON.stringify(payload));
  }
  res.end(trailer);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (req.method === 'POST' && req.url === '/execute') {
    try {
      await handleExecute(req, res);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ errors: [{ message: String(err && err.message || err) }] }));
    }
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, '0.0.0.0', () => {
  process.stderr.write(`grafast driver listening on :${PORT}\n`);
});
