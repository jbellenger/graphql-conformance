module conformer

go 1.22

require (
	github.com/graphql-go/graphql v0.8.1
	github.com/vektah/gqlparser/v2 v2.5.22
)

require github.com/agnivade/levenshtein v1.2.0 // indirect

replace github.com/graphql-go/graphql => ./build
