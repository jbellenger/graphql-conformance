package conformer;

import com.fasterxml.jackson.databind.ObjectMapper;
import graphql.ExecutionInput;
import graphql.ExecutionResult;
import graphql.GraphQL;
import graphql.language.BooleanValue;
import graphql.language.DirectiveDefinition;
import graphql.language.InputValueDefinition;
import graphql.language.NonNullType;
import graphql.language.ScalarTypeDefinition;
import graphql.language.TypeName;
import graphql.parser.ParserOptions;
import graphql.schema.Coercing;
import graphql.schema.DataFetcher;
import graphql.schema.GraphQLEnumType;
import graphql.schema.GraphQLInterfaceType;
import graphql.schema.GraphQLList;
import graphql.schema.GraphQLNamedOutputType;
import graphql.schema.GraphQLNamedType;
import graphql.schema.GraphQLNonNull;
import graphql.schema.GraphQLObjectType;
import graphql.schema.GraphQLOutputType;
import graphql.schema.GraphQLScalarType;
import graphql.schema.GraphQLSchema;
import graphql.schema.GraphQLUnionType;
import graphql.schema.TypeResolver;
import graphql.schema.idl.InterfaceWiringEnvironment;
import graphql.schema.idl.RuntimeWiring;
import graphql.schema.idl.ScalarInfo;
import graphql.schema.idl.SchemaGenerator;
import graphql.schema.idl.SchemaParser;
import graphql.schema.idl.TypeDefinitionRegistry;
import graphql.schema.idl.UnionWiringEnvironment;
import graphql.schema.idl.WiringFactory;
import graphql.schema.idl.FieldWiringEnvironment;

import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class Main {

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.err.println("Usage: java -jar conformer.jar <schema> <query> [<variables>]");
            System.exit(1);
        }

        String schemaText = Files.readString(Paths.get(args[0]));
        String queryText = Files.readString(Paths.get(args[1]));
        Map<String, Object> variables = null;
        if (args.length >= 3) {
            ObjectMapper mapper = new ObjectMapper();
            @SuppressWarnings("unchecked")
            Map<String, Object> parsed = mapper.readValue(Files.readString(Paths.get(args[2])), Map.class);
            variables = parsed;
        }

        ParserOptions parserOptions = ParserOptions.newParserOptions()
                .maxCharacters(Integer.MAX_VALUE)
                .maxTokens(Integer.MAX_VALUE)
                .maxWhitespaceTokens(Integer.MAX_VALUE)
                .build();
        ParserOptions.setDefaultOperationParserOptions(parserOptions);
        ParserOptions.setDefaultSdlParserOptions(parserOptions);

        TypeDefinitionRegistry registry = new SchemaParser().parse(schemaText);

        // Bug 2 (part 1): register @stream directive so queries that use it parse
        // and validate successfully. graphql-java treats @defer as built-in but
        // does not ship a @stream definition. We register a stub; because we do
        // not enable ExperimentalApi.ENABLE_INCREMENTAL_SUPPORT, both directives
        // are accepted and then silently ignored at execution time, yielding a
        // single final JSON response as required by the wiring spec.
        registerStreamDirectiveIfMissing(registry);

        // Bug 1: walk the schema AST for custom scalars and register a coercing
        // implementation so schema generation does not fail with "expected a
        // type resolver for scalar X" style SchemaProblem errors. Per the
        // wiring spec, custom scalars serialize to the string "str".
        RuntimeWiring.Builder wiringBuilder = RuntimeWiring.newRuntimeWiring()
                .wiringFactory(new ConformanceWiringFactory());
        for (Map.Entry<String, ScalarTypeDefinition> entry : registry.scalars().entrySet()) {
            String scalarName = entry.getKey();
            if (ScalarInfo.isGraphqlSpecifiedScalar(scalarName)) {
                continue;
            }
            wiringBuilder.scalar(buildStrScalar(scalarName));
        }
        RuntimeWiring wiring = wiringBuilder.build();

        GraphQLSchema schema = new SchemaGenerator().makeExecutableSchema(registry, wiring);
        GraphQL graphql = GraphQL.newGraphQL(schema).build();

        ExecutionInput.Builder inputBuilder = ExecutionInput.newExecutionInput()
                .query(queryText);
        if (variables != null) {
            inputBuilder.variables(variables);
        }

        ExecutionResult result = graphql.execute(inputBuilder.build());

        // Bug 2 (part 2): always emit a single final JSON result. Strip any
        // incremental-delivery keys ("hasNext", "incremental", "pending") that
        // IncrementalExecutionResult.toSpecification() may add.
        Map<String, Object> spec = new LinkedHashMap<>(result.toSpecification());
        spec.remove("hasNext");
        spec.remove("incremental");
        spec.remove("pending");

        ObjectMapper mapper = new ObjectMapper();
        System.out.print(mapper.writeValueAsString(spec));
    }

    static void registerStreamDirectiveIfMissing(TypeDefinitionRegistry registry) {
        if (registry.getDirectiveDefinition("stream").isPresent()) {
            return;
        }
        DirectiveDefinition streamDef = DirectiveDefinition.newDirectiveDefinition()
                .name("stream")
                .directiveLocation(graphql.language.DirectiveLocation.newDirectiveLocation()
                        .name("FIELD")
                        .build())
                .inputValueDefinition(InputValueDefinition.newInputValueDefinition()
                        .name("if")
                        .type(NonNullType.newNonNullType(TypeName.newTypeName("Boolean").build()).build())
                        .defaultValue(BooleanValue.newBooleanValue(true).build())
                        .build())
                .inputValueDefinition(InputValueDefinition.newInputValueDefinition()
                        .name("label")
                        .type(TypeName.newTypeName("String").build())
                        .build())
                .inputValueDefinition(InputValueDefinition.newInputValueDefinition()
                        .name("initialCount")
                        .type(TypeName.newTypeName("Int").build())
                        .defaultValue(graphql.language.IntValue.newIntValue(java.math.BigInteger.ZERO).build())
                        .build())
                .build();
        registry.add(streamDef);
    }

    static GraphQLScalarType buildStrScalar(String name) {
        return GraphQLScalarType.newScalar()
                .name(name)
                .description("Conformance stub for custom scalar " + name)
                .coercing(new Coercing<Object, Object>() {
                    @Override
                    public Object serialize(Object dataFetcherResult) {
                        return "str";
                    }

                    @Override
                    public Object parseValue(Object input) {
                        return input;
                    }

                    @Override
                    public Object parseLiteral(Object input) {
                        return input;
                    }
                })
                .build();
    }

    static Object resolveValue(GraphQLOutputType type) {
        if (type instanceof GraphQLNonNull) {
            return resolveValue((GraphQLOutputType) ((GraphQLNonNull) type).getWrappedType());
        }
        if (type instanceof GraphQLList) {
            GraphQLOutputType inner = (GraphQLOutputType) ((GraphQLList) type).getWrappedType();
            return Arrays.asList(resolveValue(inner), resolveValue(inner));
        }
        if (type instanceof GraphQLScalarType) {
            String name = ((GraphQLScalarType) type).getName();
            switch (name) {
                case "Int": return 2;
                case "Float": return 3.14;
                case "String": return "str";
                case "Boolean": return true;
                case "ID": return "id";
                default: return "str";
            }
        }
        if (type instanceof GraphQLEnumType) {
            return ((GraphQLEnumType) type).getValues().get(0).getName();
        }
        if (type instanceof GraphQLObjectType
                || type instanceof GraphQLUnionType
                || type instanceof GraphQLInterfaceType) {
            return Collections.emptyMap();
        }
        return null;
    }

    static class ConformanceWiringFactory implements WiringFactory {

        @Override
        public boolean providesDataFetcher(FieldWiringEnvironment environment) {
            return true;
        }

        @Override
        public DataFetcher<?> getDataFetcher(FieldWiringEnvironment environment) {
            return env -> resolveValue(env.getFieldType());
        }

        @Override
        public boolean providesTypeResolver(InterfaceWiringEnvironment environment) {
            return true;
        }

        @Override
        public TypeResolver getTypeResolver(InterfaceWiringEnvironment environment) {
            String name = environment.getInterfaceTypeDefinition().getName();
            return env -> {
                GraphQLInterfaceType iface = (GraphQLInterfaceType) env.getSchema().getType(name);
                List<GraphQLObjectType> impls = new ArrayList<>(env.getSchema().getImplementations(iface));
                impls.sort(Comparator.comparing(GraphQLNamedType::getName));
                return impls.get(impls.size() - 1);
            };
        }

        @Override
        public boolean providesTypeResolver(UnionWiringEnvironment environment) {
            return true;
        }

        @Override
        public TypeResolver getTypeResolver(UnionWiringEnvironment environment) {
            String name = environment.getUnionTypeDefinition().getName();
            return env -> {
                GraphQLUnionType union = (GraphQLUnionType) env.getSchema().getType(name);
                List<GraphQLNamedOutputType> members = new ArrayList<>(union.getTypes());
                members.sort(Comparator.comparing(GraphQLNamedType::getName));
                return env.getSchema().getObjectType(members.get(0).getName());
            };
        }
    }
}
