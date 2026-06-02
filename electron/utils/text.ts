/**
 * 文本规范化处理，用于视频/收评搜索匹配。
 * 去除扩展名、空格、标点等干扰字符，统一小写。
 */
export function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(/\.[^.]+$/, "").replace(/[\s_\-—–()（）[\]【】.·,，。]/g, "");
}
