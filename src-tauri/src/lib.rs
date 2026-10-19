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
        .setup({
            let state = Arc::clone(&state);
            move |app| {
                runtime::start(app.handle(), Arc::clone(&state));
                Ok(())
            }
        })
        .build(tauri::generate_context!());
    match result {
        Ok(app) => app.run(move |_, event| {
            if let tauri::RunEvent::Exit = event {
                let _ = state.shutdown();
            }
        }),
        Err(error) => {
            eprintln!("Desktop window failed: {error}");
            let _ = state.shutdown();
            std::process::exit(1);
        }
    }
}
