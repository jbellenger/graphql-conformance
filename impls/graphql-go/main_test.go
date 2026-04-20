package main

import (
	"encoding/json"
	"testing"

	"github.com/graphql-go/graphql"
	"github.com/vektah/gqlparser/v2"
	"github.com/vektah/gqlparser/v2/ast"
)

func execJSON(t *testing.T, sdl, query string) string {
	t.Helper()
	astSchema, gqlErr := gqlparser.LoadSchema(&ast.Source{Input: sdl})
	if gqlErr != nil {
		t.Fatalf("parse schema: %v", gqlErr)
	}
	sb := newSchemaBuilder(astSchema)
	schema, err := sb.Build()
	if err != nil {
		t.Fatalf("build schema: %v", err)
	}
	result := graphql.Do(graphql.Params{
		Schema:        schema,
		RequestString: query,
	})
	if len(result.Errors) > 0 {
		t.Fatalf("graphql errors: %v", result.Errors)
	}
	output := map[string]interface{}{"data": result.Data}
	b, err := json.Marshal(output)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

func TestIntFieldReturns2(t *testing.T) {
	got := execJSON(t, "type Query { x: Int }", "{ x }")
	want := `{"data":{"x":2}}`
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestFloatFieldReturns314(t *testing.T) {
	got := execJSON(t, "type Query { x: Float }", "{ x }")
	want := `{"data":{"x":3.14}}`
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestStringFieldReturnsStr(t *testing.T) {
	got := execJSON(t, "type Query { x: String }", "{ x }")
	want := `{"data":{"x":"str"}}`
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestBooleanFieldReturnsTrue(t *testing.T) {
	got := execJSON(t, "type Query { x: Boolean }", "{ x }")
	want := `{"data":{"x":true}}`
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestIDFieldReturnsId(t *testing.T) {
	got := execJSON(t, "type Query { x: ID }", "{ x }")
	want := `{"data":{"x":"id"}}`
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestNullableFieldIsNonNull(t *testing.T) {
	got := execJSON(t, "type Query { x: String }", "{ x }")
	want := `{"data":{"x":"str"}}`
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestListFieldReturns2Items(t *testing.T) {
	got := execJSON(t, "type Query { x: [String] }", "{ x }")
	want := `{"data":{"x":["str","str"]}}`
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestEnumFieldReturnsFirstDeclaredValue(t *testing.T) {
	got := execJSON(t, "enum Color { RED GREEN BLUE } type Query { x: Color }", "{ x }")
	want := `{"data":{"x":"RED"}}`
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestUnionResolvesAlphabeticallyFirstMember(t *testing.T) {
	sdl := "type Dog { bark: String } type Cat { meow: String } union Pet = Dog | Cat type Query { x: Pet }"
	query := "{ x { ... on Cat { meow } ... on Dog { bark } } }"
	got := execJSON(t, sdl, query)
	want := `{"data":{"x":{"meow":"str"}}}`
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestInterfaceResolvesAlphabeticallyLastImplementor(t *testing.T) {
	sdl := "interface Node { id: ID } type Alpha implements Node { id: ID a: Int } type Zeta implements Node { id: ID z: Int } type Query { x: Node }"
	query := "{ x { id ... on Alpha { a } ... on Zeta { z } } }"
	got := execJSON(t, sdl, query)
	want := `{"data":{"x":{"id":"id","z":2}}}`
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestNestedListOfObjectsReturns2Items(t *testing.T) {
	sdl := "type Item { name: String } type Query { items: [Item] }"
	got := execJSON(t, sdl, "{ items { name } }")
	want := `{"data":{"items":[{"name":"str"},{"name":"str"}]}}`
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestCustomQueryRootTypeName(t *testing.T) {
	sdl := "schema { query: MyRoot } type MyRoot { x: String }"
	got := execJSON(t, sdl, "{ x }")
	want := `{"data":{"x":"str"}}`
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestCustomMutationRootTypeName(t *testing.T) {
	sdl := "schema { query: Q mutation: MyMutation } type Q { x: String } type MyMutation { doIt: Boolean }"
	got := execJSON(t, sdl, "mutation { doIt }")
	want := `{"data":{"doIt":true}}`
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestNonNullWrapperDoesNotChangeValue(t *testing.T) {
	got := execJSON(t, "type Query { x: String! }", "{ x }")
	want := `{"data":{"x":"str"}}`
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestResolveUnionTypeReturnsNilForEmptyMembers(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("resolveUnionType panicked on empty member list: %v", r)
		}
	}()
	sb := newSchemaBuilder(&ast.Schema{})
	def := &ast.Definition{
		Kind:  ast.Union,
		Name:  "EmptyUnion",
		Types: []string{},
	}
	if got := sb.resolveUnionType(def); got != nil {
		t.Errorf("expected nil for empty union member list, got %v", got)
	}
}

func TestResolveInterfaceTypeReturnsNilForNoImplementors(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("resolveInterfaceType panicked on no implementors: %v", r)
		}
	}()
	sb := newSchemaBuilder(&ast.Schema{
		PossibleTypes: map[string][]*ast.Definition{},
	})
	if got := sb.resolveInterfaceType("UnimplementedInterface"); got != nil {
		t.Errorf("expected nil for interface with no implementors, got %v", got)
	}
}

func TestResolveUnionTypeStillWorksOnHappyPath(t *testing.T) {
	// Sanity check: the guard doesn't break the non-empty case.
	sdl := "type Dog { bark: String } type Cat { meow: String } union Pet = Dog | Cat type Query { x: Pet }"
	query := "{ x { ... on Cat { meow } ... on Dog { bark } } }"
	got := execJSON(t, sdl, query)
	want := `{"data":{"x":{"meow":"str"}}}`
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}
