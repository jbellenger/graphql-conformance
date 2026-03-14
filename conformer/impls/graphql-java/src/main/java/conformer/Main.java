package conformer;

import com.fasterxml.jackson.databind.ObjectMapper;
import graphql.ExecutionInput;
import graphql.ExecutionResult;
import graphql.GraphQL;
import graphql.parser.ParserOptions;
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
        RuntimeWiring wiring = RuntimeWiring.newRuntimeWiring()
                .wiringFactory(new ConformanceWiringFactory())
                .build();
        GraphQLSchema schema = new SchemaGenerator().makeExecutableSchema(registry, wiring);
        GraphQL graphql = GraphQL.newGraphQL(schema).build();

        ExecutionInput.Builder inputBuilder = ExecutionInput.newExecutionInput()
                .query(queryText);
        if (variables != null) {
            inputBuilder.variables(variables);
        }

        ExecutionResult result = graphql.execute(inputBuilder.build());
        Map<String, Object> spec = result.toSpecification();

        ObjectMapper mapper = new ObjectMapper();
        System.out.print(mapper.writeValueAsString(spec));
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
