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

var schemaText = File.ReadAllText(args[0]);
var queryText = File.ReadAllText(args[1]);
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
var executor = await new ServiceCollection()
    .AddGraphQL()
    .AddDocumentFromString(schemaText)
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
            // Need to find implementing ObjectTypes from the schema
            // iface.Implements returns interfaces (what this interface implements),
            // but we need the ObjectTypes that implement this interface.
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

// Serialize result
if (result is IOperationResult opResult)
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
