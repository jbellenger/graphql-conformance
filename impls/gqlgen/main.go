package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
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

func (ds *dynamicSchema) Schema() *ast.Schema {
	return ds.schema
}

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

// resolveSelectionSet collects fields from a selection set and resolves each
// field according to the wiring spec.
func (ds *dynamicSchema) resolveSelectionSet(
	opCtx *graphql.OperationContext,
	selSet ast.SelectionSet,
	typeDef *ast.Definition,
) graphql.Marshaler {
	// Build satisfies list: the concrete type, its interfaces, and any unions it belongs to.
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

// marshalValue produces a graphql.Marshaler for the given AST type according
// to the wiring spec.
func (ds *dynamicSchema) marshalValue(
	opCtx *graphql.OperationContext,
	field graphql.CollectedField,
	astType *ast.Type,
) graphql.Marshaler {
	// Unwrap NonNull — same value, just not nullable.
	if astType.NonNull {
		inner := &ast.Type{NamedType: astType.NamedType, Elem: astType.Elem}
		return ds.marshalValue(opCtx, field, inner)
	}

	// List → return exactly 2 items.
	if astType.Elem != nil {
		return graphql.Array{
			ds.marshalValue(opCtx, field, astType.Elem),
			ds.marshalValue(opCtx, field, astType.Elem),
		}
	}

	// Named type.
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

// marshalScalar returns the wiring-spec value for a scalar type.
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
		return graphql.MarshalString("str") // custom scalars
	}
}

// resolveUnionType returns the lexicographically first member type name.
func (ds *dynamicSchema) resolveUnionType(def *ast.Definition) string {
	members := make([]string, len(def.Types))
	copy(members, def.Types)
	sort.Strings(members)
	return members[0]
}

// resolveInterfaceType returns the lexicographically last implementing type name.
func (ds *dynamicSchema) resolveInterfaceType(def *ast.Definition) string {
	possibleTypes := ds.schema.PossibleTypes[def.Name]
	names := make([]string, len(possibleTypes))
	for i, pt := range possibleTypes {
		names[i] = pt.Name
	}
	sort.Strings(names)
	return names[len(names)-1]
}

func main() {
	if len(os.Args) < 3 {
		fmt.Fprintf(os.Stderr, "Usage: conformer <schema> <query> [<variables>]\n")
		os.Exit(1)
	}

	schemaPath := os.Args[1]
	queryPath := os.Args[2]

	schemaBytes, err := os.ReadFile(schemaPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading schema: %v\n", err)
		os.Exit(1)
	}

	queryBytes, err := os.ReadFile(queryPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading query: %v\n", err)
		os.Exit(1)
	}

	var variables map[string]any
	if len(os.Args) >= 4 {
		varBytes, err := os.ReadFile(os.Args[3])
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error reading variables: %v\n", err)
			os.Exit(1)
		}
		if err := json.Unmarshal(varBytes, &variables); err != nil {
			fmt.Fprintf(os.Stderr, "Error parsing variables: %v\n", err)
			os.Exit(1)
		}
	}

	// Parse SDL with gqlparser.
	astSchema, gqlErr := gqlparser.LoadSchema(&ast.Source{Input: string(schemaBytes)})
	if gqlErr != nil {
		fmt.Fprintf(os.Stderr, "Error parsing schema: %v\n", gqlErr)
		os.Exit(1)
	}

	// Build dynamic executable schema.
	ds := newDynamicSchema(astSchema)

	// Create gqlgen executor.
	exec := executor.New(ds)

	// Build operation params.
	params := &graphql.RawParams{
		Query:     string(queryBytes),
		Variables: variables,
	}

	// Execute.
	ctx := context.Background()
	ctx = graphql.StartOperationTrace(ctx)

	opCtx, errs := exec.CreateOperationContext(ctx, params)
	if len(errs) > 0 {
		resp := exec.DispatchError(ctx, errs)
		jsonBytes, _ := json.Marshal(resp)
		fmt.Print(string(jsonBytes))
		os.Exit(0)
	}

	handler, resCtx := exec.DispatchOperation(ctx, opCtx)
	resp := handler(resCtx)

	// Build output matching graphql-js format: only include "errors" if non-empty.
	output := map[string]any{}
	if resp.Data != nil {
		output["data"] = json.RawMessage(resp.Data)
	} else {
		output["data"] = nil
	}
	if len(resp.Errors) > 0 {
		output["errors"] = resp.Errors
	}

	jsonBytes, err := json.Marshal(output)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error marshaling result: %v\n", err)
		os.Exit(1)
	}

	fmt.Print(string(jsonBytes))
}
