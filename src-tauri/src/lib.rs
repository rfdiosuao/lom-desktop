mod documents;

pub fn run() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            documents::open_document,
            documents::save_document
        ])
        .run(tauri::generate_context!());
    if let Err(error) = result {
        eprintln!("Desktop window failed: {error}");
        std::process::exit(1);
    }
}
