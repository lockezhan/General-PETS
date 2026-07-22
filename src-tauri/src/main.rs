#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use image::{GenericImageView, ImageDecoder};

const MAIN_TRAY_ID: &str = "general-pets-main-tray";

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CodexPetManifest {
    pub id: String,
    pub display_name: String,
    pub description: Option<String>,
    pub spritesheet_path: String,
    pub sprite_version_number: u32,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CodexScanResult {
    pub source_path: String,
    pub status: String, // "valid", "invalid", "unsupported-version", "missing-spritesheet"
    pub manifest: Option<CodexPetManifest>,
    pub preview_url: Option<String>,
    pub preview_cache_path: Option<String>,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InstalledCharacter {
    pub id: String,
    pub source_type: String, // "codex-v1"
    pub source_pet_id: String,
    pub display_name: String,
    pub description: Option<String>,
    pub directory: String,
    pub preview_path: String,
    pub installed_at: String,
    pub absolute_path: String,
    pub sprite_version_number: u32,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InstalledIndex {
    pub schema_version: u32,
    pub characters: Vec<InstalledCharacter>,
}

fn create_main_tray(app: &tauri::App) -> tauri::Result<()> {
    if app.tray_by_id(MAIN_TRAY_ID).is_some() {
        println!(
            "[tray] duplicate creation prevented id={} pid={}",
            MAIN_TRAY_ID,
            std::process::id()
        );
        return Ok(());
    }

    println!(
        "[tray] create requested id={} pid={}",
        MAIN_TRAY_ID,
        std::process::id()
    );

    let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let show_i = MenuItem::with_id(app, "show", "显示桌宠", true, None::<&str>)?;
    let hide_i = MenuItem::with_id(app, "hide", "隐藏桌宠", true, None::<&str>)?;
    let settings_i = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let reset_i = MenuItem::with_id(app, "reset-position", "重置位置", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show_i, &hide_i, &settings_i, &reset_i, &quit_i])?;

    let _tray = TrayIconBuilder::with_id(MAIN_TRAY_ID)
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("General PETS")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            println!(
                "[tray] event id={} pid={}",
                event.id().as_ref(),
                std::process::id()
            );
            match event.id().as_ref() {
                "quit" => {
                    app.exit(0);
                }
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.emit("window-visibility-changed", true);
                    }
                }
                "hide" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                        let _ = window.emit("window-visibility-changed", false);
                    }
                }
                "settings" => {
                    let _ = app.emit("open-settings", ());
                }
                "reset-position" => {
                    let _ = app.emit("reset-position", ());
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } => {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn get_codex_home_path() -> std::path::PathBuf {
    if let Ok(val) = std::env::var("CODEX_HOME") {
        std::path::PathBuf::from(val).join("pets")
    } else if let Some(home) = dirs::home_dir() {
        home.join(".codex").join("pets")
    } else {
        std::path::PathBuf::from("")
    }
}

fn sanitize_pet_id(id: &str) -> String {
    let mut clean = String::new();
    for c in id.chars() {
        if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
            clean.push(c);
        } else {
            clean.push('-');
        }
    }
    if clean.is_empty() {
        clean = "pet".to_string();
    }
    clean
}

fn contains_code_injection(val: &str) -> bool {
    let lowercase = val.to_lowercase();
    lowercase.contains("javascript:")
        || lowercase.contains("script")
        || lowercase.contains("eval(")
        || lowercase.contains("function(")
        || lowercase.contains("require(")
}

fn validate_spritesheet_image_alpha(path: &std::path::Path) -> Result<(), String> {
    let img_reader = image::ImageReader::open(path)
        .map_err(|e| format!("Failed to open image file: {}", e))?;
    let color = img_reader.into_decoder()
        .map_err(|e| format!("Failed to create image decoder: {}", e))?
        .color_type();

    use image::ColorType;
    let has_alpha = match color {
        ColorType::La8 | ColorType::Rgba8 | ColorType::La16 | ColorType::Rgba16 | ColorType::Rgba32F => true,
        _ => false
    };

    if !has_alpha {
        return Err("Spritesheet must have an alpha (transparency) channel".to_string());
    }

    Ok(())
}

fn generate_codex_preview(
    spritesheet_path: &std::path::Path,
    _sprite_version: u32,
    output_path: &std::path::Path,
) -> Result<(), String> {
    let img = image::open(spritesheet_path)
        .map_err(|e| format!("Failed to open spritesheet image: {}", e))?;

    let frame_width = 192;
    let frame_height = 208;
    
    let max_cols = 6;
    let mut chosen_col = 0;
    let mut found_non_empty = false;

    let (sheet_w, _sheet_h) = img.dimensions();
    let max_available_cols = std::cmp::min(max_cols, (sheet_w / frame_width) as usize);

    for col in 0..max_available_cols {
        let x = (col * frame_width as usize) as u32;
        let y = 0;
        
        let cropped = image::imageops::crop_imm(&img, x, y, frame_width, frame_height).to_image();
        
        let mut non_transparent_pixels = 0;
        let total_pixels = frame_width * frame_height;
        
        for pixel in cropped.pixels() {
            if pixel[3] > 0 {
                non_transparent_pixels += 1;
            }
        }
        
        let coverage = (non_transparent_pixels as f64) / (total_pixels as f64);
        if coverage >= 0.01 {
            chosen_col = col;
            found_non_empty = true;
            break;
        }
    }

    if !found_non_empty {
        return Err("All idle frames are empty (less than 1% alpha coverage)".to_string());
    }

    let x = (chosen_col * frame_width as usize) as u32;
    let frame = image::imageops::crop_imm(&img, x, 0, frame_width, frame_height).to_image();
    let preview = image::imageops::resize(&frame, 128, 139, image::imageops::FilterType::Lanczos3);
    
    preview.save_with_format(output_path, image::ImageFormat::Png)
        .map_err(|e| format!("Failed to save preview image: {}", e))?;

    Ok(())
}

fn validate_single_pet(path: &std::path::Path) -> CodexScanResult {
    validate_single_pet_with_preview(None, path)
}

fn validate_single_pet_with_preview(app_opt: Option<&tauri::AppHandle>, path: &std::path::Path) -> CodexScanResult {
    let source_path = path.to_string_lossy().to_string();
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    let pet_json_path = path.join("pet.json");
    if !pet_json_path.exists() {
        errors.push("Missing pet.json".to_string());
        return CodexScanResult {
            source_path,
            status: "invalid".to_string(),
            manifest: None,
            preview_url: None,
            preview_cache_path: None,
            errors,
            warnings,
        };
    }

    if let Ok(metadata) = std::fs::metadata(&pet_json_path) {
        if metadata.len() > 256 * 1024 {
            errors.push("pet.json exceeds 256 KiB size limit".to_string());
        }
    }

    let json_content = match std::fs::read_to_string(&pet_json_path) {
        Ok(c) => c,
        Err(e) => {
            errors.push(format!("Failed to read pet.json: {}", e));
            return CodexScanResult {
                source_path,
                status: "invalid".to_string(),
                manifest: None,
                preview_url: None,
                preview_cache_path: None,
                errors,
                warnings,
            };
        }
    };

    let json_value: serde_json::Value = match serde_json::from_str(&json_content) {
        Ok(v) => v,
        Err(e) => {
            errors.push(format!("Failed to parse pet.json: {}", e));
            return CodexScanResult {
                source_path,
                status: "invalid".to_string(),
                manifest: None,
                preview_url: None,
                preview_cache_path: None,
                errors,
                warnings,
            };
        }
    };

    if !json_value.is_object() {
        errors.push("pet.json top-level must be an object".to_string());
    }

    if let Some(obj) = json_value.as_object() {
        for key in obj.keys() {
            if key == "__proto__" || key == "constructor" || key == "prototype" {
                errors.push("Security error: pet.json contains illegal prototype properties".to_string());
            }
        }
    }

    let id_opt = json_value.get("id").and_then(|v| v.as_str()).map(|s| s.to_string());
    let display_name_opt = json_value.get("displayName")
        .or_else(|| json_value.get("name"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let mut spritesheet_path_opt = json_value.get("spritesheetPath")
        .or_else(|| json_value.get("spritesheet"))
        .or_else(|| json_value.get("image"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let sprite_version_number_opt = json_value.get("spriteVersionNumber")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);

    let id = match id_opt {
        Some(val) => val,
        None => {
            let dir_name = path.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "unknown-pet".to_string());
            dir_name
        }
    };

    let display_name = display_name_opt.unwrap_or_else(|| id.clone());
    let description = json_value.get("description").and_then(|v| v.as_str()).map(|s| s.to_string());

    let sanitized_id = sanitize_pet_id(&id);
    if sanitized_id != id {
        warnings.push(format!("ID '{}' contained invalid characters, sanitized to '{}'", id, sanitized_id));
    }

    if spritesheet_path_opt.is_none() {
        let webp_file = path.join("spritesheet.webp");
        let png_file = path.join("spritesheet.png");
        if webp_file.exists() {
            spritesheet_path_opt = Some("spritesheet.webp".to_string());
        } else if png_file.exists() {
            spritesheet_path_opt = Some("spritesheet.png".to_string());
        }
    }

    let spritesheet_path_rel = match spritesheet_path_opt {
        Some(val) => val,
        None => {
            errors.push("Missing spritesheet.webp or spritesheet.png".to_string());
            return CodexScanResult {
                source_path,
                status: "missing-spritesheet".to_string(),
                manifest: None,
                preview_url: None,
                preview_cache_path: None,
                errors,
                warnings,
            };
        }
    };

    if spritesheet_path_rel.contains("..") || spritesheet_path_rel.contains('/') || spritesheet_path_rel.contains('\\') {
        let clean_name = std::path::Path::new(&spritesheet_path_rel)
            .file_name()
            .map(|s| s.to_string_lossy().to_string());
        if let Some(ref name) = clean_name {
            if name != &spritesheet_path_rel {
                errors.push("Security error: Path traversal detected in spritesheetPath".to_string());
                return CodexScanResult {
                    source_path,
                    status: "invalid".to_string(),
                    manifest: None,
                    preview_url: None,
                    preview_cache_path: None,
                    errors,
                    warnings,
                };
            }
        }
    }

    let spritesheet_path = path.join(&spritesheet_path_rel);
    if !spritesheet_path.exists() {
        errors.push(format!("Spritesheet file does not exist: {}", spritesheet_path_rel));
        return CodexScanResult {
            source_path,
            status: "missing-spritesheet".to_string(),
            manifest: None,
            preview_url: None,
            preview_cache_path: None,
            errors,
            warnings,
        };
    }

    if contains_code_injection(&id) || contains_code_injection(&display_name) || description.as_ref().map(|s| contains_code_injection(s)).unwrap_or(false) {
        errors.push("Security error: Malicious code injection detected in text fields".to_string());
    }

    let mut spritesheet_version = None;
    if let Ok(metadata) = std::fs::metadata(&spritesheet_path) {
        if metadata.len() > 30 * 1024 * 1024 {
            errors.push("Spritesheet file size exceeds 30 MiB limit".to_string());
        }
    }

    let is_webp = spritesheet_path_rel.ends_with(".webp");
    let is_png = spritesheet_path_rel.ends_with(".png");
    if !is_webp && !is_png {
        errors.push("Spritesheet file extension must be .webp or .png".to_string());
    }

    if errors.is_empty() {
        match image::image_dimensions(&spritesheet_path) {
            Ok(dims) => {
                if dims.0 == 1536 && dims.1 == 1872 {
                    spritesheet_version = Some(1);
                } else if dims.0 == 1536 && dims.1 == 2288 {
                    spritesheet_version = Some(2);
                } else {
                    errors.push(format!(
                        "Invalid spritesheet dimensions: {}x{} (must be 1536x1872 for V1 or 1536x2288 for V2)",
                        dims.0, dims.1
                    ));
                }
            }
            Err(e) => {
                errors.push(format!("Failed to read image dimensions: {}", e));
            }
        }
    }

    let final_sprite_version = match (sprite_version_number_opt, spritesheet_version) {
        (Some(manifest_ver), Some(img_ver)) => {
            if manifest_ver != img_ver {
                errors.push(format!(
                    "Version conflict: pet.json declared V{}, but spritesheet dimensions correspond to V{}",
                    manifest_ver, img_ver
                ));
            }
            manifest_ver
        }
        (None, Some(img_ver)) => {
            img_ver
        }
        (Some(manifest_ver), None) => {
            manifest_ver
        }
        (None, None) => {
            1
        }
    };

    if errors.is_empty() {
        match validate_spritesheet_image_alpha(&spritesheet_path) {
            Ok(_) => {}
            Err(e) => {
                errors.push(format!("Image validation failed: {}", e));
            }
        }
    }

    let status = if errors.is_empty() {
        "valid".to_string()
    } else {
        "invalid".to_string()
    };

    let preview_url = Some(spritesheet_path.to_string_lossy().to_string());
    let mut preview_cache_path = None;

    let manifest_opt = if status == "valid" {
        Some(CodexPetManifest {
            id: sanitized_id,
            display_name,
            description,
            spritesheet_path: spritesheet_path_rel,
            sprite_version_number: final_sprite_version,
        })
    } else {
        None
    };

    if status == "valid" {
        if let Some(app) = app_opt {
            if let Some(ref m) = manifest_opt {
                if let Ok(cache_dir) = app.path().app_cache_dir() {
                    let preview_cache_dir = cache_dir.join("general-pets-previews");
                    let _ = std::fs::create_dir_all(&preview_cache_dir);
                    
                    use std::collections::hash_map::DefaultHasher;
                    use std::hash::{Hash, Hasher};
                    let mut hasher = DefaultHasher::new();
                    path.to_string_lossy().hash(&mut hasher);
                    let hash_val = hasher.finish();
                    let filename = format!("{:x}.png", hash_val);
                    let dest_preview_path = preview_cache_dir.join(&filename);
                    
                    match generate_codex_preview(&spritesheet_path, m.sprite_version_number, &dest_preview_path) {
                        Ok(_) => {
                            preview_cache_path = Some(dest_preview_path.to_string_lossy().to_string());
                        }
                        Err(e) => {
                            warnings.push(format!("Failed to generate scan preview: {}", e));
                        }
                    }
                }
            }
        }
    }

    CodexScanResult {
        source_path,
        status,
        manifest: manifest_opt,
        preview_url,
        preview_cache_path,
        errors,
        warnings,
    }
}

fn scan_folder_for_pets(app: &tauri::AppHandle, pets_dir: &std::path::Path) -> Vec<CodexScanResult> {
    let mut results = Vec::new();
    if !pets_dir.exists() || !pets_dir.is_dir() {
        return results;
    }
    if let Ok(entries) = std::fs::read_dir(pets_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let pet_json_path = path.join("pet.json");
                if pet_json_path.exists() {
                    let result = validate_single_pet_with_preview(Some(app), &path);
                    results.push(result);
                }
            }
        }
    }
    results
}

fn load_installed_index(path: &std::path::Path) -> Result<InstalledIndex, String> {
    if !path.exists() {
        return Ok(InstalledIndex {
            schema_version: 1,
            characters: Vec::new(),
        });
    }
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read index file: {}", e))?;
    let index: InstalledIndex = serde_json::from_str(&content)
        .unwrap_or_else(|_| InstalledIndex {
            schema_version: 1,
            characters: Vec::new(),
        });
    Ok(index)
}

fn save_installed_index(path: &std::path::Path, index: &InstalledIndex) -> Result<(), String> {
    let content = serde_json::to_string_pretty(index)
        .map_err(|e| format!("Failed to serialize index: {}", e))?;
    std::fs::write(path, content)
        .map_err(|e| format!("Failed to write index file: {}", e))?;
    Ok(())
}

#[tauri::command]
fn scan_codex_pets(app: tauri::AppHandle) -> Result<Vec<CodexScanResult>, String> {
    let pets_dir = get_codex_home_path();
    println!("[codex-scan] CODEX_HOME/pets path: {:?}", pets_dir);
    // Clear old cache before scanning
    if let Ok(cache_dir) = app.path().app_cache_dir() {
        let preview_cache_dir = cache_dir.join("general-pets-previews");
        if preview_cache_dir.exists() {
            let _ = std::fs::remove_dir_all(&preview_cache_dir);
        }
    }
    Ok(scan_folder_for_pets(&app, &pets_dir))
}

#[tauri::command]
fn select_codex_directory() -> Result<Option<String>, String> {
    let folder = rfd::FileDialog::new()
        .set_title("选择 Codex 角色文件夹或 pets 目录")
        .pick_folder();
    
    Ok(folder.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
fn scan_directory(app: tauri::AppHandle, path: String) -> Result<Vec<CodexScanResult>, String> {
    let pets_dir = std::path::Path::new(&path);
    // Clear old cache before scanning
    if let Ok(cache_dir) = app.path().app_cache_dir() {
        let preview_cache_dir = cache_dir.join("general-pets-previews");
        if preview_cache_dir.exists() {
            let _ = std::fs::remove_dir_all(&preview_cache_dir);
        }
    }
    if pets_dir.join("pet.json").exists() {
        Ok(vec![validate_single_pet_with_preview(Some(&app), pets_dir)])
    } else {
        Ok(scan_folder_for_pets(&app, pets_dir))
    }
}

#[tauri::command]
fn install_codex_pet(app: tauri::AppHandle, source_path_str: String) -> Result<String, String> {
    println!("[codex-install] starting install from source={}", source_path_str);
    let source_path = std::path::Path::new(&source_path_str)
        .canonicalize()
        .map_err(|e| format!("Failed to resolve source path: {}", e))?;

    let scan_res = validate_single_pet_with_preview(Some(&app), &source_path);
    if scan_res.status != "valid" {
        return Err(format!("Validation failed: {}", scan_res.errors.join("; ")));
    }

    let manifest = scan_res.manifest.ok_or("No manifest parsed")?;
    
    if manifest.id == "default" {
        return Err("Cannot overwrite the built-in 'default' character".to_string());
    }

    let app_local_data = app.path().app_local_data_dir()
        .map_err(|e| format!("Failed to resolve AppLocalData: {}", e))?;

    let characters_dir = app_local_data.join("characters");
    let temp_dir = characters_dir.join("temp");

    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to clear temp directory: {}", e))?;
    }
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    // Copy pet.json
    let source_json = source_path.join("pet.json");
    let target_json = temp_dir.join("pet.json");
    std::fs::copy(&source_json, &target_json)
        .map_err(|e| format!("Failed to copy pet.json: {}", e))?;

    // Copy spritesheet
    let source_spritesheet = source_path.join(&manifest.spritesheet_path);
    if !source_spritesheet.starts_with(&source_path) {
        return Err("Path traversal attempt blocked".to_string());
    }
    let target_spritesheet = temp_dir.join(&manifest.spritesheet_path);
    std::fs::copy(&source_spritesheet, &target_spritesheet)
        .map_err(|e| format!("Failed to copy spritesheet: {}", e))?;

    // Generate preview thumbnail
    let target_preview = temp_dir.join("preview.png");
    generate_codex_preview(&target_spritesheet, manifest.sprite_version_number, &target_preview)
        .map_err(|e| format!("Failed to generate preview thumbnail: {}", e))?;

    // Generate general-pets.adapter.json
    let adapter_json = serde_json::json!({
        "schemaVersion": 1,
        "sourceType": "codex-v1",
        "sourcePetId": manifest.id,
        "spriteVersionNumber": manifest.sprite_version_number,
        "render": {
            "frameWidth": 192,
            "frameHeight": 208,
            "defaultScale": 1
        },
        "animationMapping": {
            "idle": "idle",
            "walkLeft": "running-left",
            "walkRight": "running-right",
            "happy": "waving",
            "angry": "failed",
            "sleep": "waiting",
            "sit": "waiting",
            "wake": "waving",
            "falling": "jumping",
            "landing": "jumping",
            "dragged": "jumping",
            "shy": "review",
            "surprised": "review"
        },
        "interactionMode": "whole-sprite-default"
    });
    let adapter_path = temp_dir.join("general-pets.adapter.json");
    let adapter_str = serde_json::to_string_pretty(&adapter_json)
        .map_err(|e| format!("Failed to serialize adapter: {}", e))?;
    std::fs::write(&adapter_path, adapter_str)
        .map_err(|e| format!("Failed to write adapter config: {}", e))?;

    let target_pet_dir = characters_dir.join(format!("codex-{}", manifest.id));
    if target_pet_dir.exists() {
        std::fs::remove_dir_all(&target_pet_dir)
            .map_err(|e| format!("Failed to clean existing installation: {}", e))?;
    }

    std::fs::rename(&temp_dir, &target_pet_dir)
        .map_err(|e| format!("Failed to finalize installation directory move: {}", e))?;

    let index_path = characters_dir.join("installed-index.json");
    let mut index = load_installed_index(&index_path)?;
    
    let target_id = format!("codex-{}", manifest.id);
    index.characters.retain(|c| c.id != target_id);

    let installed_character = InstalledCharacter {
        id: target_id.clone(),
        source_type: "codex-v1".to_string(),
        source_pet_id: manifest.id.clone(),
        display_name: manifest.display_name,
        description: manifest.description,
        directory: format!("codex-{}", manifest.id),
        preview_path: "preview.png".to_string(),
        installed_at: chrono::Local::now().to_rfc3339(),
        absolute_path: target_pet_dir.to_string_lossy().to_string(),
        sprite_version_number: manifest.sprite_version_number,
    };
    index.characters.push(installed_character);

    save_installed_index(&index_path, &index)?;

    Ok(target_id)
}

#[tauri::command]
fn load_installed_character_configs(app: tauri::AppHandle, id: String) -> Result<serde_json::Value, String> {
    let app_local_data = app.path().app_local_data_dir()
        .map_err(|e| format!("Failed to resolve AppLocalData: {}", e))?;
    let characters_dir = app_local_data.join("characters");
    let index_path = characters_dir.join("installed-index.json");
    let index = load_installed_index(&index_path)?;
    
    if let Some(char_info) = index.characters.iter().find(|c| c.id == id) {
        let char_dir = characters_dir.join(&char_info.directory);
        
        let pet_json_path = char_dir.join("pet.json");
        let pet_json: serde_json::Value = if pet_json_path.exists() {
            let content = std::fs::read_to_string(&pet_json_path)
                .map_err(|e| format!("Failed to read pet.json: {}", e))?;
            serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse pet.json: {}", e))?
        } else {
            serde_json::json!({})
        };
        
        let adapter_json_path = char_dir.join("general-pets.adapter.json");
        let adapter_json: serde_json::Value = if adapter_json_path.exists() {
            let content = std::fs::read_to_string(&adapter_json_path)
                .map_err(|e| format!("Failed to read adapter config: {}", e))?;
            serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse adapter config: {}", e))?
        } else {
            serde_json::json!({})
        };
        
        let dialogues_json_path = char_dir.join("dialogues.json");
        let dialogues_json: serde_json::Value = if dialogues_json_path.exists() {
            let content = std::fs::read_to_string(&dialogues_json_path)
                .unwrap_or_else(|_| String::new());
            serde_json::from_str(&content)
                .unwrap_or(serde_json::json!(null))
        } else {
            serde_json::json!(null)
        };
        
        let interactions_json_path = char_dir.join("interactions.json");
        let interactions_json: serde_json::Value = if interactions_json_path.exists() {
            let content = std::fs::read_to_string(&interactions_json_path)
                .unwrap_or_else(|_| String::new());
            serde_json::from_str(&content)
                .unwrap_or(serde_json::json!(null))
        } else {
            serde_json::json!(null)
        };

        let extras_json_path = char_dir.join("general-pets-extras.json");
        let extras_json: serde_json::Value = if extras_json_path.exists() {
            let content = std::fs::read_to_string(&extras_json_path)
                .map_err(|e| format!("Failed to read extras config: {}", e))?;
            serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse extras config: {}", e))?
        } else {
            serde_json::json!(null)
        };
        
        Ok(serde_json::json!({
            "pet": pet_json,
            "adapter": adapter_json,
            "dialogues": dialogues_json,
            "interactions": interactions_json,
            "extras": extras_json
        }))
    } else {
        Err(format!("Character '{}' not found in index", id))
    }
}

#[tauri::command]
fn repair_missing_character_previews(app: tauri::AppHandle) -> Result<(), String> {
    let app_local_data = app.path().app_local_data_dir()
        .map_err(|e| format!("Failed to resolve AppLocalData: {}", e))?;
    let characters_dir = app_local_data.join("characters");
    let index_path = characters_dir.join("installed-index.json");
    
    if !index_path.exists() {
        return Ok(());
    }

    let mut index = load_installed_index(&index_path)?;
    let mut modified = false;

    for char in &mut index.characters {
        let char_dir = std::path::Path::new(&char.absolute_path);
        if !char_dir.exists() {
            continue;
        }

        let preview_path = char_dir.join("preview.png");
        let needs_generation = char.preview_path.is_empty() || !preview_path.exists();
        if needs_generation {
            let pet_json_path = char_dir.join("pet.json");
            let mut spritesheet_rel = "spritesheet.webp".to_string();
            
            if pet_json_path.exists() {
                if let Ok(content) = std::fs::read_to_string(&pet_json_path) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                        if let Some(path_str) = json.get("spritesheetPath").or_else(|| json.get("spritesheet")).and_then(|v| v.as_str()) {
                            spritesheet_rel = path_str.to_string();
                        }
                    }
                }
            }

            let spritesheet_path = char_dir.join(&spritesheet_rel);
            if spritesheet_path.exists() {
                println!("[codex-repair] Generating missing preview for character: {}", char.id);
                match generate_codex_preview(&spritesheet_path, char.sprite_version_number, &preview_path) {
                    Ok(_) => {
                        char.preview_path = "preview.png".to_string();
                        modified = true;
                    }
                    Err(e) => {
                        eprintln!("[codex-repair] Failed to generate preview for {}: {}", char.id, e);
                    }
                }
            }
        }
    }

    if modified {
        save_installed_index(&index_path, &index)?;
    }

    Ok(())
}

fn repair_installed_codex_adapters_impl(app: &tauri::AppHandle) -> Result<(), String> {
    let app_local_data = app.path().app_local_data_dir()
        .map_err(|e| format!("Failed to resolve AppLocalData: {}", e))?;
    let characters_dir = app_local_data.join("characters");
    let index_path = characters_dir.join("installed-index.json");
    
    if !index_path.exists() {
        return Ok(());
    }

    let index = load_installed_index(&index_path)?;
    for char in &index.characters {
        let char_dir = std::path::Path::new(&char.absolute_path);
        if !char_dir.exists() {
            continue;
        }

        let adapter_json_path = char_dir.join("general-pets.adapter.json");
        if adapter_json_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&adapter_json_path) {
                if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) {
                    let mut modified = false;
                    
                    if let Some(mapping) = json.get_mut("animationMapping").and_then(|m| m.as_object_mut()) {
                        let standard_left = "running-left";
                        let standard_right = "running-right";

                        let current_left = mapping.get("walkLeft").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let current_right = mapping.get("walkRight").and_then(|v| v.as_str()).unwrap_or("").to_string();

                        if current_left != standard_left {
                            mapping.insert("walkLeft".to_string(), serde_json::Value::String(standard_left.to_string()));
                            modified = true;
                        }
                        if current_right != standard_right {
                            mapping.insert("walkRight".to_string(), serde_json::Value::String(standard_right.to_string()));
                            modified = true;
                        }
                    }

                    if modified {
                        println!("[codex-repair] Correcting walkLeft/walkRight mapping for: {}", char.id);
                        if let Ok(new_content) = serde_json::to_string_pretty(&json) {
                            let _ = std::fs::write(&adapter_json_path, new_content);
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
fn repair_installed_codex_adapters(app: tauri::AppHandle) -> Result<(), String> {
    repair_installed_codex_adapters_impl(&app)
}

#[tauri::command]
fn list_installed_characters(app: tauri::AppHandle) -> Result<Vec<InstalledCharacter>, String> {
    let _ = repair_missing_character_previews(app.clone());
    let _ = repair_installed_codex_adapters_impl(&app);

    let app_local_data = app.path().app_local_data_dir()
        .map_err(|e| format!("Failed to resolve AppLocalData: {}", e))?;
    let characters_dir = app_local_data.join("characters");
    let index_path = characters_dir.join("installed-index.json");

    let mut index = load_installed_index(&index_path).unwrap_or(InstalledIndex {
        schema_version: 1,
        characters: Vec::new(),
    });

    let mut reconstructed = false;
    let mut active_directories = std::collections::HashSet::new();

    if characters_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&characters_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() && path.file_name() != Some(std::ffi::OsStr::new("temp")) {
                    let dir_name = path.file_name().unwrap().to_string_lossy().to_string();
                    active_directories.insert(dir_name.clone());

                    let in_index = index.characters.iter().any(|c| c.directory == dir_name);
                    if !in_index {
                        let pet_json = path.join("pet.json");
                        if pet_json.exists() {
                            if let Ok(content) = std::fs::read_to_string(&pet_json) {
                                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                                    let id = json.get("id").and_then(|v| v.as_str()).map(|s| s.to_string())
                                        .unwrap_or_else(|| dir_name.replace("codex-", ""));
                                    let display_name = json.get("displayName")
                                        .or_else(|| json.get("name"))
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string())
                                        .unwrap_or_else(|| id.clone());
                                    let description = json.get("description").and_then(|v| v.as_str()).map(|s| s.to_string());
                                    
                                    let mut sprite_version_number = 1;
                                    let adapter_json_path = path.join("general-pets.adapter.json");
                                    if adapter_json_path.exists() {
                                        if let Ok(adapter_content) = std::fs::read_to_string(&adapter_json_path) {
                                            if let Ok(adapter_val) = serde_json::from_str::<serde_json::Value>(&adapter_content) {
                                                sprite_version_number = adapter_val.get("spriteVersionNumber")
                                                    .and_then(|v| v.as_u64())
                                                    .unwrap_or(1) as u32;
                                            }
                                        }
                                    }

                                    index.characters.push(InstalledCharacter {
                                        id: format!("codex-{}", id),
                                        source_type: "codex-v1".to_string(),
                                        source_pet_id: id,
                                        display_name,
                                        description,
                                        directory: dir_name.clone(),
                                        preview_path: "preview.png".to_string(),
                                        installed_at: chrono::Local::now().to_rfc3339(),
                                        absolute_path: path.to_string_lossy().to_string(),
                                        sprite_version_number,
                                    });
                                    reconstructed = true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let original_len = index.characters.len();
    index.characters.retain(|c| active_directories.contains(&c.directory));
    if index.characters.len() != original_len {
        reconstructed = true;
    }

    if reconstructed {
        let _ = save_installed_index(&index_path, &index);
    }

    Ok(index.characters)
}

#[tauri::command]
fn delete_installed_character(app: tauri::AppHandle, id: String) -> Result<(), String> {
    println!("[codex-delete] delete requested id={}", id);
    if id == "default" {
        return Err("Cannot delete the default character".to_string());
    }

    let app_local_data = app.path().app_local_data_dir()
        .map_err(|e| format!("Failed to resolve AppLocalData: {}", e))?;
    let characters_dir = app_local_data.join("characters");
    
    let index_path = characters_dir.join("installed-index.json");
    let mut index = load_installed_index(&index_path)?;
    
    if let Some(pos) = index.characters.iter().position(|c| c.id == id) {
        let char_dir_name = index.characters[pos].directory.clone();
        
        let char_dir = characters_dir.join(&char_dir_name);
        if char_dir.exists() {
            if char_dir.parent() == Some(&characters_dir) {
                std::fs::remove_dir_all(&char_dir)
                    .map_err(|e| format!("Failed to delete character files: {}", e))?;
            } else {
                return Err("Path traversal safety check failed during deletion".to_string());
            }
        }
        
        index.characters.remove(pos);
        save_installed_index(&index_path, &index)?;
        println!("[codex-delete] deletion successful id={}", id);
    } else {
        return Err(format!("Character '{}' not found in index", id));
    }

    Ok(())
}

#[tauri::command]
fn open_installed_character_directory(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let app_local_data = app.path().app_local_data_dir()
        .map_err(|e| format!("Failed to resolve AppLocalData: {}", e))?;
    let characters_dir = app_local_data.join("characters");
    
    let path = if id == "default" {
        characters_dir
    } else {
        let index_path = characters_dir.join("installed-index.json");
        let index = load_installed_index(&index_path)?;
        if let Some(c) = index.characters.iter().find(|c| c.id == id) {
            characters_dir.join(&c.directory)
        } else {
            return Err("Character not found".to_string());
        }
    };

    if path.exists() {
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("explorer")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("Failed to open directory: {}", e))?;
        }
    }

    Ok(())
}

#[tauri::command]
fn export_codex_direction_probe(app: tauri::AppHandle, character_id: String) -> Result<serde_json::Value, String> {
    let app_local_data = app.path().app_local_data_dir()
        .map_err(|e| format!("Failed to resolve AppLocalData: {}", e))?;
    let characters_dir = app_local_data.join("characters");
    let index_path = characters_dir.join("installed-index.json");
    
    let index = load_installed_index(&index_path)?;
    let char_info = index.characters.iter().find(|c| c.id == character_id)
        .ok_or_else(|| format!("Character '{}' not found", character_id))?;
        
    let char_dir = characters_dir.join(&char_info.directory);
    
    let pet_json_path = char_dir.join("pet.json");
    let mut spritesheet_rel = "spritesheet.webp".to_string();
    if pet_json_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&pet_json_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(path_str) = json.get("spritesheetPath").or_else(|| json.get("spritesheet")).and_then(|v| v.as_str()) {
                    spritesheet_rel = path_str.to_string();
                }
            }
        }
    }
    
    let spritesheet_path = char_dir.join(&spritesheet_rel);
    if !spritesheet_path.exists() {
        return Err(format!("Spritesheet path does not exist: {:?}", spritesheet_path));
    }
    
    let img = image::open(&spritesheet_path)
        .map_err(|e| format!("Failed to open spritesheet image: {}", e))?;
        
    let cache_dir = app.path().app_cache_dir()
        .map_err(|e| format!("Failed to resolve AppCache: {}", e))?;
    
    let right_probe_path = cache_dir.join(format!("{}_running_right_probe.png", character_id));
    let left_probe_path = cache_dir.join(format!("{}_running_left_probe.png", character_id));
    
    let frame_width = 192;
    let frame_height = 208;
    
    // Row 1 (running-right) Col 0
    let right_frame = image::imageops::crop_imm(&img, 0, frame_height, frame_width, frame_height).to_image();
    right_frame.save(&right_probe_path)
        .map_err(|e| format!("Failed to save right probe: {}", e))?;
        
    // Row 2 (running-left) Col 0
    let left_frame = image::imageops::crop_imm(&img, 0, frame_height * 2, frame_width, frame_height).to_image();
    left_frame.save(&left_probe_path)
        .map_err(|e| format!("Failed to save left probe: {}", e))?;
        
    println!("[codex-probe] Exported direction probes for character '{}':\n  Right: {:?}\n  Left: {:?}", character_id, right_probe_path, left_probe_path);
    
    Ok(serde_json::json!({
        "rightProbePath": right_probe_path.to_string_lossy().to_string(),
        "leftProbePath": left_probe_path.to_string_lossy().to_string()
    }))
}

#[tauri::command]
fn export_codex_animation_contact_sheet(
    app: tauri::AppHandle,
    character_id: String,
    animation_name: String
) -> Result<serde_json::Value, String> {
    let app_local_data = app.path().app_local_data_dir()
        .map_err(|e| format!("Failed to resolve AppLocalData: {}", e))?;
    let characters_dir = app_local_data.join("characters");
    let index_path = characters_dir.join("installed-index.json");
    
    let index = load_installed_index(&index_path)?;
    let char_info = index.characters.iter().find(|c| c.id == character_id)
        .ok_or_else(|| format!("Character '{}' not found", character_id))?;
        
    let char_dir = characters_dir.join(&char_info.directory);
    
    let pet_json_path = char_dir.join("pet.json");
    let mut spritesheet_rel = "spritesheet.webp".to_string();
    if pet_json_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&pet_json_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(path_str) = json.get("spritesheetPath").or_else(|| json.get("spritesheet")).and_then(|v| v.as_str()) {
                    spritesheet_rel = path_str.to_string();
                }
            }
        }
    }
    
    let spritesheet_path = char_dir.join(&spritesheet_rel);
    if !spritesheet_path.exists() {
        return Err(format!("Spritesheet path does not exist: {:?}", spritesheet_path));
    }
    
    let img = image::open(&spritesheet_path)
        .map_err(|e| format!("Failed to open spritesheet image: {}", e))?;

    let (row, frame_count) = match animation_name.as_str() {
        "idle" => (0, 6),
        "running-right" => (1, 8),
        "running-left" => (2, 8),
        "running" => (7, 6),
        "look-row-9" => (9, 8),
        "look-row-10" => (10, 8),
        _ => return Err(format!("Unsupported animation name for contact sheet: {}", animation_name)),
    };

    let frame_width: u32 = 192;
    let frame_height: u32 = 208;
    let header_height: u32 = 24;

    if img.width() < frame_width * frame_count || img.height() < frame_height * (row + 1) {
        return Err(format!(
            "Spritesheet is too small for animation '{}': {}x{}",
            animation_name,
            img.width(),
            img.height()
        ));
    }

    let canvas_width = frame_width * frame_count;
    let canvas_height = frame_height + header_height;

    let mut contact_sheet = image::RgbaImage::new(canvas_width, canvas_height);

    // Fill background with light gray for header & boundary check
    for x in 0..canvas_width {
        for y in 0..canvas_height {
            contact_sheet.put_pixel(x, y, image::Rgba([240, 240, 245, 255]));
        }
    }

    for col in 0..frame_count {
        let source_x = col * frame_width;
        let source_y = row * frame_height;

        let frame = image::imageops::crop_imm(&img, source_x, source_y, frame_width, frame_height).to_image();

        let dest_x = col * frame_width;
        let dest_y = header_height;

        image::imageops::overlay(&mut contact_sheet, &frame, dest_x as i64, dest_y as i64);

        // Draw vertical separating grid lines
        if col > 0 {
            for y in 0..canvas_height {
                contact_sheet.put_pixel(dest_x, y, image::Rgba([200, 50, 50, 255]));
            }
        }
    }

    let cache_dir = app.path().app_cache_dir()
        .map_err(|e| format!("Failed to resolve AppCache: {}", e))?;
    
    let out_filename = format!("{}-contact-sheet.png", animation_name);
    let out_path = cache_dir.join(&out_filename);

    contact_sheet.save(&out_path)
        .map_err(|e| format!("Failed to save contact sheet: {}", e))?;

    let preview_path = if animation_name == "idle" {
        use image::codecs::gif::{GifEncoder, Repeat};
        use image::{Delay, Frame};
        let path = cache_dir.join("idle-preview.gif");
        let file = std::fs::File::create(&path)
            .map_err(|e| format!("Failed to create idle preview: {}", e))?;
        let mut encoder = GifEncoder::new(file);
        encoder.set_repeat(Repeat::Infinite)
            .map_err(|e| format!("Failed to configure idle preview: {}", e))?;
        let frames = (0..frame_count).map(|col| {
            let frame = image::imageops::crop_imm(
                &img,
                col * frame_width,
                row * frame_height,
                frame_width,
                frame_height,
            ).to_image();
            Frame::from_parts(frame, 0, 0, Delay::from_numer_denom_ms(550, 1))
        });
        encoder.encode_frames(frames)
            .map_err(|e| format!("Failed to encode idle preview: {}", e))?;
        Some(path)
    } else {
        None
    };

    println!("[codex-probe] Exported contact sheet '{}' for character '{}' -> {:?}", animation_name, character_id, out_path);

    Ok(serde_json::json!({
        "characterId": character_id,
        "animationName": animation_name,
        "contactSheetPath": out_path.to_string_lossy().to_string(),
        "row": row,
        "frameCount": frame_count,
        "frameWidth": frame_width,
        "frameHeight": frame_height,
        "previewPath": preview_path.map(|path| path.to_string_lossy().to_string())
    }))
}

fn main() {
    println!(
        "[startup] pid={} exe={:?}",
        std::process::id(),
        std::env::current_exe()
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            println!(
                "[single-instance] blocked duplicate launch pid={}",
                std::process::id()
            );
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            scan_codex_pets,
            select_codex_directory,
            scan_directory,
            install_codex_pet,
            list_installed_characters,
            delete_installed_character,
            open_installed_character_directory,
            repair_missing_character_previews,
            load_installed_character_configs,
            repair_installed_codex_adapters,
            export_codex_direction_probe,
            export_codex_animation_contact_sheet
        ])
        .setup(|app| {
            create_main_tray(app)?;
            // Clean scan previews cache on startup
            if let Ok(cache_dir) = app.path().app_cache_dir() {
                let preview_cache_dir = cache_dir.join("general-pets-previews");
                if preview_cache_dir.exists() {
                    let _ = std::fs::remove_dir_all(&preview_cache_dir);
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                window.hide().unwrap();
                let _ = window.emit("window-visibility-changed", false);
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
