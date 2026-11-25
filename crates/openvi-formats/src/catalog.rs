//! Game-data catalogs built by SixNG from the scans: vehicles (with their handling) for now.
//!
//! SixNG reads its scans from a work folder (`<work>/index`), the layout [`crate::scan_archive`] writes when given
//! `<work>/index` as its cache: the scans OpenVI made are reused, not repeated.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::Value;
use sixng_core::export::Workspace;
use sixng_core::{classify, meta7a, pso, vehicles};

use crate::{ScanPhase, scan_archive};

/// The archives the vehicle catalog reads: the vehicle tables (`packs.rpf`), and the game text and handling records
/// (`data.rpf`, optional).
pub const VEHICLE_ARCHIVES: [&str; 2] = ["packs.rpf", "data.rpf"];

/// One vehicle model, flattened for a table.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Vehicle {
    /// Model name (`phoenix`), when a scanned resource carries it; otherwise only the hash is known.
    pub model: Option<String>,
    /// Joaat hash of the model name, 8 hex digits: the stable id.
    pub model_hash: String,
    /// The game's own name for it (English text table).
    pub display_name: Option<String>,
    /// Its maker's name (English text table).
    pub make: Option<String>,
    /// The handling record it uses, 8 hex digits.
    pub handling_id: Option<String>,
    /// Name of that handling record, when known.
    pub handling_name: Option<String>,
    pub configurations: usize,
    pub palettes: usize,
    /// Body colour of the first configuration, as it shows on screen (`#rrggbb`).
    pub colour: Option<String>,
    /// Rim and tyre models of the first configuration.
    pub rim: Option<String>,
    pub tyre: Option<String>,
    /// Largest steering angle, radians.
    pub steering_lock: Option<f64>,
    /// Handling values, under their GTA V names: kg, km/h, count, N/kg.
    pub mass: Option<f64>,
    pub max_speed: Option<f64>,
    pub gears: Option<f64>,
    pub drive_force: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VehicleCatalog {
    /// By display name, then model name, then hash.
    pub vehicles: Vec<Vehicle>,
    /// SixNG's full records: every field it decodes (configurations, palettes, part groups, lights, mods).
    pub vehicles_json: PathBuf,
    /// Full handling records, when `data.rpf` is there.
    pub handling_json: Option<PathBuf>,
}

/// First number under `key` anywhere in `value` (handling components nest their fields).
fn find_number(value: &Value, key: &str) -> Option<f64> {
    match value {
        Value::Object(map) => map
            .get(key)
            .and_then(Value::as_f64)
            .or_else(|| map.values().find_map(|inner| find_number(inner, key))),
        Value::Array(items) => items.iter().find_map(|inner| find_number(inner, key)),
        _ => None,
    }
}

fn text(value: &Value) -> Option<String> {
    value.as_str().map(str::to_owned)
}

/// Joins SixNG's `vehicles.json` and `handling.json` (both parsed) into table rows.
pub fn vehicle_rows(vehicles: &Value, handling: Option<&Value>) -> Vec<Vehicle> {
    let handling_field = meta7a::field_name(0xec41_bd9c); // handlingId, case-sensitive joaat
    let records: HashMap<&str, &Value> = handling
        .and_then(|h| h["records"].as_array())
        .into_iter()
        .flatten()
        .filter_map(|record| Some((record["handling"].as_str()?, record)))
        .collect();

    let mut rows: Vec<Vehicle> = vehicles["vehicles"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|vehicle| {
            let model_hash = vehicle["model_hash"].as_str().unwrap_or_default().to_owned();
            // A model without its own handlingId uses the record named like itself.
            let handling_id = vehicle["model_info"][&handling_field]
                .as_u64()
                .filter(|id| *id != 0)
                .map(|id| format!("{id:08x}"))
                .or_else(|| records.contains_key(model_hash.as_str()).then(|| model_hash.clone()));
            let record = handling_id.as_deref().and_then(|id| records.get(id)).copied();
            let first = &vehicle["configurations"][0];
            Vehicle {
                model: text(&vehicle["model"]),
                display_name: text(&vehicle["display_name"]),
                make: text(&vehicle["make"]),
                handling_name: record.and_then(|r| text(&r["name"])),
                configurations: vehicle["configurations"].as_array().map_or(0, Vec::len),
                palettes: vehicle["palettes"].as_array().map_or(0, Vec::len),
                colour: text(&first["colour"]["srgb_if_linear"]),
                rim: text(&first["rim"]),
                tyre: text(&first["tyre"]),
                steering_lock: vehicle["steering_lock"].as_f64(),
                mass: record.and_then(|r| find_number(&r["components"], "fMass")),
                max_speed: record.and_then(|r| find_number(&r["components"], "fInitialDriveMaxFlatVel")),
                gears: record.and_then(|r| find_number(&r["components"], "nInitialDriveGears")),
                drive_force: record.and_then(|r| find_number(&r["components"], "fInitialDriveForce")),
                handling_id,
                model_hash,
            }
        })
        .collect();
    rows.sort_by(|a, b| {
        let key = |v: &Vehicle| {
            (
                v.display_name.is_none(),
                v.display_name.clone(),
                v.model.clone(),
                v.model_hash.clone(),
            )
        };
        key(a).cmp(&key(b))
    });
    rows
}

fn read_json(path: &Path) -> Result<Value> {
    let bytes = std::fs::read(path).with_context(|| format!("cannot read {}", path.display()))?;
    Ok(serde_json::from_slice(&bytes)?)
}

/// Builds the vehicle catalog of the game in `game_root`.
///
/// Scans `packs.rpf` and `data.rpf` first if needed (cached in `<work>/index`, progress through `progress`), then
/// lets SixNG decode the vehicle tables and the handling records into `<work>/catalog`. Model names come from every
/// scanned archive: index the whole game for the most names.
pub fn vehicle_catalog(
    game_root: &Path,
    work_dir: &Path,
    progress: impl Fn(&str, ScanPhase, u64, u64) + Send + Sync + 'static,
) -> Result<VehicleCatalog> {
    let workspace = Workspace::new(game_root, work_dir);
    let progress = std::sync::Arc::new(progress);
    for id in VEHICLE_ARCHIVES {
        let path = game_root.join(id);
        if !path.is_file() {
            anyhow::ensure!(
                id != "packs.rpf",
                "{} has no packs.rpf: no vehicle tables",
                game_root.display()
            );
            continue;
        }
        let report = std::sync::Arc::clone(&progress);
        scan_archive(&path, id, &workspace.index_dir(), move |phase, done, total| {
            report(id, phase, done, total);
        })?;
    }

    // Decoding the tables and the handling records takes a minute and more: done again only when an archive changes.
    let out = work_dir.join("catalog");
    let vehicles_json = out.join("vehicles").join("vehicles.json");
    let inputs: Vec<std::path::PathBuf> = VEHICLE_ARCHIVES.iter().map(|id| game_root.join(id)).collect();
    if crate::model::stale(&vehicles_json, &inputs) {
        vehicles::build(&workspace, &out)?;
    }

    let handling_json = match workspace.resolve("data.rpf") {
        Ok(data) => {
            let handling = out.join("pso").join("handling.json");
            if crate::model::stale(&handling, &inputs) {
                let index = crate::index_cache::load(&workspace.index_dir(), &data.id)?;
                let records: Vec<_> = index.entries.iter().filter(|e| e.kind == classify::Kind::Pso).collect();
                pso::export_handling(&data, &records, &vehicles::model_names(&workspace), &out)?;
            }
            Some(handling)
        }
        Err(_) => None,
    };

    let handling = handling_json.as_deref().map(read_json).transpose()?;
    let vehicles = vehicle_rows(&read_json(&vehicles_json)?, handling.as_ref());
    Ok(VehicleCatalog {
        vehicles,
        vehicles_json,
        handling_json,
    })
}

/// The catalog as CSV: one line per vehicle, the columns of [`Vehicle`].
pub fn vehicles_csv(vehicles: &[Vehicle]) -> String {
    fn cell(value: Option<impl ToString>) -> String {
        let text = value.map(|v| v.to_string()).unwrap_or_default();
        if text.contains([',', '"', '\n']) {
            format!("\"{}\"", text.replace('"', "\"\""))
        } else {
            text
        }
    }
    let mut csv = String::from(
        "model_hash,model,display_name,make,handling_id,handling_name,configurations,palettes,colour,rim,tyre,\
         steering_lock,mass,max_speed,gears,drive_force\n",
    );
    for v in vehicles {
        let row = [
            cell(Some(&v.model_hash)),
            cell(v.model.as_ref()),
            cell(v.display_name.as_ref()),
            cell(v.make.as_ref()),
            cell(v.handling_id.as_ref()),
            cell(v.handling_name.as_ref()),
            cell(Some(v.configurations)),
            cell(Some(v.palettes)),
            cell(v.colour.as_ref()),
            cell(v.rim.as_ref()),
            cell(v.tyre.as_ref()),
            cell(v.steering_lock),
            cell(v.mass),
            cell(v.max_speed),
            cell(v.gears),
            cell(v.drive_force),
        ];
        csv.push_str(&row.join(","));
        csv.push('\n');
    }
    csv
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn sample() -> (Value, Value) {
        let handling_field = meta7a::field_name(0xec41_bd9c);
        let vehicles = json!({ "vehicles": [
            {
                "model": "synthetic_coupe", "model_hash": "11111111", "display_name": "Coupe, \"S\"", "make": "Maker",
                "model_info": { handling_field.clone(): 0x2222_2222_u64 },
                "configurations": [
                    { "colour": { "srgb_if_linear": "#336699" }, "rim": "rim_a", "tyre": "tyre_b" },
                    { "colour": null }
                ],
                "palettes": [[1]], "steering_lock": 0.7
            },
            { "model": null, "model_hash": "33333333", "model_info": null, "configurations": [], "palettes": [] },
            { "model": "self_handled", "model_hash": "44444444", "display_name": "Alpha", "model_info": {},
              "configurations": [], "palettes": [] }
        ]});
        let handling = json!({ "records": [
            { "handling": "22222222", "name": "coupe_handling", "components": [
                { "_struct": "body", "fMass": 1450.0, "nested": { "nInitialDriveGears": 6 } },
                { "fInitialDriveMaxFlatVel": 160.0, "fInitialDriveForce": 0.31 }
            ]},
            { "handling": "44444444", "name": "self_handled", "components": [{ "fMass": 900 }] }
        ]});
        (vehicles, handling)
    }

    #[test]
    fn joins_vehicles_with_their_handling() {
        let (vehicles, handling) = sample();
        let rows = vehicle_rows(&vehicles, Some(&handling));

        let names: Vec<_> = rows.iter().map(|v| v.model_hash.as_str()).collect();
        assert_eq!(names, ["44444444", "11111111", "33333333"]);
        let coupe = &rows[1];
        assert_eq!(coupe.handling_id.as_deref(), Some("22222222"));
        assert_eq!(coupe.handling_name.as_deref(), Some("coupe_handling"));
        assert_eq!(
            (coupe.mass, coupe.gears, coupe.max_speed),
            (Some(1450.0), Some(6.0), Some(160.0))
        );
        assert_eq!((coupe.configurations, coupe.palettes), (2, 1));
        assert_eq!(coupe.colour.as_deref(), Some("#336699"));
        assert_eq!(
            (coupe.rim.as_deref(), coupe.tyre.as_deref()),
            (Some("rim_a"), Some("tyre_b"))
        );
        // No handlingId of its own: the record with its model hash.
        assert_eq!(rows[0].mass, Some(900.0));
        assert_eq!(
            rows[2],
            Vehicle {
                model_hash: "33333333".into(),
                ..Vehicle::default()
            }
        );
    }

    #[test]
    fn writes_csv_with_quoted_cells() {
        let (vehicles, handling) = sample();
        let csv = vehicles_csv(&vehicle_rows(&vehicles, Some(&handling)));
        let lines: Vec<_> = csv.lines().collect();
        assert_eq!(lines.len(), 4);
        assert!(lines[0].starts_with("model_hash,model,display_name"));
        assert!(
            lines[2].starts_with("11111111,synthetic_coupe,\"Coupe, \"\"S\"\"\",Maker,22222222,coupe_handling,2,1,")
        );
        assert_eq!(lines[3], "33333333,,,,,,0,0,,,,,,,,");
    }
}
