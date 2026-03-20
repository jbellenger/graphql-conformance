(ns conformer-lacinia
  (:gen-class)
  (:require
   [clojure.data.json :as json]
   [com.walmartlabs.lacinia :as lacinia]
   [com.walmartlabs.lacinia.parser.schema :refer [parse-schema]]
   [com.walmartlabs.lacinia.schema :as schema]
   [com.walmartlabs.lacinia.util :as util]))

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

(defn read-variables [variables-path]
  (when variables-path
    (json/read-str (slurp variables-path) :key-fn keyword)))

(defn -main [& args]
  (let [[schema-path query-path variables-path] args]
    (when (or (nil? schema-path) (nil? query-path))
      (binding [*out* *err*]
        (println "Usage: clojure -M -m conformer-lacinia <schema> <query> [<variables>]"))
      (System/exit 1))

    (let [result (execute-query (slurp schema-path)
                                (slurp query-path)
                                (read-variables variables-path))]
      (print (json/write-str result)))))
