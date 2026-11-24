//! OpenVI desktop backend: Tauri commands the React frontend calls.

mod animations;
mod archive;
mod catalog;
mod characters;
mod export;
mod file;
mod fs;
mod index;
mod model;
mod progress;
mod resource;
mod scans;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            model::model_materials,
            characters::characters,
            characters::character_part_list,
            characters::character_preview,
            animations::animation_dictionaries,
            animations::animation_clips,
            export::save_resource,
            export::save_texture,
            export::save_model
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenVI");
}
