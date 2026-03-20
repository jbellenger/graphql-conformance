package conformer.viaduct

import graphql.schema.GraphQLOutputType
import graphql.schema.GraphQLSchema
import viaduct.engine.api.ResolverMetadata
import viaduct.engine.api.spi.FieldResolverExecutor
import viaduct.engine.api.EngineExecutionContext

class DeterministicFieldResolverExecutor(
    private val resolverName: String,
    private val fieldType: GraphQLOutputType,
    private val schema: GraphQLSchema,
) : FieldResolverExecutor {
    override val objectSelectionSet = null
    override val querySelectionSet = null
    override val resolverId = resolverName
    override val metadata = ResolverMetadata.forModern(resolverName)
    override val isBatching = false

    override suspend fun batchResolve(
        selectors: List<FieldResolverExecutor.Selector>,
        context: EngineExecutionContext,
    ): Map<FieldResolverExecutor.Selector, Result<Any?>> =
        selectors.associateWith {
            runCatching { DeterministicValues.resolveValue(fieldType, schema) }
        }
}
