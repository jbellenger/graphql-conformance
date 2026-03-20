use std::collections::HashMap;
use std::env;
use std::fs;

use graphql_parser::schema::{self as gp, Definition, TypeDefinition};
use juniper::{
    arcstr, ArcStr, Arguments, DefaultScalarValue, EmptyMutation, EmptySubscription,
    ExecutionResult, Executor, GraphQLType, GraphQLValue, Registry, RootNode, Value,
};
use juniper::meta::{Argument as MetaArgument, EnumValue, Field, MetaType};

// ---------------------------------------------------------------------------
// SchemaInfo: carries parsed schema + which type this DynamicValue represents
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct SchemaInfo {
    doc: &'static gp::Document<'static, String>,
    type_name: String,
    enum_first: HashMap<String, String>,
    union_members: HashMap<String, Vec<String>>,
    iface_impls: HashMap<String, Vec<String>>,
    query_type: String,
}

impl juniper::Context for SchemaInfo {}

impl SchemaInfo {
    fn with_type(&self, type_name: &str) -> SchemaInfo {
        let mut info = self.clone();
        info.type_name = type_name.to_string();
        info
    }

    fn find_type_def(&self, name: &str) -> Option<&'static TypeDefinition<'static, String>> {
        for def in &self.doc.definitions {
            if let Definition::TypeDefinition(td) = def {
                if type_def_name(td) == name {
                    return Some(td);
                }
            }
        }
        None
    }
}

fn type_def_name<'a>(td: &'a TypeDefinition<'a, String>) -> &'a str {
    match td {
        TypeDefinition::Scalar(s) => &s.name,
        TypeDefinition::Object(o) => &o.name,
        TypeDefinition::Interface(i) => &i.name,
        TypeDefinition::Union(u) => &u.name,
        TypeDefinition::Enum(e) => &e.name,
        TypeDefinition::InputObject(io) => &io.name,
    }
}

// ---------------------------------------------------------------------------
// DynamicValue: the single type that implements GraphQLType for all SDL types
// ---------------------------------------------------------------------------

struct DynamicValue;

impl GraphQLValue<DefaultScalarValue> for DynamicValue {
    type Context = SchemaInfo;
    type TypeInfo = SchemaInfo;

    fn type_name(&self, info: &SchemaInfo) -> Option<ArcStr> {
        Some(ArcStr::from(info.type_name.as_str()))
    }

    fn resolve_field(
        &self,
        info: &SchemaInfo,
        field_name: &str,
        _arguments: &Arguments,
        executor: &Executor<SchemaInfo>,
    ) -> ExecutionResult {
        let td = info.find_type_def(&info.type_name)
            .expect("type not found in schema");

        let fields = match td {
            TypeDefinition::Object(o) => &o.fields,
            TypeDefinition::Interface(i) => &i.fields,
            _ => panic!("resolve_field called on non-object type {}", info.type_name),
        };

        let field_def = fields.iter().find(|f| f.name == field_name)
            .unwrap_or_else(|| panic!("field {} not found on {}", field_name, info.type_name));

        resolve_value(info, &field_def.field_type, executor)
    }

    fn resolve_into_type(
        &self,
        info: &SchemaInfo,
        type_name: &str,
        _selection_set: Option<&[juniper::Selection<DefaultScalarValue>]>,
        executor: &Executor<SchemaInfo>,
    ) -> ExecutionResult {
        let concrete = resolve_concrete_type(info, &info.type_name);
        if concrete == type_name {
            let concrete_info = info.with_type(&concrete);
            executor.resolve(&concrete_info, &DynamicValue)
        } else {
            Ok(Value::null())
        }
    }

    fn concrete_type_name(&self, _context: &SchemaInfo, info: &SchemaInfo) -> String {
        resolve_concrete_type(info, &info.type_name)
    }
}

impl GraphQLType<DefaultScalarValue> for DynamicValue {
    fn name(info: &SchemaInfo) -> Option<ArcStr> {
        Some(ArcStr::from(info.type_name.as_str()))
    }

    fn meta(info: &SchemaInfo, registry: &mut Registry<DefaultScalarValue>) -> MetaType<DefaultScalarValue> {
        // Built-in scalars are handled by Juniper — don't override them.
        let builtin_scalars = ["String", "Int", "Float", "Boolean", "ID"];
        if builtin_scalars.contains(&info.type_name.as_str()) {
            // Return a dummy meta that won't actually be used — Juniper's
            // own registration takes precedence for built-in types.
            return registry.build_scalar_type::<String>(&()).into_meta();
        }

        // When registering the query root type, force-register all types from
        // the SDL so that inline fragments on interface/union members work.
        if info.type_name == info.query_type {
            for def in &info.doc.definitions {
                if let Definition::TypeDefinition(td) = def {
                    let name = type_def_name(td);
                    if name != info.query_type && !builtin_scalars.contains(&name) {
                        let type_info = info.with_type(name);
                        let _ = registry.get_type::<DynamicValue>(&type_info);
                    }
                }
            }
        }

        let Some(td) = info.find_type_def(&info.type_name) else {
            // Unknown type — treat as custom scalar
            return registry.build_scalar_type::<String>(&()).into_meta();
        };

        match td {
            TypeDefinition::Scalar(_) => {
                registry.build_scalar_type::<String>(&()).into_meta()
            }
            TypeDefinition::Enum(e) => {
                let values: Vec<EnumValue> = e.values.iter()
                    .map(|v| EnumValue::new(&v.name))
                    .collect();
                registry.build_enum_type::<DynamicEnum>(
                    &info.type_name,
                    &values,
                ).into_meta()
            }
            TypeDefinition::Object(o) => {
                let fields: Vec<Field<DefaultScalarValue>> = o.fields.iter()
                    .map(|f| build_field(info, f, registry))
                    .collect();
                let mut obj = registry.build_object_type::<DynamicValue>(info, &fields);
                for iface_name in &o.implements_interfaces {
                    let iface_info = info.with_type(iface_name);
                    obj = obj.interfaces(&[registry.get_type::<DynamicValue>(&iface_info)]);
                }
                obj.into_meta()
            }
            TypeDefinition::Interface(i) => {
                let fields: Vec<Field<DefaultScalarValue>> = i.fields.iter()
                    .map(|f| build_field(info, f, registry))
                    .collect();
                registry.build_interface_type::<DynamicValue>(info, &fields).into_meta()
            }
            TypeDefinition::Union(u) => {
                let member_types: Vec<juniper::Type> = u.types.iter()
                    .map(|name| {
                        let member_info = info.with_type(name);
                        registry.get_type::<DynamicValue>(&member_info)
                    })
                    .collect();
                registry.build_union_type::<DynamicValue>(info, &member_types).into_meta()
            }
            TypeDefinition::InputObject(io) => {
                let args: Vec<MetaArgument<DefaultScalarValue>> = io.fields.iter()
                    .map(|f| {
                        let field_type = convert_type(info, &f.value_type, registry);
                        MetaArgument::new(ArcStr::from(f.name.as_str()), field_type)
                    })
                    .collect();
                registry.build_input_object_type::<DynamicValue>(info, &args).into_meta()
            }
        }
    }
}

// ---------------------------------------------------------------------------
// DynamicEnum: separate type for enum registration (needs FromInputValue)
// ---------------------------------------------------------------------------

struct DynamicEnum;

impl GraphQLValue<DefaultScalarValue> for DynamicEnum {
    type Context = SchemaInfo;
    type TypeInfo = String;

    fn type_name(&self, info: &String) -> Option<ArcStr> {
        Some(ArcStr::from(info.as_str()))
    }
}

impl GraphQLType<DefaultScalarValue> for DynamicEnum {
    fn name(info: &String) -> Option<ArcStr> {
        Some(ArcStr::from(info.as_str()))
    }

    fn meta(_info: &String, _registry: &mut Registry<DefaultScalarValue>) -> MetaType<DefaultScalarValue> {
        unreachable!("DynamicEnum::meta should not be called directly")
    }
}

impl juniper::FromInputValue<DefaultScalarValue> for DynamicValue {
    type Error = String;
    fn from_input_value(_v: &juniper::InputValue<DefaultScalarValue>) -> Result<Self, Self::Error> {
        Ok(DynamicValue)
    }
}

impl juniper::FromInputValue<DefaultScalarValue> for DynamicEnum {
    type Error = String;
    fn from_input_value(_v: &juniper::InputValue<DefaultScalarValue>) -> Result<Self, Self::Error> {
        Ok(DynamicEnum)
    }
}

impl juniper::ToInputValue<DefaultScalarValue> for DynamicEnum {
    fn to_input_value(&self) -> juniper::InputValue<DefaultScalarValue> {
        juniper::InputValue::Null
    }
}

// ---------------------------------------------------------------------------
// Field and type helpers
// ---------------------------------------------------------------------------

fn build_field(
    info: &SchemaInfo,
    f: &gp::Field<'static, String>,
    registry: &mut Registry<DefaultScalarValue>,
) -> Field<DefaultScalarValue> {
    let field_type = convert_type(info, &f.field_type, registry);
    let mut field = Field {
        name: ArcStr::from(f.name.as_str()),
        description: None,
        arguments: None,
        field_type,
        deprecation_status: juniper::meta::DeprecationStatus::Current,
    };
    if !f.arguments.is_empty() {
        let args: Vec<MetaArgument<DefaultScalarValue>> = f.arguments.iter()
            .map(|a| {
                let arg_type = convert_type(info, &a.value_type, registry);
                MetaArgument::new(ArcStr::from(a.name.as_str()), arg_type)
            })
            .collect();
        field.arguments = Some(args);
    }
    field
}

/// Convert a graphql-parser type reference into a Juniper Type,
/// registering any referenced types in the registry.
fn convert_type(
    info: &SchemaInfo,
    gp_type: &gp::Type<'static, String>,
    registry: &mut Registry<DefaultScalarValue>,
) -> juniper::Type {
    match gp_type {
        gp::Type::NamedType(name) => {
            // For built-in scalars, use Juniper's native type registration
            // to avoid overwriting them with DynamicValue's fallback.
            match name.as_str() {
                "String" => { registry.get_type::<String>(&()); }
                "Int" => { registry.get_type::<i32>(&()); }
                "Float" => { registry.get_type::<f64>(&()); }
                "Boolean" => { registry.get_type::<bool>(&()); }
                "ID" => { registry.get_type::<juniper::ID>(&()); }
                _ => { let type_info = info.with_type(name); registry.get_type::<DynamicValue>(&type_info); }
            };
            juniper::Type::nullable(ArcStr::from(name.as_str()))
        }
        gp::Type::ListType(inner) => {
            let inner_type = convert_type(info, inner, registry);
            inner_type.wrap_list(None)
        }
        gp::Type::NonNullType(inner) => {
            convert_type(info, inner, registry).wrap_non_null()
        }
    }
}

// ---------------------------------------------------------------------------
// Wiring spec resolution
// ---------------------------------------------------------------------------

fn resolve_value(
    info: &SchemaInfo,
    gp_type: &gp::Type<'static, String>,
    executor: &Executor<SchemaInfo>,
) -> ExecutionResult {
    match gp_type {
        gp::Type::NonNullType(inner) => resolve_value(info, inner, executor),
        gp::Type::ListType(inner) => {
            let a = resolve_value(info, inner, executor)?;
            let b = resolve_value(info, inner, executor)?;
            Ok(Value::list(vec![a, b]))
        }
        gp::Type::NamedType(name) => resolve_named(info, name, executor),
    }
}

fn resolve_named(
    info: &SchemaInfo,
    type_name: &str,
    executor: &Executor<SchemaInfo>,
) -> ExecutionResult {
    match type_name {
        "Int" => Ok(Value::scalar(2)),
        "Float" => Ok(Value::scalar(3.14)),
        "String" => Ok(Value::scalar("str".to_string())),
        "Boolean" => Ok(Value::scalar(true)),
        "ID" => Ok(Value::scalar("id".to_string())),
        _ => {
            let td = info.find_type_def(type_name);
            match td {
                Some(TypeDefinition::Scalar(_)) => {
                    Ok(Value::scalar("str".to_string()))
                }
                Some(TypeDefinition::Enum(_)) => {
                    let first = info.enum_first.get(type_name)
                        .expect("enum not found");
                    Ok(Value::scalar(first.clone()))
                }
                Some(TypeDefinition::Object(_)) | Some(TypeDefinition::Union(_)) | Some(TypeDefinition::Interface(_)) => {
                    let resolved = resolve_concrete_type(info, type_name);
                    let type_info = info.with_type(&resolved);
                    executor.resolve(&type_info, &DynamicValue)
                }
                _ => Ok(Value::scalar("str".to_string())),
            }
        }
    }
}

fn resolve_concrete_type(info: &SchemaInfo, type_name: &str) -> String {
    if let Some(members) = info.union_members.get(type_name) {
        return members[0].clone();
    }
    if let Some(impls) = info.iface_impls.get(type_name) {
        return impls.last().unwrap().clone();
    }
    type_name.to_string()
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        eprintln!("Usage: conformer <schema> <query> [<variables>]");
        std::process::exit(1);
    }

    let schema_text = fs::read_to_string(&args[1]).expect("read schema");
    let query_text = fs::read_to_string(&args[2]).expect("read query");

    let variables: Option<serde_json::Value> = if args.len() >= 4 {
        let var_text = fs::read_to_string(&args[3]).expect("read variables");
        Some(serde_json::from_str(&var_text).expect("parse variables"))
    } else {
        None
    };

    // Parse SDL — leak to get 'static lifetime (process exits after one execution)
    let doc: &'static gp::Document<'static, String> = Box::leak(Box::new(
        graphql_parser::parse_schema::<String>(&schema_text)
            .expect("parse schema")
            .into_static(),
    ));

    // Pre-scan
    let mut enum_first = HashMap::new();
    let mut union_members = HashMap::new();
    let mut iface_impls: HashMap<String, Vec<String>> = HashMap::new();
    let mut query_type = "Query".to_string();

    for def in &doc.definitions {
        match def {
            Definition::SchemaDefinition(sd) => {
                if let Some(q) = &sd.query {
                    query_type = q.clone();
                }
            }
            Definition::TypeDefinition(td) => {
                match td {
                    TypeDefinition::Enum(e) => {
                        if let Some(first) = e.values.first() {
                            enum_first.insert(e.name.clone(), first.name.clone());
                        }
                    }
                    TypeDefinition::Union(u) => {
                        let mut members = u.types.clone();
                        members.sort();
                        union_members.insert(u.name.clone(), members);
                    }
                    TypeDefinition::Object(o) => {
                        for iface in &o.implements_interfaces {
                            iface_impls.entry(iface.clone())
                                .or_default()
                                .push(o.name.clone());
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    for impls in iface_impls.values_mut() {
        impls.sort();
    }

    let info = SchemaInfo {
        doc,
        type_name: query_type.clone(),
        enum_first,
        union_members,
        iface_impls,
        query_type,
    };

    // Strip custom directive usages from query — Juniper's public API doesn't
    // allow registering custom directives, so it rejects unknown ones during
    // validation. Custom directives don't affect execution semantics.
    let built_in_directives = ["skip", "include", "deprecated", "specifiedBy"];
    let custom_directives: Vec<String> = doc.definitions.iter()
        .filter_map(|d| {
            if let Definition::DirectiveDefinition(dd) = d {
                if !built_in_directives.contains(&dd.name.as_str()) {
                    return Some(dd.name.clone());
                }
            }
            None
        })
        .collect();
    let query_text = strip_custom_directives(&query_text, &custom_directives);

    // Build RootNode
    let root = RootNode::new_with_info(
        DynamicValue,
        EmptyMutation::<SchemaInfo>::new(),
        EmptySubscription::<SchemaInfo>::new(),
        info.clone(),
        (),
        (),
    );

    // Convert variables
    let juniper_vars = match &variables {
        Some(serde_json::Value::Object(m)) => {
            m.iter()
                .map(|(k, v)| (k.to_string(), json_to_input_value(v)))
                .collect()
        }
        _ => juniper::Variables::new(),
    };

    // Execute
    let result = juniper::execute_sync(&query_text, None, &root, &juniper_vars, &info);

    match result {
        Ok((data, errors)) => {
            let json_data = value_to_json(&data);
            let mut output = serde_json::Map::new();
            output.insert("data".to_string(), json_data);
            if !errors.is_empty() {
                let json_errors: Vec<serde_json::Value> = errors.iter()
                    .map(|e| serde_json::json!({"message": e.error().message()}))
                    .collect();
                output.insert("errors".to_string(), serde_json::Value::Array(json_errors));
            }
            print!("{}", serde_json::Value::Object(output));
        }
        Err(e) => {
            let mut output = serde_json::Map::new();
            output.insert("data".to_string(), serde_json::Value::Null);
            output.insert("errors".to_string(), serde_json::json!([{"message": format!("{e:?}")}]));
            print!("{}", serde_json::Value::Object(output));
        }
    }
}

// ---------------------------------------------------------------------------
// JSON conversion helpers
// ---------------------------------------------------------------------------

fn value_to_json(val: &Value<DefaultScalarValue>) -> serde_json::Value {
    match val {
        Value::Null => serde_json::Value::Null,
        Value::Scalar(s) => match s {
            DefaultScalarValue::Int(i) => serde_json::Value::Number((*i).into()),
            DefaultScalarValue::Float(f) => {
                serde_json::Value::Number(serde_json::Number::from_f64(*f).unwrap())
            }
            DefaultScalarValue::String(s) => serde_json::Value::String(s.clone()),
            DefaultScalarValue::Boolean(b) => serde_json::Value::Bool(*b),
        },
        Value::List(l) => serde_json::Value::Array(l.iter().map(value_to_json).collect()),
        Value::Object(obj) => {
            let mut map = serde_json::Map::new();
            for (k, v) in obj.iter() {
                map.insert(k.to_string(), value_to_json(v));
            }
            serde_json::Value::Object(map)
        }
    }
}

/// Strip custom directive usages from a query string.
/// Handles @Name and @Name(args) patterns.
fn strip_custom_directives(query: &str, directives: &[String]) -> String {
    let mut result = query.to_string();
    for name in directives {
        // Match @name(balanced parens) or @name without parens
        loop {
            if let Some(start) = result.find(&format!("@{name}")) {
                let after = start + 1 + name.len();
                let rest = &result[after..];
                if rest.starts_with('(') {
                    // Find matching close paren
                    let mut depth = 0;
                    let mut end = after;
                    for (i, c) in rest.char_indices() {
                        match c {
                            '(' => depth += 1,
                            ')' => {
                                depth -= 1;
                                if depth == 0 {
                                    end = after + i + 1;
                                    break;
                                }
                            }
                            _ => {}
                        }
                    }
                    result = format!("{}{}", &result[..start], &result[end..]);
                } else if rest.is_empty() || !rest.starts_with(|c: char| c.is_alphanumeric() || c == '_') {
                    // @name not followed by more identifier chars — remove just @name
                    result = format!("{}{}", &result[..start], &result[after..]);
                } else {
                    // @name is a prefix of a longer directive name, skip
                    break;
                }
            } else {
                break;
            }
        }
    }
    result
}

fn json_to_input_value(val: &serde_json::Value) -> juniper::InputValue<DefaultScalarValue> {
    match val {
        serde_json::Value::Null => juniper::InputValue::Null,
        serde_json::Value::Bool(b) => juniper::InputValue::Scalar(DefaultScalarValue::Boolean(*b)),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                juniper::InputValue::Scalar(DefaultScalarValue::Int(i as i32))
            } else {
                juniper::InputValue::Scalar(DefaultScalarValue::Float(n.as_f64().unwrap()))
            }
        }
        serde_json::Value::String(s) => juniper::InputValue::Scalar(DefaultScalarValue::String(s.clone())),
        serde_json::Value::Array(a) => {
            juniper::InputValue::list(a.iter().map(json_to_input_value).collect())
        }
        serde_json::Value::Object(m) => {
            juniper::InputValue::object(
                m.iter()
                    .map(|(k, v)| (k.as_str(), json_to_input_value(v)))
                    .collect()
            )
        }
    }
}
