use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager};

mod bridge;

const MODEL_URL: &str =
    "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx";
const MODEL_FILE: &str = "models/isnet-general-use.onnx";

fn header(request: &Request<'_>, name: &str) -> Result<String, String> {
    let raw = request
        .headers()
        .get(name)
        .ok_or_else(|| format!("missing header {name}"))?
        .to_str()
        .map_err(|e| e.to_string())?;
    percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .map(|s| s.to_string())
        .map_err(|e| e.to_string())
}

fn body(request: &Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        _ => Err("expected raw bytes".into()),
    }
}

/// Resolves a path inside the app data folder and refuses anything that climbs out of it.
fn data_path(app: &AppHandle, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(format!("bad path {rel}"));
    }
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join(rel_path))
}

fn write_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Write beside the target first so a crash mid-write leaves the old file intact.
    let tmp = path.with_extension("tmp-write");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    fs::read(&path)
        .map(Response::new)
        .map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn write_file(request: Request<'_>) -> Result<(), String> {
    let path = header(&request, "x-path")?;
    write_bytes(Path::new(&path), &body(&request)?)
}

#[tauri::command]
fn data_read(app: AppHandle, rel: String) -> Result<Response, String> {
    let path = data_path(&app, &rel)?;
    fs::read(&path).map(Response::new).map_err(|e| e.to_string())
}

#[tauri::command]
fn data_write(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let rel = header(&request, "x-rel")?;
    let path = data_path(&app, &rel)?;
    write_bytes(&path, &body(&request)?)
}

#[tauri::command]
fn data_list(app: AppHandle, dir: String) -> Result<Vec<String>, String> {
    let path = data_path(&app, &dir)?;
    let Ok(entries) = fs::read_dir(&path) else {
        return Ok(vec![]);
    };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
        .filter_map(|e| e.file_name().into_string().ok())
        .collect();
    names.sort();
    Ok(names)
}

#[tauri::command]
fn data_delete(app: AppHandle, rel: String) -> Result<(), String> {
    let path = data_path(&app, &rel)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Files and folders inside a folder, for the Claude connector's list_files.
#[tauri::command]
fn list_dir(path: String) -> Result<Vec<serde_json::Value>, String> {
    let mut out = vec![];
    for entry in fs::read_dir(&path).map_err(|e| format!("{path}: {e}"))? {
        let Ok(entry) = entry else { continue };
        let Ok(meta) = entry.metadata() else { continue };
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(serde_json::json!({
            "name": entry.file_name().to_string_lossy(),
            "folder": meta.is_dir(),
            "size": meta.len(),
            "modified": modified,
        }));
    }
    Ok(out)
}

#[tauri::command]
fn list_fonts() -> Vec<String> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let mut families: Vec<String> = db
        .faces()
        .filter_map(|face| face.families.first().map(|(name, _)| name.clone()))
        .collect();
    families.sort_by_key(|a| a.to_lowercase());
    families.dedup();
    families
}

/// A model the app downloads on first use. Each URL list is tried in order; a
/// list with several URLs is one file split into parts, joined in order.
struct Model {
    file: &'static str,
    total: u64,
    sources: &'static [&'static [&'static str]],
}

fn model(name: Option<&str>) -> Result<Model, String> {
    match name.unwrap_or("isnet") {
        "isnet" => Ok(Model { file: MODEL_FILE, total: 178_648_008, sources: &[&[MODEL_URL]] }),
        "face" => Ok(Model {
            file: "models/restoreformer-pp-fp16.onnx",
            total: 148_222_244,
            sources: &[
                &[concat!("https://raw.githubusercontent.com/shinigami1235-creator/Photo-Editor/models/face/restoreformer-pp-fp16.onnx.part", "0"),
                  concat!("https://raw.githubusercontent.com/shinigami1235-creator/Photo-Editor/models/face/restoreformer-pp-fp16.onnx.part", "1")],
                // The same model before trimming, at full precision.
                &["https://github.com/facefusion/facefusion-assets/releases/download/models-3.0.0/restoreformer_plus_plus.onnx"],
            ],
        }),
        other => Err(format!("unknown model {other}")),
    }
}

#[tauri::command]
fn model_ready(app: AppHandle, name: Option<String>) -> bool {
    model(name.as_deref())
        .and_then(|m| data_path(&app, m.file))
        .map(|p| p.exists())
        .unwrap_or(false)
}

#[tauri::command]
fn model_read(app: AppHandle, name: Option<String>) -> Result<Response, String> {
    let path = data_path(&app, model(name.as_deref())?.file)?;
    fs::read(&path).map(Response::new).map_err(|e| e.to_string())
}

async fn fetch_parts(app: &AppHandle, urls: &[&str], part: &Path, total: u64) -> Result<(), String> {
    let mut file = fs::File::create(part).map_err(|e| e.to_string())?;
    let mut received: u64 = 0;
    let mut last_emit: u64 = 0;
    for url in urls {
        let mut response = tauri_plugin_http::reqwest::get(*url)
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let total = if urls.len() == 1 { response.content_length().unwrap_or(total) } else { total };
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            file.write_all(&chunk).map_err(|e| e.to_string())?;
            received += chunk.len() as u64;
            if received - last_emit > 1_000_000 || received == total {
                last_emit = received;
                let _ = app.emit("model-progress", (received, total));
            }
        }
    }
    file.flush().map_err(|e| e.to_string())
}

#[tauri::command]
async fn model_download(app: AppHandle, name: Option<String>) -> Result<(), String> {
    let m = model(name.as_deref())?;
    let path = data_path(&app, m.file)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let part = path.with_extension("part");
    let mut last_error = String::new();
    for urls in m.sources {
        match fetch_parts(&app, urls, &part, m.total).await {
            Ok(()) => return fs::rename(&part, &path).map_err(|e| e.to_string()),
            Err(e) => last_error = e,
        }
    }
    let _ = fs::remove_file(&part);
    Err(last_error)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(bridge::Bridge::default())
        .setup(|app| {
            // A connection file left by a previous run points at a closed port.
            if let Ok(dir) = app.path().app_data_dir() {
                let _ = fs::remove_file(dir.join("mcp.json"));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            file_exists,
            list_dir,
            bridge::mcp_start,
            bridge::mcp_stop,
            bridge::mcp_reply,
            read_file,
            write_file,
            data_read,
            data_write,
            data_list,
            data_delete,
            list_fonts,
            model_ready,
            model_read,
            model_download
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
