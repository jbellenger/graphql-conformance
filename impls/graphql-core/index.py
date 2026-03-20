#!/usr/bin/env python3

from __future__ import annotations

import inspect
import json
import sys
from pathlib import Path
from typing import Any

IMPL_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(IMPL_DIR / "build" / "src"))

from graphql import (  # noqa: E402
    GraphQLBoolean,
    GraphQLEnumType,
    GraphQLFloat,
    GraphQLID,
    GraphQLInt,
    GraphQLInterfaceType,
    GraphQLList,
    GraphQLNonNull,
    GraphQLObjectType,
    GraphQLScalarType,
    GraphQLString,
    GraphQLUnionType,
    build_schema,
    parse,
)
from graphql.execution import (  # noqa: E402
    ExecutionResult,
    ExperimentalIncrementalExecutionResults,
    experimental_execute_incrementally,
)


def resolve_value(type_: Any, schema: Any) -> Any:
    if isinstance(type_, GraphQLNonNull):
        return resolve_value(type_.of_type, schema)
    if isinstance(type_, GraphQLList):
        return [
            resolve_value(type_.of_type, schema),
            resolve_value(type_.of_type, schema),
        ]
    if type_ is GraphQLInt:
        return 2
    if type_ is GraphQLFloat:
        return 3.14
    if type_ is GraphQLString:
        return "str"
    if type_ is GraphQLBoolean:
        return True
    if type_ is GraphQLID:
        return "id"
    if isinstance(type_, GraphQLEnumType):
        return next(iter(type_.values.values())).value
    if isinstance(type_, GraphQLObjectType):
        return {}
    if isinstance(type_, GraphQLUnionType):
        members = sorted(type_.types, key=lambda member: member.name)
        return {"__typename": members[0].name}
    if isinstance(type_, GraphQLInterfaceType):
        implementors = sorted(
            schema.get_implementations(type_).objects,
            key=lambda member: member.name,
        )
        return {"__typename": implementors[-1].name}
    if isinstance(type_, GraphQLScalarType):
        return "str"
    return None


def field_resolver(_source: Any, info: Any, **_args: Any) -> Any:
    return resolve_value(info.return_type, info.schema)


def merge_patch(target: Any, path: list[str | int], value: Any) -> None:
    if not path:
        target.update(value)
        return

    current = target
    for segment in path[:-1]:
        current = current[segment]

    last = path[-1]
    if isinstance(current[last], dict) and isinstance(value, dict):
        current[last].update(value)
    else:
        current[last] = value


def append_items(target: Any, path: list[str | int], items: list[Any]) -> None:
    current = target
    for segment in path:
        current = current[segment]
    current.extend(items)


async def normalize_result(result: Any) -> ExecutionResult:
    if inspect.isawaitable(result):
        result = await result

    if isinstance(result, ExecutionResult):
        return result

    incremental_result = result
    if not isinstance(incremental_result, ExperimentalIncrementalExecutionResults):
        raise TypeError(f"Unsupported result type: {type(result)!r}")

    initial = incremental_result.initial_result
    pending_paths = {pending.id: list(pending.path) for pending in initial.pending}
    data = initial.data
    errors = list(initial.errors or [])
    extensions = dict(initial.extensions or {})

    async for chunk in incremental_result.subsequent_results:
        if chunk.extensions:
            extensions.update(chunk.extensions)
        for pending in chunk.pending or []:
            pending_paths[pending.id] = list(pending.path)
        for entry in chunk.incremental or []:
            if entry.errors:
                errors.extend(entry.errors)
            path = pending_paths.get(entry.id, []) + list(getattr(entry, "sub_path", None) or [])
            if hasattr(entry, "data"):
                merge_patch(data, path, entry.data)
            else:
                append_items(data, path, entry.items)
        for completed in chunk.completed or []:
            pending_paths.pop(completed.id, None)

    return ExecutionResult(
        data=data,
        errors=errors or None,
        extensions=extensions or None,
    )


def main() -> int:
    if len(sys.argv) < 3:
        sys.stderr.write("Usage: python3 index.py <schema> <query> [<variables>]\n")
        return 1

    schema_path = Path(sys.argv[1])
    query_path = Path(sys.argv[2])

    schema = build_schema(schema_path.read_text(encoding="utf-8"))
    document = parse(query_path.read_text(encoding="utf-8"))

    variables = None
    if len(sys.argv) >= 4:
        variables_path = Path(sys.argv[3])
        variables = json.loads(variables_path.read_text(encoding="utf-8"))

    result = experimental_execute_incrementally(
        schema,
        document,
        variable_values=variables,
        field_resolver=field_resolver,
    )
    if not isinstance(result, ExecutionResult):
        import asyncio

        result = asyncio.run(normalize_result(result))

    json.dump(result.formatted, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
