'use strict';

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const STREAM_PROTOCOL = 'conformer-stream-v1';

function loadBuildDependencies() {
  process.env.GRAPHILE_ENV ||= 'production';
  const buildPackagePath = path.join(__dirname, 'build', 'package.json');
  if (!fs.existsSync(buildPackagePath)) {
    throw new Error('Grafast build not found. Run `make build` before executing this harness.');
  }

  const requireFromBuild = createRequire(buildPackagePath);
  return {
    graphql: requireFromBuild('graphql'),
    ...requireFromBuild('grafast'),
  };
}

function compareByName(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function resolveValue(type, schema, graphql) {
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

  if (type instanceof GraphQLNonNull) {
    return resolveValue(type.ofType, schema, graphql);
  }
  if (type instanceof GraphQLList) {
    return [
      resolveValue(type.ofType, schema, graphql),
      resolveValue(type.ofType, schema, graphql),
    ];
  }
  if (type === GraphQLInt) return 2;
  if (type === GraphQLFloat) return 3.14;
  if (type === GraphQLString) return 'str';
  if (type === GraphQLBoolean) return true;
  if (type === GraphQLID) return 'id';
  if (type instanceof GraphQLEnumType) {
    return type.getValues()[0].value;
  }
  if (type instanceof GraphQLObjectType) {
    return {};
  }
  if (type instanceof GraphQLUnionType) {
    const members = type.getTypes().slice().sort(compareByName);
    return { __typename: members[0].name };
  }
  if (type instanceof GraphQLInterfaceType) {
    const impls = schema.getImplementations(type).objects;
    if (impls.length === 0) {
      return null;
    }
    const sorted = impls.slice().sort(compareByName);
    return { __typename: sorted[sorted.length - 1].name };
  }
  if (type instanceof GraphQLScalarType) {
    return 'str';
  }
  return null;
}

function buildObjectPlans(schema, constant, graphql) {
  const { GraphQLObjectType } = graphql;
  const objects = {};

  for (const type of Object.values(schema.getTypeMap())) {
    if (!(type instanceof GraphQLObjectType) || type.name.startsWith('__')) {
      continue;
    }

    const plans = {};
    for (const [fieldName, field] of Object.entries(type.getFields())) {
      plans[fieldName] = function planField() {
        return constant(resolveValue(field.type, schema, graphql));
      };
    }
    objects[type.name] = { plans };
  }

  return objects;
}

function buildAbstractTypePlans(schema, graphql) {
  const { GraphQLInterfaceType, GraphQLUnionType } = graphql;
  const interfaces = {};
  const unions = {};

  for (const type of Object.values(schema.getTypeMap())) {
    if (type.name.startsWith('__')) {
      continue;
    }

    if (type instanceof GraphQLInterfaceType) {
      interfaces[type.name] = {
        resolveType(obj) {
          return obj && typeof obj.__typename === 'string' ? obj.__typename : null;
        },
      };
    } else if (type instanceof GraphQLUnionType) {
      unions[type.name] = {
        resolveType(obj) {
          return obj && typeof obj.__typename === 'string' ? obj.__typename : null;
        },
      };
    }
  }

  return { interfaces, unions };
}

function buildHarnessSchema(schemaText, deps) {
  const { graphql, makeGrafastSchema, constant } = deps;
  const schema = graphql.buildSchema(schemaText);
  const { interfaces, unions } = buildAbstractTypePlans(schema, graphql);

  return makeGrafastSchema({
    typeDefs: schemaText,
    objects: buildObjectPlans(schema, constant, graphql),
    interfaces,
    unions,
  });
}

function writeProtocolEvent(event) {
  process.stdout.write(`${JSON.stringify({ protocol: STREAM_PROTOCOL, ...event })}\n`);
}

async function writeResult(result) {
  if (!result || typeof result.next !== 'function') {
    process.stdout.write(JSON.stringify(result));
    return;
  }

  let isFirstPayload = true;

  while (true) {
    const next = await result.next();
    if (next.done) {
      break;
    }
    const payload = next.value;
    if (payload == null) {
      continue;
    }

    if (isFirstPayload) {
      writeProtocolEvent({
        kind: 'initial',
        data: payload.data,
        errors: payload.errors,
        extensions: payload.extensions,
      });
      isFirstPayload = false;
    } else {
      const event = {
        kind: 'patch',
        errors: payload.errors,
        extensions: payload.extensions,
      };
      if (Object.prototype.hasOwnProperty.call(payload, 'path')) {
        event.path = payload.path;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'data')) {
        event.data = payload.data;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'items')) {
        event.items = payload.items;
      }
      if (Object.keys(event).length > 3 || event.path) {
        writeProtocolEvent(event);
      }
    }

    if (payload.hasNext === false) {
      writeProtocolEvent({ kind: 'complete' });
    }
  }
}

if (require.main === module) {
  const [schemaPath, queryPath, variablesPath] = process.argv.slice(2);

  if (!schemaPath || !queryPath) {
    process.stderr.write('Usage: node index.js <schema> <query> [<variables>]\n');
    process.exit(1);
  }

  const schemaText = fs.readFileSync(schemaPath, 'utf8');
  const queryText = fs.readFileSync(queryPath, 'utf8');
  const variableValues = variablesPath
    ? JSON.parse(fs.readFileSync(variablesPath, 'utf8'))
    : undefined;

  const deps = loadBuildDependencies();
  const schema = buildHarnessSchema(schemaText, deps);

  (async () => {
    const result = await deps.grafast({
      schema,
      source: queryText,
      variableValues,
    });
    await writeResult(result);
  })().catch((err) => {
    process.stderr.write(String(err) + '\n');
    process.exit(1);
  });
}

module.exports = { buildHarnessSchema, loadBuildDependencies, resolveValue, writeResult };
