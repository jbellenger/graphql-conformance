use std::collections::HashMap;
use std::env;
use std::fs;

use async_graphql::dynamic::*;
use async_graphql::parser::parse_schema;
use async_graphql::parser::types::{
    BaseType, SchemaDefinition, TypeDefinition, TypeKind, TypeSystemDefinition,
};
use async_graphql::{Name, Value};

fn ast_type_to_typeref(ty: &async_graphql::parser::types::Type) -> TypeRef {
    let inner = match &ty.base {
        BaseType::Named(name) => TypeRef::Named(name.to_string().into()),
        BaseType::List(inner) => TypeRef::List(Box::new(ast_type_to_typeref(inner))),
    };
    if ty.nullable {
        inner
    } else {
        TypeRef::NonNull(Box::new(inner))
    }
}

// resolve_value_composite is used instead — see below

// build_schema_v2 is the main schema builder — see below

fn build_schema_v2(
    sdl: &str,
    enum_first: HashMap<String, String>,
    union_members: HashMap<String, Vec<String>>,
    iface_impls: HashMap<String, Vec<String>>,
) -> Schema {
    let doc = parse_schema(sdl).expect("Failed to parse schema");

    let mut schema_def: Option<SchemaDefinition> = None;
    let mut type_defs: Vec<TypeDefinition> = Vec::new();

    for def in &doc.definitions {
        match def {
            TypeSystemDefinition::Schema(s) => schema_def = Some(s.node.clone()),
            TypeSystemDefinition::Type(t) => type_defs.push(t.node.clone()),
            TypeSystemDefinition::Directive(_) => {}
        }
    }

    // Collect type names by kind
    let mut composite_types: HashMap<String, String> = HashMap::new(); // name → "object"|"union"|"interface"
    for td in &type_defs {
        let name = td.name.node.to_string();
        match &td.kind {
            TypeKind::Object(_) => { composite_types.insert(name, "object".to_string()); }
            TypeKind::Union(_) => { composite_types.insert(name, "union".to_string()); }
            TypeKind::Interface(_) => { composite_types.insert(name, "interface".to_string()); }
            _ => {}
        }
    }

    let query_name = schema_def
        .as_ref()
        .and_then(|s| s.query.as_ref().map(|n| n.node.to_string()))
        .unwrap_or_else(|| "Query".to_string());
    let mutation_name = schema_def
        .as_ref()
        .and_then(|s| s.mutation.as_ref().map(|n| n.node.to_string()));

    let mut builder = Schema::build(&query_name, mutation_name.as_deref(), None)
        .validation_mode(async_graphql::ValidationMode::Fast);

    for td in &type_defs {
        let name = td.name.node.to_string();
        match &td.kind {
            TypeKind::Scalar => {
                builder = builder.register(Scalar::new(&name));
            }
            TypeKind::Enum(e) => {
                let mut en = Enum::new(&name);
                for v in &e.values {
                    en = en.item(EnumItem::new(v.node.value.node.to_string()));
                }
                builder = builder.register(en);
            }
            TypeKind::Object(obj) => {
                let mut o = Object::new(&name);
                for iface in &obj.implements {
                    o = o.implement(iface.node.to_string());
                }
                for field in &obj.fields {
                    let field_name = field.node.name.node.to_string();
                    let type_ref = ast_type_to_typeref(&field.node.ty.node);
                    let ef = enum_first.clone();
                    let um = union_members.clone();
                    let ii = iface_impls.clone();
                    let ct = composite_types.clone();
                    let mut f = Field::new(&field_name, type_ref.clone(), move |_ctx| {
                        let val = resolve_value_composite(&type_ref, &ef, &um, &ii, &ct);
                        FieldFuture::Value(val)
                    });
                    for arg in &field.node.arguments {
                        let arg_name = arg.node.name.node.to_string();
                        let arg_type = ast_type_to_typeref(&arg.node.ty.node);
                        f = f.argument(InputValue::new(arg_name, arg_type));
                    }
                    o = o.field(f);
                }
                builder = builder.register(o);
            }
            TypeKind::Interface(iface_def) => {
                let mut iface = Interface::new(&name);
                for parent_iface in &iface_def.implements {
                    iface = iface.implement(parent_iface.node.to_string());
                }
                for field in &iface_def.fields {
                    let field_name = field.node.name.node.to_string();
                    let type_ref = ast_type_to_typeref(&field.node.ty.node);
                    let mut f = InterfaceField::new(&field_name, type_ref);
                    for arg in &field.node.arguments {
                        let arg_name = arg.node.name.node.to_string();
                        let arg_type = ast_type_to_typeref(&arg.node.ty.node);
                        f = f.argument(InputValue::new(arg_name, arg_type));
                    }
                    iface = iface.field(f);
                }
                builder = builder.register(iface);
            }
            TypeKind::Union(u) => {
                let mut union = Union::new(&name);
                for member in &u.members {
                    union = union.possible_type(member.node.to_string());
                }
                builder = builder.register(union);
            }
            TypeKind::InputObject(io) => {
                let mut input = InputObject::new(&name);
                for field in &io.fields {
                    let field_name = field.node.name.node.to_string();
                    let type_ref = ast_type_to_typeref(&field.node.ty.node);
                    input = input.field(InputValue::new(field_name, type_ref));
                }
                builder = builder.register(input);
            }
        }
    }

    builder.finish().expect("Failed to build schema")
}

fn resolve_value_composite(
    ty: &TypeRef,
    enum_first: &HashMap<String, String>,
    union_members: &HashMap<String, Vec<String>>,
    iface_impls: &HashMap<String, Vec<String>>,
    composite_types: &HashMap<String, String>,
) -> Option<FieldValue<'static>> {
    match ty {
        TypeRef::NonNull(inner) => {
            resolve_value_composite(inner, enum_first, union_members, iface_impls, composite_types)
        }
        TypeRef::List(inner) => {
            let a = resolve_value_composite(inner, enum_first, union_members, iface_impls, composite_types)
                .unwrap_or(FieldValue::NULL);
            let b = resolve_value_composite(inner, enum_first, union_members, iface_impls, composite_types)
                .unwrap_or(FieldValue::NULL);
            Some(FieldValue::list(vec![a, b]))
        }
        TypeRef::Named(name) => {
            let name_str = name.as_ref();
            match name_str {
                "Int" => Some(FieldValue::value(Value::from(2))),
                "Float" => Some(FieldValue::value(Value::from(3.14))),
                "String" => Some(FieldValue::value(Value::from("str"))),
                "Boolean" => Some(FieldValue::value(Value::from(true))),
                "ID" => Some(FieldValue::value(Value::from("id"))),
                _ => {
                    if let Some(first) = enum_first.get(name_str) {
                        Some(FieldValue::value(Value::Enum(Name::new(first))))
                    } else if let Some(kind) = composite_types.get(name_str) {
                        match kind.as_str() {
                            "object" => {
                                Some(FieldValue::owned_any(()).with_type(name_str.to_string()))
                            }
                            "union" => {
                                // Alphabetically first member
                                if let Some(members) = union_members.get(name_str) {
                                    let target = members.first().unwrap();
                                    Some(FieldValue::owned_any(()).with_type(target.clone()))
                                } else {
                                    Some(FieldValue::owned_any(()).with_type(name_str.to_string()))
                                }
                            }
                            "interface" => {
                                // Alphabetically last implementor
                                if let Some(impls) = iface_impls.get(name_str) {
                                    let target = impls.last().unwrap();
                                    Some(FieldValue::owned_any(()).with_type(target.clone()))
                                } else {
                                    Some(FieldValue::owned_any(()).with_type(name_str.to_string()))
                                }
                            }
                            _ => Some(FieldValue::value(Value::from("str"))),
                        }
                    } else {
                        // Custom scalar
                        Some(FieldValue::value(Value::from("str")))
                    }
                }
            }
        }
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        eprintln!("Usage: conformer <schema> <query> [<variables>]");
        std::process::exit(1);
    }

    let schema_text = fs::read_to_string(&args[1]).expect("Failed to read schema");
    let query_text = fs::read_to_string(&args[2]).expect("Failed to read query");
    let variables: Option<serde_json::Value> = if args.len() >= 4 {
        let var_text = fs::read_to_string(&args[3]).expect("Failed to read variables");
        Some(serde_json::from_str(&var_text).expect("Failed to parse variables"))
    } else {
        None
    };

    // Pre-scan SDL to collect enum first values, union members, and interface implementors
    let doc = parse_schema(&schema_text).expect("Failed to parse schema");
    let mut enum_first: HashMap<String, String> = HashMap::new();
    let mut union_members: HashMap<String, Vec<String>> = HashMap::new();
    let mut iface_impls: HashMap<String, Vec<String>> = HashMap::new();

    for def in &doc.definitions {
        if let TypeSystemDefinition::Type(t) = def {
            let name = t.node.name.node.to_string();
            match &t.node.kind {
                TypeKind::Enum(e) => {
                    if let Some(first) = e.values.first() {
                        enum_first.insert(name, first.node.value.node.to_string());
                    }
                }
                TypeKind::Union(u) => {
                    let mut members: Vec<String> =
                        u.members.iter().map(|m| m.node.to_string()).collect();
                    members.sort();
                    union_members.insert(name, members);
                }
                TypeKind::Object(obj) => {
                    for iface in &obj.implements {
                        let iface_name = iface.node.to_string();
                        iface_impls
                            .entry(iface_name)
                            .or_default()
                            .push(name.clone());
                    }
                }
                _ => {}
            }
        }
    }

    // Sort interface implementors
    for impls in iface_impls.values_mut() {
        impls.sort();
    }

    let schema = build_schema_v2(&schema_text, enum_first, union_members, iface_impls);

    // Build request
    let mut request = async_graphql::Request::new(&query_text);
    if let Some(vars) = variables {
        if let serde_json::Value::Object(map) = vars {
            let mut ag_vars = async_graphql::Variables::default();
            for (k, v) in map {
                ag_vars.insert(Name::new(&k), serde_json_to_value(v));
            }
            request = request.variables(ag_vars);
        }
    }

    let response = schema.execute(request).await;

    // Build output
    let mut output = serde_json::Map::new();
    output.insert("data".to_string(), value_to_json(&response.data));
    if !response.errors.is_empty() {
        let errors: Vec<serde_json::Value> = response
            .errors
            .iter()
            .map(|e| {
                serde_json::json!({ "message": e.message })
            })
            .collect();
        output.insert("errors".to_string(), serde_json::Value::Array(errors));
    }

    print!("{}", serde_json::to_string(&output).unwrap());
}

fn serde_json_to_value(v: serde_json::Value) -> Value {
    match v {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(b) => Value::Boolean(b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Number(i.into())
            } else if let Some(f) = n.as_f64() {
                Value::Number(
                    async_graphql::Number::from_f64(f).unwrap_or_else(|| 0.into()),
                )
            } else {
                Value::Null
            }
        }
        serde_json::Value::String(s) => Value::String(s),
        serde_json::Value::Array(a) => {
            Value::List(a.into_iter().map(serde_json_to_value).collect())
        }
        serde_json::Value::Object(o) => Value::Object(
            o.into_iter()
                .map(|(k, v)| (Name::new(&k), serde_json_to_value(v)))
                .collect(),
        ),
    }
}

fn value_to_json(v: &Value) -> serde_json::Value {
    match v {
        Value::Null => serde_json::Value::Null,
        Value::Boolean(b) => serde_json::Value::Bool(*b),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                serde_json::Value::Number(i.into())
            } else if let Some(f) = n.as_f64() {
                serde_json::json!(f)
            } else {
                serde_json::Value::Null
            }
        }
        Value::String(s) => serde_json::Value::String(s.clone()),
        Value::Enum(e) => serde_json::Value::String(e.to_string()),
        Value::List(l) => serde_json::Value::Array(l.iter().map(value_to_json).collect()),
        Value::Object(o) => {
            let mut map = serde_json::Map::new();
            for (k, v) in o {
                map.insert(k.to_string(), value_to_json(v));
            }
            serde_json::Value::Object(map)
        }
        Value::Binary(_) => serde_json::Value::Null,
    }
}
