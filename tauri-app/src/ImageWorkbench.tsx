import { useEffect, useMemo, useState } from "react";
import { Check, FolderOpen, ImagePlus, Layers, Loader2, PaintBucket, RefreshCw, Save, Scissors, Sparkles, Trash2, Wand2 } from "lucide-react";
import clsx from "clsx";
import { alipayWorkbench } from "@/lib/tauri-bridge";
import type {
  ImageCropMode,
  ImageCropTemplate,
  ImageGenerationPayload,
  ImageGenerationProvider,
  ImageGenerationResult,
  ImageOutputFormat,
  ImageProcessPayload,
  ImageProcessTask
} from "@/lib/shared";

type TabKey = "crop" | "generate";

const TEMPLATE_KEY = "image-workbench-crop-templates-v1";
const CROP_FORM_KEY = "image-workbench-crop-form-v1";
const GEN_FORM_KEY = "image-workbench-generation-form-v1";

const defaultCropForm = {
  targetWidth: 800,
  targetHeight: 800,
  mode: "center-crop" as ImageCropMode,
  backgroundColor: "#ffffff",
  outputFormat: "jpg" as ImageOutputFormat,
  quality: 90,
  suffix: "_crop",
  outputDir: ""
};

const defaultGenForm = {
  provider: "openai" as ImageGenerationProvider,
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-image-1",
  keyword: "",
  scene: "",
  style: "",
  size: "1024x1024",
  count: 1,
  outputDir: ""
};

function parseStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function loadTemplates(): ImageCropTemplate[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function buildPrompt(form: typeof defaultGenForm) {
  return [
    form.keyword.trim() && `商品：${form.keyword.trim()}`,
    form.scene.trim() && `场景：${form.scene.trim()}`,
    form.style.trim() && `风格：${form.style.trim()}`,
    "生成适合电商评价、真实自然、干净清晰的商品图片。"
  ].filter(Boolean).join("\n");
}

export function ImageWorkbench() {
  const [activeTab, setActiveTab] = useState<TabKey>("crop");
  const [cropForm, setCropForm] = useState(() => parseStored(CROP_FORM_KEY, defaultCropForm));
  const [genForm, setGenForm] = useState(() => parseStored(GEN_FORM_KEY, defaultGenForm));
  const [templates, setTemplates] = useState<ImageCropTemplate[]>(loadTemplates);
  const [templateName, setTemplateName] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [tasks, setTasks] = useState<ImageProcessTask[]>([]);
  const [generationResults, setGenerationResults] = useState<ImageGenerationResult[]>([]);
  const [notice, setNotice] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const prompt = useMemo(() => buildPrompt(genForm), [genForm]);
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);

  useEffect(() => localStorage.setItem(CROP_FORM_KEY, JSON.stringify(cropForm)), [cropForm]);
  useEffect(() => localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates)), [templates]);
  useEffect(() => {
    const { apiKey: _apiKey, ...persistable } = genForm;
    localStorage.setItem(GEN_FORM_KEY, JSON.stringify(persistable));
  }, [genForm]);

  async function chooseImages() {
    const result = await alipayWorkbench.selectFiles({ kind: "image", multi: true });
    if (result.canceled || result.paths.length === 0) return;
    const next = result.paths.slice(0, 50).map((path) => ({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      inputPath: path,
      fileName: fileNameFromPath(path),
      status: "pending" as const
    }));
    setTasks(next);
    setNotice(result.paths.length > 50 ? "已按最多 50 张导入，超出部分已忽略。" : `已导入 ${next.length} 张图片。`);
    void hydratePreviews(next);
  }

  async function hydratePreviews(nextTasks: ImageProcessTask[]) {
    const previews = await Promise.all(nextTasks.map(async (task) => {
      try {
        return [task.id, await alipayWorkbench.getImagePreview(task.inputPath)] as const;
      } catch {
        return [task.id, ""] as const;
      }
    }));
    const map = new Map(previews);
    setTasks((current) => current.map((task) => ({ ...task, previewUrl: map.get(task.id) || task.previewUrl })));
  }

  async function chooseCropOutputDir() {
    const result = await alipayWorkbench.selectDirectory("选择裁切/扩边输出目录", "mediaRoot");
    if (!result.canceled && result.paths[0]) setCropForm((current) => ({ ...current, outputDir: result.paths[0] }));
  }

  async function chooseGenerationOutputDir() {
    const result = await alipayWorkbench.selectDirectory("选择生图保存目录", "mediaRoot");
    if (!result.canceled && result.paths[0]) setGenForm((current) => ({ ...current, outputDir: result.paths[0] }));
  }

  function saveTemplate() {
    const name = templateName.trim() || selectedTemplate?.name || "未命名模板";
    const template: ImageCropTemplate = {
      id: selectedTemplateId || `tpl-${Date.now()}`,
      name,
      targetWidth: Number(cropForm.targetWidth) || 800,
      targetHeight: Number(cropForm.targetHeight) || 800,
      mode: cropForm.mode,
      backgroundColor: cropForm.backgroundColor,
      outputFormat: cropForm.outputFormat,
      quality: Number(cropForm.quality) || 90,
      suffix: cropForm.suffix || "_crop",
      updatedAt: new Date().toISOString()
    };
    setTemplates((current) => current.some((item) => item.id === template.id)
      ? current.map((item) => item.id === template.id ? template : item)
      : [template, ...current]);
    setSelectedTemplateId(template.id);
    setTemplateName(name);
    setNotice("模板已保存，下次打开仍可直接套用。");
  }

  function applyTemplate(template: ImageCropTemplate) {
    setSelectedTemplateId(template.id);
    setTemplateName(template.name);
    setCropForm((current) => ({
      ...current,
      targetWidth: template.targetWidth,
      targetHeight: template.targetHeight,
      mode: template.mode,
      backgroundColor: template.backgroundColor,
      outputFormat: template.outputFormat,
      quality: template.quality,
      suffix: template.suffix
    }));
  }

  async function processImages() {
    if (tasks.length === 0) {
      setNotice("请先选择要处理的图片。");
      return;
    }
    if (cropForm.targetWidth <= 0 || cropForm.targetHeight <= 0) {
      setNotice("目标宽高需要大于 0。");
      return;
    }
    const payload: ImageProcessPayload = {
      inputPaths: tasks.map((task) => task.inputPath),
      outputDir: cropForm.outputDir || undefined,
      targetWidth: Number(cropForm.targetWidth),
      targetHeight: Number(cropForm.targetHeight),
      mode: cropForm.mode,
      backgroundColor: cropForm.backgroundColor || "#ffffff",
      outputFormat: cropForm.outputFormat,
      quality: Number(cropForm.quality),
      suffix: cropForm.suffix || "_crop"
    };
    setIsProcessing(true);
    setTasks((current) => current.map((task) => ({ ...task, status: "processing", error: undefined })));
    try {
      const results = await alipayWorkbench.processImages(payload);
      const resultMap = new Map(results.map((result) => [result.inputPath, result]));
      setTasks((current) => current.map((task) => {
        const result = resultMap.get(task.inputPath);
        return result ? { ...task, status: result.status, outputPath: result.outputPath, error: result.error } : { ...task, status: "failed", error: "未返回处理结果" };
      }));
      const successCount = results.filter((result) => result.status === "success").length;
      setNotice(`处理完成：成功 ${successCount} 张，失败 ${results.length - successCount} 张。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTasks((current) => current.map((task) => ({ ...task, status: "failed", error: message })));
      setNotice(message);
    } finally {
      setIsProcessing(false);
    }
  }

  async function generateImages() {
    if (!genForm.apiBaseUrl.trim() || !genForm.apiKey.trim() || !genForm.model.trim()) {
      setNotice("请先填写 API 地址、API Key 和模型名。");
      return;
    }
    if (!prompt.trim()) {
      setNotice("请填写商品关键词或场景，方便生成提示词。");
      return;
    }
    if (!genForm.outputDir.trim()) {
      setNotice("请先选择生成图片保存目录。");
      return;
    }
    const payload: ImageGenerationPayload = {
      provider: genForm.provider,
      apiBaseUrl: genForm.apiBaseUrl.trim(),
      apiKey: genForm.apiKey,
      model: genForm.model.trim(),
      prompt,
      size: genForm.size,
      count: Math.min(Math.max(Number(genForm.count) || 1, 1), 10),
      outputDir: genForm.outputDir
    };
    setIsGenerating(true);
    setGenerationResults([]);
    try {
      const results = await alipayWorkbench.generateImages(payload);
      const withPreviews = await Promise.all(results.map(async (result) => {
        if (!result.outputPath || result.previewUrl) return result;
        try {
          return { ...result, previewUrl: await alipayWorkbench.getImagePreview(result.outputPath) };
        } catch {
          return result;
        }
      }));
      setGenerationResults(withPreviews);
      const successCount = withPreviews.filter((result) => result.status === "success").length;
      setNotice(`生成完成：成功 ${successCount} 张，失败 ${withPreviews.length - successCount} 张。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGenerationResults([{ id: `failed-${Date.now()}`, status: "failed", error: message }]);
      setNotice(message);
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <section className="image-workbench">
      <div className="image-workbench-hero">
        <div>
          <p className="eyebrow">图片生产</p>
          <h2>生图工作台</h2>
          <p>集中处理第三方 AI 生图、本地裁切、扩边和常用模板。原图不会被覆盖，输出会自动生成新文件。</p>
        </div>
        <div className="image-hero-stats">
          <span><ImagePlus size={16} /> AI 生图</span>
          <span><Scissors size={16} /> 批量裁切</span>
          <span><Layers size={16} /> 模板复用</span>
        </div>
      </div>

      <div className="image-tabs" role="tablist" aria-label="生图工作台功能">
        <button className={clsx(activeTab === "crop" && "active")} onClick={() => setActiveTab("crop")}><Scissors size={16} /> 裁切/扩边</button>
        <button className={clsx(activeTab === "generate" && "active")} onClick={() => setActiveTab("generate")}><Sparkles size={16} /> AI 生图</button>
      </div>

      {notice && <div className="image-notice">{notice}</div>}

      {activeTab === "crop" ? (
        <div className="image-grid-layout">
          <div className="image-panel">
            <div className="image-panel-head">
              <div><strong>裁切/扩边参数</strong><span>支持单张或批量图片，最多按 50 张设计。</span></div>
              <button className="ghost-button" onClick={chooseImages}><ImagePlus size={16} /> 选择图片</button>
            </div>
            <div className="image-form-grid">
              <label><span>目标宽度</span><input type="number" min={1} value={cropForm.targetWidth} onChange={(event) => setCropForm((current) => ({ ...current, targetWidth: Number(event.target.value) }))} /></label>
              <label><span>目标高度</span><input type="number" min={1} value={cropForm.targetHeight} onChange={(event) => setCropForm((current) => ({ ...current, targetHeight: Number(event.target.value) }))} /></label>
              <label><span>处理方式</span><select value={cropForm.mode} onChange={(event) => setCropForm((current) => ({ ...current, mode: event.target.value as ImageCropMode }))}><option value="center-crop">居中裁切</option><option value="pad">不裁切扩边</option><option value="crop-pad">裁切后扩边</option></select></label>
              <label><span>输出格式</span><select value={cropForm.outputFormat} onChange={(event) => setCropForm((current) => ({ ...current, outputFormat: event.target.value as ImageOutputFormat }))}><option value="jpg">JPG</option><option value="png">PNG</option><option value="webp">WEBP</option></select></label>
              <label><span>图片质量</span><input type="number" min={1} max={100} value={cropForm.quality} onChange={(event) => setCropForm((current) => ({ ...current, quality: Number(event.target.value) }))} /></label>
              <label><span>文件后缀</span><input value={cropForm.suffix} onChange={(event) => setCropForm((current) => ({ ...current, suffix: event.target.value }))} /></label>
              <label><span>扩边颜色</span><input type="color" value={cropForm.backgroundColor} onChange={(event) => setCropForm((current) => ({ ...current, backgroundColor: event.target.value }))} /></label>
              <label className="wide"><span>输出目录</span><div className="image-path-row"><input value={cropForm.outputDir} onChange={(event) => setCropForm((current) => ({ ...current, outputDir: event.target.value }))} placeholder="不填则默认输出到原图旁边" /><button type="button" onClick={chooseCropOutputDir}><FolderOpen size={16} /></button></div></label>
            </div>
            <div className="image-actions">
              <button className="primary" disabled={isProcessing} onClick={processImages}>{isProcessing ? <Loader2 className="spin" size={16} /> : <Scissors size={16} />} 开始处理</button>
              <button onClick={() => setCropForm(defaultCropForm)}><RefreshCw size={16} /> 恢复默认</button>
            </div>
          </div>

          <div className="image-panel">
            <div className="image-panel-head"><div><strong>裁切模板</strong><span>保存常用尺寸和扩边规则，后续一键套用。</span></div></div>
            <div className="image-template-save"><input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="模板名，例如：主图 800 方图" /><button onClick={saveTemplate}><Save size={16} /> 保存模板</button></div>
            <div className="image-template-list">
              {templates.length === 0 ? <div className="image-empty">还没有模板，设置好参数后点击保存。</div> : templates.map((template) => (
                <div className={clsx("image-template-card", selectedTemplateId === template.id && "active")} key={template.id}>
                  <button onClick={() => applyTemplate(template)}><strong>{template.name}</strong><span>{template.targetWidth} x {template.targetHeight} · {modeLabel(template.mode)} · {template.outputFormat.toUpperCase()}</span></button>
                  <button className="icon-danger" onClick={() => setTemplates((current) => current.filter((item) => item.id !== template.id))}><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          </div>

          <div className="image-panel image-task-panel">
            <div className="image-panel-head"><div><strong>处理队列</strong><span>{tasks.length ? `共 ${tasks.length} 张图片` : "尚未选择图片"}</span></div></div>
            <div className="image-task-list">
              {tasks.length === 0 ? <div className="image-empty large"><ImagePlus size={28} />选择图片后会显示处理状态和输出路径。</div> : tasks.map((task) => (
                <div className="image-task-card" key={task.id}>
                  <div className="image-preview">{task.previewUrl ? <img src={task.previewUrl} alt="" /> : <ImagePlus size={22} />}</div>
                  <div><strong>{task.fileName}</strong><span>{task.inputPath}</span>{task.outputPath && <small>输出：{task.outputPath}</small>}{task.error && <small className="danger-text">{task.error}</small>}</div>
                  <StatusPill status={task.status} />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="image-grid-layout">
          <div className="image-panel">
            <div className="image-panel-head"><div><strong>AI 生图配置</strong><span>第一版按 OpenAI 兼容图片生成接口保存结果。</span></div></div>
            <div className="image-form-grid">
              <label><span>供应商</span><select value={genForm.provider} onChange={(event) => setGenForm((current) => ({ ...current, provider: event.target.value as ImageGenerationProvider }))}><option value="openai">OpenAI 兼容</option><option value="domestic">通义/火山类</option><option value="custom">自定义第三方</option></select></label>
              <label><span>API 地址</span><input value={genForm.apiBaseUrl} onChange={(event) => setGenForm((current) => ({ ...current, apiBaseUrl: event.target.value }))} /></label>
              <label><span>模型名</span><input value={genForm.model} onChange={(event) => setGenForm((current) => ({ ...current, model: event.target.value }))} /></label>
              <label><span>API Key</span><input type="password" value={genForm.apiKey} onChange={(event) => setGenForm((current) => ({ ...current, apiKey: event.target.value }))} placeholder="仅本次页面状态使用，不长期保存" /></label>
              <label><span>尺寸</span><input value={genForm.size} onChange={(event) => setGenForm((current) => ({ ...current, size: event.target.value }))} /></label>
              <label><span>数量</span><input type="number" min={1} max={10} value={genForm.count} onChange={(event) => setGenForm((current) => ({ ...current, count: Number(event.target.value) }))} /></label>
              <label><span>商品关键词</span><input value={genForm.keyword} onChange={(event) => setGenForm((current) => ({ ...current, keyword: event.target.value }))} placeholder="例如：奶油风桌面收纳盒" /></label>
              <label><span>场景</span><input value={genForm.scene} onChange={(event) => setGenForm((current) => ({ ...current, scene: event.target.value }))} placeholder="例如：卧室梳妆台、自然光" /></label>
              <label><span>风格</span><input value={genForm.style} onChange={(event) => setGenForm((current) => ({ ...current, style: event.target.value }))} placeholder="例如：真实买家秀、手机拍摄感" /></label>
              <label className="wide"><span>保存目录</span><div className="image-path-row"><input value={genForm.outputDir} onChange={(event) => setGenForm((current) => ({ ...current, outputDir: event.target.value }))} /><button type="button" onClick={chooseGenerationOutputDir}><FolderOpen size={16} /></button></div></label>
            </div>
            <div className="image-prompt-preview"><Wand2 size={16} /><span>{prompt || "填写关键词、场景和风格后，这里会展示即将发送给生图接口的提示词。"}</span></div>
            <div className="image-actions"><button className="primary" disabled={isGenerating} onClick={generateImages}>{isGenerating ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />} 生成图片</button></div>
          </div>

          <div className="image-panel image-results-panel">
            <div className="image-panel-head"><div><strong>生成结果</strong><span>成功后自动保存到本地目录并展示预览。</span></div></div>
            <div className="image-result-grid">
              {isGenerating && <div className="image-empty large"><Loader2 className="spin" size={28} />正在调用第三方生图接口...</div>}
              {!isGenerating && generationResults.length === 0 && <div className="image-empty large"><PaintBucket size={28} />生成后的图片会出现在这里。</div>}
              {generationResults.map((result) => (
                <div className="image-result-card" key={result.id}>
                  <div className="image-result-preview">{result.previewUrl ? <img src={result.previewUrl} alt="" /> : <ImagePlus size={26} />}</div>
                  <div><strong>{result.status === "success" ? "已保存" : "生成失败"}</strong>{result.outputPath && <span>{result.outputPath}</span>}{result.error && <small className="danger-text">{result.error}</small>}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function modeLabel(mode: ImageCropMode) {
  if (mode === "pad") return "不裁切扩边";
  if (mode === "crop-pad") return "裁切后扩边";
  return "居中裁切";
}

function StatusPill({ status }: { status: ImageProcessTask["status"] }) {
  const label = status === "pending" ? "待处理" : status === "processing" ? "处理中" : status === "success" ? "成功" : "失败";
  const icon = status === "success" ? <Check size={14} /> : status === "processing" ? <Loader2 className="spin" size={14} /> : null;
  return <span className={clsx("image-status", status)}>{icon}{label}</span>;
}
