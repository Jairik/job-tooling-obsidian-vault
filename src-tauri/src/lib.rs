// Vault Assistant desktop shell.
//
// The whole application (React UI + JSON/SSE API + agent) is the existing Bun
// server. This Tauri shell does not reimplement any of it — it spawns `bun` as a
// sidecar, waits for it to come up, and points the window at PORT.
// Because the webview loads the Bun origin directly, every relative /api fetch and
// the SSE-over-POST streaming keep working unchanged.
//
// Release builds ship a `bun build --target=bun` server.js bundle plus a small
// set of external runtime packages. We keep a bundled `bun` runtime rather than a
// `bun build --compile` single binary because css-tree still needs real package
// files for createRequire JSON data, Playwright resolves subprocess assets at
// runtime, and the Claude Agent SDK spawns its own native subprocess.

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Holds the spawned Bun child so it can be killed when the app exits.
struct Sidecar(Mutex<Option<CommandChild>>);

/// Grabs an available localhost port by binding to :0 and reading it back.
/// A tiny TOCTOU window exists before the sidecar rebinds it; negligible for a
/// single-user desktop app, and far safer than assuming 5173 is free.
fn pick_free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(5173)
}

fn parse_dotenv(app_dir: &std::path::Path) -> HashMap<String, String> {
    let path = app_dir.join(".env");
    let Ok(text) = std::fs::read_to_string(path) else {
        return HashMap::new();
    };
    let mut values = HashMap::new();

    for raw_line in text.lines() {
        let mut line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(rest) = line.strip_prefix("export ") {
            line = rest.trim();
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if !key
            .chars()
            .next()
            .is_some_and(|c| c == '_' || c.is_ascii_alphabetic())
            || !key.chars().all(|c| c == '_' || c.is_ascii_alphanumeric())
        {
            continue;
        }

        let mut value = value.trim().to_string();
        if (value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\''))
        {
            value = value[1..value.len().saturating_sub(1)].to_string();
        } else if let Some(idx) = value.find(" #") {
            value = value[..idx].trim().to_string();
        }
        values.insert(key.to_string(), value);
    }

    values
}

fn env_or_dotenv(name: &str, dotenv: &HashMap<String, String>) -> Option<String> {
    std::env::var(name)
        .ok()
        .or_else(|| dotenv.get(name).cloned())
}

fn parse_port(raw: Option<String>) -> Option<u16> {
    raw.and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0)
}

fn resolve_port(dotenv: &HashMap<String, String>) -> u16 {
    parse_port(env_or_dotenv("PORT", dotenv)).unwrap_or_else(pick_free_port)
}

/// Directory that contains the server entrypoint and runtime resources.
/// In dev this is the repo root (one level above src-tauri); in a bundled build
/// it is the staged `app/` folder under Tauri's resource dir.
fn resolve_app_dir(handle: &tauri::AppHandle) -> std::path::PathBuf {
    #[cfg(debug_assertions)]
    {
        let _ = handle;
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri has a parent")
            .to_path_buf()
    }
    #[cfg(not(debug_assertions))]
    {
        handle
            .path()
            .resolve("app", tauri::path::BaseDirectory::Resource)
            .expect("bundled app resources")
    }
}

/// GUI processes inherit a minimal PATH (not your login shell's), so host tools the
/// agent shells out to — tectonic, opencode, codex, etc. — would be invisible.
/// Prepend the usual user/tool bin dirs so `Bun.which(...)` can find them.
/// Windows GUI apps already inherit the user's full registry-backed PATH (joined
/// with ';'), so there the existing value passes through untouched.
fn augmented_path() -> String {
    #[cfg(windows)]
    {
        std::env::var("PATH").unwrap_or_default()
    }
    #[cfg(not(windows))]
    {
        let mut parts: Vec<String> = Vec::new();
        if let Ok(home) = std::env::var("HOME") {
            parts.push(format!("{home}/.local/bin"));
            parts.push(format!("{home}/.bun/bin"));
            parts.push(format!("{home}/.cargo/bin"));
        }
        for p in ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"] {
            parts.push(p.to_string());
        }
        if let Ok(existing) = std::env::var("PATH") {
            parts.push(existing);
        }
        parts.join(":")
    }
}

/// Reveals the error message baked into the loading page (dist/index.html) when the
/// backend never comes up, so the user isn't stuck on a spinner.
fn show_backend_error(window: &tauri::WebviewWindow, msg: &str) {
    let escaped = msg.replace('\\', "\\\\").replace('\'', "\\'");
    let js = format!(
        "var s=document.querySelector('.spinner');if(s)s.style.display='none';\
         var m=document.querySelector('.msg');if(m)m.style.display='none';\
         var e=document.getElementById('err');if(e){{e.style.display='block';e.textContent='{escaped}';}}"
    );
    let _ = window.eval(&js);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Sidecar(Mutex::new(None)))
        .setup(|app| {
            #[cfg(debug_assertions)]
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            let handle = app.handle().clone();
            let app_dir = resolve_app_dir(&handle);
            let dotenv = parse_dotenv(&app_dir);
            let port = resolve_port(&dotenv);
            let server_entry = if cfg!(debug_assertions) {
                "server.ts"
            } else {
                "server.js"
            };
            let server_path = app_dir.join(server_entry);

            // Per-user writable location for config.json / logs/ / .attachments/ /
            // .sessions.json — the server roots these at VA_DATA_DIR (agent/paths.ts).
            let data_dir = handle
                .path()
                .app_data_dir()
                .expect("resolve app data dir");
            std::fs::create_dir_all(&data_dir).ok();

            let sidecar = handle
                .shell()
                .sidecar("bun")
                .expect("bun sidecar binary is bundled")
                .args([
                    "run".to_string(),
                    server_path.to_string_lossy().to_string(),
                ])
                .current_dir(app_dir)
                .env("PORT", port.to_string())
                .env("NODE_ENV", "production")
                .env("VA_DATA_DIR", data_dir.to_string_lossy().to_string())
                .env("PATH", augmented_path());

            let (mut rx, child) = sidecar.spawn().expect("failed to spawn bun sidecar");
            app.state::<Sidecar>().0.lock().unwrap().replace(child);

            // Drive readiness + failure off the sidecar's own output. The server
            // logs a Vault Assistant localhost URL once Bun.serve is
            // listening, so that line is our ready signal — no HTTP polling needed.
            let nav_handle = handle.clone();
            let target = format!("http://localhost:{port}");
            tauri::async_runtime::spawn(async move {
                let mut navigated = false;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) => {
                            let line = String::from_utf8_lossy(&bytes);
                            log::info!("[server] {}", line.trim_end());
                            if !navigated && line.contains("Vault Assistant") && line.contains("http")
                            {
                                if let (Some(window), Ok(url)) = (
                                    nav_handle.get_webview_window("main"),
                                    url::Url::parse(&target),
                                ) {
                                    let _ = window.navigate(url);
                                    navigated = true;
                                }
                            }
                        }
                        CommandEvent::Stderr(bytes) => {
                            log::warn!("[server] {}", String::from_utf8_lossy(&bytes).trim_end());
                        }
                        CommandEvent::Error(err) => log::error!("[server] {err}"),
                        CommandEvent::Terminated(payload) => {
                            log::error!("[server] exited: {payload:?}");
                            if !navigated {
                                if let Some(window) = nav_handle.get_webview_window("main") {
                                    show_backend_error(
                                        &window,
                                        "The Vault Assistant backend exited before it was ready. See the app logs for details.",
                                    );
                                }
                            }
                            break;
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|handle, event| {
            // Never leave an orphan Bun process behind the closed window.
            if let RunEvent::Exit = event {
                if let Some(child) = handle.state::<Sidecar>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
