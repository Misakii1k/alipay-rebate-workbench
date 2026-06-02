/**
 * 截断 HTTP 响应的错误文本，防止日志过长。
 */
export async function truncatedErrorText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.length > 200 ? text.slice(0, 200) + "..." : text;
  } catch {
    return "(无法读取响应体)";
  }
}
