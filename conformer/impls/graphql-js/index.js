'use strict';

const fs = require('fs');
const {
  buildSchema,
  execute,
  parse,
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

function resolveValue(type, schema) {
  if (type instanceof GraphQLNonNull) {
    return resolveValue(type.ofType, schema);
  }
  if (type instanceof GraphQLList) {
    return [resolveValue(type.ofType, schema), resolveValue(type.ofType, schema)];
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
    const members = type.getTypes().slice().sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    return { __typename: members[0].name };
  }
  if (type instanceof GraphQLInterfaceType) {
    const impls = schema.getImplementations(type).objects;
    const sorted = impls.slice().sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    return { __typename: sorted[sorted.length - 1].name };
  }
  if (type instanceof GraphQLScalarType) {
    return 'str';
  }
  return null;
}

function fieldResolver(_source, _args, _context, info) {
  return resolveValue(info.returnType, info.schema);
}

if (require.main === module) {
  const [schemaPath, queryPath, variablesPath] = process.argv.slice(2);

  if (!schemaPath || !queryPath) {
    process.stderr.write('Usage: node conformer-harness.js <schema> <query> [<variables>]\n');
    process.exit(1);
  }

  const schemaText = fs.readFileSync(schemaPath, 'utf8');
  const queryText = fs.readFileSync(queryPath, 'utf8');
  const variables = variablesPath
    ? JSON.parse(fs.readFileSync(variablesPath, 'utf8'))
    : undefined;

  const schema = buildSchema(schemaText);
  const document = parse(queryText);

  (async () => {
    const result = await execute({
      schema,
      document,
      variableValues: variables,
      fieldResolver,
    });
    process.stdout.write(JSON.stringify(result));
  })().catch((err) => {
    process.stderr.write(String(err) + '\n');
    process.exit(1);
  });
}

module.exports = { resolveValue, fieldResolver };
