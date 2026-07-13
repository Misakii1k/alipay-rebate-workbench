//! Alipay workbook export. The official template is the workbook contract, so
//! exports edit a copy of that template instead of generating a new sheet.

use crate::security::sanitize_cell_text;
use crate::types::{ExportPayload, ExportResult, ExportTailRow};
use std::path::Path;
use tauri::AppHandle;

const START_ROW: u32 = 3;
const TEMPLATE_DATA_ROWS: u32 = 22;
const OVERFLOW_STYLE_ROW: u32 = 25;
const CLEAR_TO_ROW: u32 = 200;
const DATA_COLUMNS: std::ops::RangeInclusive<u32> = 1..=5;

fn has_export_row_value(row: &ExportTailRow) -> bool {
    !row.account.trim().is_empty()
        || !row.name.trim().is_empty()
        || !row.amount.trim().is_empty()
        || !row.remark.trim().is_empty()
}

fn collect_rows(payload: &ExportPayload) -> Vec<ExportTailRow> {
    let mut rows = payload
        .rows
        .iter()
        .map(|row| ExportTailRow {
            account: row.account.clone(),
            name: row.name.clone(),
            amount: row.amount.clone(),
            remark: row.remark.clone(),
        })
        .collect::<Vec<_>>();
    if let Some(tail_row) = payload.tail_row.clone().filter(has_export_row_value) {
        rows.push(tail_row);
    }
    rows
}

fn style_source_row(row: u32) -> u32 {
    if row < START_ROW + TEMPLATE_DATA_ROWS {
        row
    } else {
        OVERFLOW_STYLE_ROW
    }
}

fn clear_data_cells(sheet: &mut umya_spreadsheet::Worksheet, row: u32) {
    for column in DATA_COLUMNS {
        sheet.get_cell_mut((column, row)).set_value_string("");
    }
}

fn copy_data_row_style(sheet: &mut umya_spreadsheet::Worksheet, target_row: u32) {
    let source_row = style_source_row(target_row);
    let styles = DATA_COLUMNS
        .clone()
        .map(|column| (column, sheet.get_style((column, source_row)).clone()))
        .collect::<Vec<_>>();
    for (column, style) in styles {
        sheet.get_cell_mut((column, target_row)).set_style(style);
    }
}

/// Write user rows into a copy of the official Alipay upload template.
pub fn write_workbook(
    payload: &ExportPayload,
    file_path: &str,
    template_path: &Path,
) -> Result<(), String> {
    if !template_path.is_file() {
        return Err("未找到支付宝 Excel 模板文件。".to_string());
    }

    let mut workbook = umya_spreadsheet::reader::xlsx::read(template_path)
        .map_err(|error| format!("读取支付宝 Excel 模板失败：{error}"))?;
    let sheet = workbook
        .get_sheet_mut(&0)
        .ok_or_else(|| "支付宝 Excel 模板不包含工作表。".to_string())?;
    let rows = collect_rows(payload);

    for (index, row) in rows.iter().enumerate() {
        let target_row = START_ROW + index as u32;
        copy_data_row_style(sheet, target_row);
        sheet
            .get_cell_mut((1, target_row))
            .set_value_number((index + 1) as f64);
        sheet
            .get_cell_mut((2, target_row))
            .set_value_string(sanitize_cell_text(Some(&row.account)).unwrap_or_default());
        sheet
            .get_cell_mut((3, target_row))
            .set_value_string(sanitize_cell_text(Some(&row.name)).unwrap_or_default());

        if row.amount.trim().is_empty() {
            sheet.get_cell_mut((4, target_row)).set_value_string("");
        } else {
            let amount = row.amount.trim().parse::<f64>().unwrap_or(0.0);
            sheet.get_cell_mut((4, target_row)).set_value_number(amount);
        }
        sheet
            .get_cell_mut((5, target_row))
            .set_value_string(sanitize_cell_text(Some(&row.remark)).unwrap_or_default());
    }

    for row in (START_ROW + rows.len() as u32)..=CLEAR_TO_ROW {
        clear_data_cells(sheet, row);
    }

    umya_spreadsheet::writer::xlsx::write(&workbook, file_path)
        .map_err(|error| format!("保存支付宝退款表失败：{error}"))
}

pub fn count_export_rows(payload: &ExportPayload) -> u32 {
    collect_rows(payload).len() as u32
}

#[tauri::command]
pub async fn export_workbook(
    payload: ExportPayload,
    file_path: Option<String>,
    app: AppHandle,
) -> Result<ExportResult, String> {
    let file_path = match file_path.filter(|path| !path.is_empty()) {
        Some(path) => path,
        None => {
            return Ok(ExportResult {
                canceled: true,
                file_path: None,
                error: None,
            });
        }
    };
    let template_path = crate::paths::get_alipay_template_path(&app);
    let output_path = file_path.clone();

    let result = tokio::task::spawn_blocking(move || {
        write_workbook(&payload, &output_path, &template_path)
    })
    .await
    .map_err(|error| format!("导出任务失败：{error}"))?;

    match result {
        Ok(()) => Ok(ExportResult {
            canceled: false,
            file_path: Some(file_path),
            error: None,
        }),
        Err(error) => Ok(ExportResult {
            canceled: false,
            file_path: None,
            error: Some(error),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::RebateRow;

    fn template_path() -> std::path::PathBuf {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("resources")
            .join("assets")
            .join("alipay-template.xlsx")
    }

    fn temporary_output_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("tauri-alipay-export-{}.xlsx", uuid::Uuid::new_v4()))
    }

    #[test]
    fn test_has_export_row_value() {
        assert!(!has_export_row_value(&ExportTailRow::default()));
        assert!(has_export_row_value(&ExportTailRow {
            account: "13800138000".to_string(),
            ..Default::default()
        }));
    }

    #[test]
    fn test_count_export_rows_includes_nonempty_tail() {
        let payload = ExportPayload {
            rows: vec![RebateRow::default()],
            default_file_name: "test".to_string(),
            tail_row: Some(ExportTailRow {
                name: "tail".to_string(),
                ..Default::default()
            }),
        };
        assert_eq!(count_export_rows(&payload), 2);
    }

    #[test]
    fn test_write_workbook_preserves_official_template_and_writes_rows() {
        let template = template_path();
        let output = temporary_output_path();
        let original = umya_spreadsheet::reader::xlsx::read(&template).unwrap();
        let original_sheet = original.get_sheet(&0).unwrap();
        let template_name = original_sheet.get_name().to_string();
        let template_title = original_sheet.get_value("A1");
        let template_instruction = original_sheet.get_value("G1");
        let source_style = original_sheet.get_style((2, START_ROW)).clone();

        let payload = ExportPayload {
            rows: vec![RebateRow {
                id: "1".to_string(),
                account: "=SUM(A1:A10)".to_string(),
                name: "张三".to_string(),
                amount: "100.50".to_string(),
                remark: "测试备注".to_string(),
                ..Default::default()
            }],
            default_file_name: "ignored-by-template".to_string(),
            tail_row: None,
        };

        write_workbook(&payload, &output.to_string_lossy(), &template).unwrap();
        let exported = umya_spreadsheet::reader::xlsx::read(&output).unwrap();
        let sheet = exported.get_sheet(&0).unwrap();

        assert_eq!(sheet.get_name(), template_name);
        assert_eq!(sheet.get_value("A1"), template_title);
        assert_eq!(sheet.get_value("G1"), template_instruction);
        assert_eq!(sheet.get_value((1, START_ROW)), "1");
        assert_eq!(sheet.get_value((2, START_ROW)), "'=SUM(A1:A10)");
        assert_eq!(sheet.get_value((3, START_ROW)), "张三");
        assert_eq!(sheet.get_value_number((4, START_ROW)), Some(100.5));
        assert_eq!(sheet.get_value((5, START_ROW)), "测试备注");
        assert_eq!(sheet.get_style((2, START_ROW)), &source_style);
        assert_eq!(sheet.get_value((1, START_ROW + 1)), "");

        let _ = std::fs::remove_file(output);
    }

}
