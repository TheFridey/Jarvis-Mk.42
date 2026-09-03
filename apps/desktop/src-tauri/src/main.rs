#[tauri::command]
fn monitor_ids(window: tauri::Window) -> Result<Vec<String>, String> {
    window.available_monitors().map_err(|error| error.to_string()).map(|monitors| monitors.into_iter().enumerate().map(|(index, monitor)| monitor.name().map(ToOwned::to_owned).unwrap_or_else(|| format!("monitor-{index}"))).collect())
}

fn main() { tauri::Builder::default().invoke_handler(tauri::generate_handler![monitor_ids]).run(tauri::generate_context!()).expect("JARVIS desktop runtime failed"); }
