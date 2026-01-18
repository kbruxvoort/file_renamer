use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use std::sync::{Arc, Mutex};
use tauri::{Manager, Emitter};

#[derive(Default)]
struct ApiState {
    port: Arc<Mutex<u16>>,
}

#[tauri::command]
fn get_api_port(state: tauri::State<ApiState>) -> u16 {
    *state.port.lock().unwrap()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(ApiState::default())
        .invoke_handler(tauri::generate_handler![get_api_port])
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
            
            // Store port in state
            let state = app.state::<ApiState>();
            *state.port.lock().unwrap() = port;

            let handle = app.handle().clone();
            
            // Spawn sidecar
            tauri::async_runtime::spawn(async move {
                let (mut rx, mut child) = handle.shell().sidecar("renamer-api")
                    .expect("failed to create sidecar")
                    .args(["--port", &port.to_string()])
                    .spawn()
                    .expect("Failed to spawn sidecar");
            
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                             // log::info!("[PY]: {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                             // log::warn!("[PY]: {}", String::from_utf8_lossy(&line));
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
