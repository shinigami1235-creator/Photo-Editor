use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager};

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

#[tauri::command]
fn model_ready(app: AppHandle) -> bool {
    data_path(&app, MODEL_FILE)
        .map(|p| p.exists())
        .unwrap_or(false)
}

#[tauri::command]
fn model_read(app: AppHandle) -> Result<Response, String> {
    let path = data_path(&app, MODEL_FILE)?;
    fs::read(&path).map(Response::new).map_err(|e| e.to_string())
}

#[tauri::command]
async fn model_download(app: AppHandle) -> Result<(), String> {
    let path = data_path(&app, MODEL_FILE)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let part = path.with_extension("part");
    let mut response = tauri_plugin_http::reqwest::get(MODEL_URL)
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let total = response.content_length().unwrap_or(0);
    let mut file = fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut received: u64 = 0;
    let mut last_emit: u64 = 0;
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        if received - last_emit > 1_000_000 || received == total {
            last_emit = received;
            let _ = app.emit("model-progress", (received, total));
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);
    fs::rename(&part, &path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
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
