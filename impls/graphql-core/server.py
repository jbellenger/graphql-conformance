#!/usr/bin/env python3
"""HTTP driver for graphql-core conformance testing."""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from graphql import (
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
    execute_sync,
    parse,
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


def format_errors(errors: Any) -> list[dict[str, Any]] | None:
    if not errors:
        return None
    return [error.formatted for error in errors]


def run_query(body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    schema_text = body.get("schema")
    query_text = body.get("query")
    if not isinstance(schema_text, str) or not isinstance(query_text, str):
        return 400, {"errors": [{"message": "schema and query are required strings"}]}

    try:
        schema = build_schema(schema_text)
        document = parse(query_text)
    except Exception as e:  # noqa: BLE001
        return 500, {"errors": [{"message": str(e)}]}

    result = execute_sync(
        schema,
        document,
        variable_values=body.get("variables"),
        operation_name=body.get("operationName"),
        field_resolver=field_resolver,
    )

    payload: dict[str, Any] = {"data": result.data}
    formatted = format_errors(result.errors)
    if formatted:
        payload["errors"] = formatted
    return 200, payload


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args: Any) -> None:
        pass

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"ok")
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/execute":
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length > 0 else b""
        try:
            body = json.loads(raw.decode("utf-8")) if raw else {}
        except json.JSONDecodeError as e:
            self._respond(400, {"errors": [{"message": f"invalid JSON body: {e}"}]})
            return

        try:
            status, payload = run_query(body)
        except Exception as e:  # noqa: BLE001
            status, payload = 500, {"errors": [{"message": str(e)}]}
        self._respond(status, payload)

    def _respond(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    sys.stderr.write(f"graphql-core driver listening on :{port}\n")
    sys.stderr.flush()
    server.serve_forever()


if __name__ == "__main__":
    main()
