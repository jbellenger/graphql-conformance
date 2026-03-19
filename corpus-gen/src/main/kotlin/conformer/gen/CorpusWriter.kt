package conformer.gen

import com.fasterxml.jackson.databind.ObjectMapper
import graphql.language.AstPrinter
import graphql.schema.idl.SchemaPrinter
import java.io.File
import java.security.MessageDigest

object CorpusWriter {
    private val mapper = ObjectMapper()

    fun hash(content: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(content.toByteArray())
        return digest.joinToString("") { "%02x".format(it) }.take(8)
    }

    fun write(data: CorpusData, outputRoot: File) {
        val sdl = SchemaPrinter().print(data.schema.schema)
        val schemaDir = File(outputRoot, hash(sdl))
        schemaDir.mkdirs()
        File(schemaDir, "schema.graphqls").writeText(sdl)

        for (doc in data.documentData) {
            val queryStr = AstPrinter.printAst(doc.document)
            val queryDir = File(schemaDir, hash(queryStr))
            queryDir.mkdirs()
            File(queryDir, "query.graphql").writeText(queryStr)

            for (vars in doc.variables) {
                val varsJson = mapper.writeValueAsString(vars.variables)
                val varsDir = File(queryDir, hash(varsJson))
                varsDir.mkdirs()
                File(varsDir, "variables.json").writeText(varsJson)
            }
        }
    }
}
