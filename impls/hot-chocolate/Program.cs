using System.IO.Pipelines;
using System.Text;
using System.Text.Json;
using HotChocolate;
using HotChocolate.Execution;
using HotChocolate.Language;
using HotChocolate.Resolvers;
using HotChocolate.Transport.Formatters;
using HotChocolate.Types;
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

app.MapPost("/execute", async (HttpContext ctx) =>
{
    ExecuteRequest? payload;
    try
    {
        payload = await JsonSerializer.DeserializeAsync<ExecuteRequest>(ctx.Request.Body, GetJsonOpts());
    }
    catch (Exception e)
    {
        await WriteErrorAsync(ctx.Response, 400, e.Message);
        return;
    }

    if (payload?.Schema is null || payload.Query is null)
    {
        await WriteErrorAsync(ctx.Response, 400, "schema and query are required strings");
        return;
    }

    try
    {
        var result = await ExecuteAsync(payload);
        if (result is IResponseStream stream)
        {
            await WriteMultipartAsync(ctx.Response, stream);
        }
        else if (result is OperationResult single)
        {
            await WriteJsonAsync(ctx.Response, 200, await BuildSingleOutputAsync(single));
        }
        else
        {
            await WriteJsonAsync(ctx.Response, 200, new Dictionary<string, object?> { ["data"] = null });
        }
    }
    catch (Exception e)
    {
        await WriteErrorAsync(ctx.Response, 500, e.Message);
    }
});

app.Run();
return 0;

static async Task WriteErrorAsync(HttpResponse response, int status, string message)
{
    await WriteJsonAsync(response, status, new { errors = new[] { new { message } } });
}

static async Task WriteJsonAsync(HttpResponse response, int status, object body)
{
    response.StatusCode = status;
    response.ContentType = "application/json";
    await JsonSerializer.SerializeAsync(response.Body, body);
}

// Emits a GraphQL multipart/mixed incremental-delivery response. Each chunk from HC's
// IResponseStream is serialized with its native incremental-delivery shape (hasNext,
// pending, incremental, completed) and written as a separate part. The conformer's
// applyIncrementalMerge reassembles these back to a single {data, errors?} object.
static async Task WriteMultipartAsync(HttpResponse response, IResponseStream stream)
{
    var boundary = Guid.NewGuid().ToString("N");
    response.StatusCode = 200;
    response.ContentType = $"multipart/mixed; boundary={boundary}";

    var formatter = new JsonResultFormatter(
        new JsonResultFormatterOptions { Indented = false });
    var headerBytes = Encoding.UTF8.GetBytes($"\r\n--{boundary}\r\nContent-Type: application/json\r\n\r\n");
    var trailerBytes = Encoding.UTF8.GetBytes($"\r\n--{boundary}--\r\n");

    await foreach (var chunk in stream.ReadResultsAsync())
    {
        await using var _ = chunk;
        await response.Body.WriteAsync(headerBytes);
        await formatter.FormatAsync(chunk, response.BodyWriter);
        await response.Body.FlushAsync();
    }

    await response.Body.WriteAsync(trailerBytes);
    await response.Body.FlushAsync();
}

static async Task<IExecutionResult> ExecuteAsync(ExecuteRequest payload)
{
    var rawSchemaText = payload.Schema!;
    var queryText = payload.Query!;

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
    if (payload.Variables is { ValueKind: JsonValueKind.Object })
    {
        variables = payload.Variables.Value.EnumerateObject()
            .ToDictionary(prop => prop.Name, prop => ConvertJsonElement(prop.Value), StringComparer.Ordinal);
    }

    var gqlBuilder = new ServiceCollection()
        .AddGraphQL()
        .AddDocumentFromString(schemaText);

    var hasCustomRoots = queryTypeName != null || mutationTypeName != null || subscriptionTypeName != null;
    if (enableDefer || enableStream || hasCustomRoots)
    {
        gqlBuilder.ModifyOptions(o =>
        {
            if (enableDefer) o.EnableDefer = true;
            if (enableStream) o.EnableStream = true;
            if (queryTypeName != null) o.QueryTypeName = queryTypeName;
            if (mutationTypeName != null) o.MutationTypeName = mutationTypeName;
            if (subscriptionTypeName != null) o.SubscriptionTypeName = subscriptionTypeName;
        });
    }

    var executor = await gqlBuilder
        .UseField(next => context =>
        {
            if (context.Selection.Field.Name.StartsWith("__"))
            {
                return next(context);
            }
            context.Result = ResolveValue(context.Selection.Type);
            return default;
        })
        .ConfigureSchema(sb => sb.SetTypeResolver((objectType, context, result) =>
        {
            var parentType = context.Selection.Type.NamedType();

            if (parentType is UnionType union)
            {
                var names = new List<string>();
                foreach (var type in union.Types) names.Add(type.Name.ToString());
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
    if (!string.IsNullOrEmpty(payload.OperationName))
    {
        requestBuilder.SetOperationName(payload.OperationName);
    }
    if (variables != null)
    {
        requestBuilder.SetVariableValues(
            variables.ToDictionary(kv => kv.Key, kv => kv.Value));
    }

    return await executor.ExecuteAsync(requestBuilder.Build());
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

static async Task<Dictionary<string, object?>> BuildSingleOutputAsync(OperationResult result)
{
    await using var stream = new MemoryStream();
    var writer = PipeWriter.Create(stream);
    await JsonResultFormatter.Default.FormatAsync(result, writer);
    await writer.FlushAsync();

    stream.Position = 0;
    using var doc = await JsonDocument.ParseAsync(stream);
    var output = ConvertJsonElement(doc.RootElement) as Dictionary<string, object?>
        ?? new Dictionary<string, object?> { ["data"] = null };

    if (output.TryGetValue("errors", out var value) && value is List<object?> errors)
    {
        output["errors"] = errors
            .OfType<Dictionary<string, object?>>()
            .Select(error => new { message = error.GetValueOrDefault("message")?.ToString() ?? "" })
            .ToList();
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

static JsonSerializerOptions GetJsonOpts() => new(JsonSerializerDefaults.Web);

internal sealed record ExecuteRequest
{
    public string? Schema { get; init; }
    public string? Query { get; init; }
    public JsonElement? Variables { get; init; }
    public string? OperationName { get; init; }
}
