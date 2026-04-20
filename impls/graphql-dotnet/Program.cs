using System.Text.Json;
using GraphQL;
using GraphQL.Resolvers;
using GraphQL.SystemTextJson;
using GraphQL.Types;
using GraphQLParser;
using GraphQLParser.AST;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var port = Environment.GetEnvironmentVariable("PORT") is { Length: > 0 } p ? int.Parse(p) : 8080;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");
builder.Logging.ClearProviders();

var app = builder.Build();

app.MapGet("/health", () => Results.Text("ok"));

app.MapPost("/execute", async (HttpRequest req) =>
{
    ExecuteRequest? payload;
    try
    {
        payload = await JsonSerializer.DeserializeAsync<ExecuteRequest>(req.Body, GetJsonOpts());
    }
    catch (Exception e)
    {
        return ErrorResponse(400, e.Message);
    }

    if (payload?.Schema is null || payload.Query is null)
        return ErrorResponse(400, "schema and query are required strings");

    try
    {
        var resultJson = await ExecuteAsync(payload);
        return Results.Content(resultJson, "application/json", null, 200);
    }
    catch (Exception e)
    {
        return ErrorResponse(500, e.Message);
    }
});

app.Run();
return 0;

static IResult ErrorResponse(int status, string message)
{
    var body = JsonSerializer.Serialize(new { errors = new[] { new { message } } });
    return Results.Content(body, "application/json", null, status);
}

static async Task<string> ExecuteAsync(ExecuteRequest payload)
{
    var schemaText = payload.Schema!;
    var queryText = payload.Query!;
    var document = Parser.Parse(schemaText);
    var unionMembers = CollectUnionMembers(document);
    var interfaceImplementors = CollectInterfaceImplementors(document);
    var abstractPossibleTypes = unionMembers.Values
        .SelectMany(x => x)
        .Concat(interfaceImplementors.Values.SelectMany(x => x))
        .Distinct(StringComparer.Ordinal)
        .ToArray();

    var schema = Schema.For(schemaText, sb =>
    {
        foreach (var objectTypeName in abstractPossibleTypes)
        {
            sb.Types.For(objectTypeName).IsTypeOfFunc = value =>
                value is RuntimeTypeMarker marker && string.Equals(marker.TypeName, objectTypeName, StringComparison.Ordinal);
        }
    });

    foreach (var graphType in schema.AllTypes)
    {
        if (graphType is not IComplexGraphType complex) continue;
        foreach (var field in complex.Fields)
        {
            if (field.Name.StartsWith("__", StringComparison.Ordinal)) continue;
            var resolvedType = field.ResolvedType
                ?? throw new InvalidOperationException($"Field {complex.Name}.{field.Name} has no resolved type");
            field.Resolver = new FuncFieldResolver<object?>(_ => ResolveValue(resolvedType, unionMembers, interfaceImplementors));
        }
    }

    Dictionary<string, object?>? variables = null;
    if (payload.Variables is { ValueKind: JsonValueKind.Object })
    {
        variables = payload.Variables.Value.EnumerateObject()
            .ToDictionary(prop => prop.Name, prop => ConvertJsonElement(prop.Value), StringComparer.Ordinal);
    }

    var result = await new DocumentExecuter().ExecuteAsync(options =>
    {
        options.Schema = schema;
        options.Query = queryText;
        if (!string.IsNullOrEmpty(payload.OperationName)) options.OperationName = payload.OperationName;
        if (variables != null) options.Variables = variables.ToInputs();
    });

    return new GraphQLSerializer().Serialize(result);
}

static Dictionary<string, List<string>> CollectUnionMembers(GraphQLDocument document)
{
    var result = new Dictionary<string, List<string>>(StringComparer.Ordinal);
    foreach (var def in document.Definitions.OfType<GraphQLUnionTypeDefinition>())
        AddNamedTypes(result, def.Name.StringValue, def.Types?.Items);
    foreach (var ext in document.Definitions.OfType<GraphQLUnionTypeExtension>())
        AddNamedTypes(result, ext.Name.StringValue, ext.Types?.Items);
    foreach (var members in result.Values) members.Sort(StringComparer.Ordinal);
    return result;
}

static Dictionary<string, List<string>> CollectInterfaceImplementors(GraphQLDocument document)
{
    var result = new Dictionary<string, List<string>>(StringComparer.Ordinal);
    foreach (var def in document.Definitions.OfType<GraphQLObjectTypeDefinition>())
        AddImplementedInterfaces(result, def.Name.StringValue, def.Interfaces?.Items);
    foreach (var ext in document.Definitions.OfType<GraphQLObjectTypeExtension>())
        AddImplementedInterfaces(result, ext.Name.StringValue, ext.Interfaces?.Items);
    foreach (var implementors in result.Values) implementors.Sort(StringComparer.Ordinal);
    return result;
}

static void AddNamedTypes(Dictionary<string, List<string>> result, string ownerName, IReadOnlyList<GraphQLNamedType>? namedTypes)
{
    if (namedTypes == null || namedTypes.Count == 0) return;
    if (!result.TryGetValue(ownerName, out var values)) { values = []; result[ownerName] = values; }
    foreach (var namedType in namedTypes) values.Add(namedType.Name.StringValue);
}

static void AddImplementedInterfaces(Dictionary<string, List<string>> result, string objectTypeName, IReadOnlyList<GraphQLNamedType>? interfaces)
{
    if (interfaces == null || interfaces.Count == 0) return;
    foreach (var iface in interfaces)
    {
        var interfaceName = iface.Name.StringValue;
        if (!result.TryGetValue(interfaceName, out var values)) { values = []; result[interfaceName] = values; }
        values.Add(objectTypeName);
    }
}

static object? ConvertJsonElement(JsonElement element)
{
    return element.ValueKind switch
    {
        JsonValueKind.String => element.GetString(),
        JsonValueKind.Number => element.TryGetInt32(out var i) ? (object)i : element.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Null => null,
        JsonValueKind.Array => element.EnumerateArray().Select(ConvertJsonElement).ToList(),
        JsonValueKind.Object => element.EnumerateObject()
            .ToDictionary(prop => prop.Name, prop => ConvertJsonElement(prop.Value), StringComparer.Ordinal),
        _ => element.ToString(),
    };
}

static object? ResolveValue(IGraphType type, IReadOnlyDictionary<string, List<string>> unionMembers, IReadOnlyDictionary<string, List<string>> interfaceImplementors)
{
    while (type is NonNullGraphType nonNull)
        type = nonNull.ResolvedType ?? throw new InvalidOperationException("Non-null type was not resolved");

    if (type is ListGraphType list)
    {
        var inner = list.ResolvedType ?? throw new InvalidOperationException("List type was not resolved");
        return new object?[] { ResolveValue(inner, unionMembers, interfaceImplementors), ResolveValue(inner, unionMembers, interfaceImplementors) };
    }

    return type switch
    {
        IntGraphType => 2,
        FloatGraphType => 3.14,
        StringGraphType => "str",
        BooleanGraphType => true,
        IdGraphType => "id",
        EnumerationGraphType enumType => enumType.Values.First().Name,
        UnionGraphType unionType => new RuntimeTypeMarker(unionMembers[unionType.Name][0]),
        InterfaceGraphType interfaceType => new RuntimeTypeMarker(interfaceImplementors[interfaceType.Name][^1]),
        IObjectGraphType => new object(),
        ScalarGraphType => "str",
        _ => null,
    };
}

static JsonSerializerOptions GetJsonOpts() => new(JsonSerializerDefaults.Web);

internal sealed record ExecuteRequest
{
    public string? Schema { get; init; }
    public string? Query { get; init; }
    public JsonElement? Variables { get; init; }
    public string? OperationName { get; init; }
}

internal sealed record RuntimeTypeMarker(string TypeName);
