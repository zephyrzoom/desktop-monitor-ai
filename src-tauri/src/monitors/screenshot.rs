use std::fs;
use std::path::PathBuf;

use active_win_pos_rs::WindowPosition;
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

/// 抓取活动窗口所在显示器画面并落库，返回截图记录 id。
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

    let monitor = target_monitor(&monitors);

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

/// 选出本次要截图的显示器：优先活动窗口所在的那块屏，取不到时回退主显示器。
///
/// 多屏场景下固定截主屏会丢掉副屏上的工作画面，因此这里按窗口中心点命中屏幕。
/// `xcap` 的 `from_point` 与 `kCGWindowBounds` / `GetWindowRect` 使用同一套全局坐标，
/// 可直接拿窗口中心的坐标点做命中判断。
fn target_monitor(monitors: &[xcap::Monitor]) -> xcap::Monitor {
    if let Some((x, y)) = active_window_center() {
        match xcap::Monitor::from_point(x, y) {
            Ok(monitor) => return monitor,
            Err(err) => logger::info(format!("按窗口位置定位显示器失败（{err}），回退主显示器")),
        }
    }

    let index = monitors
        .iter()
        .position(|m| m.is_primary().unwrap_or(false))
        .unwrap_or(0);
    monitors[index].clone()
}

/// 当前活动窗口的中心点（全局坐标）。窗口信息缺失或尺寸异常时返回 `None`。
fn active_window_center() -> Option<(i32, i32)> {
    let window = active_win_pos_rs::get_active_window().ok()?;
    window_center(&window.position)
}

fn window_center(position: &WindowPosition) -> Option<(i32, i32)> {
    let values = [position.x, position.y, position.width, position.height];
    if !values.iter().all(|value| value.is_finite()) {
        return None;
    }
    if position.width <= 0.0 || position.height <= 0.0 {
        return None;
    }
    let x = position.x + position.width / 2.0;
    let y = position.y + position.height / 2.0;
    Some((x as i32, y as i32))
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

#[cfg(test)]
mod tests {
    use super::window_center;
    use active_win_pos_rs::WindowPosition;

    #[test]
    fn window_center_is_geometric_middle() {
        let position = WindowPosition::new(100.0, 200.0, 800.0, 600.0);
        assert_eq!(window_center(&position), Some((500, 500)));
    }

    #[test]
    fn window_center_keeps_negative_coordinates_for_screens_left_of_primary() {
        // 副屏放在主屏左侧时，窗口 x 为负值，命中判断要保留符号
        let position = WindowPosition::new(-1440.0, 0.0, 1440.0, 900.0);
        assert_eq!(window_center(&position), Some((-720, 450)));
    }

    #[test]
    fn window_center_rejects_empty_or_invalid_geometry() {
        assert_eq!(window_center(&WindowPosition::default()), None);
        assert_eq!(
            window_center(&WindowPosition::new(0.0, 0.0, 0.0, 600.0)),
            None
        );
        assert_eq!(
            window_center(&WindowPosition::new(f64::NAN, 0.0, 800.0, 600.0)),
            None
        );
        assert_eq!(
            window_center(&WindowPosition::new(0.0, f64::INFINITY, 800.0, 600.0)),
            None
        );
        assert_eq!(
            window_center(&WindowPosition::new(0.0, 0.0, f64::INFINITY, 600.0)),
            None
        );
    }
}
