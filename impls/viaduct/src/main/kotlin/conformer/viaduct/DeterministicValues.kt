package conformer.viaduct

import graphql.Scalars
import graphql.schema.GraphQLEnumType
import graphql.schema.GraphQLInterfaceType
import graphql.schema.GraphQLList
import graphql.schema.GraphQLNonNull
import graphql.schema.GraphQLObjectType
import graphql.schema.GraphQLOutputType
import graphql.schema.GraphQLScalarType
import graphql.schema.GraphQLSchema
import graphql.schema.GraphQLUnionType
import viaduct.engine.api.ResolvedEngineObjectData

object DeterministicValues {
    fun resolveValue(type: GraphQLOutputType, schema: GraphQLSchema): Any? =
        when (type) {
            is GraphQLNonNull -> resolveValue(type.wrappedType as GraphQLOutputType, schema)
            is GraphQLList -> listOf(
                resolveValue(type.wrappedType as GraphQLOutputType, schema),
                resolveValue(type.wrappedType as GraphQLOutputType, schema),
            )
            Scalars.GraphQLInt -> 2
            Scalars.GraphQLFloat -> 3.14
            Scalars.GraphQLString -> "str"
            Scalars.GraphQLBoolean -> true
            Scalars.GraphQLID -> "id"
            is GraphQLEnumType -> type.values.firstOrNull()?.value
                ?: error("Enum ${type.name} has no declared values.")
            is GraphQLObjectType -> ResolvedEngineObjectData(type, emptyMap())
            is GraphQLUnionType -> {
                val selectedType = type.types
                    .filterIsInstance<GraphQLObjectType>()
                    .minByOrNull { it.name }
                    ?: error("Union ${type.name} has no member object types.")
                ResolvedEngineObjectData(selectedType, emptyMap())
            }
            is GraphQLInterfaceType -> {
                val selectedType = schema.getImplementations(type).maxByOrNull { it.name }
                    ?: error("Interface ${type.name} has no concrete implementors.")
                ResolvedEngineObjectData(selectedType, emptyMap())
            }
            is GraphQLScalarType -> "str"
            else -> error("Unsupported GraphQL output type: ${type::class.qualifiedName}")
        }
}
