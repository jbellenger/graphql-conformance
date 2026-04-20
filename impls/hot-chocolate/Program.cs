using System.Text.Json;
using System.Text.Json.Nodes;
using HotChocolate;
using HotChocolate.Execution;
using HotChocolate.Language;
using HotChocolate.Resolvers;
using HotChocolate.Types;
using Microsoft.Extensions.DependencyInjection;

try
{
    return await RunAsync(args);
}
catch (Exception ex)
{
    var payload = new Dictionary<string, object?>
    {
        ["error"] = ex.GetType().FullName,
        ["message"] = ex.Message,
    };
    Console.Error.WriteLine(JsonSerializer.Serialize(payload));
    return 1;
}

async Task<int> RunAsync(string[] runArgs)
{
    if (runArgs.Length < 2)
    {
        Console.Error.WriteLine("Usage: Conformer <schema> <query> [<variables>]");
        return 1;
    }

    var rawSchemaText = File.ReadAllText(runArgs[0]);
    var queryText = File.ReadAllText(runArgs[1]);

    // Strip built-in directive declarations that Hot Chocolate already registers
    // internally. Corpus schemas may redeclare these, causing "name already
    // registered" errors. We also strip @defer/@stream declarations since HC
    // handles them via opt-in options rather than SDL declarations.
    var schemaDoc = Utf8GraphQLParser.Parse(rawSchemaText);
    var stripDirectives = new HashSet<string>
    {
        "skip", "include", "deprecated", "specifiedBy", "oneOf",
        "defer", "stream",
    };
    var declaredDirectives = new HashSet<string>(
        schemaDoc.Definitions.OfType<DirectiveDefinitionNode>().Select(d => d.Name.Value));
    var enableDefer = declaredDirectives.Contains("defer");
    var enableStream = declaredDirectives.Contains("stream");
    var filteredDefs = schemaDoc.Definitions
        .Where(d => d is not DirectiveDefinitionNode dir || !stripDirectives.Contains(dir.Name.Value))
        .ToList();
    var schemaText = schemaDoc.WithDefinitions(filteredDefs).ToString();

    // Detect custom root type names declared via `schema { query: Foo, ... }`.
    // When a SchemaDefinitionNode is present, its OperationTypeDefinition entries
    // map each operation (query/mutation/subscription) to the corresponding named
    // type. If absent, Hot Chocolate falls back to the defaults Query/Mutation/
    // Subscription automatically.
    string? queryTypeName = null;
    string? mutationTypeName = null;
    string? subscriptionTypeName = null;
    foreach (var schemaDef in schemaDoc.Definitions.OfType<SchemaDefinitionNode>())
    {
        foreach (var op in schemaDef.OperationTypes)
        {
            switch (op.Operation)
            {
                case OperationType.Query:
                    queryTypeName = op.Type.Name.Value;
                    break;
                case OperationType.Mutation:
                    mutationTypeName = op.Type.Name.Value;
                    break;
                case OperationType.Subscription:
                    subscriptionTypeName = op.Type.Name.Value;
                    break;
            }
        }
    }

    Dictionary<string, object?>? variables = null;
    if (runArgs.Length >= 3)
    {
        var varText = File.ReadAllText(runArgs[2]);
        using var doc = JsonDocument.Parse(varText);
        variables = new Dictionary<string, object?>();
        foreach (var prop in doc.RootElement.EnumerateObject())
        {
            variables[prop.Name] = ConvertJsonElement(prop.Value);
        }
    }

    // Build request executor from SDL
    var builder = new ServiceCollection()
        .AddGraphQL()
        .AddDocumentFromString(schemaText);

    // Apply custom root type names (if any) and @defer/@stream opt-in.
    var hasCustomRoots = queryTypeName != null || mutationTypeName != null || subscriptionTypeName != null;
    if (enableDefer || enableStream || hasCustomRoots)
    {
        builder.ModifyOptions(o =>
        {
            if (enableDefer) o.EnableDefer = true;
            if (enableStream) o.EnableStream = true;
            if (queryTypeName != null) o.QueryTypeName = queryTypeName;
            if (mutationTypeName != null) o.MutationTypeName = mutationTypeName;
            if (subscriptionTypeName != null) o.SubscriptionTypeName = subscriptionTypeName;
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
        var collapsed = await CollapseStreamAsync(stream);
        Console.Write(collapsed.ToJsonString());
        return 0;
    }

    if (result is IOperationResult single)
    {
        Console.Write(JsonSerializer.Serialize(BuildSingleOutput(single)));
    }

    return 0;
}

static async Task<JsonObject> CollapseStreamAsync(IResponseStream stream)
{
    JsonNode? data = null;
    var errors = new JsonArray();
    var pendingPaths = new Dictionary<string, List<object>>();

    await foreach (var chunk in stream.ReadResultsAsync())
    {
        var json = chunk.ToJson(withIndentations: false);
        if (JsonNode.Parse(json) is not JsonObject root)
        {
            continue;
        }

        if (data is null && root["data"] is JsonNode dataNode)
        {
            root.Remove("data");
            data = dataNode;
        }

        if (root["errors"] is JsonArray chunkErrors)
        {
            DrainErrors(chunkErrors, errors);
        }

        if (root["pending"] is JsonArray pending)
        {
            foreach (var entry in pending)
            {
                if (entry is not JsonObject obj) continue;
                var id = obj["id"]?.GetValue<string>();
                if (id is null) continue;
                if (obj["path"] is JsonArray pathArr)
                {
                    pendingPaths[id] = ExtractPath(pathArr);
                }
            }
        }

        if (root["incremental"] is JsonArray incremental)
        {
            foreach (var entry in incremental)
            {
                if (entry is not JsonObject inc) continue;

                List<object> fullPath;
                if (inc["path"] is JsonArray directPath)
                {
                    fullPath = ExtractPath(directPath);
                    if (inc["subPath"] is JsonArray directSub)
                    {
                        fullPath.AddRange(ExtractPath(directSub));
                    }
                }
                else
                {
                    var id = inc["id"]?.GetValue<string>();
                    if (id is null || !pendingPaths.TryGetValue(id, out var basePath)) continue;
                    fullPath = new List<object>(basePath);
                    if (inc["subPath"] is JsonArray subPath)
                    {
                        fullPath.AddRange(ExtractPath(subPath));
                    }
                }

                if (inc["data"] is JsonObject incData)
                {
                    inc.Remove("data");
                    if (data is not null)
                    {
                        MergeObjectAt(data, fullPath, incData);
                    }
                }
                else if (inc["items"] is JsonArray incItems)
                {
                    inc.Remove("items");
                    if (data is not null)
                    {
                        AppendItemsAt(data, fullPath, incItems);
                    }
                }

                if (inc["errors"] is JsonArray incErrors)
                {
                    DrainErrors(incErrors, errors);
                }
            }
        }
    }

    var output = new JsonObject { ["data"] = data };
    if (errors.Count > 0)
    {
        output["errors"] = errors;
    }
    return output;
}

static List<object> ExtractPath(JsonArray arr)
{
    var list = new List<object>(arr.Count);
    foreach (var seg in arr)
    {
        if (seg is not JsonValue value) continue;
        if (value.TryGetValue<string>(out var s))
        {
            list.Add(s);
        }
        else if (value.TryGetValue<int>(out var i))
        {
            list.Add(i);
        }
        else if (value.TryGetValue<long>(out var l))
        {
            list.Add((int)l);
        }
    }
    return list;
}

static JsonNode? Navigate(JsonNode root, IReadOnlyList<object> path)
{
    JsonNode? current = root;
    foreach (var seg in path)
    {
        if (current is null) return null;
        switch (seg)
        {
            case string name when current is JsonObject obj:
                current = obj[name];
                break;
            case int index when current is JsonArray arr:
                current = index >= 0 && index < arr.Count ? arr[index] : null;
                break;
            default:
                return null;
        }
    }
    return current;
}

static void MergeObjectAt(JsonNode root, IReadOnlyList<object> path, JsonObject patch)
{
    if (Navigate(root, path) is not JsonObject target) return;
    var keys = new List<string>();
    foreach (var kv in patch) keys.Add(kv.Key);
    foreach (var key in keys)
    {
        var val = patch[key];
        patch.Remove(key);
        target[key] = val;
    }
}

static void AppendItemsAt(JsonNode root, IReadOnlyList<object> path, JsonArray items)
{
    if (Navigate(root, path) is not JsonArray target) return;
    while (items.Count > 0)
    {
        var item = items[0];
        items.RemoveAt(0);
        target.Add(item);
    }
}

static void DrainErrors(JsonArray source, JsonArray destination)
{
    while (source.Count > 0)
    {
        var err = source[0];
        source.RemoveAt(0);
        destination.Add(NormalizeError(err));
    }
}

static JsonObject NormalizeError(JsonNode? err)
{
    var normalized = new JsonObject();
    if (err is JsonObject obj && obj["message"] is JsonValue msg && msg.TryGetValue<string>(out var text))
    {
        normalized["message"] = text;
    }
    else
    {
        normalized["message"] = err?.ToString() ?? string.Empty;
    }
    return normalized;
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
