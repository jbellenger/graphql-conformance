package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"

	"github.com/graphql-go/graphql"
	"github.com/vektah/gqlparser/v2"
	"github.com/vektah/gqlparser/v2/ast"
)

// SchemaBuilder converts a gqlparser AST schema into a graphql-go schema.
type SchemaBuilder struct {
	astSchema      *ast.Schema
	typeMap        map[string]graphql.Type
	enumFirstValue map[string]interface{}
}

func newSchemaBuilder(astSchema *ast.Schema) *SchemaBuilder {
	sb := &SchemaBuilder{
		astSchema:      astSchema,
		typeMap:        make(map[string]graphql.Type),
		enumFirstValue: make(map[string]interface{}),
	}
	// Pre-populate built-in scalars.
	sb.typeMap["Int"] = graphql.Int
	sb.typeMap["Float"] = graphql.Float
	sb.typeMap["String"] = graphql.String
	sb.typeMap["Boolean"] = graphql.Boolean
	sb.typeMap["ID"] = graphql.ID
	return sb
}

func (sb *SchemaBuilder) Build() (graphql.Schema, error) {
	// First pass: create all types (thunks handle forward references).
	for name, def := range sb.astSchema.Types {
		if def.BuiltIn {
			continue
		}
		switch def.Kind {
		case ast.Scalar:
			sb.typeMap[name] = graphql.NewScalar(graphql.ScalarConfig{
				Name: name,
				Serialize: func(value interface{}) interface{} {
					return value
				},
			})
		case ast.Enum:
			values := graphql.EnumValueConfigMap{}
			for _, v := range def.EnumValues {
				values[v.Name] = &graphql.EnumValueConfig{Value: v.Name}
			}
			if len(def.EnumValues) > 0 {
				sb.enumFirstValue[name] = def.EnumValues[0].Name
			}
			sb.typeMap[name] = graphql.NewEnum(graphql.EnumConfig{
				Name:   name,
				Values: values,
			})
		case ast.Object:
			obj := graphql.NewObject(graphql.ObjectConfig{
				Name: name,
				Fields: (graphql.FieldsThunk)(func() graphql.Fields {
					return sb.buildFields(def)
				}),
				Interfaces: (graphql.InterfacesThunk)(func() []*graphql.Interface {
					var ifaces []*graphql.Interface
					for _, iname := range def.Interfaces {
						if t, ok := sb.typeMap[iname]; ok {
							if iface, ok := t.(*graphql.Interface); ok {
								ifaces = append(ifaces, iface)
							}
						}
					}
					return ifaces
				}),
			})
			sb.typeMap[name] = obj
		case ast.Interface:
			defCopy := def
			sb.typeMap[name] = graphql.NewInterface(graphql.InterfaceConfig{
				Name: name,
				Fields: (graphql.FieldsThunk)(func() graphql.Fields {
					return sb.buildFields(defCopy)
				}),
				ResolveType: func(p graphql.ResolveTypeParams) *graphql.Object {
					return sb.resolveInterfaceType(name)
				},
			})
		case ast.Union:
			defCopy := def
			sb.typeMap[name] = graphql.NewUnion(graphql.UnionConfig{
				Name: name,
				Types: (graphql.UnionTypesThunk)(func() []*graphql.Object {
					var members []*graphql.Object
					for _, m := range defCopy.Types {
						if t, ok := sb.typeMap[m]; ok {
							if obj, ok := t.(*graphql.Object); ok {
								members = append(members, obj)
							}
						}
					}
					return members
				}),
				ResolveType: func(p graphql.ResolveTypeParams) *graphql.Object {
					return sb.resolveUnionType(defCopy)
				},
			})
		case ast.InputObject:
			defCopy := def
			sb.typeMap[name] = graphql.NewInputObject(graphql.InputObjectConfig{
				Name: name,
				Fields: (graphql.InputObjectConfigFieldMapThunk)(func() graphql.InputObjectConfigFieldMap {
					return sb.buildInputFields(defCopy)
				}),
			})
		}
	}

	if sb.astSchema.Query == nil {
		return graphql.Schema{}, fmt.Errorf("Query type not found")
	}
	queryType, ok := sb.typeMap[sb.astSchema.Query.Name].(*graphql.Object)
	if !ok {
		return graphql.Schema{}, fmt.Errorf("Query type %q not found in typeMap", sb.astSchema.Query.Name)
	}

	config := graphql.SchemaConfig{
		Query: queryType,
	}

	// Include all types so implementations are discovered.
	var allTypes []graphql.Type
	for _, t := range sb.typeMap {
		allTypes = append(allTypes, t)
	}
	config.Types = allTypes

	if sb.astSchema.Mutation != nil {
		if mt, ok := sb.typeMap[sb.astSchema.Mutation.Name]; ok {
			if mutType, ok := mt.(*graphql.Object); ok {
				config.Mutation = mutType
			}
		}
	}

	// Register custom directives from the schema.
	for name, dir := range sb.astSchema.Directives {
		if dir.Position != nil && dir.Position.Src != nil && dir.Position.Src.BuiltIn {
			continue
		}
		var locations []string
		for _, loc := range dir.Locations {
			locations = append(locations, string(loc))
		}
		args := graphql.FieldConfigArgument{}
		for _, arg := range dir.Arguments {
			args[arg.Name] = &graphql.ArgumentConfig{
				Type: sb.resolveInputType(arg.Type),
			}
		}
		config.Directives = append(config.Directives, graphql.NewDirective(graphql.DirectiveConfig{
			Name:      name,
			Locations: locations,
			Args:      args,
		}))
	}

	return graphql.NewSchema(config)
}

func (sb *SchemaBuilder) resolveOutputType(t *ast.Type) graphql.Output {
	if t.NonNull {
		inner := &ast.Type{
			NamedType: t.NamedType,
			Elem:      t.Elem,
		}
		return graphql.NewNonNull(sb.resolveOutputType(inner))
	}
	if t.Elem != nil {
		return graphql.NewList(sb.resolveOutputType(t.Elem))
	}
	if gt, ok := sb.typeMap[t.NamedType]; ok {
		if out, ok := gt.(graphql.Output); ok {
			return out
		}
	}
	return graphql.String
}

func (sb *SchemaBuilder) resolveInputType(t *ast.Type) graphql.Input {
	if t.NonNull {
		inner := &ast.Type{
			NamedType: t.NamedType,
			Elem:      t.Elem,
		}
		return graphql.NewNonNull(sb.resolveInputType(inner))
	}
	if t.Elem != nil {
		return graphql.NewList(sb.resolveInputType(t.Elem))
	}
	if gt, ok := sb.typeMap[t.NamedType]; ok {
		if in, ok := gt.(graphql.Input); ok {
			return in
		}
	}
	return graphql.String
}

func (sb *SchemaBuilder) buildFields(def *ast.Definition) graphql.Fields {
	fields := graphql.Fields{}
	for _, f := range def.Fields {
		fieldType := sb.resolveOutputType(f.Type)
		args := graphql.FieldConfigArgument{}
		for _, a := range f.Arguments {
			args[a.Name] = &graphql.ArgumentConfig{
				Type: sb.resolveInputType(a.Type),
			}
		}
		fields[f.Name] = &graphql.Field{
			Name: f.Name,
			Type: fieldType,
			Args: args,
			Resolve: func(p graphql.ResolveParams) (interface{}, error) {
				return resolveValue(p.Info.ReturnType, sb), nil
			},
		}
	}
	return fields
}

func (sb *SchemaBuilder) buildInputFields(def *ast.Definition) graphql.InputObjectConfigFieldMap {
	fields := graphql.InputObjectConfigFieldMap{}
	for _, f := range def.Fields {
		fields[f.Name] = &graphql.InputObjectFieldConfig{
			Type: sb.resolveInputType(f.Type),
		}
	}
	return fields
}

func (sb *SchemaBuilder) resolveUnionType(def *ast.Definition) *graphql.Object {
	members := make([]string, len(def.Types))
	copy(members, def.Types)
	sort.Strings(members)
	if t, ok := sb.typeMap[members[0]]; ok {
		if obj, ok := t.(*graphql.Object); ok {
			return obj
		}
	}
	return nil
}

func (sb *SchemaBuilder) resolveInterfaceType(name string) *graphql.Object {
	possibleTypes := sb.astSchema.PossibleTypes[name]
	names := make([]string, len(possibleTypes))
	for i, pt := range possibleTypes {
		names[i] = pt.Name
	}
	sort.Strings(names)
	last := names[len(names)-1]
	if t, ok := sb.typeMap[last]; ok {
		if obj, ok := t.(*graphql.Object); ok {
			return obj
		}
	}
	return nil
}

func resolveValue(t graphql.Output, sb *SchemaBuilder) interface{} {
	switch typ := t.(type) {
	case *graphql.NonNull:
		return resolveValue(typ.OfType.(graphql.Output), sb)
	case *graphql.List:
		inner := typ.OfType.(graphql.Output)
		return []interface{}{resolveValue(inner, sb), resolveValue(inner, sb)}
	case *graphql.Scalar:
		switch typ.Name() {
		case "Int":
			return 2
		case "Float":
			return 3.14
		case "String":
			return "str"
		case "Boolean":
			return true
		case "ID":
			return "id"
		default:
			return "str"
		}
	case *graphql.Enum:
		if v, ok := sb.enumFirstValue[typ.Name()]; ok {
			return v
		}
		return nil
	case *graphql.Object:
		return map[string]interface{}{}
	case *graphql.Union:
		return map[string]interface{}{}
	case *graphql.Interface:
		return map[string]interface{}{}
	}
	return nil
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

	var variables map[string]interface{}
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

	// Build graphql-go schema.
	sb := newSchemaBuilder(astSchema)
	schema, err := sb.Build()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error building schema: %v\n", err)
		os.Exit(1)
	}

	// Execute query.
	params := graphql.Params{
		Schema:        schema,
		RequestString: string(queryBytes),
	}
	if variables != nil {
		params.VariableValues = variables
	}

	result := graphql.Do(params)

	// Build output matching graphql-js format: only include "errors" if non-empty.
	output := map[string]interface{}{}
	output["data"] = result.Data
	if len(result.Errors) > 0 {
		output["errors"] = result.Errors
	}

	jsonBytes, err := json.Marshal(output)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error marshaling result: %v\n", err)
		os.Exit(1)
	}

	fmt.Print(string(jsonBytes))
}
