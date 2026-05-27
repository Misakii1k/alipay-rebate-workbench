import { useEffect, useMemo, useState } from "react";
import { Check, FileAudio, FolderOpen, ImagePlus, Loader2, List, Play, Plus, Search, Scissors, Stethoscope, Table2, Trash2, Video, X } from "lucide-react";
import clsx from "clsx";
import type { AppSettings, FfmpegStatus, VideoCandidate, VideoRenderProgress, VideoTask, VideoTemplateId } from "./lib/shared";
import { autoFillSliceImages, createVideoTask, isTaskReady, normalizeVideoTask, updateTaskName } from "./lib/video";

const musicPresets = [
  { id: "sunny", label: "活力轻快", source: "CC0" },
  { id: "fresh", label: "清新明亮", source: "CC0" },
  { id: "soft", label: "温柔治愈", source: "CC0" },
  { id: "urban", label: "时尚节奏", source: "CC0" },
  { id: "clean", label: "简约质感", source: "CC0" }
];

export function VideoWorkbench({
  settings,
  onSaveSettings,
  onStateChange,
  showToast
}: {
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => Promise<void>;
  onStateChange?: (state: { tasks: VideoTask[]; currentIndex: number }) => void;
  showToast: (message: string) => void;
}) {
  const [tasks, setTasks] = useState<VideoTask[]>([createVideoTask(settings.videoTemplate)]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [ffmpegStatus, setFfmpegStatus] = useState<FfmpegStatus>({ available: false, path: "", detail: "进入页面后检测 FFmpeg" });
  const [matching, setMatching] = useState(false);
  const [candidateOpen, setCandidateOpen] = useState(false);
  const [candidateView, setCandidateView] = useState<"thumb" | "list">("thumb");
  const [processing, setProcessing] = useState(false);
  const [batchInfo, setBatchInfo] = useState("");
  const [activeSlot, setActiveSlot] = useState(0);
  const [diagnosing, setDiagnosing] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<{ items: Array<{ label: string; passed: boolean; detail: string }>; suggestions: string[]; ok: boolean } | null>(null);
  const currentTask = tasks[currentIndex] ?? tasks[0];
  const readyCount = useMemo(() => tasks.filter(isTaskReady).length, [tasks]);
  const totalProgress = useMemo(() => (tasks.length ? Math.round(tasks.reduce((sum, task) => sum + (task.progress || 0), 0) / tasks.length) : 0), [tasks]);

  useEffect(() => {
    window.alipayWorkbench.loadVideoWorkbenchState().then((state) => {
      if (state.tasks?.length) {
        const normalizedTasks = state.tasks.map(normalizeVideoTask);
        setTasks(normalizedTasks);
        setCurrentIndex(Math.min(state.currentIndex ?? 0, normalizedTasks.length - 1));
      }
    });
  }, []);

  useEffect(() => {
    onStateChange?.({ tasks, currentIndex });
    const timer = window.setTimeout(() => {
      void window.alipayWorkbench.saveVideoWorkbenchState({ tasks, currentIndex });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [tasks, currentIndex, onStateChange]);

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
    return window.alipayWorkbench.onVideoRenderProgress((progress) => {
      setTasks((prev) =>
        prev.map((task) =>
          task.id === progress.taskId
            ? { ...task, progress: progress.percent, progressStage: progress.stage, status: "processing" }
            : task
        )
      );
    });
  }, []);

  function updateCurrent(patch: Partial<VideoTask>) {
    setTasks((prev) => prev.map((task, index) => (index === currentIndex ? { ...task, ...patch } : task)));
  }

  async function chooseDirectory(kind: "library" | "output") {
    const result = await window.alipayWorkbench.selectDirectory(kind === "library" ? "选择视频库文件夹" : "选择输出文件夹");
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
    const result = await window.alipayWorkbench.selectDirectory("选择图片所在文件夹");
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
    try {
      const candidates = await window.alipayWorkbench.scanVideoLibrary(settings, currentTask.productName, currentTask.colorName);
      updateCurrent({ candidates });
      setCandidateOpen(true);
      showToast(candidates.length ? `找到 ${candidates.length} 个候选素材。` : "没有找到足够匹配的素材。");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "智能选择失败");
    } finally {
      setMatching(false);
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
    setProcessing(true);
    updateCurrent({ status: "processing", progress: 5, progressStage: "排队中", error: "" });
    try {
      const result = await window.alipayWorkbench.renderVideoTask({ task: currentTask, settings });
      updateCurrent({ status: result.success ? "done" : "failed", progress: result.success ? 100 : 0, progressStage: result.success ? "完成" : "失败", outputPath: result.outputPath, log: result.log, error: result.error });
      showToast(result.success ? `已生成：${result.outputPath}` : result.error || "剪辑失败");
    } catch (error) {
      const message = error instanceof Error ? error.message : "剪辑失败";
      updateCurrent({ status: "failed", progress: 0, progressStage: "失败", error: message });
      showToast(message);
    } finally {
      setProcessing(false);
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
    setProcessing(true);
    let done = 0;
    let failed = 0;
    for (const { task, index } of readyTasks) {
      setCurrentIndex(index);
      setBatchInfo(`正在剪辑 ${index + 1}/${tasks.length}：${task.outputName || "未命名"}`);
      setTasks((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, status: "processing", progress: 5, progressStage: "排队中", error: "" } : item)));
      try {
        const result = await window.alipayWorkbench.renderVideoTask({ task, settings });
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
    setProcessing(false);
    showToast(`批量制作结束：成功 ${done}，失败 ${failed}`);
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
        <button className="secondary-action light" onClick={runDiagnosis} disabled={diagnosing}>
          {diagnosing ? <Loader2 className="spin" size={16} /> : <Stethoscope size={16} />} 诊断修复
        </button>
      </div>

      <div className="template-switch" data-tour="video-template">
        <button className={clsx(currentTask.template !== "video-slice" && "active")} onClick={() => updateCurrent({ template: "bos-template" as VideoTemplateId })}>帛先生模板</button>
        <button className={clsx(currentTask.template === "video-slice" && "active")} onClick={() => updateCurrent({ template: "video-slice", videoPath: "" })}>视频切片</button>
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
          <button type="button" className="inline-mini" onClick={(event) => { event.stopPropagation(); void chooseLatestImage(); }}>选择最新图片</button>
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

      <div className="video-actions" data-tour="video-actions">
        <button className="secondary-action light" onClick={() => addTask()}><Plus size={17} /> 下一个视频</button>
        <button className="secondary-action light" onClick={smartMatch} disabled={matching || currentTask.template === "video-slice"}>
          {matching ? <Loader2 className="spin" size={17} /> : <Search size={17} />} 智能选择
        </button>
        <button className="primary" onClick={renderCurrent} disabled={processing || !ffmpegStatus.available}>
          {processing ? <Loader2 className="spin" size={18} /> : <Play size={18} />} 开始制作
        </button>
        <button className="secondary-action" onClick={renderAllReady} disabled={processing || !ffmpegStatus.available}>
          <Check size={17} /> 批量制作全部
        </button>
        <button className="secondary-action light danger-ghost" onClick={clearAllTasks} disabled={processing}>
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
              <button className="secondary-action compact" onClick={runAutoFix} disabled={fixing}>
                {fixing ? <><Loader2 className="spin" size={14} /> 修复中…</> : "尝试自动修复"}
              </button>
            )}
            <button className="secondary-action light compact" onClick={() => setDiagnosis(null)}>关闭诊断</button>
          </div>
        </div>
      )}
      {currentTask.outputPath && <div className="result-box"><strong>输出文件</strong><span>{currentTask.outputPath}</span></div>}
      {candidateOpen && (
        <CandidateModal
          candidates={currentTask.candidates}
          view={candidateView}
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
    <button className="path-badge" onClick={onPick}>
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
    <button
      type="button"
      className="upload-box"
      onClick={onClick}
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
    </button>
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
              <button className="slice-slot-delete" onClick={(e) => { e.stopPropagation(); onSlotRemove(index); }}>
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
          <button key={item.id} className={clsx(active === item.id && "active")} onClick={() => onPreset(item.id)}>{item.label}<small>{item.source}</small></button>
        ))}
        <button className={clsx(active === "custom" && "active")} onClick={onCustom}>自选音乐</button>
      </div>
      <em>{task.musicPath || settings.sliceCustomMusicPath || "未选择音乐时会生成无音乐视频"}</em>
    </div>
  );
}

function TaskQueue({ tasks, currentIndex, onPick, onRemove }: { tasks: VideoTask[]; currentIndex: number; onPick: (index: number) => void; onRemove: (index: number) => void }) {
  return (
    <div className="task-queue">
      {tasks.map((task, index) => (
        <div key={task.id} className={clsx("task-queue-item", index === currentIndex && "active", task.status)}>
          <button className="task-queue-label" onClick={() => onPick(index)}>
            {index + 1}. {task.outputName || "未命名"} <span>{task.progress ? `${task.progress}%` : ""}</span>
          </button>
          <button className="task-queue-delete" onClick={() => onRemove(index)}><Trash2 size={13} /></button>
        </div>
      ))}
    </div>
  );
}

function CandidateModal({
  candidates,
  view,
  onViewChange,
  onClose,
  onPick
}: {
  candidates: VideoCandidate[];
  view: "thumb" | "list";
  onViewChange: (view: "thumb" | "list") => void;
  onClose: () => void;
  onPick: (candidate: VideoCandidate) => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="candidate-modal wide">
        <div className="modal-title">
          <strong>智能推荐素材</strong>
          <div className="modal-tools">
            <button onClick={() => onViewChange("thumb")} className={clsx(view === "thumb" && "active")}><Table2 size={17} /></button>
            <button onClick={() => onViewChange("list")} className={clsx(view === "list" && "active")}><List size={17} /></button>
            <button onClick={onClose}><X size={18} /></button>
          </div>
        </div>
        <div className={clsx("candidate-list", view)}>
          {candidates.length ? candidates.map((candidate) => (
            <button key={candidate.path} onClick={() => onPick(candidate)}>
              {view === "thumb" && <div className="candidate-thumb">{candidate.thumbnailDataUrl ? <img src={candidate.thumbnailDataUrl} /> : <Video size={28} />}</div>}
              <strong>{candidate.fileName}</strong>
              <span>匹配度 {candidate.score} · {candidate.reason}</span>
              <em>{candidate.matchedPath || candidate.path}</em>
            </button>
          )) : <div className="empty">没有找到匹配素材。</div>}
        </div>
      </div>
    </div>
  );
}
