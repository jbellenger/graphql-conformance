package conformer.gen

import io.kotest.property.Arb
import io.kotest.property.RandomSource
import io.kotest.property.arbitrary.next
import io.kotest.property.arbitrary.take
import viaduct.arbitrary.common.Config
import viaduct.arbitrary.graphql.graphQLDocument
import viaduct.arbitrary.graphql.graphQLExecutionInput
import viaduct.arbitrary.graphql.viaductSchema

class CorpusDataGen(private val cfg: Config, private val rs: RandomSource) {

    fun gen(docsPerSchema: Int, variablesPerDoc: Int): CorpusData {
        val schema = Arb.viaductSchema(cfg).next(rs)
        val docs = Arb.graphQLDocument(schema, cfg)
            .take(docsPerSchema, rs)
            .toList()

        val docData = docs.map { doc ->
            val varData = Arb.graphQLExecutionInput(schema, doc, cfg)
                .take(variablesPerDoc, rs)
                .toList()
                .map { inp ->
                    VariablesData(inp.variables)
                }

            DocumentData(doc, varData)
        }

        return CorpusData(schema, docData)
    }
}