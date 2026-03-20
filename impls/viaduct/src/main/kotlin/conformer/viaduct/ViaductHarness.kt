@file:Suppress("OVERRIDE_DEPRECATION")

package conformer.viaduct

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import graphql.Scalars
import graphql.schema.GraphQLScalarType
import graphql.schema.idl.RuntimeWiring
import graphql.schema.idl.SchemaGenerator
import graphql.schema.idl.SchemaParser
import java.nio.file.Files
import java.nio.file.Path
import kotlin.system.exitProcess
import kotlinx.coroutines.future.await
import kotlinx.coroutines.runBlocking
import viaduct.engine.EngineFactory
import viaduct.engine.ViaductWiringFactory
import viaduct.engine.api.ExecutionInput
import viaduct.engine.api.ViaductSchema
import viaduct.engine.api.spi.NoOpCheckerExecutorFactoryImpl
import viaduct.engine.runtime.execution.DefaultCoroutineInterop
import viaduct.engine.runtime.tenantloading.DispatcherRegistryFactory
import viaduct.engine.runtime.tenantloading.ExecutorValidator

object ViaductHarness {
    private val mapper = ObjectMapper()
    private val variablesType = object : TypeReference<Map<String, Any?>>() {}
    private val builtInScalarNames = setOf(
        Scalars.GraphQLInt.name,
        Scalars.GraphQLFloat.name,
        Scalars.GraphQLString.name,
        Scalars.GraphQLBoolean.name,
        Scalars.GraphQLID.name,
    )

    @JvmStatic
    fun main(argv: Array<String>) {
        if (argv.size !in 2..3) {
            System.err.println("Usage: java -jar conformer-1.0.jar <schema> <query> [<variables>]")
            exitProcess(1)
        }

        try {
            val schemaText = Files.readString(Path.of(argv[0]))
            val queryText = Files.readString(Path.of(argv[1]))
            val variables = if (argv.size == 3) {
                mapper.readValue(Files.readString(Path.of(argv[2])), variablesType)
            } else {
                emptyMap()
            }

            val result = executeSpecification(schemaText, queryText, variables)
            System.out.print(mapper.writeValueAsString(result))
        } catch (err: Throwable) {
            System.err.println(err.message ?: err.toString())
            exitProcess(1)
        }
    }

    fun executeSpecification(
        schemaText: String,
        queryText: String,
        variables: Map<String, Any?> = emptyMap(),
    ): Map<String, Any?> {
        val schema = executeForTest(schemaText)
        val registry = DispatcherRegistryFactory(
            DeterministicTenantAPIBootstrapper(),
            ExecutorValidator(schema),
            NoOpCheckerExecutorFactoryImpl(),
        ).create(schema)
        val engine = EngineFactory(dispatcherRegistry = registry).create(schema, fullSchema = schema)
        val input = ExecutionInput(
            operationText = queryText,
            variables = variables,
            requestContext = Any(),
        )

        val executionResult = runBlocking {
            DefaultCoroutineInterop.enterThreadLocalCoroutineContext(coroutineContext) {
                engine.execute(input)
            }.await()
        }

        @Suppress("UNCHECKED_CAST")
        return executionResult.toSpecification() as Map<String, Any?>
    }

    internal fun executeForTest(schemaText: String): ViaductSchema {
        val typeDefinitionRegistry = SchemaParser().parse(schemaText)
        val runtimeWiring = RuntimeWiring.newRuntimeWiring()
            .wiringFactory(ViaductWiringFactory(DefaultCoroutineInterop))
            .apply {
                typeDefinitionRegistry.scalars().values.forEach { scalarDefinition ->
                    if (scalarDefinition.name !in builtInScalarNames) {
                        scalar(
                            GraphQLScalarType.newScalar()
                                .name(scalarDefinition.name)
                                .coercing(NoOpCoercing)
                                .build()
                        )
                    }
                }
            }
            .build()
        val graphQLSchema = SchemaGenerator().makeExecutableSchema(typeDefinitionRegistry, runtimeWiring)
        return ViaductSchema(graphQLSchema)
    }
}

private object NoOpCoercing : graphql.schema.Coercing<Any, Any> {
    override fun serialize(dataFetcherResult: Any): Any = dataFetcherResult

    override fun parseValue(input: Any): Any = input

    override fun parseLiteral(input: Any): Any = input
}
