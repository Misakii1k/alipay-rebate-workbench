import { normalizeVideoTemplate, type VideoTask, type VideoTemplateId } from "./shared";

export function parseProductName(value: string) {
  const raw = value.trim().replace(/\.[^.]+$/, "");
  const [productName, ...rest] = raw.split(/[-—_\s]+/).filter(Boolean);
  return {
    productName: productName || raw,
    colorName: rest.join("-"),
    outputName: raw
  };
}

export function createVideoTask(template: VideoTemplateId, outputName = ""): VideoTask {
  const parsed = parseProductName(outputName);
  return {
    id: crypto.randomUUID(),
    template,
    productName: parsed.productName,
    colorName: parsed.colorName,
    outputName: parsed.outputName,
    imagePath: "",
    imagePaths: [],
    videoPath: "",
    candidates: [],
    status: "draft",
    progress: 0
  };
}

export function updateTaskName(task: VideoTask, value: string): VideoTask {
  const parsed = parseProductName(value);
  return {
    ...task,
    productName: parsed.productName,
    colorName: parsed.colorName,
    outputName: parsed.outputName
  };
}

export function autoFillSliceImages(paths: string[]) {
  const slots = Array<string>(5).fill("");
  const sorted = [...paths].sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));
  sorted.forEach((filePath) => {
    const fileName = filePath.split(/[\\/]/).pop() ?? "";
    const match = fileName.match(/(?:^|[^0-9])([1-5])(?:[^0-9]|$)/);
    if (match) {
      slots[Number(match[1]) - 1] = filePath;
    }
  });
  let cursor = 0;
  sorted.forEach((filePath) => {
    if (slots.includes(filePath)) return;
    while (cursor < slots.length && slots[cursor]) cursor += 1;
    if (cursor < slots.length) slots[cursor] = filePath;
  });
  return slots;
}

export function isTaskReady(task: VideoTask) {
  if (!task.outputName.trim()) return false;
  if (task.template === "video-slice") return task.imagePaths.filter(Boolean).length === 5;
  return Boolean((task.imagePath || task.imagePaths[0]) && task.videoPath);
}

export function normalizeVideoTask(task: VideoTask): VideoTask {
  return {
    ...task,
    template: normalizeVideoTemplate(task.template)
  };
}
