'use strict';

const {
  buildSchema,
  getNamedType,
  Kind,
  parse,
  print,
  TypeInfo,
  visit,
  visitWithTypeInfo,
} = require('graphql');

function normalizeQuery(schemaText, queryText) {
  const schema = buildSchema(schemaText, { assumeValidSDL: true });
  const typeInfo = new TypeInfo(schema);
  const document = parse(queryText);

  const rewritten = visit(document, visitWithTypeInfo(typeInfo, {
    InlineFragment: {
      enter(node) {
        if (node.typeCondition) {
          return undefined;
        }

        const currentType = getNamedType(typeInfo.getType());
        if (!currentType) {
          return undefined;
        }

        return {
          ...node,
          typeCondition: {
            kind: Kind.NAMED_TYPE,
            name: {
              kind: Kind.NAME,
              value: currentType.name,
            },
          },
        };
      },
    },
  }));

  return print(rewritten);
}

module.exports = {
  normalizeQuery,
};
