// Tauri app entry. Registers the http plugin so the frontend can reach a local
// LLM (e.g. Ollama) without browser CORS restrictions; the request runs in Rust.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
