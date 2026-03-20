<?php declare(strict_types=1);

spl_autoload_register(static function (string $class): void {
    $prefix = 'GraphQL\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }

    $relative = substr($class, strlen($prefix));
    $path = __DIR__ . '/build/src/' . str_replace('\\', '/', $relative) . '.php';
    if (is_file($path)) {
        require $path;
    }
});

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

if ($argc < 3) {
    fwrite(STDERR, "Usage: php index.php <schema> <query> [<variables>]\n");
    exit(1);
}

$schemaText = file_get_contents($argv[1]);
$queryText = file_get_contents($argv[2]);
if ($schemaText === false || $queryText === false) {
    fwrite(STDERR, "Failed to read schema or query file\n");
    exit(1);
}

$variables = null;
if ($argc >= 4) {
    $variablesText = file_get_contents($argv[3]);
    if ($variablesText === false) {
        fwrite(STDERR, "Failed to read variables file\n");
        exit(1);
    }

    $variables = json_decode($variablesText, true, 512, JSON_THROW_ON_ERROR);
}

$document = Parser::parse($schemaText);
$unionMembers = collectUnionMembers($document);
$interfaceImplementors = collectInterfaceImplementors($document);

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

$result = GraphQL::executeQuery($schema, $queryText, null, null, $variables);
echo json_encode($result->toArray(), JSON_THROW_ON_ERROR);

/**
 * @return array<string, list<string>>
 */
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

/**
 * @return array<string, list<string>>
 */
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

/**
 * @param array<string, list<string>> $unionMembers
 * @param array<string, list<string>> $interfaceImplementors
 * @return mixed
 */
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
