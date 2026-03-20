@file:Suppress("OVERRIDE_DEPRECATION")

package conformer.viaduct

import graphql.schema.GraphQLEnumType
import graphql.schema.GraphQLObjectType
import graphql.schema.GraphQLScalarType
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class ViaductHarnessTest {
    @Test
    fun `custom scalar resolves to str`() {
        val scalar = GraphQLScalarType.newScalar()
            .name("Custom")
            .coercing(NoOpCoercing)
            .build()

        assertEquals("str", DeterministicValues.resolveValue(scalar, emptySchema()))
    }

    @Test
    fun `registered coordinates skip viaduct node helpers`() {
        val schema = buildSchema(
            """
                schema { query: Root }
                type Root {
                  value: String
                }
            """.trimIndent()
        )

        val coords = DeterministicTenantModuleBootstrapper.registeredFieldCoordinates(schema.schema)

        assertEquals(true, coords.contains("Root" to "value"))
        assertEquals(false, coords.contains("Query" to "node"))
        assertEquals(false, coords.contains("Query" to "nodes"))
    }

    @Test
    fun `interface resolves to lexicographically last implementor`() {
        val result = ViaductHarness.executeSpecification(
            schemaText = """
                schema { query: Root }
                interface Animal { name: String }
                type Aardvark implements Animal { name: String, snout: Float }
                type Zebra implements Animal { name: String, stripes: Int }
                type Root { animal: Animal }
            """.trimIndent(),
            queryText = "{ animal { name ... on Zebra { stripes } ... on Aardvark { snout } } }",
        )

        assertEquals(mapOf("data" to mapOf("animal" to mapOf("name" to "str", "stripes" to 2))), result)
    }

    @Test
    fun `custom query root type is supported`() {
        val result = ViaductHarness.executeSpecification(
            schemaText = """
                schema { query: Root }
                type Root { x: String }
            """.trimIndent(),
            queryText = "{ x }",
        )

        assertEquals(mapOf("data" to mapOf("x" to "str")), result)
    }

    @Test
    fun `conventional query root type is supported without schema block`() {
        val result = ViaductHarness.executeSpecification(
            schemaText = """
                type Query { x: String }
            """.trimIndent(),
            queryText = "{ x }",
        )

        assertEquals(mapOf("data" to mapOf("x" to "str")), result)
    }

    @Test
    fun `custom scalar schema executes`() {
        val result = ViaductHarness.executeSpecification(
            schemaText = """
                scalar Custom
                type Query { value: Custom }
            """.trimIndent(),
            queryText = "{ value }",
        )

        assertEquals(mapOf("data" to mapOf("value" to "str")), result)
    }

    @Test
    fun `interface with no implementors fails`() {
        val schema = buildSchema(
            """
                schema { query: Root }
                interface Animal { name: String }
                type Root { animal: Animal }
            """.trimIndent()
        )
        val queryType = schema.schema.getType("Root") as GraphQLObjectType
        val animalType = queryType.getFieldDefinition("animal").type

        val error = assertThrows(IllegalStateException::class.java) {
            DeterministicValues.resolveValue(animalType, schema.schema)
        }

        assertEquals("Interface Animal has no concrete implementors.", error.message)
    }

    @Test
    fun `enum resolves to first declared value`() {
        val enumType = GraphQLEnumType.newEnum()
            .name("Status")
            .value("ACTIVE")
            .value("INACTIVE")
            .build()

        assertEquals("ACTIVE", DeterministicValues.resolveValue(enumType, emptySchema()))
    }

    @Test
    fun `node redefinition surfaces as failure`() {
        val error = assertThrows(Exception::class.java) {
            buildSchema(
                """
                    schema { query: Root }
                    type Root { value: String }
                    extend type Query {
                      node(id: ID!): String
                    }
                """.trimIndent()
            )
        }

        assertFalse(error.message.isNullOrBlank())
    }

    private fun buildSchema(sdl: String) = ViaductHarness.executeForTest(sdl)

    private fun emptySchema() = buildSchema("schema { query: Root } type Root { x: String }").schema
}

private object NoOpCoercing : graphql.schema.Coercing<Any, Any> {
    override fun serialize(dataFetcherResult: Any): Any = dataFetcherResult

    override fun parseValue(input: Any): Any = input

    override fun parseLiteral(input: Any): Any = input
}
