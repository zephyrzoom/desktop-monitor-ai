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

/// 一次清理的结果，前端「立即清理」用它给出反馈，也用于日志。
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupReport {
    /// 实际生效的保留天数
    pub retention_days: i64,
    /// 早于该本地日期（不含）的数据被视为过期
    pub cutoff: String,
    pub deleted_records: usize,
    pub deleted_windows: usize,
    pub deleted_tasks: usize,
    pub deleted_files: usize,
    pub deleted_dirs: usize,
    /// 删除失败的截图文件数（通常是权限或文件已被移走）
    pub failed_files: usize,
}

/// 目录名是否为 `YYYY-MM-DD`，只有这种归档目录才会被整目录清理。
fn is_date_dir(name: &str) -> bool {
    let bytes = name.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
}

/// 按保留天数清理过期截图、窗口记录与任务记忆。
///
/// 「保留 N 天」= 保留今天在内的最近 N 个自然日，所以过期分界是 `今天 - (N-1)`；
/// 早期版本用的是 `今天 - N`，会让实际保留天数比配置多一天。
pub fn cleanup(rt: &Runtime) -> CleanupReport {
    let retention_days = rt.config.cleanup().retention_days.max(1);
    let cutoff = (Local::now().date_naive() - chrono::Duration::days(retention_days - 1))
        .format("%Y-%m-%d")
        .to_string();

    let mut report = CleanupReport {
        retention_days,
        cutoff: cutoff.clone(),
        ..CleanupReport::default()
    };

    let dir = rt.screenshots_dir();

    match rt.db.screenshots_before_date(&cutoff) {
        Ok(expired) => {
            for shot in expired {
                let file = dir.join(&shot.file_path);
                if !file.exists() {
                    continue;
                }
                match fs::remove_file(&file) {
                    Ok(()) => report.deleted_files += 1,
                    Err(err) => {
                        report.failed_files += 1;
                        logger::warn(format!("删除截图文件失败（{}）：{err}", file.display()));
                    }
                }
            }
        }
        Err(err) => logger::error(format!("查询过期截图失败：{err}")),
    }

    match rt.db.delete_screenshots_before_date(&cutoff) {
        Ok(count) => report.deleted_records = count,
        Err(err) => logger::error(format!("清理过期截图记录失败：{err}")),
    }

    match rt.db.delete_active_windows_before_date(&cutoff) {
        Ok(count) => report.deleted_windows = count,
        Err(err) => logger::error(format!("清理过期窗口记录失败：{err}")),
    }

    match rt.db.delete_task_memories_before_date(&cutoff) {
        Ok(count) => report.deleted_tasks = count,
        Err(err) => logger::error(format!("清理过期任务记忆失败：{err}")),
    }

    // 兜底：整目录清扫过期的日期归档目录。
    // 数据库里没有记录的文件（早期版本写入的 png、写库失败残留的 jpg）不会被上面的
    // 按记录删除覆盖到，长年累月就会一直留在磁盘上。
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.as_str() >= cutoff.as_str() || !is_date_dir(&name) {
                continue;
            }
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            match fs::remove_dir_all(&path) {
                Ok(()) => report.deleted_dirs += 1,
                Err(err) => logger::warn(format!("删除过期目录失败（{}）：{err}", path.display())),
            }
        }
    }

    if report.deleted_records > 0
        || report.deleted_files > 0
        || report.deleted_dirs > 0
        || report.deleted_windows > 0
        || report.deleted_tasks > 0
    {
        logger::info(format!(
            "清理过期数据（早于 {cutoff}，保留 {retention_days} 天）：截图记录 {} 条、文件 {} 个、目录 {} 个、窗口 {} 条、任务记忆 {} 条",
            report.deleted_records,
            report.deleted_files,
            report.deleted_dirs,
            report.deleted_windows,
            report.deleted_tasks
        ));
    }

    report
}

#[cfg(test)]
mod tests {
    use super::window_center;
    use active_win_pos_rs::WindowPosition;

    #[test]
    fn date_dir_only_matches_archived_date_folders() {
        use super::is_date_dir;
        assert!(is_date_dir("2026-11-24"));
        // 只认 `YYYY-MM-DD`：带后缀、分隔符不对、长度不对的目录都不能整目录删除
        assert!(!is_date_dir("2026-11-24.bak"));
        assert!(!is_date_dir("2026_11_24"));
        assert!(!is_date_dir("2026-1-4"));
        assert!(!is_date_dir("screenshots"));
        assert!(!is_date_dir(""));
    }

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
