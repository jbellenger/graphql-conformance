using System.Text.Json;
using HotChocolate;
using HotChocolate.Execution;
using HotChocolate.Language;
using HotChocolate.Resolvers;
using HotChocolate.Types;
using Microsoft.Extensions.DependencyInjection;

if (args.Length < 2)
{
    Console.Error.WriteLine("Usage: Conformer <schema> <query> [<variables>]");
    return 1;
}

var rawSchemaText = File.ReadAllText(args[0]);
var queryText = File.ReadAllText(args[1]);

// Strip built-in directive declarations that Hot Chocolate already registers
// internally. Corpus schemas may redeclare these, causing "name already
// registered" errors. We also strip @defer/@stream declarations since HC
// handles them via opt-in options rather than SDL declarations.
var schemaDoc = Utf8GraphQLParser.Parse(rawSchemaText);
var stripDirectives = new HashSet<string>
{
    "skip", "include", "deprecated", "specifiedBy", "oneOf",
    "experimental_disableErrorPropagation", "defer", "stream",
};
var declaredDirectives = new HashSet<string>(
    schemaDoc.Definitions.OfType<DirectiveDefinitionNode>().Select(d => d.Name.Value));
var enableDefer = declaredDirectives.Contains("defer");
var enableStream = declaredDirectives.Contains("stream");
var filteredDefs = schemaDoc.Definitions
    .Where(d => d is not DirectiveDefinitionNode dir || !stripDirectives.Contains(dir.Name.Value))
    .ToList();
var schemaText = schemaDoc.WithDefinitions(filteredDefs).ToString();

Dictionary<string, object?>? variables = null;
if (args.Length >= 3)
{
    var varText = File.ReadAllText(args[2]);
    using var doc = JsonDocument.Parse(varText);
    variables = new Dictionary<string, object?>();
    foreach (var prop in doc.RootElement.EnumerateObject())
    {
        variables[prop.Name] = ConvertJsonElement(prop.Value);
    }
}

static object? ConvertJsonElement(JsonElement element)
{
    return element.ValueKind switch
    {
        JsonValueKind.String => element.GetString(),
        JsonValueKind.Number => element.TryGetInt32(out var i) ? i : element.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Null => null,
        JsonValueKind.Array => element.EnumerateArray().Select(ConvertJsonElement).ToList(),
        JsonValueKind.Object => element.EnumerateObject()
            .ToDictionary(p => p.Name, p => ConvertJsonElement(p.Value)),
        _ => element.ToString(),
    };
}

// Build request executor from SDL
var builder = new ServiceCollection()
    .AddGraphQL()
    .AddDocumentFromString(schemaText);

// Enable @defer/@stream if the schema declared them, so HC accepts their
// usage in queries without returning a validation error.
if (enableDefer || enableStream)
{
    builder.ModifyOptions(o =>
    {
        o.EnableDefer = enableDefer;
        o.EnableStream = enableStream;
    });
}

var executor = await builder
    .UseField(next => context =>
    {
        // Skip introspection fields — let HC handle __typename etc.
        if (context.Selection.Field.Name.StartsWith("__"))
        {
            return next(context);
        }
        context.Result = ResolveValue(context.Selection.Type);
        return default;
    })
    .ConfigureSchema(sb => sb.SetTypeResolver((objectType, context, result) =>
    {
        // For unions: resolve to alphabetically first member
        // For interfaces: resolve to alphabetically last implementor
        var parentType = context.Selection.Type.NamedType();

        if (parentType is UnionType union)
        {
            var names = new List<string>();
            foreach (var kv in union.Types) names.Add(kv.Value.Name.ToString());
            names.Sort(StringComparer.Ordinal);
            return objectType.Name.ToString() == names[0];
        }

        if (parentType is InterfaceType iface)
        {
            var schema = context.Schema;
            var names = new List<string>();
            foreach (var type in schema.Types)
            {
                if (type is ObjectType obj && obj.IsImplementing(iface.Name))
                {
                    names.Add(obj.Name.ToString());
                }
            }
            names.Sort(StringComparer.Ordinal);
            return objectType.Name.ToString() == names[^1];
        }

        return true;
    }))
    .BuildRequestExecutorAsync();

// Build request
var requestBuilder = OperationRequestBuilder.New().SetDocument(queryText);
if (variables != null)
{
    requestBuilder.SetVariableValues(
        variables.ToDictionary(kv => kv.Key, kv => kv.Value));
}

var result = await executor.ExecuteAsync(requestBuilder.Build());

// When @defer/@stream is active, HC returns an IResponseStream instead of a
// single IOperationResult. Collect all chunks — our resolvers are synchronous
// so the stream completes immediately. The last chunk has the final data.
IOperationResult? opResult = null;
if (result is IResponseStream stream)
{
    // @defer returns incremental chunks: the initial result in Data, and
    // deferred fields in Incremental entries on subsequent chunks.
    // Merge everything into a single flat data map.
    Dictionary<string, object?>? merged = null;
    await foreach (var chunk in stream.ReadResultsAsync())
    {
        opResult = chunk;
        if (chunk.Data != null)
        {
            merged ??= new Dictionary<string, object?>();
            foreach (var kv in chunk.Data)
                merged[kv.Key] = kv.Value;
        }
        if (chunk.Incremental != null)
        {
            merged ??= new Dictionary<string, object?>();
            foreach (var inc in chunk.Incremental)
            {
                if (inc.Data != null)
                {
                    foreach (var kv in inc.Data)
                        merged[kv.Key] = kv.Value;
                }
            }
        }
    }
    if (merged != null)
    {
        opResult = OperationResultBuilder.FromResult(opResult!).SetData(merged).Build();
    }
}
else if (result is IOperationResult single)
{
    opResult = single;
}

if (opResult != null)
{
    var output = new Dictionary<string, object?>();
    output["data"] = opResult.Data;
    if (opResult.Errors is { Count: > 0 })
    {
        output["errors"] = opResult.Errors.Select(e => new { message = e.Message }).ToList();
    }
    var json = JsonSerializer.Serialize(output);
    Console.Write(json);
}

return 0;

static object? ResolveValue(IType type)
{
    // Unwrap NonNull
    if (type.IsNonNullType())
        return ResolveValue(type.InnerType());

    // List: return 2 items
    if (type.IsListType())
    {
        var inner = type.ElementType();
        return new object?[] { ResolveValue(inner), ResolveValue(inner) };
    }

    var named = type.NamedType();
    if (named is ScalarType scalar)
    {
        return scalar.Name switch
        {
            "Int" => 2,
            "Float" => 3.14,
            "String" => "str",
            "Boolean" => true,
            "ID" => "id",
            _ => "str", // custom scalars
        };
    }

    if (named is EnumType enumType)
    {
        return enumType.Values.First().Name;
    }

    // Object, Union, Interface → empty map (HC will recurse into fields)
    if (named is ObjectType || named is UnionType || named is InterfaceType)
    {
        return new Dictionary<string, object?>();
    }

    return null;
}
