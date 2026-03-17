package conformer.gen

import io.kotest.property.RandomSource
import viaduct.arbitrary.common.Config
import viaduct.arbitrary.graphql.DescriptionLength
import viaduct.arbitrary.graphql.GenInterfaceStubsIfNeeded
import viaduct.arbitrary.graphql.OperationCount
import viaduct.arbitrary.graphql.asIntRange
import java.io.File
import kotlin.time.ExperimentalTime
import kotlin.time.measureTime

@OptIn(ExperimentalTime::class)
fun main(args: Array<String>) {
    val schemas = args.getOrNull(0)?.toInt() ?: 1
    val docsPerSchema = args.getOrNull(1)?.toInt() ?: 1
    val variablesPerDoc = args.getOrNull(2)?.toInt() ?: 1
    val outputRoot = File(args.getOrNull(3) ?: "/tmp")

    val duration = measureTime {
        print("Generating...")
        val gen = CorpusDataGen(defaultConfig, RandomSource.default())
        repeat(schemas) {
            val data = gen.gen(docsPerSchema, variablesPerDoc)
            CorpusWriter.write(data, outputRoot)
            print(".")
        }
    }

    println(" done (took ${duration.inWholeSeconds}s)")
    println("Wrote $schemas schema(s) to ${outputRoot.absolutePath}")
}

val defaultConfig: Config = Config.default +
    (DescriptionLength to 0.asIntRange()) +
    (GenInterfaceStubsIfNeeded to true) +
    (OperationCount to 1.asIntRange())
