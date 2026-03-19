package conformer;

import com.fasterxml.jackson.databind.ObjectMapper;
import graphql.ExecutionResult;
import graphql.GraphQL;
import graphql.schema.GraphQLSchema;
import graphql.schema.idl.RuntimeWiring;
import graphql.schema.idl.SchemaGenerator;
import graphql.schema.idl.SchemaParser;
import graphql.schema.idl.TypeDefinitionRegistry;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class WiringTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private String exec(String sdl, String query) throws Exception {
        TypeDefinitionRegistry registry = new SchemaParser().parse(sdl);
        RuntimeWiring wiring = RuntimeWiring.newRuntimeWiring()
                .wiringFactory(new Main.ConformanceWiringFactory())
                .build();
        GraphQLSchema schema = new SchemaGenerator().makeExecutableSchema(registry, wiring);
        GraphQL graphql = GraphQL.newGraphQL(schema).build();
        ExecutionResult result = graphql.execute(query);
        return MAPPER.writeValueAsString(result.toSpecification());
    }

    @Test
    void intFieldReturns2() throws Exception {
        assertEquals("{\"data\":{\"x\":2}}", exec("type Query { x: Int }", "{ x }"));
    }

    @Test
    void floatFieldReturns314() throws Exception {
        assertEquals("{\"data\":{\"x\":3.14}}", exec("type Query { x: Float }", "{ x }"));
    }

    @Test
    void stringFieldReturnsStr() throws Exception {
        assertEquals("{\"data\":{\"x\":\"str\"}}", exec("type Query { x: String }", "{ x }"));
    }

    @Test
    void booleanFieldReturnsTrue() throws Exception {
        assertEquals("{\"data\":{\"x\":true}}", exec("type Query { x: Boolean }", "{ x }"));
    }

    @Test
    void idFieldReturnsId() throws Exception {
        assertEquals("{\"data\":{\"x\":\"id\"}}", exec("type Query { x: ID }", "{ x }"));
    }

    @Test
    void nullableFieldIsNonNull() throws Exception {
        // nullable String should still return "str", not null
        String json = exec("type Query { x: String }", "{ x }");
        assertEquals("{\"data\":{\"x\":\"str\"}}", json);
    }

    @Test
    void listFieldReturns2Items() throws Exception {
        assertEquals(
                "{\"data\":{\"x\":[\"str\",\"str\"]}}",
                exec("type Query { x: [String] }", "{ x }")
        );
    }

    @Test
    void enumFieldReturnsFirstDeclaredValue() throws Exception {
        assertEquals(
                "{\"data\":{\"x\":\"RED\"}}",
                exec("enum Color { RED GREEN BLUE } type Query { x: Color }", "{ x }")
        );
    }

    @Test
    void unionResolvesAlphabeticallyFirstMember() throws Exception {
        String sdl = "type Dog { bark: String } type Cat { meow: String } union Pet = Dog | Cat type Query { x: Pet }";
        String query = "{ x { ... on Cat { meow } ... on Dog { bark } } }";
        // Cat < Dog alphabetically
        assertEquals("{\"data\":{\"x\":{\"meow\":\"str\"}}}", exec(sdl, query));
    }

    @Test
    void interfaceResolvesAlphabeticallyLastImplementor() throws Exception {
        String sdl = "interface Node { id: ID } type Alpha implements Node { id: ID, a: Int } type Zeta implements Node { id: ID, z: Int } type Query { x: Node }";
        String query = "{ x { id ... on Alpha { a } ... on Zeta { z } } }";
        // Zeta > Alpha alphabetically
        assertEquals("{\"data\":{\"x\":{\"id\":\"id\",\"z\":2}}}", exec(sdl, query));
    }

    @Test
    void nestedListOfObjectsReturns2Items() throws Exception {
        String sdl = "type Item { name: String } type Query { items: [Item] }";
        assertEquals(
                "{\"data\":{\"items\":[{\"name\":\"str\"},{\"name\":\"str\"}]}}",
                exec(sdl, "{ items { name } }")
        );
    }

    @Test
    void nonNullWrapperDoesNotChangeValue() throws Exception {
        assertEquals("{\"data\":{\"x\":\"str\"}}", exec("type Query { x: String! }", "{ x }"));
    }
}
