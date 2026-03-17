package conformer.gen

import graphql.language.AstPrinter
import graphql.schema.idl.SchemaPrinter
import io.kotest.property.RandomSource
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import viaduct.arbitrary.common.Config
import java.io.File

class CorpusWriterTest {
    private fun generate(seed: Long = 42): CorpusData =
        CorpusDataGen(Config.default, RandomSource.seeded(seed)).gen(1, 1)

    @Test
    fun `write creates hash-based directory tree`(@TempDir tempDir: File) {
        val data = generate()
        CorpusWriter.write(data, tempDir)

        val schemaDirs = tempDir.listFiles { f -> f.isDirectory }!!
        assertEquals(1, schemaDirs.size, "should have 1 schema dir")

        val schemaDir = schemaDirs[0]
        assertTrue(File(schemaDir, "schema.graphqls").exists(), "schema.graphqls should exist")

        val queryDirs = schemaDir.listFiles { f -> f.isDirectory }!!
        assertEquals(1, queryDirs.size, "should have 1 query dir")
        assertTrue(File(queryDirs[0], "query.graphql").exists(), "query.graphql should exist")

        val varsDirs = queryDirs[0].listFiles { f -> f.isDirectory }!!
        assertEquals(1, varsDirs.size, "should have 1 variables dir")
        assertTrue(File(varsDirs[0], "variables.json").exists(), "variables.json should exist")
    }

    @Test
    fun `directory names are content hashes`(@TempDir tempDir: File) {
        val data = generate()
        CorpusWriter.write(data, tempDir)

        val sdl = SchemaPrinter().print(data.schema.schema)
        val schemaDir = tempDir.listFiles { f -> f.isDirectory }!![0]
        assertEquals(CorpusWriter.hash(sdl), schemaDir.name, "schema dir should be hash of SDL")

        val queryStr = AstPrinter.printAst(data.documentData[0].document)
        val queryDir = schemaDir.listFiles { f -> f.isDirectory }!![0]
        assertEquals(CorpusWriter.hash(queryStr), queryDir.name, "query dir should be hash of query")
    }

    @Test
    fun `write handles multiple docs and variable sets`(@TempDir tempDir: File) {
        val data = CorpusDataGen(Config.default, RandomSource.seeded(77)).gen(2, 3)
        CorpusWriter.write(data, tempDir)

        val schemaDir = tempDir.listFiles { f -> f.isDirectory }!![0]
        val queryDirs = schemaDir.listFiles { f -> f.isDirectory }!!
        assertTrue(queryDirs.isNotEmpty(), "should have query dirs")
        // May be fewer than 2 if queries hash-deduplicate
        assertTrue(queryDirs.size <= 2, "should have at most 2 query dirs")

        for (queryDir in queryDirs) {
            val varsDirs = queryDir.listFiles { f -> f.isDirectory }!!
            assertTrue(varsDirs.isNotEmpty(), "should have variable dirs")
            // May be fewer than 3 if variable sets hash-deduplicate
            assertTrue(varsDirs.size <= 3, "should have at most 3 variable dirs")
        }
    }
}
