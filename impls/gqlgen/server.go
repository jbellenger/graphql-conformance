package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"

	"github.com/99designs/gqlgen/graphql"
	"github.com/99designs/gqlgen/graphql/executor"
	"github.com/vektah/gqlparser/v2"
	"github.com/vektah/gqlparser/v2/ast"
)

// dynamicSchema implements graphql.ExecutableSchema for arbitrary SDL schemas
// using deterministic wiring-spec resolvers.
type dynamicSchema struct {
	schema         *ast.Schema
	enumFirstValue map[string]string
}

func newDynamicSchema(schema *ast.Schema) *dynamicSchema {
	ds := &dynamicSchema{
		schema:         schema,
		enumFirstValue: make(map[string]string),
	}
	for name, def := range schema.Types {
		if def.Kind == ast.Enum && len(def.EnumValues) > 0 {
			ds.enumFirstValue[name] = def.EnumValues[0].Name
		}
	}
	return ds
}

func (ds *dynamicSchema) Schema() *ast.Schema { return ds.schema }

func (ds *dynamicSchema) Complexity(ctx context.Context, typeName, fieldName string, childComplexity int, args map[string]any) (int, bool) {
	return 0, false
}

func (ds *dynamicSchema) Exec(ctx context.Context) graphql.ResponseHandler {
	opCtx := graphql.GetOperationContext(ctx)

	var rootType *ast.Definition
	switch opCtx.Operation.Operation {
	case ast.Query:
		rootType = ds.schema.Query
	case ast.Mutation:
		rootType = ds.schema.Mutation
	default:
		return graphql.OneShot(graphql.ErrorResponse(ctx, "unsupported operation"))
	}
	if rootType == nil {
		return graphql.OneShot(graphql.ErrorResponse(ctx, "root type not found"))
	}

	data := ds.resolveSelectionSet(opCtx, opCtx.Operation.SelectionSet, rootType)
	var buf bytes.Buffer
	data.MarshalGQL(&buf)
	return graphql.OneShot(&graphql.Response{Data: buf.Bytes()})
}

func (ds *dynamicSchema) resolveSelectionSet(opCtx *graphql.OperationContext, selSet ast.SelectionSet, typeDef *ast.Definition) graphql.Marshaler {
	satisfies := []string{typeDef.Name}
	satisfies = append(satisfies, typeDef.Interfaces...)
	for name, def := range ds.schema.Types {
		if def.Kind == ast.Union {
			for _, member := range def.Types {
				if member == typeDef.Name {
					satisfies = append(satisfies, name)
					break
				}
			}
		}
	}

	collected := graphql.CollectFields(opCtx, selSet, satisfies)
	fieldSet := graphql.NewFieldSet(collected)

	for i, field := range collected {
		if field.Name == "__typename" {
			fieldSet.Values[i] = graphql.MarshalString(typeDef.Name)
			continue
		}
		fieldDef := typeDef.Fields.ForName(field.Name)
		if fieldDef == nil {
			fieldSet.Values[i] = graphql.Null
			continue
		}
		fieldSet.Values[i] = ds.marshalValue(opCtx, field, fieldDef.Type)
	}
	return fieldSet
}

func (ds *dynamicSchema) marshalValue(opCtx *graphql.OperationContext, field graphql.CollectedField, astType *ast.Type) graphql.Marshaler {
	if astType.NonNull {
		inner := &ast.Type{NamedType: astType.NamedType, Elem: astType.Elem}
		return ds.marshalValue(opCtx, field, inner)
	}
	if astType.Elem != nil {
		return graphql.Array{
			ds.marshalValue(opCtx, field, astType.Elem),
			ds.marshalValue(opCtx, field, astType.Elem),
		}
	}

	typeName := astType.NamedType
	def := ds.schema.Types[typeName]
	if def == nil {
		return graphql.Null
	}

	switch def.Kind {
	case ast.Scalar:
		return ds.marshalScalar(typeName)
	case ast.Enum:
		if v, ok := ds.enumFirstValue[typeName]; ok {
			return graphql.MarshalString(v)
		}
		return graphql.Null
	case ast.Object:
		return ds.resolveSelectionSet(opCtx, field.Selections, def)
	case ast.Union:
		concrete := ds.resolveUnionType(def)
		concreteDef := ds.schema.Types[concrete]
		if concreteDef == nil {
			return graphql.Null
		}
		return ds.resolveSelectionSet(opCtx, field.Selections, concreteDef)
	case ast.Interface:
		concrete := ds.resolveInterfaceType(def)
		concreteDef := ds.schema.Types[concrete]
		if concreteDef == nil {
			return graphql.Null
		}
		return ds.resolveSelectionSet(opCtx, field.Selections, concreteDef)
	}
	return graphql.Null
}

func (ds *dynamicSchema) marshalScalar(typeName string) graphql.Marshaler {
	switch typeName {
	case "Int":
		return graphql.MarshalInt(2)
	case "Float":
		return graphql.MarshalFloat(3.14)
	case "String":
		return graphql.MarshalString("str")
	case "Boolean":
		return graphql.MarshalBoolean(true)
	case "ID":
		return graphql.MarshalID("id")
	default:
		return graphql.MarshalString("str")
	}
}

func (ds *dynamicSchema) resolveUnionType(def *ast.Definition) string {
	members := make([]string, len(def.Types))
	copy(members, def.Types)
	sort.Strings(members)
	return members[0]
}

// registerStreamDirective injects a stub @stream definition if the schema
// does not already declare one. Mirrors the built-in arguments from the
// GraphQL incremental-delivery proposal.
func registerStreamDirective(schema *ast.Schema) {
	if schema.Directives == nil {
		schema.Directives = map[string]*ast.DirectiveDefinition{}
	}
	if _, ok := schema.Directives["stream"]; ok {
		return
	}
	schema.Directives["stream"] = &ast.DirectiveDefinition{
		Name: "stream",
		Arguments: ast.ArgumentDefinitionList{
			{Name: "if", Type: &ast.Type{NamedType: "Boolean"}},
			{Name: "label", Type: &ast.Type{NamedType: "String"}},
			{Name: "initialCount", Type: &ast.Type{NamedType: "Int"}},
		},
		Locations: []ast.DirectiveLocation{ast.LocationField},
	}
}


func (ds *dynamicSchema) resolveInterfaceType(def *ast.Definition) string {
	possibleTypes := ds.schema.PossibleTypes[def.Name]
	names := make([]string, len(possibleTypes))
	for i, pt := range possibleTypes {
		names[i] = pt.Name
	}
	sort.Strings(names)
	return names[len(names)-1]
}

type executeRequest struct {
	Schema        string                 `json:"schema"`
	Query         string                 `json:"query"`
	Variables     map[string]interface{} `json:"variables"`
	OperationName string                 `json:"operationName"`
}

func writeJSON(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func executeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	raw, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"errors": []map[string]string{{"message": fmt.Sprintf("read body: %v", err)}},
		})
		return
	}
	var req executeRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"errors": []map[string]string{{"message": fmt.Sprintf("invalid JSON body: %v", err)}},
		})
		return
	}
	if req.Schema == "" || req.Query == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"errors": []map[string]string{{"message": "schema and query are required strings"}},
		})
		return
	}

	astSchema, gqlErr := gqlparser.LoadSchema(&ast.Source{Input: req.Schema})
	if gqlErr != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"errors": []map[string]string{{"message": gqlErr.Error()}},
		})
		return
	}

	registerStreamDirective(astSchema)


	ds := newDynamicSchema(astSchema)
	exec := executor.New(ds)

	params := &graphql.RawParams{
		Query:         req.Query,
		Variables:     req.Variables,
		OperationName: req.OperationName,
	}
	ctx := graphql.StartOperationTrace(r.Context())
	opCtx, errs := exec.CreateOperationContext(ctx, params)
	if len(errs) > 0 {
		resp := exec.DispatchError(ctx, errs)
		out := map[string]interface{}{}
		if resp.Data != nil {
			out["data"] = json.RawMessage(resp.Data)
		} else {
			out["data"] = nil
		}
		if len(resp.Errors) > 0 {
			out["errors"] = resp.Errors
		}
		writeJSON(w, http.StatusOK, out)
		return
	}

	handler, resCtx := exec.DispatchOperation(ctx, opCtx)
	resp := handler(resCtx)

	out := map[string]interface{}{}
	if resp.Data != nil {
		out["data"] = json.RawMessage(resp.Data)
	} else {
		out["data"] = nil
	}
	if len(resp.Errors) > 0 {
		out["errors"] = resp.Errors
	}
	writeJSON(w, http.StatusOK, out)
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("/execute", executeHandler)

	addr := fmt.Sprintf(":%s", port)
	fmt.Fprintf(os.Stderr, "gqlgen driver listening on %s\n", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		fmt.Fprintf(os.Stderr, "server error: %v\n", err)
		os.Exit(1)
	}
}
