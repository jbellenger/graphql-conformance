using System.Text.Json;
using HotChocolate;
using HotChocolate.Execution;
using HotChocolate.Language;
using HotChocolate.Resolvers;
using HotChocolate.Types;
using Microsoft.Extensions.DependencyInjection;

const string StreamProtocol = "conformer-stream-v1";

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

static object? NormalizeResultValue(object? value)
{
    if (value is null)
    {
        return null;
    }

    using var doc = JsonDocument.Parse(JsonSerializer.Serialize(value));
    return ConvertJsonElement(doc.RootElement);
}

static List<object>? FormatErrors(IReadOnlyList<IError>? source)
{
    if (source is not { Count: > 0 })
    {
        return null;
    }

    var errors = new List<object>();
    foreach (var error in source)
    {
        errors.Add(new { message = error.Message });
    }
    return errors;
}

static Dictionary<string, object?> CreateProtocolEvent(string kind)
{
    return new Dictionary<string, object?>
    {
        ["protocol"] = StreamProtocol,
        ["kind"] = kind,
    };
}

static void WriteProtocolEvent(Dictionary<string, object?> payload)
{
    Console.WriteLine(JsonSerializer.Serialize(payload));
}

static Dictionary<string, object?> BuildSingleOutput(IOperationResult result)
{
    var output = new Dictionary<string, object?> { ["data"] = result.Data };
    var errors = FormatErrors(result.Errors);
    if (errors is { Count: > 0 })
    {
        output["errors"] = errors;
    }
    return output;
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
        // Skip introspection fields. Let HC handle __typename and friends.
        if (context.Selection.Field.Name.StartsWith("__"))
        {
            return next(context);
        }
        context.Result = ResolveValue(context.Selection.Type);
        return default;
    })
    .ConfigureSchema(sb => sb.SetTypeResolver((objectType, context, result) =>
    {
        // For unions: resolve to alphabetically first member.
        // For interfaces: resolve to alphabetically last implementor.
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

var requestBuilder = OperationRequestBuilder.New().SetDocument(queryText);
if (variables != null)
{
    requestBuilder.SetVariableValues(
        variables.ToDictionary(kv => kv.Key, kv => kv.Value));
}

var result = await executor.ExecuteAsync(requestBuilder.Build());

if (result is IResponseStream stream)
{
    var wroteInitial = false;
    var wroteComplete = false;

    await foreach (var chunk in stream.ReadResultsAsync())
    {
        if (!wroteInitial)
        {
            var initialEvent = CreateProtocolEvent("initial");
            initialEvent["data"] = NormalizeResultValue(chunk.Data);
            var initialErrors = FormatErrors(chunk.Errors);
            if (initialErrors is { Count: > 0 })
            {
                initialEvent["errors"] = initialErrors;
            }
            WriteProtocolEvent(initialEvent);
            wroteInitial = true;
        }
        else
        {
            var chunkEvent = CreateProtocolEvent("patch");
            if (chunk.Data != null)
            {
                chunkEvent["path"] = Array.Empty<object>();
                chunkEvent["data"] = NormalizeResultValue(chunk.Data);
            }
            var chunkErrors = FormatErrors(chunk.Errors);
            if (chunkErrors is { Count: > 0 })
            {
                chunkEvent["errors"] = chunkErrors;
            }
            if (chunkEvent.Count > 2)
            {
                WriteProtocolEvent(chunkEvent);
            }
        }

        if (chunk.Incremental != null)
        {
            foreach (var inc in chunk.Incremental)
            {
                var patchEvent = CreateProtocolEvent("patch");
                patchEvent["path"] = inc.Path.ToList();
                if (inc.Data != null)
                {
                    patchEvent["data"] = NormalizeResultValue(inc.Data);
                }
                var patchErrors = FormatErrors(inc.Errors);
                if (patchErrors is { Count: > 0 })
                {
                    patchEvent["errors"] = patchErrors;
                }
                WriteProtocolEvent(patchEvent);
            }
        }

        if (chunk.HasNext == false)
        {
            WriteProtocolEvent(CreateProtocolEvent("complete"));
            wroteComplete = true;
        }
    }

    if (wroteInitial && !wroteComplete)
    {
        WriteProtocolEvent(CreateProtocolEvent("complete"));
    }
    return 0;
}

if (result is IOperationResult single)
{
    Console.Write(JsonSerializer.Serialize(BuildSingleOutput(single)));
}

return 0;

static object? ResolveValue(IType type)
{
    if (type.IsNonNullType())
    {
        return ResolveValue(type.InnerType());
    }

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
            _ => "str",
        };
    }

    if (named is EnumType enumType)
    {
        return enumType.Values.First().Name;
    }

    if (named is ObjectType || named is UnionType || named is InterfaceType)
    {
        return new Dictionary<string, object?>();
    }

    return null;
}
