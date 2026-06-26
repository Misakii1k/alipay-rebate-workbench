import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, FileAudio, FolderOpen, ImagePlus, Loader2, List, Play, Plus, Search, Scissors, Stethoscope, Table2, Trash2, Video, X, Zap } from "lucide-react";
import clsx from "clsx";
import type { AppSettings, FfmpegStatus, VideoCandidate, VideoRenderProgress, VideoRenderResult, VideoTask, VideoTemplateId } from "./lib/shared";
import { autoFillSliceImages, createVideoTask, isTaskReady, normalizeVideoTask, updateTaskName } from "./lib/video";

const musicPresets = [
  { id: "sunny", label: "活力轻快", source: "CC0" },
  { id: "fresh", label: "清新明亮", source: "CC0" },
  { id: "soft", label: "温柔治愈", source: "CC0" },
  { id: "urban", label: "时尚节奏", source: "CC0" },
  { id: "clean", label: "简约质感", source: "CC0" }
];

const PROGRESS_UPDATE_INTERVAL_MS = 250;
const TASK_QUEUE_WINDOW = 60;
const CANDIDATE_INITIAL_VISIBLE = 60;
const CANDIDATE_LOAD_STEP = 60;
const CANDIDATE_LOW_INITIAL_VISIBLE = 36;
const CANDIDATE_LOW_LOAD_STEP = 36;

function isCanceledRender(result: Pick<VideoRenderResult, "success" | "error">): boolean {
  return !result.success && /cancel/i.test(result.error || "");
}

function canceledRenderPatch(log?: string): Partial<VideoTask> {
  return { status: "failed", progress: 0, progressStage: "已取消", log, error: "渲染已取消。" };
}

export function VideoWorkbench({
  settings,
  resolvedPerformanceMode,
  onSaveSettings,
  onStateChange,
  showToast
}: {
  settings: AppSettings;
  resolvedPerformanceMode?: Exclude<AppSettings["performanceMode"], "auto">;
  onSaveSettings: (settings: AppSettings) => Promise<void>;
  onStateChange?: (state: { tasks: VideoTask[]; currentIndex: number }) => void;
  showToast: (message: string) => void;
}) {
  const [tasks, setTasks] = useState<VideoTask[]>([createVideoTask(settings.videoTemplate)]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [videoStateLoaded, setVideoStateLoaded] = useState(false);
  const [ffmpegStatus, setFfmpegStatus] = useState<FfmpegStatus>({ available: false, path: "", detail: "进入页面后检测 FFmpeg" });
  const [matching, setMatching] = useState(false);
  const [candidateOpen, setCandidateOpen] = useState(false);
  const [candidateView, setCandidateView] = useState<"thumb" | "list">("thumb");
  const [lastScanSpeedMode, setLastScanSpeedMode] = useState(settings.videoScanMode === "speed");
  const [processing, setProcessing] = useState(false);
  const [processingTaskId, setProcessingTaskId] = useState<string | null>(null);
  const [batchInfo, setBatchInfo] = useState("");
  const [activeSlot, setActiveSlot] = useState(0);
  const [diagnosing, setDiagnosing] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<{ items: Array<{ label: string; passed: boolean; detail: string }>; suggestions: string[]; ok: boolean } | null>(null);
  const batchCancelRef = useRef(false);
  const scanRequestRef = useRef(0);
  const pendingProgressRef = useRef<Record<string, VideoRenderProgress>>({});
  const progressFlushTimerRef = useRef<number | null>(null);
  const lastProgressPaintRef = useRef(0);
  const currentTask = tasks[currentIndex] ?? tasks[0];
  const readyCount = useMemo(() => tasks.filter(isTaskReady).length, [tasks]);
  const totalProgress = useMemo(() => (tasks.length ? Math.round(tasks.reduce((sum, task) => sum + (task.progress || 0), 0) / tasks.length) : 0), [tasks]);
  const scanMode = settings.videoScanMode ?? "auto";
  const lowPerformancePreviewMode = settings.performanceMode === "low" || (settings.performanceMode === "auto" && resolvedPerformanceMode === "low");
  const autoSpeedActive = scanMode === "auto" && lowPerformancePreviewMode;
  const effectiveVideoSpeedMode = scanMode === "speed" || autoSpeedActive;
  const disableCandidateHoverPreview = effectiveVideoSpeedMode || lastScanSpeedMode;
  const setVideoScanMode = (nextMode: AppSettings["videoScanMode"]) => {
    void onSaveSettings({ ...settings, videoScanMode: nextMode, videoSpeedMode: nextMode === "speed" });
  };
  const setVideoRenderOption = <K extends "videoOutputSize" | "videoQualityMode">(key: K, value: AppSettings[K]) => {
    void onSaveSettings({ ...settings, [key]: value });
  };

  useEffect(() => {
    window.alipayWorkbench.loadVideoWorkbenchState().then((state) => {
      if (state.tasks?.length) {
        const normalizedTasks = state.tasks.map((t) => normalizeVideoTask(t));
        setTasks(normalizedTasks);
        setCurrentIndex(Math.min(state.currentIndex ?? 0, normalizedTasks.length - 1));
      }
    }).catch(() => {
      setTasks([createVideoTask(settings.videoTemplate)]);
      setCurrentIndex(0);
    }).finally(() => setVideoStateLoaded(true));
  }, []);

  useEffect(() => {
    if (!videoStateLoaded) return;
    onStateChange?.({ tasks, currentIndex });
    const timer = window.setTimeout(() => {
      void window.alipayWorkbench.saveVideoWorkbenchState({ tasks, currentIndex });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [videoStateLoaded, tasks, currentIndex, onStateChange]);

  useEffect(() => {
    let alive = true;
    setFfmpegStatus({ available: false, path: "", detail: "正在后台检测 FFmpeg" });
    void window.alipayWorkbench.getFfmpegStatus(settings).then((status) => {
      if (alive) setFfmpegStatus(status);
    });
    return () => {
      alive = false;
    };
  }, [settings.ffmpegPath]);

  useEffect(() => {
    function applyProgressUpdates(updates: VideoRenderProgress[]) {
      if (!updates.length) return;
      const updateMap = new Map(updates.map((progress) => [progress.taskId, progress]));
      lastProgressPaintRef.current = Date.now();
      setTasks((prev) =>
        prev.map((task) => {
          const progress = updateMap.get(task.id);
          if (!progress || task.status === "done" || task.status === "failed") return task;
          return { ...task, progress: progress.percent, progressStage: progress.stage, status: "processing" };
        })
      );
    }

    function flushProgressUpdates() {
      progressFlushTimerRef.current = null;
      const updates = Object.values(pendingProgressRef.current);
      pendingProgressRef.current = {};
      applyProgressUpdates(updates);
    }

    const unsubscribe = window.alipayWorkbench.onVideoRenderProgress((progress) => {
      pendingProgressRef.current[progress.taskId] = progress;
      const elapsed = Date.now() - lastProgressPaintRef.current;
      const delay = Math.max(0, PROGRESS_UPDATE_INTERVAL_MS - elapsed);
      if (delay === 0) {
        if (progressFlushTimerRef.current !== null) window.clearTimeout(progressFlushTimerRef.current);
        flushProgressUpdates();
        return;
      }
      if (progressFlushTimerRef.current === null) {
        progressFlushTimerRef.current = window.setTimeout(flushProgressUpdates, delay);
      }
    });

    return () => {
      unsubscribe();
      if (progressFlushTimerRef.current !== null) window.clearTimeout(progressFlushTimerRef.current);
      progressFlushTimerRef.current = null;
      pendingProgressRef.current = {};
    };
  }, []);

  function updateCurrent(patch: Partial<VideoTask>) {
    setTasks((prev) => prev.map((task, index) => (index === currentIndex ? { ...task, ...patch } : task)));
  }

  async function chooseDirectory(kind: "library" | "output") {
    const result = await window.alipayWorkbench.selectDirectory(kind === "library" ? "选择视频库文件夹" : "选择输出文件夹", kind === "library" ? "videoLibrary" : "videoOutput");
    if (result.canceled || !result.paths[0]) return;
    await onSaveSettings({ ...settings, [kind === "library" ? "videoLibraryDir" : "videoOutputDir"]: result.paths[0] });
  }

  function applyImagePaths(paths: string[], targetSlot?: number) {
    const images = paths.filter((filePath) => /\.(jpe?g|png|webp|bmp)$/i.test(filePath));
    if (!images.length) return;
    const namePatch = currentTask.outputName ? {} : updateTaskName(currentTask, baseName(images[0]));
    if (currentTask.template === "video-slice") {
      if (images.length === 1 && targetSlot !== undefined) {
        const newPaths = [...(currentTask.imagePaths.length === 5 ? currentTask.imagePaths : Array<string>(5).fill(""))];
        newPaths[targetSlot] = images[0];
        updateCurrent({ ...namePatch, imagePaths: newPaths, imagePath: newPaths.find(Boolean) ?? "" });
        const nextEmpty = newPaths.findIndex((p, i) => i > targetSlot && !p);
        const fallback = newPaths.findIndex((p) => !p);
        setActiveSlot(nextEmpty !== -1 ? nextEmpty : fallback !== -1 ? fallback : targetSlot);
      } else {
        const filled = autoFillSliceImages(images);
        updateCurrent({ ...namePatch, imagePaths: filled, imagePath: images[0] ?? "" });
        const nextEmpty = filled.findIndex((p) => !p);
        setActiveSlot(nextEmpty !== -1 ? nextEmpty : 0);
      }
    } else if (images.length > 1) {
      const newTasks = images.map((imgPath) => {
        const task = createVideoTask(currentTask.template);
        const patch = updateTaskName(task, baseName(imgPath));
        return { ...task, ...patch, imagePath: imgPath, imagePaths: [imgPath] };
      });
      setTasks((prev) => [...prev, ...newTasks]);
      setCurrentIndex(tasks.length);
      showToast(`已为 ${newTasks.length} 张图片创建独立任务，请分别选择视频。`);
    } else {
      updateCurrent({ ...namePatch, imagePath: images[0], imagePaths: [images[0]] });
    }
  }

  function removeSliceImage(slot: number) {
    const newPaths = [...(currentTask.imagePaths.length === 5 ? currentTask.imagePaths : Array<string>(5).fill(""))];
    newPaths[slot] = "";
    updateCurrent({ imagePaths: newPaths, imagePath: newPaths.find(Boolean) ?? "" });
    setActiveSlot(slot);
  }

  async function chooseSlotImage(slot: number) {
    const result = await window.alipayWorkbench.selectFiles({ kind: "image", multi: false });
    if (!result.canceled && result.paths[0]) applyImagePaths([result.paths[0]], slot);
  }

  async function chooseImages() {
    const result = await window.alipayWorkbench.selectFiles({ kind: "image", multi: true });
    if (result.canceled || !result.paths.length) return;
    applyImagePaths(result.paths);
  }

  async function chooseLatestImage() {
    const result = await window.alipayWorkbench.selectDirectory("选择图片所在文件夹", "mediaRoot");
    if (result.canceled || !result.paths[0]) return;
    const latest = await window.alipayWorkbench.getLatestImageInDirectory(result.paths[0]);
    if (!latest) {
      showToast("这个文件夹里没有找到图片。");
      return;
    }
    applyImagePaths([latest]);
  }

  function applyVideoPath(paths: string[]) {
    const video = paths.find((filePath) => /\.(mp4|mov|mkv|avi|webm)$/i.test(filePath));
    if (video) updateCurrent({ videoPath: video });
  }

  async function chooseVideo() {
    const result = await window.alipayWorkbench.selectFiles({ kind: "video", multi: false });
    if (!result.canceled) applyVideoPath(result.paths);
  }

  async function chooseMusic() {
    const result = await window.alipayWorkbench.selectFiles({ kind: "audio", multi: false });
    if (result.canceled || !result.paths[0]) return;
    updateCurrent({ musicPath: result.paths[0], musicPresetId: "custom" });
    await onSaveSettings({ ...settings, sliceCustomMusicPath: result.paths[0], sliceMusicPresetId: "custom" });
  }

  async function chooseFfmpeg() {
    const result = await window.alipayWorkbench.selectFiles({ kind: "ffmpeg", multi: false });
    if (result.canceled || !result.paths[0]) return;
    await onSaveSettings({ ...settings, ffmpegPath: result.paths[0] });
  }

  async function runDiagnosis() {
    setDiagnosing(true);
    setDiagnosis(null);
    try {
      const result = await window.alipayWorkbench.diagnoseFfmpeg(settings);
      setDiagnosis(result);
      showToast(result.ok ? "FFmpeg 诊断通过，所有检查项正常。" : "发现问题，请查看诊断结果。");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "诊断失败");
    } finally {
      setDiagnosing(false);
    }
  }

  async function runAutoFix() {
    setFixing(true);
    try {
      const result = await window.alipayWorkbench.autoFixFfmpeg(settings);
      if (result.settingsPatch) {
        await onSaveSettings({ ...settings, ...result.settingsPatch });
      }
      const msgs: string[] = [];
      if (result.fixed.length) msgs.push("已修复: " + result.fixed.join("、"));
      if (result.failed.length) msgs.push("未能修复: " + result.failed.join("、"));
      showToast(msgs.join(" | ") || "未发现可修复项");
      await runDiagnosis();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "自动修复失败");
    } finally {
      setFixing(false);
    }
  }

  async function smartMatch() {
    if (currentTask.template === "video-slice") {
      showToast("视频切片模板只需要图片和音乐。");
      return;
    }
    setMatching(true);
    const requestSeq = scanRequestRef.current + 1;
    const scanSpeedMode = Boolean(effectiveVideoSpeedMode);
    scanRequestRef.current = requestSeq;
    setLastScanSpeedMode(scanSpeedMode);
    try {
      const requestId = `video-scan-${Date.now()}-${requestSeq}`;
      const candidates = await window.alipayWorkbench.scanVideoLibrary(settings, currentTask.productName, currentTask.colorName, scanSpeedMode, requestId);
      if (scanRequestRef.current !== requestSeq) return;
      updateCurrent({ candidates });
      setCandidateOpen(true);
      const scanNote = scanSpeedMode
        ? autoSpeedActive
          ? "低性能模式已自动跳过缩略图。"
          : "极速模式已跳过缩略图。"
        : "标准预览已加载缩略图。";
      showToast(candidates.length ? `找到 ${candidates.length} 个候选素材，${scanNote}` : `没有找到足够匹配的素材，${scanNote}`);
    } catch (error) {
      if (scanRequestRef.current !== requestSeq) return;
      showToast(error instanceof Error ? error.message : "智能选择失败");
    } finally {
      if (scanRequestRef.current === requestSeq) setMatching(false);
    }
  }

  async function renderCurrent() {
    if (!ffmpegStatus.available) {
      showToast(ffmpegStatus.detail || "FFmpeg 不可用，暂时不能剪辑。");
      return;
    }
    if (!isTaskReady(currentTask)) {
      showToast(currentTask.template === "video-slice" ? "请补齐 5 张图片和文件名。" : "请补齐图片、视频和文件名。");
      return;
    }
    batchCancelRef.current = false;
    setProcessing(true);
    setProcessingTaskId(currentTask.id);
    updateCurrent({ status: "processing", progress: 5, progressStage: "排队中", error: "" });
    try {
      const result = await window.alipayWorkbench.renderVideoTask({ task: currentTask, settings });
      if (isCanceledRender(result)) {
        updateCurrent(canceledRenderPatch(result.log));
        showToast("已取消当前渲染任务。");
        return;
      }
      updateCurrent({ status: result.success ? "done" : "failed", progress: result.success ? 100 : 0, progressStage: result.success ? "完成" : "失败", outputPath: result.outputPath, log: result.log, error: result.error });
      showToast(result.success ? `已生成：${result.outputPath}` : result.error || "剪辑失败");
    } catch (error) {
      const message = error instanceof Error ? error.message : "剪辑失败";
      updateCurrent({ status: "failed", progress: 0, progressStage: "失败", error: message });
      showToast(message);
    } finally {
      setProcessing(false);
      setProcessingTaskId(null);
    }
  }

  async function renderAllReady() {
    const readyTasks = tasks.map((task, index) => ({ task, index })).filter(({ task }) => isTaskReady(task));
    if (!ffmpegStatus.available) {
      showToast(ffmpegStatus.detail || "FFmpeg 不可用，暂时不能剪辑。");
      return;
    }
    if (!readyTasks.length) {
      showToast("没有可制作的任务。");
      return;
    }
    batchCancelRef.current = false;
    setProcessing(true);
    let done = 0;
    let failed = 0;
    for (const { task, index } of readyTasks) {
      if (batchCancelRef.current) break;
      setCurrentIndex(index);
      setProcessingTaskId(task.id);
      setBatchInfo(`正在剪辑 ${index + 1}/${tasks.length}：${task.outputName || "未命名"}`);
      setTasks((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, status: "processing", progress: 5, progressStage: "排队中", error: "" } : item)));
      try {
        const result = await window.alipayWorkbench.renderVideoTask({ task, settings });
        if (isCanceledRender(result)) {
          failed += 1;
          batchCancelRef.current = true;
          setTasks((prev) =>
            prev.map((item, itemIndex) => (itemIndex === index ? { ...item, ...canceledRenderPatch(result.log) } : item))
          );
          break;
        }
        if (result.success) done += 1;
        else failed += 1;
        setTasks((prev) =>
          prev.map((item, itemIndex) =>
            itemIndex === index ? { ...item, status: result.success ? "done" : "failed", progress: result.success ? 100 : 0, progressStage: result.success ? "完成" : "失败", outputPath: result.outputPath, log: result.log, error: result.error } : item
          )
        );
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : "剪辑失败";
        setTasks((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, status: "failed", progress: 0, progressStage: "失败", error: message } : item)));
      }
      setBatchInfo(`批量进度：成功 ${done}，失败 ${failed}，共 ${readyTasks.length}`);
    }
    const batchCanceled = batchCancelRef.current;
    setProcessing(false);
    setProcessingTaskId(null);
    if (batchCanceled) {
      showToast(`批量渲染已取消：成功 ${done}，未完成 ${Math.max(0, readyTasks.length - done - failed)}`);
      return;
    }
    showToast(`批量制作结束：成功 ${done}，失败 ${failed}`);
  }

  async function cancelRender() {
    if (!processingTaskId) return;
    batchCancelRef.current = true;
    const result = await window.alipayWorkbench.cancelVideoRender(processingTaskId);
    if (result.canceled) {
      setTasks((prev) =>
        prev.map((task) =>
          task.id === processingTaskId
            ? { ...task, status: "failed", progress: 0, progressStage: "已取消", error: "渲染已取消" }
            : task
        )
      );
      setProcessing(false);
      setProcessingTaskId(null);
      showToast("已取消当前渲染任务。");
    }
  }

  function removeTask(index: number) {
    setTasks((prev) => {
      if (prev.length <= 1) return [createVideoTask(currentTask.template)];
      return prev.filter((_, i) => i !== index);
    });
    setCurrentIndex((prev) => {
      if (tasks.length <= 1) return 0;
      if (prev >= index && prev > 0) return prev - 1;
      return prev;
    });
  }

  function clearAllTasks() {
    setTasks([createVideoTask(currentTask.template)]);
    setCurrentIndex(0);
  }

  function addTask(template: VideoTemplateId = currentTask.template) {
    setTasks((prev) => [...prev, createVideoTask(template)]);
    setCurrentIndex(tasks.length);
  }

  if (!videoStateLoaded) {
    return (
      <section className="video-workbench">
        <div className="hint-card"><Loader2 className="spin" size={16} /> 正在加载视频任务...</div>
      </section>
    );
  }

  return (
    <section className="video-workbench">
      <div className="tool-header video-status-header">
        <div className={clsx("status-pill", ffmpegStatus.available ? "double-check" : "model failed")}>
          <Scissors size={15} /> {ffmpegStatus.available ? `FFmpeg：${ffmpegStatus.acceleration || "可用"}` : "FFmpeg：未就绪"}
        </div>
      </div>

      <div className="video-settings-strip" data-tour="video-paths">
        <PathBadge label="视频库" value={settings.videoLibraryDir} onPick={() => chooseDirectory("library")} />
        <PathBadge label="输出目录" value={settings.videoOutputDir} onPick={() => chooseDirectory("output")} />
        <button className="secondary-action light" onClick={runDiagnosis} disabled={diagnosing} title="检查并诊断 FFmpeg 配置">
          {diagnosing ? <Loader2 className="spin" size={16} /> : <Stethoscope size={16} />} 诊断修复
        </button>
      </div>

      <div className="video-render-strip">
        <label>
          <span>视频尺寸</span>
          <select value={settings.videoOutputSize} onChange={(event) => setVideoRenderOption("videoOutputSize", event.target.value as AppSettings["videoOutputSize"])}>
            <option value="auto">自动保真</option>
            <option value="portrait-1080">1080 × 1440</option>
            <option value="portrait-1440">1440 × 1920</option>
          </select>
        </label>
        <label>
          <span>画质</span>
          <select value={settings.videoQualityMode} onChange={(event) => setVideoRenderOption("videoQualityMode", event.target.value as AppSettings["videoQualityMode"])}>
            <option value="preserve">保真优先</option>
            <option value="high">高清优先</option>
            <option value="balanced">标准</option>
          </select>
        </label>
        <div className="video-render-note">自动保真会优先沿用原视频尺寸和帧率，尽量减少二次压缩损失。</div>
      </div>

      <div className="template-switch" data-tour="video-template">
        <button className={clsx(currentTask.template !== "video-slice" && "active")} onClick={() => updateCurrent({ template: "bos-template" as VideoTemplateId })} title="切换到帛先生视频模板">帛先生模板</button>
        <button className={clsx(currentTask.template === "video-slice" && "active")} onClick={() => updateCurrent({ template: "video-slice" as VideoTemplateId })} title="切换到 5 图 4 转场的视频切片模板">视频切片</button>
        <span>{ffmpegStatus.detail}</span>
      </div>

      <div className={clsx("video-layout", currentTask.template === "video-slice" && "slice-mode")} data-tour="video-assets">
        <UploadBox
          title={currentTask.template === "video-slice" ? "上传 5 张图片" : "上传图片"}
          icon="image"
          onClick={currentTask.template === "video-slice" ? () => chooseSlotImage(activeSlot) : chooseImages}
          onDropFiles={currentTask.template === "video-slice" ? (paths) => applyImagePaths(paths, activeSlot) : applyImagePaths}
        >
          {currentTask.template === "video-slice" ? (
            <SliceImageGrid
              task={currentTask}
              activeSlot={activeSlot}
              onSlotClick={(slot) => { setActiveSlot(slot); void chooseSlotImage(slot); }}
              onSlotDrop={(slot, paths) => applyImagePaths(paths, slot)}
              onSlotRemove={removeSliceImage}
            />
          ) : <FilePreview path={currentTask.imagePath} />}
          <button type="button" className="inline-mini" onClick={(event) => { event.stopPropagation(); void chooseLatestImage(); }} title="从文件夹中选择最新图片">选择最新图片</button>
        </UploadBox>

        <div className="rename-panel">
          <label>
            <span>成片文件名</span>
            <input value={currentTask.outputName} onChange={(event) => updateCurrent(updateTaskName(currentTask, event.target.value))} placeholder="彩棉317-黑" />
          </label>
          <div className="name-breakdown">
            <span>商品名：{currentTask.productName || "待填写"}</span>
            <span>颜色/型号：{currentTask.colorName || "待填写"}</span>
          </div>
          {currentTask.template === "video-slice" && (
            <MusicPicker task={currentTask} settings={settings} onPreset={(id) => updateCurrent({ musicPresetId: id, musicPath: "" })} onCustom={chooseMusic} />
          )}
          <TaskQueue tasks={tasks} currentIndex={currentIndex} onPick={setCurrentIndex} onRemove={removeTask} />
        </div>

        {currentTask.template !== "video-slice" && (
          <UploadBox title="上传视频" icon="video" onClick={chooseVideo} onDropFiles={applyVideoPath}>
            <FilePreview path={currentTask.videoPath} />
          </UploadBox>
        )}
      </div>

      <div className="video-progress-panel">
        <div>
          <strong>{currentTask.progressStage || "等待剪辑"}</strong>
          <span>{batchInfo || `当前任务进度 ${currentTask.progress || 0}%`}</span>
        </div>
        <div className="video-progress"><i style={{ width: `${currentTask.progress || 0}%` }} /></div>
        <small>总进度 {totalProgress}%</small>
      </div>

      <div className={clsx("scan-mode-strip", effectiveVideoSpeedMode ? "speed" : "preview")}>
        <div>
          <strong>{scanMode === "speed" ? "当前扫描：极速模式 ON" : autoSpeedActive ? "当前扫描：低配极速 AUTO" : "当前扫描：标准预览"}</strong>
          <span>{effectiveVideoSpeedMode ? "跳过候选缩略图，优先保持扫描流畅。" : "加载候选缩略图，保留素材预览。"}</span>
        </div>
        <em>{matching ? "正在扫描" : effectiveVideoSpeedMode ? "缩略图已关闭" : "缩略图已开启"}</em>
      </div>

      <div className="video-actions" data-tour="video-actions">
        <button className="secondary-action light" onClick={() => addTask()} title="添加一个新的剪辑任务到队列末尾"><Plus size={17} /> 下一个视频</button>
        <button className="secondary-action light" onClick={smartMatch} disabled={matching || currentTask.template === "video-slice"} title="扫描视频库，按商品名和颜色智能匹配素材">
          {matching ? <Loader2 className="spin" size={17} /> : <Search size={17} />} 智能选择
        </button>
        <div className="scan-mode-control" role="group" aria-label="视频扫描模式">
          <button className={clsx(scanMode === "auto" && "active", autoSpeedActive && "auto-speed")} type="button" onClick={() => setVideoScanMode("auto")} title="自动：低配设备自动启用极速扫描">
            自动
          </button>
          <button className={clsx(scanMode === "speed" && "active speed")} type="button" onClick={() => setVideoScanMode("speed")} title="极速模式：跳过缩略图，扫描更快">
            <Zap size={13} /> 极速
          </button>
          <button className={clsx(scanMode === "preview" && "active preview")} type="button" onClick={() => setVideoScanMode("preview")} title="标准预览：加载候选缩略图">
            标准
          </button>
        </div>
        <button className="primary" onClick={renderCurrent} disabled={processing || !ffmpegStatus.available} title="使用 FFmpeg 渲染当前任务的视频">
          {processing ? <Loader2 className="spin" size={18} /> : <Play size={18} />} 开始制作
        </button>
        {processing && (
          <button className="secondary-action light danger-ghost" onClick={() => void cancelRender()} title="取消当前正在渲染的 FFmpeg 任务">
            <X size={17} /> 取消渲染
          </button>
        )}
        <button className="secondary-action" onClick={renderAllReady} disabled={processing || !ffmpegStatus.available} title="依次渲染所有素材已就绪的任务">
          <Check size={17} /> 批量制作全部
        </button>
        <button className="secondary-action light danger-ghost" onClick={clearAllTasks} disabled={processing} title="删除所有任务记录和输出文件引用">
          <Trash2 size={17} /> 清空记录
        </button>
        <span className="queue-summary">任务 {currentIndex + 1} / {tasks.length}，可制作 {readyCount} 条</span>
      </div>

      {currentTask.error && (
        <div className="error-banner">
          <span>{currentTask.error}</span>
          {currentTask.log && <details><summary>查看完整日志</summary><pre className="error-log-detail">{currentTask.log}</pre></details>}
        </div>
      )}
      {diagnosis && (
        <div className="diagnosis-panel">
          <strong>FFmpeg 诊断结果</strong>
          <div className="diagnosis-items">
            {diagnosis.items.map((item) => (
              <div key={item.label} className={clsx("diagnosis-item", item.passed ? "pass" : "fail")}>
                <span>{item.passed ? "✓" : "✗"}</span>
                <strong>{item.label}</strong>
                <em>{item.detail}</em>
              </div>
            ))}
          </div>
          <div className="diagnosis-suggestions">
            {diagnosis.suggestions.map((s, i) => <p key={i}>{s}</p>)}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {!diagnosis.ok && (
              <button className="secondary-action compact" onClick={runAutoFix} disabled={fixing} title="尝试自动修复 FFmpeg 配置问题">
                {fixing ? <><Loader2 className="spin" size={14} /> 修复中…</> : "尝试自动修复"}
              </button>
            )}
            <button className="secondary-action light compact" onClick={() => setDiagnosis(null)} title="关闭诊断结果">关闭诊断</button>
          </div>
        </div>
      )}
      {currentTask.outputPath && <div className="result-box"><strong>输出文件</strong><span>{currentTask.outputPath}</span></div>}
      {candidateOpen && (
        <CandidateModal
          candidates={currentTask.candidates}
          view={candidateView}
          speedMode={lastScanSpeedMode}
          hoverPreviewDisabled={disableCandidateHoverPreview}
          lowPerformancePreviewMode={lowPerformancePreviewMode}
          onViewChange={setCandidateView}
          onClose={() => setCandidateOpen(false)}
          onPick={(candidate) => {
            if (candidate.kind === "image") updateCurrent({ imagePath: candidate.path, imagePaths: [candidate.path] });
            else updateCurrent({ videoPath: candidate.path });
            setCandidateOpen(false);
          }}
        />
      )}
    </section>
  );
}

function baseName(filePath: string) {
  return (filePath.split(/[\\/]/).pop() || "").replace(/\.[^.]+$/, "");
}

function PathBadge({ label, value, onPick }: { label: string; value: string; onPick: () => void }) {
  return (
    <button className="path-badge" onClick={onPick} title="选择路径">
      <FolderOpen size={16} />
      <span>{label}</span>
      <strong>{value || "未选择"}</strong>
    </button>
  );
}

function UploadBox({
  title,
  icon,
  onClick,
  onDropFiles,
  children
}: {
  title: string;
  icon: "image" | "video";
  onClick: () => void;
  onDropFiles: (paths: string[]) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="upload-box"
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onClick();
      }}
      title={`点击选择${icon === "image" ? "图片" : "视频"}文件，也可以直接拖拽文件到此处`}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const paths = Array.from(event.dataTransfer.files)
          .map((file) => window.alipayWorkbench.getPathForFile(file))
          .filter(Boolean);
        onDropFiles(paths);
      }}
    >
      {icon === "image" ? <ImagePlus size={34} /> : <Video size={34} />}
      <strong>{title}</strong>
      <span>拖拽文件或点击选择</span>
      {children}
    </div>
  );
}

function FilePreview({ path }: { path: string }) {
  return <em className="file-preview">{path ? path.split(/[\\/]/).pop() : "尚未选择"}</em>;
}

function SliceImageGrid({ task, activeSlot, onSlotClick, onSlotDrop, onSlotRemove }: {
  task: VideoTask;
  activeSlot: number;
  onSlotClick: (slot: number) => void;
  onSlotDrop: (slot: number, paths: string[]) => void;
  onSlotRemove: (slot: number) => void;
}) {
  return (
    <div className="slice-grid">
      {Array.from({ length: 5 }).map((_, index) => {
        const filled = Boolean(task.imagePaths[index]);
        return (
          <div
            key={index}
            className={clsx("slice-slot", filled && "filled", index === activeSlot && "active")}
            onClick={() => onSlotClick(index)}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const paths = Array.from(e.dataTransfer.files).map((f) => window.alipayWorkbench.getPathForFile(f)).filter(Boolean);
              onSlotDrop(index, paths);
            }}
          >
            <span>{index + 1}</span>
            {filled && (
              <button className="slice-slot-delete" onClick={(e) => { e.stopPropagation(); onSlotRemove(index); }} title="删除这个图片槽位">
                <Trash2 size={11} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MusicPicker({ task, settings, onPreset, onCustom }: { task: VideoTask; settings: AppSettings; onPreset: (id: string) => void; onCustom: () => void }) {
  const active = task.musicPresetId || settings.sliceMusicPresetId;
  return (
    <div className="music-picker">
      <span><FileAudio size={15} /> 切片音乐 <b>内置 CC0</b></span>
      <div className="music-grid">
        {musicPresets.map((item) => (
          <button key={item.id} className={clsx(active === item.id && "active")} onClick={() => onPreset(item.id)} title="选择这首内置音乐">{item.label}<small>{item.source}</small></button>
        ))}
        <button className={clsx(active === "custom" && "active")} onClick={onCustom} title="选择自定义音乐文件">自选音乐</button>
      </div>
      <em>{task.musicPath || settings.sliceCustomMusicPath || "未选择音乐时会生成无音乐视频"}</em>
    </div>
  );
}

function TaskQueue({ tasks, currentIndex, onPick, onRemove }: { tasks: VideoTask[]; currentIndex: number; onPick: (index: number) => void; onRemove: (index: number) => void }) {
  const clampedIndex = Math.min(Math.max(currentIndex, 0), Math.max(tasks.length - 1, 0));
  const halfWindow = Math.floor(TASK_QUEUE_WINDOW / 2);
  const windowStart = Math.min(Math.max(0, clampedIndex - halfWindow), Math.max(0, tasks.length - TASK_QUEUE_WINDOW));
  const visibleTasks = tasks.slice(windowStart, windowStart + TASK_QUEUE_WINDOW);
  const windowEnd = windowStart + visibleTasks.length;

  return (
    <div className="task-queue">
      {tasks.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="6" width="18" height="12" rx="2" />
              <path d="M10 9v6M14 9v6" />
            </svg>
          </div>
          <div className="empty-state-title">队列为空</div>
          <div className="empty-state-desc">选择视频模板并上传素材后,将在此显示渲染队列</div>
        </div>
      )}
      {tasks.length > visibleTasks.length && (
        <div className="task-queue-window-status">
          显示 {windowStart + 1}-{windowEnd} / {tasks.length} 个任务
        </div>
      )}
      {visibleTasks.map((task, offset) => {
        const index = windowStart + offset;
        return (
        <div key={task.id} className={clsx("task-queue-item list-item", index === currentIndex && "active", task.status)} style={{ "--i": offset } as React.CSSProperties}>
          <button className="task-queue-label" onClick={() => onPick(index)} title="切换到这个视频任务">
            <span>{index + 1}. {task.outputName || "未命名"}</span>
            <em>{task.progress ? `${task.progress}%` : ""}</em>
          </button>
          <button className="task-queue-delete" onClick={() => onRemove(index)} title="删除这个视频任务"><Trash2 size={13} /></button>
        </div>
        );
      })}
    </div>
  );
}

function CandidateThumb({ candidate, hoverPreviewDisabled, speedMode }: { candidate: VideoCandidate; hoverPreviewDisabled: boolean; speedMode: boolean }) {
  const [hovering, setHovering] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isVideo = candidate.kind === "video";
  const isElectron = Boolean(window.alipayWorkbench && !(window.alipayWorkbench as unknown as Record<string, unknown>).__mock);
  const showSkippedThumbnail = speedMode && !candidate.thumbnailDataUrl;

  const handleEnter = useCallback(() => { if (isVideo && !hoverPreviewDisabled) setHovering(true); }, [hoverPreviewDisabled, isVideo]);
  const handleLeave = useCallback(() => {
    setHovering(false);
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.removeAttribute("src"); videoRef.current.load(); }
  }, []);

  useEffect(() => {
    if (hovering && isVideo && videoRef.current && isElectron && !hoverPreviewDisabled) {
      const normalizedPath = candidate.path.replace(/\\/g, "/");
      videoRef.current.src = `file:///${normalizedPath.replace(/^\/+/, "")}`;
      videoRef.current.play().catch(() => {/* ignore autoplay errors */});
    }
  }, [hovering, hoverPreviewDisabled, isVideo, isElectron, candidate.path]);

  return (
    <div className={clsx("candidate-thumb", hoverPreviewDisabled && "preview-disabled", showSkippedThumbnail && "thumbnail-skipped")} onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      {candidate.thumbnailDataUrl ? <img src={candidate.thumbnailDataUrl} alt="" /> : <Video size={28} />}
      {showSkippedThumbnail && <span className="candidate-thumb-note">极速模式已跳过缩略图</span>}
      {hovering && isVideo && isElectron && !hoverPreviewDisabled && (
        <video ref={videoRef} className="candidate-video-preview" muted loop playsInline />
      )}
      {isVideo && <span className="candidate-play-badge"><Play size={12} /></span>}
    </div>
  );
}

function CandidateModal({
  candidates,
  view,
  speedMode,
  hoverPreviewDisabled,
  lowPerformancePreviewMode,
  onViewChange,
  onClose,
  onPick
}: {
  candidates: VideoCandidate[];
  view: "thumb" | "list";
  speedMode: boolean;
  hoverPreviewDisabled: boolean;
  lowPerformancePreviewMode: boolean;
  onViewChange: (view: "thumb" | "list") => void;
  onClose: () => void;
  onPick: (candidate: VideoCandidate) => void;
}) {
  const previewDisabledReason = speedMode ? "极速模式已关闭缩略图与悬停预览。" : lowPerformancePreviewMode ? "低性能模式下已关闭悬停视频预览。" : "";
  const initialVisible = lowPerformancePreviewMode ? CANDIDATE_LOW_INITIAL_VISIBLE : CANDIDATE_INITIAL_VISIBLE;
  const loadStep = lowPerformancePreviewMode ? CANDIDATE_LOW_LOAD_STEP : CANDIDATE_LOAD_STEP;
  const [visibleCount, setVisibleCount] = useState(initialVisible);
  const visibleCandidates = candidates.slice(0, visibleCount);
  const hasMore = visibleCount < candidates.length;

  useEffect(() => {
    setVisibleCount(initialVisible);
  }, [candidates.length, initialVisible, view]);

  return (
    <div className="modal-backdrop">
      <div className="candidate-modal wide">
        <div className="modal-title">
          <div>
            <strong>智能推荐素材</strong>
            {previewDisabledReason && <span className="candidate-modal-note">{previewDisabledReason}</span>}
          </div>
          <div className="modal-tools">
            <button onClick={() => onViewChange("thumb")} className={clsx(view === "thumb" && "active")} title="缩略图视图"><Table2 size={17} /></button>
            <button onClick={() => onViewChange("list")} className={clsx(view === "list" && "active")} title="列表视图"><List size={17} /></button>
            <button onClick={onClose} title="关闭弹窗"><X size={18} /></button>
          </div>
        </div>
        <div className={clsx("candidate-list", view)}>
          {candidates.length ? visibleCandidates.map((candidate) => (
            <button key={candidate.path} onClick={() => onPick(candidate)} title="选择这个推荐素材">
              {view === "thumb" && <CandidateThumb candidate={candidate} hoverPreviewDisabled={hoverPreviewDisabled} speedMode={speedMode} />}
              <strong>{candidate.fileName}</strong>
              <span>匹配度 {candidate.score} · {candidate.reason}</span>
              {speedMode && !candidate.thumbnailDataUrl && <span className="candidate-speed-note">极速模式跳过缩略图，并非加载失败</span>}
              <em>{candidate.matchedPath || candidate.path}</em>
            </button>
          )) : <div className="empty">没有找到匹配素材。</div>}
        </div>
        {candidates.length > 0 && (
          <div className="candidate-list-footer">
            <span>已显示 {Math.min(visibleCount, candidates.length)} / {candidates.length} 个候选</span>
            {hasMore && (
              <button className="candidate-load-more" onClick={() => setVisibleCount((prev) => Math.min(candidates.length, prev + loadStep))} title="继续加载更多推荐素材">
                加载更多
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
