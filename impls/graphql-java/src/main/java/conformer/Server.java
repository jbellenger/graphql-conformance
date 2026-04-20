package conformer;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import graphql.ExecutionInput;
import graphql.ExecutionResult;
import graphql.GraphQL;
import graphql.parser.ParserOptions;
import graphql.schema.GraphQLScalarType;
import graphql.schema.GraphQLSchema;
import graphql.schema.idl.RuntimeWiring;
import graphql.schema.idl.ScalarInfo;
import graphql.schema.idl.SchemaGenerator;
import graphql.schema.idl.SchemaParser;
import graphql.schema.idl.TypeDefinitionRegistry;
import graphql.language.ScalarTypeDefinition;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Executors;

public class Server {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    public static void main(String[] args) throws Exception {
        int port = 8080;
        String portEnv = System.getenv("PORT");
        if (portEnv != null && !portEnv.isEmpty()) {
            port = Integer.parseInt(portEnv);
        }

        ParserOptions parserOptions = ParserOptions.newParserOptions()
                .maxCharacters(Integer.MAX_VALUE)
                .maxTokens(Integer.MAX_VALUE)
                .maxWhitespaceTokens(Integer.MAX_VALUE)
                .build();
        ParserOptions.setDefaultOperationParserOptions(parserOptions);
        ParserOptions.setDefaultSdlParserOptions(parserOptions);

        HttpServer server = HttpServer.create(new InetSocketAddress("0.0.0.0", port), 0);
        server.createContext("/health", new HealthHandler());
        server.createContext("/execute", new ExecuteHandler());
        server.setExecutor(Executors.newFixedThreadPool(4));
        server.start();
        System.err.println("graphql-java driver listening on 0.0.0.0:" + port);
    }

    static class HealthHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            byte[] body = "ok".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(body);
            }
        }
    }

    static class ExecuteHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            try (InputStream is = exchange.getRequestBody()) {
                byte[] bytes = is.readAllBytes();
                @SuppressWarnings("unchecked")
                Map<String, Object> body = MAPPER.readValue(bytes, Map.class);
                Object schemaText = body.get("schema");
                Object queryText = body.get("query");
                if (!(schemaText instanceof String) || !(queryText instanceof String)) {
                    sendJson(exchange, 400, Map.of("errors",
                            java.util.List.of(Map.of("message", "schema and query are required strings"))));
                    return;
                }
                @SuppressWarnings("unchecked")
                Map<String, Object> variables = body.get("variables") instanceof Map
                        ? (Map<String, Object>) body.get("variables")
                        : null;
                String operationName = body.get("operationName") instanceof String
                        ? (String) body.get("operationName")
                        : null;

                Map<String, Object> result = executeGraphQL((String) schemaText, (String) queryText,
                        variables, operationName);
                sendJson(exchange, 200, result);
            } catch (Throwable t) {
                sendJson(exchange, 500, Map.of("errors",
                        java.util.List.of(Map.of("message",
                                t.getMessage() != null ? t.getMessage() : t.toString()))));
            }
        }
    }

    static Map<String, Object> executeGraphQL(String schemaText, String queryText,
            Map<String, Object> variables, String operationName) {
        TypeDefinitionRegistry registry = new SchemaParser().parse(schemaText);
        Main.registerStreamDirectiveIfMissing(registry);

        RuntimeWiring.Builder wiringBuilder = RuntimeWiring.newRuntimeWiring()
                .wiringFactory(new Main.ConformanceWiringFactory());
        for (Map.Entry<String, ScalarTypeDefinition> entry : registry.scalars().entrySet()) {
            String scalarName = entry.getKey();
            if (ScalarInfo.isGraphqlSpecifiedScalar(scalarName)) {
                continue;
            }
            GraphQLScalarType stub = Main.buildStrScalar(scalarName);
            wiringBuilder.scalar(stub);
        }
        RuntimeWiring wiring = wiringBuilder.build();

        GraphQLSchema schema = new SchemaGenerator().makeExecutableSchema(registry, wiring);
        GraphQL graphql = GraphQL.newGraphQL(schema).build();

        ExecutionInput.Builder inputBuilder = ExecutionInput.newExecutionInput().query(queryText);
        if (variables != null) {
            inputBuilder.variables(variables);
        }
        if (operationName != null) {
            inputBuilder.operationName(operationName);
        }

        ExecutionResult result = graphql.execute(inputBuilder.build());
        Map<String, Object> spec = new LinkedHashMap<>(result.toSpecification());
        spec.remove("hasNext");
        spec.remove("incremental");
        spec.remove("pending");
        return spec;
    }

    static void sendJson(HttpExchange exchange, int status, Object body) throws IOException {
        byte[] bytes = MAPPER.writeValueAsBytes(body);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }
}
