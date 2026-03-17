package conformer.gen

import graphql.language.Document
import viaduct.engine.api.ViaductSchema

data class VariablesData(val variables: Map<String, Any?>)
data class DocumentData(val document: Document, val variables: List<VariablesData>)
data class CorpusData(val schema: ViaductSchema, val documentData: List<DocumentData>)
