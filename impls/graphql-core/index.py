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

STREAM_PROTOCOL = "conformer-stream-v1"


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


def format_errors(errors: Any) -> list[dict[str, Any]] | None:
    if not errors:
        return None
    return [error.formatted for error in errors]


def write_protocol_event(kind: str, **payload: Any) -> None:
    event = {"protocol": STREAM_PROTOCOL, "kind": kind, **payload}
    sys.stdout.write(json.dumps(event) + "\n")


async def emit_incremental_result(result: Any) -> None:
    if inspect.isawaitable(result):
        result = await result

    if isinstance(result, ExecutionResult):
        json.dump(result.formatted, sys.stdout)
        return

    if not isinstance(result, ExperimentalIncrementalExecutionResults):
        raise TypeError(f"Unsupported result type: {type(result)!r}")

    initial = result.initial_result
    pending_paths = {pending.id: list(pending.path) for pending in initial.pending}

    write_protocol_event(
        "initial",
        data=initial.data,
        errors=format_errors(initial.errors),
        extensions=initial.extensions,
    )

    wrote_complete = False
    async for chunk in result.subsequent_results:
        chunk_extensions = getattr(chunk, "extensions", None)
        chunk_errors = getattr(chunk, "errors", None)
        if chunk_extensions or chunk_errors:
            write_protocol_event(
                "patch",
                errors=format_errors(chunk_errors),
                extensions=chunk_extensions,
            )

        for pending in chunk.pending or []:
            pending_paths[pending.id] = list(pending.path)

        for entry in chunk.incremental or []:
            path = pending_paths.get(entry.id, []) + list(getattr(entry, "sub_path", None) or [])
            payload: dict[str, Any] = {
                "path": path,
                "errors": format_errors(entry.errors),
            }
            if hasattr(entry, "data"):
                payload["data"] = entry.data
            else:
                payload["items"] = entry.items
            write_protocol_event("patch", **payload)

        for completed in chunk.completed or []:
            pending_paths.pop(completed.id, None)

        if getattr(chunk, "has_next", None) is False:
            write_protocol_event("complete")
            wrote_complete = True

    if not wrote_complete:
        write_protocol_event("complete")


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

        asyncio.run(emit_incremental_result(result))
    else:
        json.dump(result.formatted, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
