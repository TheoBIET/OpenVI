//! OpenVI desktop backend: Tauri commands the React frontend calls.

mod archive;
mod catalog;
mod export;
mod file;
mod fs;
mod index;
mod model;
mod resource;
mod scans;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(index::Indexing::default())
        .invoke_handler(tauri::generate_handler![
            fs::list_dir,
            archive::open_archive,
            index::index_game,
            index::search_index,
            index::index_status,
            resource::resource_info,
            resource::texture_preview,
            resource::resource_text_preview,
            resource::resource_image,
            file::file_preview,
            file::file_bytes,
            catalog::vehicle_list,
            catalog::save_export,
            model::model_preview,
            model::vehicle_preview,
            export::save_resource,
            export::save_texture,
            export::save_model
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenVI");
}
