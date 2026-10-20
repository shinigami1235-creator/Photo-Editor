//! Local control server for the Claude connector (mcp/photo-editor-mcp.mjs).
//!
//! It listens on 127.0.0.1 only and runs only while "Let Claude control this
//! app" is ticked in the Help menu. Each start writes a fresh random token and
//! the port to mcp.json in the app data folder; a request without that token,
//! or one sent from a web page (it carries an Origin header), is refused.
//! Requests are handed to the editor window, which answers through `mcp_reply`.

use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

const INFO_FILE: &str = "mcp.json";
const MAX_BODY: usize = 64 * 1024 * 1024;
// Cut-outs and exports of big photos can take a few minutes on a slow computer.
const REPLY_WAIT: Duration = Duration::from_secs(300);

struct Running {
    port: u16,
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct Bridge {
    running: Mutex<Option<Running>>,
    pending: Arc<Mutex<HashMap<u64, Sender<String>>>>,
    next: Arc<AtomicU64>,
}

fn token() -> String {
    let mut out = String::new();
    for i in 0..2u64 {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(i);
        h.write_u128(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
        );
        h.write_u32(std::process::id());
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.flush();
}

fn error_json(msg: &str) -> String {
    serde_json::json!({ "error": msg }).to_string()
}

fn handle(
    mut stream: TcpStream,
    app: &AppHandle,
    secret: &str,
    pending: &Arc<Mutex<HashMap<u64, Sender<String>>>>,
    next: &Arc<AtomicU64>,
) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    });
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() {
        return;
    }
    let mut parts = line.split_whitespace();
    let (method, path) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    let mut length = 0usize;
    let mut given = String::new();
    let mut origin = false;
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h).is_err() {
            return;
        }
        let h = h.trim_end();
        if h.is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            let (k, v) = (k.trim().to_ascii_lowercase(), v.trim());
            match k.as_str() {
                "content-length" => length = v.parse().unwrap_or(0),
                "x-token" => given = v.to_string(),
                "origin" => origin = true,
                _ => {}
            }
        }
    }
    if origin {
        return respond(&mut stream, "403 Forbidden", &error_json("Web pages cannot control Photo Editor."));
    }
    if given.len() != secret.len() || !given.bytes().zip(secret.bytes()).fold(true, |ok, (a, b)| ok & (a == b)) {
        return respond(&mut stream, "401 Unauthorized", &error_json("Wrong token."));
    }
    if method != "POST" || path != "/rpc" {
        return respond(&mut stream, "404 Not Found", &error_json("Use POST /rpc."));
    }
    if length > MAX_BODY {
        return respond(&mut stream, "413 Payload Too Large", &error_json("Request too big."));
    }
    let mut body = vec![0u8; length];
    if reader.read_exact(&mut body).is_err() {
        return;
    }
    let body = String::from_utf8_lossy(&body).to_string();

    let id = next.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = channel();
    pending.lock().unwrap().insert(id, tx);
    if app.emit("mcp-request", serde_json::json!({ "id": id, "body": body })).is_err() {
        pending.lock().unwrap().remove(&id);
        return respond(&mut stream, "500 Internal Server Error", &error_json("The editor window is not ready."));
    }
    match rx.recv_timeout(REPLY_WAIT) {
        Ok(reply) => respond(&mut stream, "200 OK", &reply),
        Err(_) => {
            pending.lock().unwrap().remove(&id);
            respond(&mut stream, "504 Gateway Timeout", &error_json("Photo Editor took too long to answer."))
        }
    }
}

fn info_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(INFO_FILE))
}

#[tauri::command]
pub fn mcp_start(app: AppHandle, bridge: tauri::State<'_, Bridge>) -> Result<u16, String> {
    let mut running = bridge.running.lock().unwrap();
    if let Some(r) = running.as_ref() {
        return Ok(r.port);
    }
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let secret = token();
    let info = serde_json::json!({ "port": port, "token": secret, "pid": std::process::id() });
    std::fs::write(info_path(&app)?, info.to_string()).map_err(|e| e.to_string())?;

    let stop = Arc::new(AtomicBool::new(false));
    let (stop2, pending, next, app2) = (stop.clone(), bridge.pending.clone(), bridge.next.clone(), app.clone());
    thread::spawn(move || {
        for conn in listener.incoming() {
            if stop2.load(Ordering::SeqCst) {
                break;
            }
            if let Ok(stream) = conn {
                let (app3, secret3, pending3, next3) = (app2.clone(), secret.clone(), pending.clone(), next.clone());
                thread::spawn(move || handle(stream, &app3, &secret3, &pending3, &next3));
            }
        }
    });
    *running = Some(Running { port, stop });
    Ok(port)
}

#[tauri::command]
pub fn mcp_stop(app: AppHandle, bridge: tauri::State<'_, Bridge>) -> Result<(), String> {
    if let Some(r) = bridge.running.lock().unwrap().take() {
        r.stop.store(true, Ordering::SeqCst);
        // Wakes the listener so its loop sees the stop flag.
        if let Ok(s) = TcpStream::connect(("127.0.0.1", r.port)) {
            let _ = s.shutdown(Shutdown::Both);
        }
    }
    let path = info_path(&app)?;
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn mcp_reply(id: u64, body: String, bridge: tauri::State<'_, Bridge>) {
    if let Some(tx) = bridge.pending.lock().unwrap().remove(&id) {
        let _ = tx.send(body);
    }
}
