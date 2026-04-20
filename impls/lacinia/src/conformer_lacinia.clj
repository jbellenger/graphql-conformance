(ns conformer-lacinia
  (:gen-class)
  (:require
   [clojure.data.json :as json]
   [com.walmartlabs.lacinia :as lacinia]
   [com.walmartlabs.lacinia.parser.schema :refer [parse-schema]]
   [com.walmartlabs.lacinia.schema :as schema]
   [com.walmartlabs.lacinia.util :as util])
  (:import
   [com.sun.net.httpserver HttpServer HttpHandler HttpExchange]
   [java.net InetSocketAddress]
   [java.io InputStreamReader BufferedReader]
   [java.nio.charset StandardCharsets]))

(defn type-ref-kind [type-ref]
  (when (seq? type-ref)
    (first type-ref)))

(defn nested-type-ref [type-ref]
  (when (seq? type-ref)
    (second type-ref)))

(defn sorted-type-names [type-names]
  (sort-by name type-names))

(defn interface-implementors [parsed-schema interface-name]
  (for [[type-name type-def] (:objects parsed-schema)
        :when (some #{interface-name} (:implements type-def))]
    type-name))

(declare resolve-value)

(defn concrete-union-value [parsed-schema union-name]
  (when-let [type-name (first (sorted-type-names (get-in parsed-schema [:unions union-name :members])))]
    (schema/tag-with-type {} type-name)))

(defn concrete-interface-value [parsed-schema interface-name]
  (when-let [type-name (last (sorted-type-names (interface-implementors parsed-schema interface-name)))]
    (schema/tag-with-type {} type-name)))

(defn resolve-value [parsed-schema type-ref]
  (case (type-ref-kind type-ref)
    non-null (resolve-value parsed-schema (nested-type-ref type-ref))
    list (let [item (resolve-value parsed-schema (nested-type-ref type-ref))]
           [item item])
    (cond
      (= type-ref 'Int) 2
      (= type-ref 'Float) 3.14
      (= type-ref 'String) "str"
      (= type-ref 'Boolean) true
      (= type-ref 'ID) "id"
      (contains? (:enums parsed-schema) type-ref)
      (get-in parsed-schema [:enums type-ref :values 0 :enum-value])
      (contains? (:unions parsed-schema) type-ref)
      (concrete-union-value parsed-schema type-ref)
      (contains? (:interfaces parsed-schema) type-ref)
      (concrete-interface-value parsed-schema type-ref)
      (contains? (:objects parsed-schema) type-ref)
      {}
      (contains? (:scalars parsed-schema) type-ref)
      "str"
      :else nil)))

(defn field-resolver [parsed-schema field-def]
  (let [type-ref (:type field-def)]
    (fn [_ _ _]
      (resolve-value parsed-schema type-ref))))

(defn build-resolvers [parsed-schema]
  (into {}
        (for [[type-name {:keys [fields]}] (:objects parsed-schema)
              [field-name field-def] fields]
          [(keyword (name type-name) (name field-name))
           (field-resolver parsed-schema field-def)])))

(defn execute-query [schema-text query-text variables]
  (let [parsed-schema (parse-schema schema-text)
        compiled-schema (-> parsed-schema
                            (util/inject-resolvers (build-resolvers parsed-schema))
                            schema/compile)]
    (lacinia/execute compiled-schema query-text variables nil)))

(defn read-request-body [^HttpExchange exchange]
  (with-open [is (.getRequestBody exchange)
              reader (BufferedReader. (InputStreamReader. is StandardCharsets/UTF_8))]
    (slurp reader)))

(defn send-json [^HttpExchange exchange status body]
  (let [bytes (.getBytes (json/write-str body) StandardCharsets/UTF_8)
        headers (.getResponseHeaders exchange)]
    (.add headers "Content-Type" "application/json")
    (.sendResponseHeaders exchange status (count bytes))
    (with-open [os (.getResponseBody exchange)]
      (.write os bytes))))

(defn send-text [^HttpExchange exchange status body]
  (let [bytes (.getBytes ^String body StandardCharsets/UTF_8)]
    (.sendResponseHeaders exchange status (count bytes))
    (with-open [os (.getResponseBody exchange)]
      (.write os bytes))))

(defn health-handler []
  (reify HttpHandler
    (handle [_ exchange]
      (send-text exchange 200 "ok"))))

(defn execute-handler []
  (reify HttpHandler
    (handle [_ exchange]
      (try
        (let [body (read-request-body exchange)
              req (json/read-str body :key-fn keyword)
              schema-text (:schema req)
              query-text (:query req)
              variables (:variables req)]
          (if (or (nil? schema-text) (nil? query-text))
            (send-json exchange 400
                       {:errors [{:message "schema and query are required strings"}]})
            (try
              (let [result (execute-query schema-text query-text variables)]
                (send-json exchange 200 result))
              (catch Throwable e
                (send-json exchange 500
                           {:errors [{:message (or (.getMessage e) (.toString e))}]})))))
        (catch Throwable e
          (send-json exchange 500
                     {:errors [{:message (or (.getMessage e) (.toString e))}]}))))))

(defn -main [& _args]
  (let [port (or (some-> (System/getenv "PORT") Integer/parseInt) 8080)
        server (HttpServer/create (InetSocketAddress. "0.0.0.0" port) 0)]
    (.createContext server "/health" (health-handler))
    (.createContext server "/execute" (execute-handler))
    (.setExecutor server (java.util.concurrent.Executors/newFixedThreadPool 4))
    (.start server)
    (binding [*out* *err*]
      (println (str "lacinia driver listening on 0.0.0.0:" port)))))
