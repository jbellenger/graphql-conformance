@file:OptIn(VisibleForTest::class)

package conformer.gen

import graphql.Directives
import graphql.com.google.common.collect.Ordering.arbitrary
import graphql.language.AstPrinter
import graphql.language.Directive
import graphql.language.Node
import graphql.schema.idl.SchemaPrinter
import io.kotest.property.Arb
import io.kotest.property.RandomSource
import io.kotest.property.arbitrary.arbitrary
import io.kotest.property.arbitrary.long
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import viaduct.apiannotations.VisibleForTest
import viaduct.arbitrary.common.Config
import viaduct.arbitrary.common.KotestPropertyBase
import viaduct.graphql.utils.allChildrenOfType

class CorpusDataGenTest : KotestPropertyBase() {
    @Test
    fun `gen produces valid corpus data`() = runTest {
        Arb.long().checkAll { seed ->
            val gen = CorpusDataGen(Config.default, RandomSource.seeded(seed))
            val data = gen.gen(docsPerSchema = 1, variablesPerDoc = 1)

            assertTrue(data.schema.schema.queryType != null, "schema should have a Query type")
            assertEquals(1, data.documentData.size, "should have 1 document")
            assertEquals(1, data.documentData[0].variables.size, "should have 1 variable set")
        }
    }

    @Test
    fun `gen with same seed is deterministic`() {
        val a = CorpusDataGen(Config.default, RandomSource.seeded(42)).gen(1, 1)
        val b = CorpusDataGen(Config.default, RandomSource.seeded(42)).gen(1, 1)
        assertEquals(
            a.schema.schema.queryType?.name,
            b.schema.schema.queryType?.name,
            "same seed should produce identical schema"
        )
        assertEquals(
            a.documentData.size,
            b.documentData.size,
            "same seed should produce same number of documents"
        )
    }

    @Test
    fun `gen respects docsPerSchema and variablesPerDoc`() {
        val gen = CorpusDataGen(Config.default, RandomSource.seeded(99))
        val data = gen.gen(docsPerSchema = 3, variablesPerDoc = 2)

        assertEquals(3, data.documentData.size, "should have 3 documents")
        for (doc in data.documentData) {
            assertEquals(2, doc.variables.size, "each document should have 2 variable sets")
        }
    }

    @Test
    fun `gen never emits experimental_disableErrorPropagation`() = runTest {
        val arb = arbitrary { rs ->
            val gen = CorpusDataGen(defaultConfig, rs)
            gen.gen(docsPerSchema = 1, variablesPerDoc = 0)
        }
        arb.forAll { data ->
            data.documentData.none { doc ->
                doc.document.allChildrenOfType<Directive>().any { it.name == Directives.ExperimentalDisableErrorPropagationDirective.name }
            }
        }
    }
}
