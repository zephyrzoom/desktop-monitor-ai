use std::fs;
use std::path::PathBuf;

use chrono::Local;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ExtendedColorType, RgbaImage};

use crate::logger;
use crate::runtime::Runtime;

/// 截图最长边限制，与旧版 desktopCapturer thumbnailSize 1280x720 对齐
const MAX_WIDTH: u32 = 1280;
const MAX_HEIGHT: u32 = 720;
const JPEG_QUALITY: u8 = 80;

/// 抓取主显示器画面并落库，返回截图记录 id。
pub fn capture(rt: &Runtime, trigger: &str) -> Option<i64> {
    let monitors = match xcap::Monitor::all() {
        Ok(list) if !list.is_empty() => list,
        Ok(_) => {
            logger::warn("截图失败：未检测到显示器");
            return None;
        }
        Err(err) => {
            logger::warn(format!(
                "截图失败：无法枚举显示器（{err}），请检查屏幕录制权限"
            ));
            return None;
        }
    };

    let index = monitors
        .iter()
        .position(|m| m.is_primary().unwrap_or(false))
        .unwrap_or(0);
    let monitor = &monitors[index];

    let image = match monitor.capture_image() {
        Ok(img) => img,
        Err(err) => {
            logger::warn(format!("截图失败：{err}"));
            return None;
        }
    };

    let thumb = downscale(&image);
    let buffer = encode_jpeg(&thumb)?;

    let dir = rt.screenshots_dir();
    let now_local = Local::now();
    // 目录名按本地日期归档，与数据库 `date(timestamp, 'localtime')` 的口径保持一致；
    // 文件名沿用本地时分秒（历史数据也是本地时间）。
    let date_dir = dir.join(now_local.format("%Y-%m-%d").to_string());
    if let Err(err) = fs::create_dir_all(&date_dir) {
        logger::error(format!("创建截图目录失败：{err}"));
        return None;
    }

    let file_name = format!("{}_{}.jpg", now_local.format("%H-%M-%S"), trigger);
    let file_path = date_dir.join(&file_name);
    if let Err(err) = fs::write(&file_path, &buffer) {
        logger::error(format!("写入截图失败：{err}"));
        return None;
    }

    let relative = file_path
        .strip_prefix(&dir)
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(&file_name));
    let relative = relative.to_string_lossy().replace('\\', "/");

    match rt.db.insert_screenshot(
        &relative,
        buffer.len() as i64,
        thumb.width() as i64,
        thumb.height() as i64,
        trigger,
    ) {
        Ok(id) => Some(id),
        Err(err) => {
            logger::error(format!("写入截图记录失败：{err}"));
            None
        }
    }
}

fn downscale(image: &RgbaImage) -> RgbaImage {
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 {
        return image.clone();
    }

    let scale = (MAX_WIDTH as f32 / width as f32).min(MAX_HEIGHT as f32 / height as f32);
    if scale >= 1.0 {
        return image.clone();
    }

    let target_width = ((width as f32 * scale).round() as u32).max(1);
    let target_height = ((height as f32 * scale).round() as u32).max(1);
    image::imageops::resize(image, target_width, target_height, FilterType::Triangle)
}

fn encode_jpeg(image: &RgbaImage) -> Option<Vec<u8>> {
    let rgb = DynamicImage::ImageRgba8(image.clone()).into_rgb8();
    let mut buffer = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut buffer, JPEG_QUALITY);
    match encoder.encode(
        rgb.as_raw(),
        rgb.width(),
        rgb.height(),
        ExtendedColorType::Rgb8,
    ) {
        Ok(()) => Some(buffer),
        Err(err) => {
            logger::error(format!("截图编码失败：{err}"));
            None
        }
    }
}

/// 按保留天数清理过期截图、窗口记录与任务记忆。
pub fn cleanup(rt: &Runtime) {
    let retention_days = rt.config.cleanup().retention_days.max(1);
    let cutoff = (Local::now() - chrono::Duration::days(retention_days))
        .format("%Y-%m-%d")
        .to_string();

    let dir = rt.screenshots_dir();

    match rt.db.screenshots_before_date(&cutoff) {
        Ok(expired) => {
            for shot in expired {
                let file = dir.join(&shot.file_path);
                if file.exists() {
                    let _ = fs::remove_file(file);
                }
            }
        }
        Err(err) => logger::error(format!("查询过期截图失败：{err}")),
    }

    match rt.db.delete_screenshots_before_date(&cutoff) {
        Ok(0) => {}
        Ok(count) => logger::info(format!("清理过期截图 {count} 条（早于 {cutoff}）")),
        Err(err) => logger::error(format!("清理过期截图失败：{err}")),
    }

    match rt.db.delete_active_windows_before_date(&cutoff) {
        Ok(0) => {}
        Ok(count) => logger::info(format!("清理过期窗口记录 {count} 条（早于 {cutoff}）")),
        Err(err) => logger::error(format!("清理过期窗口记录失败：{err}")),
    }

    match rt.db.delete_task_memories_before_date(&cutoff) {
        Ok(0) => {}
        Ok(count) => logger::info(format!("清理过期任务记忆 {count} 条（早于 {cutoff}）")),
        Err(err) => logger::error(format!("清理过期任务记忆失败：{err}")),
    }

    // 删除过期的空日期目录。
    // 目录名按 UTC 日期命名，而 cutoff 是本地日期，本地 00:00-08:00 时前者会比后者早一天，
    // 因此只删除已经清空的目录，避免误删仍有未过期截图的目录。
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() && name < cutoff {
                let _ = fs::remove_dir(path);
            }
        }
    }
}
