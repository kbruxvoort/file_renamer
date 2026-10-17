use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use std::sync::Mutex;
use tauri::Manager;

#[derive(Default)]
struct ApiState {
    port: Mutex<u16>,
    token: Mutex<String>,
}

#[tauri::command]
fn get_api_port(state: tauri::State<ApiState>) -> u16 {
    *state.port.lock().unwrap()
}

/// Per-launch secret the backend requires on every request, so other local
/// programs and web pages can't drive the file-moving API.
#[tauri::command]
fn get_api_token(state: tauri::State<ApiState>) -> String {
    state.token.lock().unwrap().clone()
}

fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("failed to generate API token");
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(ApiState::default())
        .invoke_handler(tauri::generate_handler![get_api_port, get_api_token])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Find a free port
            let port = std::net::TcpListener::bind("127.0.0.1:0")
                .map(|l| l.local_addr().unwrap().port())
                .expect("failed to find free port");
            let token = generate_token();

            let state = app.state::<ApiState>();
            *state.port.lock().unwrap() = port;
            *state.token.lock().unwrap() = token.clone();

            let handle = app.handle().clone();
            
            // Spawn sidecar. The token goes through the environment, not argv,
            // so it doesn't show up in process listings.
            tauri::async_runtime::spawn(async move {
                let (mut rx, _child) = handle.shell().sidecar("renamer-api")
                    .expect("failed to create sidecar")
                    .args(["--port", &port.to_string()])
                    .env("SORTIFY_API_TOKEN", token)
                    .spawn()
                    .expect("Failed to spawn sidecar");
            
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                             log::info!("[PY]: {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                             log::warn!("[PY]: {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Terminated(payload) => {
                             log::warn!("[PY]: backend exited with {:?}", payload.code);
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
