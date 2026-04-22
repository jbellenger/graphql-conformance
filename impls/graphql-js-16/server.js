'use strict';

const http = require('http');
const {
  buildSchema,
  execute,
  parse,
  validate,
  validateSchema,
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
} = require('graphql');

const PORT = Number(process.env.PORT || 8080);

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
    const members = type.getTypes().slice().sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    return { __typename: members[0].name };
  }
  if (type instanceof GraphQLInterfaceType) {
    const impls = schema.getImplementations(type).objects;
    const sorted = impls.slice().sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    return { __typename: sorted[sorted.length - 1].name };
  }
  if (type instanceof GraphQLScalarType) return 'str';
  return null;
}

function fieldResolver(_source, _args, _context, info) {
  return resolveValue(info.returnType, info.schema);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
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

  let schema;
  let document;
  try {
    schema = buildSchema(schemaText);
    document = parse(queryText);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ errors: [{ message: err.message }] }));
    return;
  }

  const schemaErrors = validateSchema(schema);
  if (schemaErrors.length > 0) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ errors: schemaErrors }));
    return;
  }

  const validationErrors = validate(schema, document);
  if (validationErrors.length > 0) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ errors: validationErrors }));
    return;
  }

  const result = await execute({
    schema,
    document,
    variableValues: variables ?? undefined,
    operationName: operationName ?? undefined,
    fieldResolver,
  });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
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
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ errors: [{ message: String(err && err.message || err) }] }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, '0.0.0.0', () => {
  process.stderr.write(`graphql-js-16 driver listening on :${PORT}\n`);
});
