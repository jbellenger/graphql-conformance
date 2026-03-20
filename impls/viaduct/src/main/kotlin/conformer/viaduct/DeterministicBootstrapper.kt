package conformer.viaduct

import graphql.schema.GraphQLObjectType
import graphql.schema.GraphQLSchema
import viaduct.engine.api.Coordinate
import viaduct.engine.api.ViaductSchema
import viaduct.engine.api.spi.FieldResolverExecutor
import viaduct.engine.api.spi.NodeResolverExecutor
import viaduct.engine.api.spi.TenantAPIBootstrapper
import viaduct.engine.api.spi.TenantModuleBootstrapper

class DeterministicTenantAPIBootstrapper : TenantAPIBootstrapper {
    override suspend fun tenantModuleBootstrappers(): List<TenantModuleBootstrapper> =
        listOf(DeterministicTenantModuleBootstrapper)
}

object DeterministicTenantModuleBootstrapper : TenantModuleBootstrapper {
    private val skippedCoordinates = setOf("Query" to "node", "Query" to "nodes")

    override fun fieldResolverExecutors(schema: ViaductSchema): Iterable<Pair<Coordinate, FieldResolverExecutor>> =
        registeredFieldCoordinates(schema.schema).map { coord ->
            val ownerType = schema.schema.getType(coord.first) as GraphQLObjectType
            val fieldType = ownerType.getFieldDefinition(coord.second).type
            coord to DeterministicFieldResolverExecutor("${coord.first}.${coord.second}", fieldType, schema.schema)
        }

    override fun nodeResolverExecutors(schema: ViaductSchema): Iterable<Pair<String, NodeResolverExecutor>> =
        emptyList()

    fun registeredFieldCoordinates(schema: GraphQLSchema): List<Coordinate> =
        schema.allTypesAsList
            .asSequence()
            .filterIsInstance<GraphQLObjectType>()
            .filterNot { it.name.startsWith("__") }
            .flatMap { type ->
                type.fieldDefinitions.asSequence()
                    .filterNot { it.name.startsWith("__") }
                    .map { type.name to it.name }
            }
            .filterNot { it in skippedCoordinates }
            .sortedWith(compareBy<Coordinate>({ it.first }, { it.second }))
            .toList()
}
