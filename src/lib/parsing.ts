import type { RebateRow } from "./shared";

const fullWidthSpace = /\u3000/g;

export function normalizeLines(input: string): string[] {
  return input
    .replace(fullWidthSpace, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseMoneyLines(input: string): string[] {
  return normalizeLines(input)
    .map((line) => {
      const firstCell = line.split(/\t|,/).find(Boolean) ?? line;
      return firstCell.replace(/[¥￥\s]/g, "");
    })
    .filter(Boolean);
}

export function parseRemarkLines(input: string): string[] {
  return normalizeLines(input).map((line) => line.split(/\t/)[0]?.trim() ?? "");
}

export function buildRows(amountInput: string, remarkInput: string): {
  rows: RebateRow[];
  amountLines: string[];
  remarkLines: string[];
  error?: string;
} {
  const amountLines = parseMoneyLines(amountInput);
  const remarkLines = parseRemarkLines(remarkInput);
  const createdAt = new Date().toISOString();

  if (amountLines.length !== remarkLines.length) {
    return {
      rows: [],
      amountLines,
      remarkLines,
      error: `金额 ${amountLines.length} 行，备注 ${remarkLines.length} 行，数量不一致。`
    };
  }

  const rows = amountLines.map((amount, index) => ({
    id: crypto.randomUUID(),
    amount,
    remark: remarkLines[index],
    account: "",
    name: "",
    status: "pending" as const,
    createdAt
  }));

  return { rows, amountLines, remarkLines };
}

export function isValidAccount(account: string): boolean {
  const text = account.trim();
  const phone = /^1[3-9]\d{9}$/.test(text);
  const email = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(text);
  return phone || email;
}

export function formatExportFileName(owner = "丛宇航", date = new Date()): string {
  const normalizedOwner = owner.trim() || "丛宇航";
  const year = String(date.getFullYear()).slice(-2);
  return `${normalizedOwner}${year}年${date.getMonth() + 1}月${date.getDate()}日返款已验证.xlsx`;
}

export function exportValidationErrors(rows: RebateRow[]): string[] {
  const errors: string[] = [];
  rows.forEach((row, index) => {
    const line = index + 1;
    if (!row.amount.trim()) errors.push(`第 ${line} 行缺少金额`);
    if (!row.remark.trim()) errors.push(`第 ${line} 行缺少备注`);
    if (!isValidAccount(row.account)) errors.push(`第 ${line} 行支付宝账号格式不正确`);
    if (!row.name.trim()) errors.push(`第 ${line} 行缺少收款方姓名`);
  });
  return errors;
}
