<?php declare(strict_types=1);

require __DIR__ . '/vendor/autoload.php';

use GraphQL\GraphQL;
use GraphQL\Language\AST\DocumentNode;
use GraphQL\Language\AST\InterfaceTypeDefinitionNode;
use GraphQL\Language\AST\ObjectTypeDefinitionNode;
use GraphQL\Language\AST\ObjectTypeExtensionNode;
use GraphQL\Language\AST\UnionTypeDefinitionNode;
use GraphQL\Language\AST\UnionTypeExtensionNode;
use GraphQL\Language\Parser;
use GraphQL\Type\Definition\EnumType;
use GraphQL\Type\Definition\InterfaceType;
use GraphQL\Type\Definition\ListOfType;
use GraphQL\Type\Definition\NonNull;
use GraphQL\Type\Definition\ObjectType;
use GraphQL\Type\Definition\ScalarType;
use GraphQL\Type\Definition\Type;
use GraphQL\Type\Definition\UnionType;
use GraphQL\Type\Schema;
use GraphQL\Utils\BuildSchema;

function collectUnionMembers(DocumentNode $document): array
{
    $result = [];
    foreach ($document->definitions as $definition) {
        if ($definition instanceof UnionTypeDefinitionNode || $definition instanceof UnionTypeExtensionNode) {
            $name = $definition->name->value;
            $result[$name] ??= [];
            foreach ($definition->types as $typeNode) {
                $result[$name][] = $typeNode->name->value;
            }
        }
    }
    foreach ($result as &$members) {
        sort($members, SORT_STRING);
    }
    return $result;
}

function collectInterfaceImplementors(DocumentNode $document): array
{
    $result = [];
    foreach ($document->definitions as $definition) {
        if ($definition instanceof ObjectTypeDefinitionNode || $definition instanceof ObjectTypeExtensionNode) {
            $objectTypeName = $definition->name->value;
            foreach ($definition->interfaces as $interfaceNode) {
                $interfaceName = $interfaceNode->name->value;
                $result[$interfaceName] ??= [];
                $result[$interfaceName][] = $objectTypeName;
            }
        }
    }
    foreach ($result as &$implementors) {
        sort($implementors, SORT_STRING);
    }
    return $result;
}

function resolveValue(Type $type, Schema $schema, array $unionMembers, array $interfaceImplementors)
{
    if ($type instanceof NonNull) {
        return resolveValue($type->getWrappedType(), $schema, $unionMembers, $interfaceImplementors);
    }
    if ($type instanceof ListOfType) {
        $inner = $type->getWrappedType();
        return [
            resolveValue($inner, $schema, $unionMembers, $interfaceImplementors),
            resolveValue($inner, $schema, $unionMembers, $interfaceImplementors),
        ];
    }

    $namedType = Type::getNamedType($type);
    if ($namedType instanceof ScalarType) {
        return match ($namedType->name) {
            Type::INT => 2,
            Type::FLOAT => 3.14,
            Type::STRING => 'str',
            Type::BOOLEAN => true,
            Type::ID => 'id',
            default => 'str',
        };
    }
    if ($namedType instanceof EnumType) {
        return $namedType->getValues()[0]->name;
    }
    if ($namedType instanceof UnionType) {
        return ['__conformerTypeName' => $unionMembers[$namedType->name][0]];
    }
    if ($namedType instanceof InterfaceType) {
        $implementors = $interfaceImplementors[$namedType->name];
        return ['__conformerTypeName' => $implementors[count($implementors) - 1]];
    }
    if ($namedType instanceof ObjectType) {
        return [];
    }
    return null;
}

function buildHarnessSchema(string $schemaText): Schema
{
    $document = Parser::parse($schemaText);
    $unionMembers = collectUnionMembers($document);
    $interfaceImplementors = collectInterfaceImplementors($document);

    $schema = null;
    $schema = BuildSchema::buildAST(
        $document,
        static function (array $config, object $typeNode) use ($unionMembers, $interfaceImplementors): array {
            if ($typeNode instanceof UnionTypeDefinitionNode || $typeNode instanceof UnionTypeExtensionNode) {
                $config['resolveType'] = static function ($value) {
                    return is_array($value) ? ($value['__conformerTypeName'] ?? null) : null;
                };
            }
            if ($typeNode instanceof InterfaceTypeDefinitionNode) {
                $config['resolveType'] = static function ($value) {
                    return is_array($value) ? ($value['__conformerTypeName'] ?? null) : null;
                };
            }
            return $config;
        },
        [],
        static function (array $config) use (&$schema, $unionMembers, $interfaceImplementors): array {
            $config['resolve'] = static function ($source, array $args, $context, $info) use ($config, &$schema, $unionMembers, $interfaceImplementors) {
                return resolveValue($config['type'], $schema, $unionMembers, $interfaceImplementors);
            };
            return $config;
        }
    );
    return $schema;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);

if ($method === 'GET' && $path === '/health') {
    header('Content-Type: text/plain');
    echo 'ok';
    return true;
}

if ($method === 'POST' && $path === '/execute') {
    $raw = file_get_contents('php://input');
    try {
        $body = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    } catch (\JsonException $e) {
        http_response_code(400);
        header('Content-Type: application/json');
        echo json_encode(['errors' => [['message' => 'invalid JSON body: ' . $e->getMessage()]]]);
        return true;
    }

    $schemaText = $body['schema'] ?? null;
    $queryText = $body['query'] ?? null;
    $variables = $body['variables'] ?? null;
    $operationName = $body['operationName'] ?? null;

    if (!is_string($schemaText) || !is_string($queryText)) {
        http_response_code(400);
        header('Content-Type: application/json');
        echo json_encode(['errors' => [['message' => 'schema and query are required strings']]]);
        return true;
    }

    try {
        $schema = buildHarnessSchema($schemaText);
        $result = GraphQL::executeQuery($schema, $queryText, null, null, $variables, $operationName);
        header('Content-Type: application/json');
        echo json_encode($result->toArray(), JSON_THROW_ON_ERROR);
    } catch (\Throwable $e) {
        http_response_code(500);
        header('Content-Type: application/json');
        echo json_encode(['errors' => [['message' => $e->getMessage()]]]);
    }
    return true;
}

http_response_code(404);
header('Content-Type: text/plain');
echo 'not found';
return true;
