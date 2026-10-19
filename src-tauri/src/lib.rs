mod documents;
mod runtime;
mod sidecar;
use std::sync::Arc;

pub fn run() {
    let state = Arc::new(runtime::Runtime::default());
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::clone(&state))
        .invoke_handler(tauri::generate_handler![
            documents::open_document,
            documents::save_document,
            runtime::core_endpoint
        ])
        .setup(move |app| {
            runtime::start(app.handle(), Arc::clone(&state));
            Ok(())
        })
        .run(tauri::generate_context!());
    if let Err(error) = result {
        eprintln!("Desktop window failed: {error}");
        std::process::exit(1);
    }
}
