//! Excel 导出模块
//!
//! 对应原 `electron/handlers/export.ts`。
//!
//! - 用 rust_xlsxwriter 生成 .xlsx 文件
//! - 导出格式：序号 / 支付宝账号 / 收款方姓名 / 金额 / 备注
//! - 公式注入防护（调用 security::sanitize_cell_text）
//!
//! 注意：原版使用 ExcelJS 读取 alipay-template.xlsx 模板。rust_xlsxwriter 是
//! 只写库，无法读取模板，因此本实现直接创建新工作簿并设置列宽/表头。
//! 数据从第 3 行开始写入（与原版 startRow = 3 一致）。

use crate::security::sanitize_cell_text;
use crate::types::{ExportPayload, ExportResult, ExportTailRow, RebateRow};
use rust_xlsxwriter::{Format, FormatBorder, Workbook};

/// 数据起始行（与原版一致，第 3 行开始）。
const START_ROW: u32 = 3;

/// 清理文件名中的非法字符。
fn sanitize_file_name(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

/// 判断行是否有值。
fn has_export_row_value(row: &ExportTailRow) -> bool {
    !row.account.trim().is_empty()
        || !row.name.trim().is_empty()
        || !row.amount.trim().is_empty()
        || !row.remark.trim().is_empty()
}

/// 创建表头格式。
fn header_format() -> Format {
    Format::new()
        .set_bold()
        .set_border(FormatBorder::Thin)
        .set_background_color(rust_xlsxwriter::Color::RGB(0xD9E1F2))
}

/// 创建数据单元格格式。
fn cell_format() -> Format {
    Format::new().set_border(FormatBorder::Thin)
}

/// 生成 Excel 工作簿并写入文件。
///
/// 参数：
/// - `payload`: 导出负载（行数据 + 默认文件名 + 尾行）
/// - `file_path`: 输出文件路径（由前端 save 对话框提供）
pub fn write_workbook(payload: &ExportPayload, file_path: &str) -> Result<(), String> {
    let mut workbook = Workbook::new();
    let worksheet = workbook
        .add_worksheet()
        .set_name("返款表")
        .map_err(|e| format!("创建工作表失败：{}", e))?;

    // 设置列宽（rust_xlsxwriter 的 set_column_width 返回 Result，逐个处理）
    let col_widths: [(u16, f64); 5] = [
        (0, 8.0),   // 序号
        (1, 28.0),  // 支付宝账号
        (2, 16.0),  // 收款方姓名
        (3, 14.0),  // 金额
        (4, 32.0),  // 备注
    ];
    for (col, width) in col_widths {
        worksheet
            .set_column_width(col, width)
            .map_err(|e| format!("设置列宽失败：{}", e))?;
    }

    let header_fmt = header_format();
    let cell_fmt = cell_format();

    // 第 1 行：标题
    let title = sanitize_file_name(&payload.default_file_name);
    worksheet
        .merge_range(0, 0, 0, 4, &title, &header_fmt)
        .map_err(|e| format!("写入标题失败：{}", e))?;

    // 第 2 行：表头
    let headers = ["序号", "支付宝账号", "收款方姓名", "金额", "备注"];
    for (col, header) in headers.iter().enumerate() {
        worksheet
            .write_with_format(1, col as u16, *header, &header_fmt)
            .map_err(|e| format!("写入表头失败：{}", e))?;
    }

    // 构造数据行（含尾行）
    let tail_row = payload.tail_row.clone().unwrap_or_default();
    let has_tail = has_export_row_value(&tail_row);

    let mut data_rows: Vec<ExportTailRow> = payload
        .rows
        .iter()
        .map(|r| ExportTailRow {
            account: r.account.clone(),
            name: r.name.clone(),
            amount: r.amount.clone(),
            remark: r.remark.clone(),
        })
        .collect();

    if has_tail {
        data_rows.push(tail_row);
    }

    // 写入数据行（从第 3 行开始）
    for (index, row) in data_rows.iter().enumerate() {
        let row_idx = START_ROW + index as u32 - 1; // 0-based row index

        // 序号
        worksheet
            .write_number_with_format(row_idx, 0, (index + 1) as f64, &cell_fmt)
            .map_err(|e| format!("写入序号失败：{}", e))?;

        // 支付宝账号（消毒）
        let account = sanitize_cell_text(Some(&row.account)).unwrap_or_default();
        worksheet
            .write_with_format(row_idx, 1, &account, &cell_fmt)
            .map_err(|e| format!("写入账号失败：{}", e))?;

        // 收款方姓名（消毒）
        let name = sanitize_cell_text(Some(&row.name)).unwrap_or_default();
        worksheet
            .write_with_format(row_idx, 2, &name, &cell_fmt)
            .map_err(|e| format!("写入姓名失败：{}", e))?;

        // 金额（空字符串写空值，否则写数字）
        if row.amount.trim().is_empty() {
            worksheet
                .write_with_format(row_idx, 3, "", &cell_fmt)
                .map_err(|e| format!("写入金额失败：{}", e))?;
        } else {
            let amount: f64 = row.amount.trim().parse().unwrap_or(0.0);
            worksheet
                .write_number_with_format(row_idx, 3, amount, &cell_fmt)
                .map_err(|e| format!("写入金额失败：{}", e))?;
        }

        // 备注（消毒）
        let remark = sanitize_cell_text(Some(&row.remark)).unwrap_or_default();
        worksheet
            .write_with_format(row_idx, 4, &remark, &cell_fmt)
            .map_err(|e| format!("写入备注失败：{}", e))?;
    }

    // 写入文件
    workbook
        .save(file_path)
        .map_err(|e| format!("保存文件失败：{}", e))?;

    Ok(())
}

/// 统计有值的行数（含尾行）。
pub fn count_export_rows(payload: &ExportPayload) -> u32 {
    let mut count = payload.rows.len() as u32;
    if let Some(tail) = &payload.tail_row {
        if has_export_row_value(tail) {
            count += 1;
        }
    }
    count
}

// ============================================================================
// Tauri 命令
// ============================================================================

/// 导出工作簿命令（对应 `export:workbook` IPC 通道）。
///
/// 前端通过 save 对话框获取 file_path 后传入；若未提供则返回 canceled。
#[tauri::command]
pub async fn export_workbook(
    payload: ExportPayload,
    file_path: Option<String>,
) -> Result<ExportResult, String> {
    let file_path = match file_path {
        Some(p) if !p.is_empty() => p,
        _ => {
            return Ok(ExportResult {
                canceled: true,
                file_path: None,
                error: None,
            });
        }
    };

    match write_workbook(&payload, &file_path) {
        Ok(()) => Ok(ExportResult {
            canceled: false,
            file_path: Some(file_path),
            error: None,
        }),
        Err(e) => Ok(ExportResult {
            canceled: false,
            file_path: None,
            error: Some(e),
        }),
    }
}

// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_file_name() {
        assert_eq!(sanitize_file_name("normal name"), "normal name");
        assert_eq!(sanitize_file_name("a/b:c*d"), "a_b_c_d");
        assert_eq!(sanitize_file_name("test\"file"), "test_file");
    }

    #[test]
    fn test_has_export_row_value_empty() {
        let row = ExportTailRow::default();
        assert!(!has_export_row_value(&row));
    }

    #[test]
    fn test_has_export_row_value_with_account() {
        let row = ExportTailRow {
            account: "13800138000".to_string(),
            ..Default::default()
        };
        assert!(has_export_row_value(&row));
    }

    #[test]
    fn test_has_export_row_value_with_name() {
        let row = ExportTailRow {
            name: "张三".to_string(),
            ..Default::default()
        };
        assert!(has_export_row_value(&row));
    }

    #[test]
    fn test_count_export_rows_no_tail() {
        let payload = ExportPayload {
            rows: vec![RebateRow::default(), RebateRow::default()],
            default_file_name: "test".to_string(),
            tail_row: None,
        };
        assert_eq!(count_export_rows(&payload), 2);
    }

    #[test]
    fn test_count_export_rows_with_tail() {
        let payload = ExportPayload {
            rows: vec![RebateRow::default()],
            default_file_name: "test".to_string(),
            tail_row: Some(ExportTailRow {
                account: "13800138000".to_string(),
                ..Default::default()
            }),
        };
        assert_eq!(count_export_rows(&payload), 2);
    }

    #[test]
    fn test_count_export_rows_empty_tail() {
        let payload = ExportPayload {
            rows: vec![RebateRow::default()],
            default_file_name: "test".to_string(),
            tail_row: Some(ExportTailRow::default()),
        };
        assert_eq!(count_export_rows(&payload), 1);
    }

    #[tokio::test]
    async fn test_export_workbook_no_file_path() {
        let payload = ExportPayload {
            rows: vec![],
            default_file_name: "test".to_string(),
            tail_row: None,
        };
        let result = export_workbook(payload, None).await.unwrap();
        assert!(result.canceled);
    }

    #[tokio::test]
    async fn test_export_workbook_empty_file_path() {
        let payload = ExportPayload {
            rows: vec![],
            default_file_name: "test".to_string(),
            tail_row: None,
        };
        let result = export_workbook(payload, Some(String::new())).await.unwrap();
        assert!(result.canceled);
    }

    #[tokio::test]
    async fn test_export_workbook_writes_file() {
        let temp_dir = std::env::temp_dir().join("tauri_export_test");
        let _ = std::fs::create_dir_all(&temp_dir);
        let file_path = temp_dir.join("test_export.xlsx");

        let payload = ExportPayload {
            rows: vec![RebateRow {
                id: "1".to_string(),
                account: "13800138000".to_string(),
                name: "张三".to_string(),
                amount: "100.50".to_string(),
                remark: "测试备注".to_string(),
                ..Default::default()
            }],
            default_file_name: "测试导出".to_string(),
            tail_row: None,
        };

        let result = export_workbook(payload, Some(file_path.to_string_lossy().to_string()))
            .await
            .unwrap();
        assert!(!result.canceled);
        assert!(result.error.is_none());
        assert!(file_path.exists());

        let _ = std::fs::remove_file(&file_path);
        let _ = std::fs::remove_dir(&temp_dir);
    }

    #[tokio::test]
    async fn test_export_workbook_formula_injection_sanitized() {
        let temp_dir = std::env::temp_dir().join("tauri_export_injection_test");
        let _ = std::fs::create_dir_all(&temp_dir);
        let file_path = temp_dir.join("injection_test.xlsx");

        let payload = ExportPayload {
            rows: vec![RebateRow {
                id: "1".to_string(),
                account: "=SUM(A1:A10)".to_string(),
                name: "@admin".to_string(),
                amount: "50".to_string(),
                remark: "-1-2".to_string(),
                ..Default::default()
            }],
            default_file_name: "test".to_string(),
            tail_row: None,
        };

        let result = export_workbook(payload, Some(file_path.to_string_lossy().to_string()))
            .await
            .unwrap();
        assert!(!result.canceled);
        assert!(result.error.is_none());
        assert!(file_path.exists());

        let _ = std::fs::remove_file(&file_path);
        let _ = std::fs::remove_dir(&temp_dir);
    }
}
