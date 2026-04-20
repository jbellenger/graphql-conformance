package conformer.viaduct

import com.fasterxml.jackson.databind.ObjectMapper
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpHandler
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.Executors

object Server {
    private val mapper = ObjectMapper()

    @JvmStatic
    fun main(argv: Array<String>) {
        val port = System.getenv("PORT")?.toIntOrNull() ?: 8080
        val server = HttpServer.create(InetSocketAddress("0.0.0.0", port), 0)
        server.createContext("/health", HealthHandler())
        server.createContext("/execute", ExecuteHandler())
        server.executor = Executors.newFixedThreadPool(4)
        server.start()
        System.err.println("viaduct driver listening on 0.0.0.0:$port")
    }

    class HealthHandler : HttpHandler {
        override fun handle(exchange: HttpExchange) {
            val body = "ok".toByteArray(Charsets.UTF_8)
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
    }

    class ExecuteHandler : HttpHandler {
        override fun handle(exchange: HttpExchange) {
            try {
                val bytes = exchange.requestBody.use { it.readAllBytes() }
                @Suppress("UNCHECKED_CAST")
                val body = mapper.readValue(bytes, Map::class.java) as Map<String, Any?>
                val schemaText = body["schema"] as? String
                val queryText = body["query"] as? String
                if (schemaText == null || queryText == null) {
                    sendJson(
                        exchange,
                        400,
                        mapOf(
                            "errors" to listOf(mapOf("message" to "schema and query are required strings"))
                        )
                    )
                    return
                }
                @Suppress("UNCHECKED_CAST")
                val variables = (body["variables"] as? Map<String, Any?>) ?: emptyMap()

                val result = ViaductHarness.executeSpecification(schemaText, queryText, variables)
                sendJson(exchange, 200, result)
            } catch (t: Throwable) {
                sendJson(
                    exchange,
                    500,
                    mapOf("errors" to listOf(mapOf("message" to (t.message ?: t.toString()))))
                )
            }
        }
    }

    private fun sendJson(exchange: HttpExchange, status: Int, body: Any) {
        val bytes = mapper.writeValueAsBytes(body)
        exchange.responseHeaders.add("Content-Type", "application/json")
        exchange.sendResponseHeaders(status, bytes.size.toLong())
        exchange.responseBody.use { it.write(bytes) }
    }
}
