import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import {
  ArrowRight,
  Check,
  Clipboard,
  Download,
  Eraser,
  Eye,
  EyeOff,
  Film,
  FileSpreadsheet,
  KeyRound,
  PanelLeftClose,
  PanelLeftOpen,
  Loader2,
  Maximize2,
  MessageSquareText,
  Minus,
  Moon,
  Play,
  Plus,
  Settings,
  Sparkles,
  Sun,
  Tags,
  Upload,
  Wand2,
  X
} from "lucide-react";
import clsx from "clsx";

// 懒加载大型组件以优化初始加载性能
const CompareWorkbench = lazy(() => import("./CompareWorkbench").then(m => ({ default: m.CompareWorkbench })));
const ReviewAssistant = lazy(() => import("./ReviewAssistant").then(m => ({ default: m.ReviewAssistant })));
const TitleOptimizer = lazy(() => import("./TitleOptimizer").then(m => ({ default: m.TitleOptimizer })));
const VideoWorkbench = lazy(() => import("./VideoWorkbench").then(m => ({ default: m.VideoWorkbench })));

import { buildRows, exportValidationErrors, formatExportFileName, isValidAccount } from "./lib/parsing";
import { recognizePartialByRules } from "./lib/recognition";
import {
  ApiProfile,
  AppSettings,
  DEFAULT_API_PROFILE,
  DEFAULT_SETTINGS,
  ModelConnectionStatus,
  RebateRow,
  RebateViewKey,
  RecognitionResult,
  ToolboxTool,
  VideoWorkbenchState,
  detectModelCapabilities,
  getActiveApiProfile,
  getFixedTailRow,
  normalizeSettings,
  switchActiveApiProfile,
  syncActiveApiProfile
} from "./lib/shared";

type ViewKey = "home" | RebateViewKey | "video" | "review" | "title" | "compare" | "settings";

const APP_VERSION = "0.10.1";
const MAKER_CREDIT = "Made by Misaki";
const CHANGELOG_ITEMS = [
  "录入页「自动读取剪切板」恢复正常：复制账号信息后会自动识别并填入账号和姓名，不再需要手动输入。",
  "收评助手左侧图片支持 S/M/L 三档缩略图大小切换，右侧预览面板不变。",
  "AI 生成好评时会参考你选中的商品图片，写出来的文案更贴合实物。",
  "视频切片功能暂时关闭维护，按钮灰显标注「暂不可用」。",
  "收评助手的一键回到顶部按钮修好了，滚动之后会自动出现。",
  "预览和导出界面自动检测同名/同账号的重复行，黄色高亮提醒，不影响正常操作。",
  "录入界面新增「自动读取剪切板」快捷开关，无需进设置页切换。",
  "识别过程中可以随时点「取消识别」按钮打断，不用干等了。",
  "底部快捷栏优化：主题切换和设置图标改为并排图标按钮，去除冗余文字标签，视觉上更紧凑。",
  "设置页居中面板宽度优化：移除 800px 上限，侧边栏折叠后设置内容自动铺满右侧空间。",
  "安全加固：API 密钥改用系统级安全存储加密，不再明文保存在设置文件中；更新源强制要求 HTTPS；启用了沙箱和内容安全策略等多层防护。",
  "收评助手索引增量更新：第二次及以后的搜索不再全量扫描目录，只检查有变化的文件夹，大幅加快搜索速度。",
  "收评助手文件夹可展开：搜索结果中的文件夹卡片新增展开按钮，点击可展开查看里面的图片，再次点击收起。",
  "左侧菜单栏视觉优化：收起时所有图标整齐居中对成一条竖线；当前所在页面的高亮竖条不再贴边、改成柔和的小圆条；顶部的收起按钮去掉了多余的方框，和其它图标风格统一。",
  "收评助手支持三种工作模式切换：混合模式（完整流程）、搜索模式（只搜图）、AI评价模式（只生成文案）。",
  "收评增加评分开关，关闭后搜索更快、不显示相关度分数；新增目标字数滑块（30-100字）和思考模式控制。",
  "设置页 API Key 增加小眼睛，可切换显示/隐藏，保护隐私。",
  "收评选择计数改为「X 个卡片 / 共 Y 张图」，更直观。",
  "视频批量剪辑去除内部重复标题，顶部标题栏更简洁。",
  "M 等级说明弹窗在浅色主题下更清晰可见。",

  "对比视图的「推荐」分数也归一化成 0-100 标准分了，不再展示 3328 这种内部原始分。",
  "对比视图的关键词分布三栏色彩调整：仅原标题用橙、共有用灰、仅推荐用绿，三色一眼可分辨。",
  "浅色主题下「分差 +X」和「分差 -X」不再是同一种红棕色，正向用翠绿、负向用正红，差异明显。",
  "对比视图分数加上「/100」单位说明，避免误以为是内部分数。",
];

const toolNavItems: Array<{ key: "home" | ToolboxTool; label: string; icon: typeof Upload }> = [
  { key: "home", label: "工具首页", icon: Sparkles },
  { key: "rebate", label: "支付宝返款", icon: FileSpreadsheet },
  { key: "video", label: "视频批量剪辑", icon: Film },
  { key: "review", label: "收评助手", icon: MessageSquareText },
  { key: "title", label: "标题词优化", icon: Tags },
  { key: "compare", label: "评价返款对比", icon: Check },
  { key: "settings", label: "设置", icon: Settings }
];

const rebateNavItems: Array<{ key: RebateViewKey; label: string; icon: typeof Upload }> = [
  { key: "import", label: "导入", icon: Upload },
  { key: "entry", label: "录入", icon: Wand2 },
  { key: "preview", label: "预览", icon: Eye },
  { key: "export", label: "导出", icon: Download }
];

export default function App() {
  const [view, setView] = useState<ViewKey>("home");
  const [theme, setTheme] = useState<"dark" | "light">(() => (localStorage.getItem("app-theme") === "light" ? "light" : "dark"));
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelConnectionStatus>({ state: "unknown", detail: "尚未测试大模型连接" });
  const [amountInput, setAmountInput] = useState("");
  const [remarkInput, setRemarkInput] = useState("");
  const [rows, setRows] = useState<RebateRow[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [manualAccount, setManualAccount] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualText, setManualText] = useState("");
  const [recognizing, setRecognizing] = useState(false);
  const [lastResult, setLastResult] = useState<RecognitionResult | null>(null);
  const [toast, setToast] = useState("");
  const [videoState, setVideoState] = useState<VideoWorkbenchState | null>(null);
  const [recognitionPulse, setRecognitionPulse] = useState(0);
  const lastClipboardSignature = useRef("");
  const autoRecognizingRef = useRef(false);
  const skipAutoRecognizeRef = useRef(false);
  const recognizeAbortRef = useRef<AbortController | null>(null);
  const completionNotifiedRef = useRef(false);

  const parsed = useMemo(() => buildRows(amountInput, remarkInput), [amountInput, remarkInput]);
  const currentRow = rows[currentIndex];
  const doneCount = rows.filter((row) => row.status === "done" || row.status === "manual").length;
  const pendingCount = rows.length - doneCount;
  const totalAmount = useMemo(() => sumRebateAmount(rows.map((row) => row.amount)), [rows]);
  const parsedTotalAmount = useMemo(() => sumRebateAmount(parsed.amountLines), [parsed.amountLines]);
  const exportName = formatExportFileName(settings.exportNameOwner);
  const validationErrors = useMemo(() => exportValidationErrors(rows), [rows]);
  const activeTool = toolForView(view);
  const videoTasks = videoState?.tasks ?? [];

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("app-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-font-scale", settings.fontScale);
  }, [settings.fontScale]);

  useEffect(() => {
    if (!rows.length) {
      completionNotifiedRef.current = false;
      return;
    }
    const incomplete = rows.some((row) => row.status === "pending" || row.status === "failed");
    if (incomplete) {
      completionNotifiedRef.current = false;
      return;
    }
    if (!completionNotifiedRef.current) {
      completionNotifiedRef.current = true;
      showToast("已完成本轮录入。");
    }
  }, [rows]);

  useEffect(() => {
    window.alipayWorkbench.loadSettings().then((loaded) => {
      const normalized = normalizeSettings(loaded);
      setSettings(normalized);
      setSettingsLoaded(true);
      // 启动时自动测试大模型连接
      if (normalized.apiKey && normalized.apiBaseUrl) {
        setModelStatus({ state: "testing", detail: "正在自动测试大模型连接" });
        window.alipayWorkbench.testModelConnection(normalized).then((result) => {
          setModelStatus(result);
        });
      }
    });
    window.alipayWorkbench.loadWorkbenchState().then((state) => {
      setAmountInput(state.amountInput);
      setRemarkInput(state.remarkInput);
      setRows(state.rows ?? []);
      setCurrentIndex(state.currentIndex ?? 0);
    });
    window.alipayWorkbench.loadVideoWorkbenchState().then(setVideoState);
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    const timer = window.setTimeout(() => {
      void window.alipayWorkbench.saveWorkbenchState({ amountInput, remarkInput, rows, currentIndex });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [settingsLoaded, amountInput, remarkInput, rows, currentIndex]);

  useEffect(() => {
    if (currentRow) {
      setManualAccount(currentRow.account);
      setManualName(currentRow.name);
    } else {
      setManualAccount("");
      setManualName("");
      setManualText("");
    }
  }, [currentRow?.id]);

  useEffect(() => {
    if (!settingsLoaded || !settings.autoListenClipboard || view !== "entry") return;
    let canceled = false;

    const readLatestClipboard = async () => {
      try {
        const snapshot = await window.alipayWorkbench.readClipboard();
        if (canceled || snapshot.signature === lastClipboardSignature.current || snapshot.kind !== "text" || !snapshot.text?.trim()) return;
        lastClipboardSignature.current = snapshot.signature;
        setManualText(snapshot.text);
        if (autoRecognizingRef.current) return;
        autoRecognizingRef.current = true;
        if (skipAutoRecognizeRef.current) {
          skipAutoRecognizeRef.current = false;
          showToast("备注已复制，跳过自动识别。");
          autoRecognizingRef.current = false;
        } else {
          showToast("剪切板已读取，正在自动识别…");
          try { await doRecognizeRef.current(snapshot.text); }
          finally { autoRecognizingRef.current = false; }
        }
      } catch {
        if (!canceled) showToast("读取剪切板失败，请手动粘贴。");
      }
    };

    void readLatestClipboard();
    const timer = window.setInterval(() => void readLatestClipboard(), 1200);
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [settingsLoaded, settings.autoListenClipboard, view]);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  async function saveSettings(next: AppSettings) {
    const saved = await window.alipayWorkbench.saveSettings(normalizeSettings(next));
    setSettings(saved);
    showToast("设置已保存。");
  }

  function openTool(key: "home" | ToolboxTool) {
    setView(key === "rebate" ? "import" : key);
  }

  function toggleTheme(event: React.MouseEvent<HTMLButtonElement>) {
    const nextTheme = theme === "dark" ? "light" : "dark";
    const doc = document as Document & {
      startViewTransition?: (callback: () => void) => { ready: Promise<void> };
    };
    if (!doc.startViewTransition) {
      setTheme(nextTheme);
      return;
    }
    const x = event.clientX;
    const y = event.clientY;
    const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const transition = doc.startViewTransition(() => setTheme(nextTheme));
    void transition.ready.then(() => {
      document.documentElement.animate(
        {
          clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`]
        },
        {
          duration: 560,
          easing: "cubic-bezier(.22, 1, .36, 1)",
          pseudoElement: "::view-transition-new(root)"
        }
      );
    });
  }

  async function readClipboardToImport() {
    try {
      const snapshot = await window.alipayWorkbench.readClipboard();
      lastClipboardSignature.current = snapshot.signature;
      if (snapshot.kind !== "text" || !snapshot.text?.trim()) {
        showToast(snapshot.kind === "image" ? "剪切板里是图片，批量导入需要文本。" : "剪切板里没有可导入的文本。");
        return;
      }
      applyClipboardText(snapshot.text, true);
    } catch {
      showToast("读取剪切板失败，请检查系统权限。");
    }
  }

  function applyClipboardText(text: string, notify: boolean) {
    const rows = parseClipboardRows(text);
    if (!rows.length) {
      if (notify) showToast("剪切板里没有可导入的内容。");
      return;
    }

    const hasTwoColumns = rows.some((row) => row.length >= 2);
    if (hasTwoColumns) {
      const amountLines: string[] = [];
      const remarkLines: string[] = [];
      rows.forEach((row) => {
        amountLines.push(row[0] ?? "");
        remarkLines.push(row.slice(1).join("\t") || "");
      });
      setAmountInput(amountLines.join("\n"));
      setRemarkInput(remarkLines.join("\n"));
      showToast(`已从剪切板读取 ${rows.length} 行。`);
      return;
    }

    const lines = rows.map((row) => row[0]).filter(Boolean);
    const target = lines.every(isLikelyMoneyLine) ? "amount" : "remark";
    if (target === "amount") setAmountInput(lines.join("\n"));
    else setRemarkInput(lines.join("\n"));
    showToast(notify ? `已读取到${target === "amount" ? "金额" : "备注"}列。` : `剪切板已自动填入${target === "amount" ? "金额" : "备注"}列。`);
  }

  function clearImportInputs() {
    if (!amountInput && !remarkInput) {
      showToast("导入框已经是空的。");
      return;
    }
    setAmountInput("");
    setRemarkInput("");
    showToast("已清空批量导入内容。");
  }

  function clearRows() {
    if (!rows.length) {
      showToast("预览列表已经是空的。");
      return;
    }
    if (!window.confirm("确定清空当前返款列表和处理进度吗？导入页的粘贴内容会保留。")) return;
    setRows([]);
    setCurrentIndex(0);
    setManualAccount("");
    setManualName("");
    setManualText("");
    showToast("已清空预览列表。");
  }

  function importRows(mode: "append" | "replace") {
    if (parsed.error) {
      showToast(parsed.error);
      return;
    }
    if (!parsed.rows.length) {
      showToast("请先粘贴金额和备注。");
      return;
    }
    if (mode === "replace" && rows.length > 0 && !window.confirm("替换列表会清空当前已经录入的内容，确定继续吗？")) return;
    setRows((prev) => (mode === "append" ? [...prev, ...parsed.rows] : parsed.rows));
    setCurrentIndex(mode === "append" && rows.length ? rows.length : 0);
    setView("entry");
    showToast(mode === "append" ? `已追加 ${parsed.rows.length} 条任务。` : `已生成 ${parsed.rows.length} 条任务。`);
  }

  function cancelRecognition() {
    recognizeAbortRef.current?.abort();
    recognizeAbortRef.current = null;
    setRecognizing(false);
    autoRecognizingRef.current = false;
    showToast("已取消识别。");
  }

  async function recognizeManualText() {
    if (recognizing) { cancelRecognition(); return; }
    if (!manualText.trim()) { showToast("请先粘贴要识别的文字。"); return; }
    await doRecognizeRef.current(manualText);
  }

  async function applyRecognition(result: RecognitionResult, sourceText = "") {
    setLastResult(result);
    setManualAccount(result.account || manualAccount);
    setManualName(result.name || manualName);
    if (result.account && result.name && isValidAccount(result.account)) {
      const recognizedIndex = currentIndex;
      const rawText = result.rawText || sourceText || manualText || currentRow?.remark || "";
      setRows((prev) =>
        prev.map((row, index) =>
          index === recognizedIndex
            ? { ...row, account: result.account, name: result.name, status: "done", confidence: result.confidence, reason: result.reason, rawText }
            : row
        )
      );
      setRecognitionPulse((value) => value + 1);
      showToast(`已识别：${result.name} / ${result.account}`);
      if (settings.autoAdvance) setCurrentIndex((index) => Math.min(index + 1, Math.max(rows.length - 1, 0)));
    } else {
      showToast("已填入可识别字段，请补齐后保存。");
    }
  }

  const doRecognizeRef = useRef<(text: string) => Promise<void>>(async () => {});
  doRecognizeRef.current = async (text: string) => {
    if (!currentRow || !text.trim()) return;
    const abort = new AbortController();
    recognizeAbortRef.current = abort;
    setRecognizing(true);
    try {
      const result = recognizePartialByRules(text);
      if (abort.signal.aborted) return;
      if (result) {
        await applyRecognition(result, text);
      } else {
        if (!abort.signal.aborted) showToast("未识别到账号或姓名，请手动填写。");
      }
    } catch { /* auto-recognize silent fail */ }
    finally {
      if (recognizeAbortRef.current === abort) {
        recognizeAbortRef.current = null;
        setRecognizing(false);
      }
    }
  };

  async function saveManual() {
    if (!currentRow) return;
    if (!isValidAccount(manualAccount)) {
      showToast("支付宝账号必须是手机号或邮箱。");
      return;
    }
    if (!manualName.trim()) {
      showToast("请填写收款方姓名。");
      return;
    }
    const savedAccount = manualAccount.trim();
    const savedName = manualName.trim();
    const savedIndex = currentIndex;
    const savedRemark = currentRow.remark;
    setRows((prev) =>
      prev.map((row, index) =>
        index === currentIndex ? { ...row, account: savedAccount, name: savedName, status: "manual", confidence: 1 } : row
      )
    );
    showToast("已保存当前行。");
    if (settings.autoAdvance) setCurrentIndex((index) => Math.min(index + 1, Math.max(rows.length - 1, 0)));
  }

  function skipCurrentRow() {
    if (!currentRow) return;
    setRows((prev) =>
      prev.map((row, index) =>
        index === currentIndex ? { ...row, status: "skipped" as const } : row
      )
    );
    showToast("已跳过当前行。");
    setCurrentIndex((index) => Math.min(index + 1, Math.max(rows.length - 1, 0)));
  }

  async function copyRemark() {
    if (!currentRow) return;
    skipAutoRecognizeRef.current = true;
    await window.alipayWorkbench.writeClipboardText(currentRow.remark);
    showToast("备注已复制。");
  }

  async function exportFile() {
    if (!rows.length) return;
    if (settings.strictExportValidation && validationErrors.length) {
      showToast(`还有 ${validationErrors.length} 个问题需要处理。`);
      return;
    }
    const result = await window.alipayWorkbench.exportWorkbook({ rows, defaultFileName: exportName, tailRow: getFixedTailRow(settings) });
    if (!result.canceled) showToast("Excel 已导出。");
  }

  const sidebarProgress =
    activeTool === "rebate"
      ? { label: "返款进度", done: doneCount, total: rows.length, percent: rows.length ? Math.round((doneCount / rows.length) * 100) : 0 }
      : activeTool === "video"
        ? { label: "视频进度", done: videoTasks.filter((task) => task.status === "done").length, total: videoTasks.length, percent: videoTasks.length ? Math.round((videoTasks.filter((task) => task.status === "done").length / videoTasks.length) * 100) : 0 }
        : null;

  return (
    <div className="app-shell">
      <header className="window-titlebar">
        <div className="window-title-brand">
          <BrandGlyph className="window-title-mark" compact />
          <span>{settings.toolboxName}</span>
        </div>
        <div className="window-title-center">{viewTitle(view)}</div>
        <div className="window-controls">
          <button onClick={() => void window.alipayWorkbench.minimizeWindow()} aria-label="最小化"><Minus size={14} /></button>
          <button onClick={() => void window.alipayWorkbench.toggleMaximizeWindow()} aria-label="最大化"><Maximize2 size={13} /></button>
          <button className="danger" onClick={() => void window.alipayWorkbench.closeWindow()} aria-label="关闭"><X size={15} /></button>
        </div>
      </header>
      <aside className={clsx("sidebar", settings.sidebarCollapsed && "collapsed")}>
        <div className="brand">
          <BrandGlyph className="brand-mark" />
          <div><strong>{settings.toolboxName}</strong><span>E-commerce ops kit</span></div>
          <button
            className="sidebar-collapse"
            onClick={() => void saveSettings({ ...settings, sidebarCollapsed: !settings.sidebarCollapsed })}
            title={settings.sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
            aria-label={settings.sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            {settings.sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        </div>
        <nav role="navigation" aria-label="工具导航">
          {toolNavItems.filter((item) => item.key !== "settings").map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.key} className={clsx("nav-item", activeTool === item.key && "active")} aria-current={activeTool === item.key ? "page" : undefined} onClick={() => openTool(item.key)}>
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        {sidebarProgress && (
          <div className="side-status">
            <span>{sidebarProgress.label}</span>
            <strong>{sidebarProgress.done} / {sidebarProgress.total}</strong>
            <div className="mini-progress"><i style={{ width: `${sidebarProgress.percent}%` }} /></div>
          </div>
        )}
        <div className="bottom-actions">
          <button className="bottom-btn" onClick={toggleTheme} title={theme === "dark" ? "切换浅色模式" : "切换深色模式"}>
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          {(() => {
            const settingsItem = toolNavItems.find((item) => item.key === "settings")!;
            const Icon = settingsItem.icon;
            return (
              <button className={clsx("bottom-btn", activeTool === "settings" && "active")} title={settingsItem.label} onClick={() => openTool("settings")}>
                <Icon size={16} />
              </button>
            );
          })()}
        </div>
      </aside>

      <main className="main">
        {view !== "home" && (
          <header className="topbar">
            <div><p className="eyebrow">{toolEyebrow(activeTool)}</p><h1>{viewTitle(view)}</h1></div>
            <div className="top-actions">
              <span className={clsx("status-pill", "model", modelStatus.state)}><KeyRound size={15} /> 大模型：{modelStatusLabel(modelStatus.state)}</span>
            </div>
          </header>
        )}

        {view === "home" && <ToolboxHome settings={settings} pendingCount={pendingCount} totalAmount={sumRebateAmount(rows.filter(isTodayRebateRow).map((row) => row.amount))} onOpen={setView} />}

        {activeTool === "rebate" && (
          <div className="subnav">
            {rebateNavItems.map((item) => {
              const Icon = item.icon;
              return <button key={item.key} className={clsx(view === item.key && "active")} onClick={() => setView(item.key)}><Icon size={16} /> {item.label}</button>;
            })}
          </div>
        )}

        {view === "import" && (
          <section className="grid-two">
            <Panel title="批量导入" icon={Upload}>
              <div className="paste-grid">
                <label><span>金额列</span><textarea value={amountInput} onChange={(event) => setAmountInput(event.target.value)} placeholder="从 Excel 复制金额列后粘贴到这里" /></label>
                <label><span>备注列</span><textarea value={remarkInput} onChange={(event) => setRemarkInput(event.target.value)} placeholder="从 Excel 复制备注列后粘贴到这里" /></label>
              </div>
              <div className={clsx("import-summary", parsed.error && "danger")}>
                <strong>{parsed.error || "数据可进入录入流程"}</strong>
                <span>金额 {parsed.amountLines.length} 行 · 备注 {parsed.remarkLines.length} 行 · 总金额 {formatMoney(parsedTotalAmount)}</span>
              </div>
              <div className="button-row">
                <button className="secondary-action light" onClick={() => void readClipboardToImport()}><Clipboard size={18} /> 读取剪切板</button>
                <button className="primary" onClick={() => importRows(rows.length ? "append" : "replace")}><Play size={18} /> {rows.length ? "添加到列表" : "开始录入"}</button>
                {rows.length > 0 && <button className="secondary-action light" onClick={() => importRows("replace")}><Plus size={18} /> 替换列表</button>}
                <button className="secondary-action danger-text" onClick={clearImportInputs}><Eraser size={18} /> 清空</button>
              </div>
            </Panel>
            <Panel title="清洗预览" icon={Sparkles}>
              <PreviewRows amountLines={parsed.amountLines} remarkLines={parsed.remarkLines} />
            </Panel>
          </section>
        )}

        {view === "entry" && (
          <section className="entry-layout">
            <Panel title="当前用户" icon={Clipboard} className="hero-panel">
              {currentRow ? (
                <>
                  <div className="current-card">
                    <button className="remark-copy" onClick={copyRemark}>{currentRow.remark}</button>
                    <div className="amount">{currentRow.amount}</div>
                    <div className="progress-text">{currentIndex + 1} / {rows.length}</div>
                  </div>
                  <div className="manual-recognize">
                    <label><span>识别文本</span><textarea value={manualText} onChange={(event) => setManualText(event.target.value)} placeholder="粘贴支付宝账号、姓名或聊天内容" /></label>
                    <button onClick={recognizeManualText} className={recognizing ? "danger-text" : undefined}>{recognizing ? <><X size={18} /> 取消识别</> : <><Wand2 size={18} /> 重新识别</>}</button>
                  </div>
                  <Toggle checked={settings.autoListenClipboard} label="自动读取剪切板" onChange={(value) => void saveSettings({ ...settings, autoListenClipboard: value })} />
                </>
              ) : <EmptyState text="请先导入金额和备注。" />}
            </Panel>
            <Panel title="识别结果" icon={Wand2}>
              <div className="form-stack">
                <label><span>收款方支付宝账号</span><input value={manualAccount} onChange={(event) => setManualAccount(event.target.value)} /></label>
                <label className={clsx("recognized-name-field", recognitionPulse > 0 && "pulse")} key={`name-pulse-${recognitionPulse}`}><span>收款方姓名</span><input value={manualName} onChange={(event) => setManualName(event.target.value)} /></label>
                <button className="primary" onClick={saveManual}><Check size={18} /> 保存到当前行</button>
                <button className="secondary-action light" onClick={skipCurrentRow}><ArrowRight size={18} /> 跳过当前行</button>
              </div>
              {lastResult && <div className="result-box"><strong>{lastResult.source} · {Math.round(lastResult.confidence * 100)}%</strong><span>{lastResult.reason}</span></div>}
            </Panel>
          </section>
        )}

         {view === "preview" && <RowsTable rows={rows} currentIndex={currentIndex} onClear={clearRows} onPick={(index) => { setCurrentIndex(index); setView("entry"); }}  />}

        {view === "export" && (
          <ExportView rows={rows} doneCount={doneCount} totalAmount={totalAmount} exportName={exportName} validationErrors={validationErrors} settings={settings} onExport={exportFile} />
        )}

        {/* 懒加载组件用 Suspense 包装，显示加载状态 */}
        <Suspense fallback={<div className="loading-fallback"><Loader2 className="spin" size={32} /><span>加载中...</span></div>}>
          {view === "video" && <VideoWorkbench settings={settings} onSaveSettings={saveSettings} onStateChange={setVideoState} showToast={showToast} />}
          {view === "review" && <ReviewAssistant settings={settings} onSaveSettings={saveSettings} showToast={showToast} modelConnected={modelStatus.state === "connected"} />}
          {view === "title" && <TitleOptimizer settings={settings} onSaveSettings={saveSettings} showToast={showToast} />}
          {view === "compare" && <CompareWorkbench settings={settings} showToast={showToast} />}
        </Suspense>

        {view === "settings" && <SettingsView settings={settings} onSave={saveSettings} modelStatus={modelStatus} onTestModel={async (draft) => {
          setModelStatus({ state: "testing", detail: "正在测试大模型连接" });
          const result = await window.alipayWorkbench.testModelConnection(draft);
          setModelStatus(result);
          showToast(result.detail);
          return result;
        }} />}
        <footer className="app-credit">V{APP_VERSION} · 电商运营工具箱 · {MAKER_CREDIT}</footer>
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function BrandGlyph({ className, compact = false }: { className: string; compact?: boolean }) {
  return (
    <div className={className} aria-hidden="true">
      <svg viewBox="0 0 48 48" role="img">
        <rect className="brand-glyph-card" x="10" y="9" width="28" height="30" rx="8" />
        <path className="brand-glyph-line main" d="M18 18h12" />
        <path className="brand-glyph-line accent" d="M18 25h16" />
        <path className="brand-glyph-line main" d="M18 32h10" />
        {!compact && <circle className="brand-glyph-dot" cx="34" cy="34" r="6" />}
      </svg>
    </div>
  );
}

function Panel({ title, icon: Icon, className, action, children }: { title: string; icon: typeof Upload; className?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className={clsx("panel", className)}><div className="panel-title"><div><Icon size={19} /><h2>{title}</h2></div>{action}</div>{children}</section>;
}

function ToolboxHome({ settings, pendingCount, totalAmount, onOpen }: { settings: AppSettings; pendingCount: number; totalAmount: number; onOpen: (view: ViewKey) => void }) {
  const cards = [
    { className: "bento-main", icon: FileSpreadsheet, label: "核心工具", title: "支付宝批量返款", text: "导入金额和备注，识别账号姓名，校验后导出支付宝模板。", view: "import" as ViewKey },
    { className: "bento-video", icon: Film, label: "视频生产", title: "批量剪辑", text: "模板化短视频，支持帛先生和切片模板。", view: "video" as ViewKey },
    { className: "bento-review", icon: MessageSquareText, label: "评价运营", title: "收评助手", text: "检索参考图并生成买家好评文案。", view: "review" as ViewKey },
    { className: "bento-title", icon: Tags, label: "关键词算法", title: "标题词优化", text: "分析已有标题评分，辅助生成严格 54 字节标题。", view: "title" as ViewKey },
    { className: "bento-compare", icon: Check, label: "核对", title: "评价返款对比", text: "自动去重，差异置顶标红。", view: "compare" as ViewKey },
    { className: "bento-settings", icon: Settings, label: "配置", title: "全局设置", text: "API、路径、规则与纠偏。", view: "settings" as ViewKey }
  ];
  return (
    <section className="home-dashboard">
      <div className="home-hero">
        <div className="home-hero-bg" aria-hidden="true" />
        <div className="home-hero-content"><p className="eyebrow">电商运营中控台</p><h1>{settings.toolboxName}</h1><p>把返款、视频、收评、标题优化和核对放在同一个工作台。</p></div>
        <div className="home-metrics"><span className="metric-green"><strong>{formatMoney(totalAmount)}</strong>今日返款总金额</span><span className="metric-gold"><strong>{pendingCount}</strong>待处理笔数</span></div>
      </div>
      <div className="bento-grid">
        {cards.map((card) => (
          <HomeCard
            key={card.view}
            {...card}
            onClick={() => onOpen(card.view)}
          />
        ))}
      </div>
    </section>
  );
}

function HomeCard({ className, icon: Icon, label, title, text, onClick }: { className: string; icon: typeof Upload; label: string; title: string; text: string; onClick: () => void }) {
  return (
    <button className={clsx("bento-card", className)} onClick={onClick}>
      <div className="bento-card-inner">
        <div className="bento-icon"><Icon size={24} /></div>
        <div className="bento-body"><p className="bento-label">{label}</p><h2>{title}</h2><span>{text}</span></div>
        <em className="bento-action">进入 <ArrowRight size={16} /></em>
      </div>
    </button>
  );
}

function PreviewRows({ amountLines, remarkLines }: { amountLines: string[]; remarkLines: string[] }) {
  const max = Math.max(amountLines.length, remarkLines.length, 8);
  const visibleCount = Math.min(max, 20);
  return <div className="preview-list">{Array.from({ length: visibleCount }).map((_, index) => <div key={index} className="preview-row"><span>{index + 1}</span><b>{amountLines[index] || "-"}</b><em>{remarkLines[index] || "-"}</em></div>)}</div>;
}

function computeDuplicateWarnings(rows: RebateRow[]): string[] {
  const nameCount = new Map<string, number>();
  const accountCount = new Map<string, number>();
  for (const row of rows) {
    const n = row.name.trim();
    const a = row.account.trim();
    if (n && n !== "待填写") nameCount.set(n, (nameCount.get(n) || 0) + 1);
    if (a && a !== "待填写") accountCount.set(a, (accountCount.get(a) || 0) + 1);
  }
  const warnings: string[] = [];
  for (const [k, v] of nameCount) if (v >= 2) warnings.push(`同实名"${k}"出现 ${v} 次`);
  for (const [k, v] of accountCount) if (v >= 2) warnings.push(`同账户"${k}"出现 ${v} 次`);
  return warnings;
}

function ExportView({ rows, doneCount, totalAmount, exportName, validationErrors, settings, onExport }: { rows: RebateRow[]; doneCount: number; totalAmount: number; exportName: string; validationErrors: string[]; settings: AppSettings; onExport: () => void }) {
  const dupWarnings = useMemo(() => computeDuplicateWarnings(rows), [rows]);
  return (
    <section className="grid-two">
      <Panel title="导出校验" icon={Download}>
        <div className="export-name">{exportName}</div>
        <div className="rebate-total-card"><span>本次返款总金额</span><strong>{formatMoney(totalAmount)}</strong><em>{rows.length} 条 · {doneCount} 条已完成</em></div>
        {dupWarnings.length > 0 && (
          <div className="duplicate-warning-bar">
            <strong>异常提醒（不阻止导出）</strong>
            <span>{dupWarnings.join("；")}</span>
          </div>
        )}
        <div className={clsx("import-summary", validationErrors.length && "danger")}>
          <strong>{validationErrors.length ? `发现 ${validationErrors.length} 个问题` : "可以导出"}</strong>
          <span>导出时会自动追加固定尾行：{settings.fixedTailAccount} / {settings.fixedTailName}</span>
        </div>
        <button className="primary" onClick={onExport} disabled={!rows.length}><Download size={18} /> 导出 Excel</button>
      </Panel>
      <Panel title="问题列表" icon={Eye}>
        <div className="error-list">{validationErrors.length ? validationErrors.map((error) => <span key={error}>{error}</span>) : <EmptyState text="没有发现阻塞导出的问题。" />}</div>
      </Panel>
    </section>
  );
}

function RowsTable({ rows, currentIndex, onPick, onClear } : { rows: RebateRow[]; currentIndex: number; onPick: (index: number) => void; onClear: () => void }) {
  const duplicates = useMemo(() => {
    const nameCount = new Map<string, number>();
    const accountCount = new Map<string, number>();
    for (const row of rows) {
      const n = row.name.trim();
      const a = row.account.trim();
      if (n && n !== "待填写") nameCount.set(n, (nameCount.get(n) || 0) + 1);
      if (a && a !== "待填写") accountCount.set(a, (accountCount.get(a) || 0) + 1);
    }
    const dupNames = new Set<string>();
    const dupAccounts = new Set<string>();
    for (const [k, v] of nameCount) if (v >= 2) dupNames.add(k);
    for (const [k, v] of accountCount) if (v >= 2) dupAccounts.add(k);
    const warnings: string[] = [];
    for (const name of dupNames) warnings.push(`同实名"${name}"出现 ${nameCount.get(name)} 次`);
    for (const acc of dupAccounts) warnings.push(`同账户"${acc}"出现 ${accountCount.get(acc)} 次`);
    return { dupNames, dupAccounts, warnings };
  }, [rows]);

  return (
    <Panel title="完整预览" icon={Eye} action={<button className="secondary-action danger-text compact" onClick={onClear}><Eraser size={16} /> 清空列表</button>}>
      {duplicates.warnings.length > 0 && (
        <div className="duplicate-warning-bar">
          <strong>异常提醒</strong>
          <span>{duplicates.warnings.join("；")}</span>
        </div>
      )}
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>序号</th><th>账号</th><th>姓名</th><th>金额</th><th>备注</th><th>状态</th><th>处理</th></tr></thead>
            <tbody>{rows.map((row, index) => {
              const isDupName = duplicates.dupNames.has(row.name.trim());
              const isDupAccount = duplicates.dupAccounts.has(row.account.trim());
              return <tr key={row.id} className={clsx(index === currentIndex && "selected", (isDupName || isDupAccount) && "duplicate-row")}><td>{index + 1}</td><td className={clsx(isDupAccount && "duplicate-cell")}>{row.account || "待填写"}</td><td className={clsx(isDupName && "duplicate-cell")}>{row.name || "待填写"}</td><td>{row.amount}</td><td>{row.remark}</td><td><span className={clsx("row-status", row.status)}>{statusLabel(row.status)}</span></td><td><button onClick={() => onPick(index)}>编辑</button></td></tr>;
            })}</tbody>
          </table>
        </div>
      ) : <EmptyState text="当前没有返款列表，请先在批量导入中生成。" />}
    </Panel>
  );
}



function SettingsView({ settings, onSave, modelStatus, onTestModel }: { settings: AppSettings; onSave: (settings: AppSettings) => void; modelStatus: ModelConnectionStatus; onTestModel: (settings: AppSettings) => Promise<ModelConnectionStatus> }) {
  const [draft, setDraft] = useState(settings);
  const [section, setSection] = useState<"global" | "rebate" | "video" | "review" | "title" | "compare">("global");
  const [showApiKey, setShowApiKey] = useState(false);
  const [modelList, setModelList] = useState<{ id: string; name: string }[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelSelectFor, setModelSelectFor] = useState<"text" | "vision" | null>(null);
  const [modelCache, setModelCache] = useState<Record<string, { id: string; name: string }[]>>({});
  const [testingModel, setTestingModel] = useState(false);
  useEffect(() => setDraft(settings), [settings]);
  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => setDraft((prev) => ({ ...prev, [key]: value }));
  const activeProfile = getActiveApiProfile(draft);
  const setProfile = (patch: Partial<ApiProfile>) => setDraft((prev) => syncActiveApiProfile(prev, patch));
  const pickDirectory = async (key: "videoLibraryDir" | "videoOutputDir" | "reviewRootDir", title: string) => {
    const result = await window.alipayWorkbench.selectDirectory(title);
    if (!result.canceled && result.paths[0]) set(key, result.paths[0]);
  };
  const pickFfmpeg = async () => {
    const result = await window.alipayWorkbench.selectFiles({ kind: "ffmpeg", multi: false });
    if (!result.canceled && result.paths[0]) set("ffmpegPath", result.paths[0]);
  };
  const pickTitleExcel = async () => {
    const result = await window.alipayWorkbench.selectTitleKeywordExcel();
    if (!result.canceled && result.paths[0]) set("titleKeywordExcelPath", result.paths[0]);
  };

  const switchProfile = (id: string) => {
    setDraft((prev) => switchActiveApiProfile(prev, id));
  };

  const addProfile = () => {
    setDraft((prev) => {
      const profiles = prev.apiProfiles;
      const nextId = `profile-${Date.now()}`;
      const nextName = `配置 ${profiles.length + 1}`;
      const base = getActiveApiProfile(prev);
      const newProfile: ApiProfile = { ...base, id: nextId, name: nextName };
      const nextProfiles = [...profiles, newProfile];
      return normalizeSettings({ ...prev, apiProfiles: nextProfiles, activeApiProfileId: nextId });
    });
  };

  const deleteProfile = (id: string) => {
    setDraft((prev) => {
      if (prev.apiProfiles.length <= 1) return prev;
      const nextProfiles = prev.apiProfiles.filter((p) => p.id !== id);
      let nextActiveId = prev.activeApiProfileId;
      if (nextActiveId === id) nextActiveId = nextProfiles[0].id;
      let nextReviewId = prev.reviewApiProfileId;
      if (nextReviewId === id) nextReviewId = "";
      return normalizeSettings({ ...prev, apiProfiles: nextProfiles, activeApiProfileId: nextActiveId, reviewApiProfileId: nextReviewId });
    });
  };

  const getModelCacheKey = (profile: ApiProfile) => `${profile.apiType}:${profile.apiBaseUrl}`;

  const fetchModels = async (kind: "text" | "vision") => {
    const cacheKey = getModelCacheKey(activeProfile);
    if (modelCache[cacheKey]) {
      setModelList(modelCache[cacheKey]);
      setModelSelectFor(kind);
      return;
    }
    setLoadingModels(true);
    setModelSelectFor(kind);
    try {
      const models = await window.alipayWorkbench.listAvailableModels(draft);
      setModelList(models);
      setModelCache((prev) => ({ ...prev, [cacheKey]: models }));
    } catch {
      setModelList([]);
    } finally {
      setLoadingModels(false);
    }
  };

  const handleTestModel = async (draftSettings: AppSettings) => {
    setTestingModel(true);
    try {
      const result = await onTestModel(draftSettings);
      if (result.state === "connected") {
        const cacheKey = getModelCacheKey(activeProfile);
        if (!modelCache[cacheKey]) {
          setLoadingModels(true);
          setModelSelectFor("text");
          try {
            const models = await window.alipayWorkbench.listAvailableModels(draftSettings);
            setModelList(models);
            setModelCache((prev) => ({ ...prev, [cacheKey]: models }));
          } catch { /* ignore fetch error */ }
          finally { setLoadingModels(false); }
        }
      }
      return result;
    } finally {
      setTestingModel(false);
    }
  };

  // Refresh model list when switching profiles
  useEffect(() => {
    const cacheKey = getModelCacheKey(activeProfile);
    if (modelCache[cacheKey]) {
      setModelList(modelCache[cacheKey]);
    } else {
      setModelList([]);
      setModelSelectFor(null);
    }
  }, [activeProfile.id]);

  // Auto-save settings with debounce
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const saveHintVisible = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const normalized = normalizeSettings(draft);
    // Skip if nothing changed compared to committed settings
    if (JSON.stringify(normalized) === JSON.stringify(settings)) return;
    saveTimerRef.current = setTimeout(() => {
      onSave(normalized);
      setLastSaved(Date.now());
      saveHintVisible.current = true;
      // Auto-hide the save hint after 2s
      setTimeout(() => { saveHintVisible.current = false; setLastSaved(null); }, 2000);
    }, 800);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [draft]);

  const cap = detectModelCapabilities(activeProfile.textModel, activeProfile.apiType);

  const sections = [
    { key: "global" as const, label: "全局设置", icon: Settings, description: "工具箱名称与 API" },
    { key: "rebate" as const, label: "支付宝返款", icon: FileSpreadsheet, description: "导出规则与识别设置" },
    { key: "video" as const, label: "视频批量剪辑", icon: Film, description: "视频库、输出目录、FFmpeg" },
    { key: "review" as const, label: "收评助手", icon: MessageSquareText, description: "图片根目录与 AI 文案参数" },
    { key: "title" as const, label: "标题词优化", icon: Tags, description: "市场关键词 Excel" },
    { key: "compare" as const, label: "评价返款对比", icon: Check, description: "对比验证与展示" }
  ];
  return (
    <section className="settings-center">
      <div className="settings-hub">
        {sections.map((item) => {
          const Icon = item.icon;
          return <button key={item.key} className={clsx("settings-hub-item", section === item.key && "active")} onClick={() => setSection(item.key)}><Icon size={18} /><strong>{item.label}</strong><span>{item.description}</span></button>;
        })}
      </div>
      {section === "global" && <section className="settings-grid single"><Panel title="全局设置" icon={Settings}><div className="form-stack">
        {/* API 配置 Tab 条 */}
        <div className="api-profile-section">
          <div className="api-profile-tabs">
            {draft.apiProfiles.map((profile) => (
              <div key={profile.id} className={clsx("api-profile-tab", profile.id === activeProfile.id && "active")}>
                <button type="button" className="api-profile-tab-label" onClick={() => switchProfile(profile.id)}>{profile.name}</button>
                {draft.apiProfiles.length > 1 && (
                  <button type="button" className="api-profile-tab-delete" onClick={() => deleteProfile(profile.id)} title="删除此配置"><X size={12} /></button>
                )}
              </div>
            ))}
            <button type="button" className="api-profile-tab-label" onClick={addProfile} title="新增配置" style={{ fontWeight: 400 }}><Plus size={14} /></button>
          </div>
        </div>

        {/* 当前配置名称 */}
        <label><span>配置名称</span><input value={activeProfile.name} onChange={(event) => setProfile({ name: event.target.value })} /></label>

        {/* API 类型选择 */}
        <label><span>API 类型</span></label>
        <div className="segmented" style={{ marginBottom: 4 }}>
          <button className={clsx(activeProfile.apiType === "openai" && "active")} onClick={() => setProfile({ apiType: "openai", apiBaseUrl: activeProfile.apiBaseUrl.includes("anthropic") ? "https://api.openai.com/v1" : activeProfile.apiBaseUrl })}>OpenAI 兼容</button>
          <button className={clsx(activeProfile.apiType === "anthropic" && "active")} onClick={() => setProfile({ apiType: "anthropic", apiBaseUrl: activeProfile.apiBaseUrl.includes("openai") ? "https://api.anthropic.com" : activeProfile.apiBaseUrl })}>Anthropic</button>
        </div>

        <label><span>工具箱名称</span><input value={draft.toolboxName} onChange={(event) => set("toolboxName", event.target.value)} /></label>
        <FontScalePicker value={draft.fontScale} onChange={(value) => set("fontScale", value)} />

        <label><span>API Base URL</span><input value={activeProfile.apiBaseUrl} onChange={(event) => setProfile({ apiBaseUrl: event.target.value })} /></label>

        <label><span>API Key</span><div className="secret-input"><input type={showApiKey ? "text" : "password"} value={activeProfile.apiKey} onChange={(event) => setProfile({ apiKey: event.target.value })} /><button type="button" onClick={() => setShowApiKey((value) => !value)} title={showApiKey ? "隐藏 API Key" : "显示 API Key"}>{showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>

        {/* 文本模型 */}
        <label><span>文本模型</span></label>
        {modelList.length > 0 ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={activeProfile.textModel} onChange={(event) => {
              if (event.target.value === "__custom__") return;
              setProfile({ textModel: event.target.value });
            }} style={{ flex: 1 }}>
              {modelList.map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
              <option value="__custom__">自定义…</option>
            </select>
            {!modelList.some((m) => m.id === activeProfile.textModel) && (
              <input value={activeProfile.textModel} onChange={(event) => setProfile({ textModel: event.target.value })} style={{ flex: 1 }} placeholder="手动输入模型名" />
            )}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input value={activeProfile.textModel} onChange={(event) => setProfile({ textModel: event.target.value })} style={{ flex: 1 }} />
            <button type="button" className="secondary-action light" onClick={() => void fetchModels("text")} disabled={loadingModels} style={{ flex: "none", padding: "4px 10px", fontSize: "var(--font-xs)" }}>
              {loadingModels && modelSelectFor === "text" ? <><Loader2 size={13} className="spin" /> 获取中…</> : "获取模型"}
            </button>
          </div>
        )}

        {/* 视觉模型 */}
        <label><span>视觉模型</span></label>
        {modelList.length > 0 ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={activeProfile.visionModel} onChange={(event) => {
              if (event.target.value === "__custom__") return;
              setProfile({ visionModel: event.target.value });
            }} style={{ flex: 1 }}>
              {modelList.map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
              <option value="__custom__">自定义…</option>
            </select>
            {!modelList.some((m) => m.id === activeProfile.visionModel) && (
              <input value={activeProfile.visionModel} onChange={(event) => setProfile({ visionModel: event.target.value })} style={{ flex: 1 }} placeholder="手动输入模型名" />
            )}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input value={activeProfile.visionModel} onChange={(event) => setProfile({ visionModel: event.target.value })} style={{ flex: 1 }} />
            <button type="button" className="secondary-action light" onClick={() => void fetchModels("vision")} disabled={loadingModels} style={{ flex: "none", padding: "4px 10px", fontSize: "var(--font-xs)" }}>
              {loadingModels && modelSelectFor === "vision" ? <><Loader2 size={13} className="spin" /> 获取中…</> : "获取模型"}
            </button>
          </div>
        )}

        {loadingModels && <div className="hint-card"><Loader2 size={13} className="spin" /> 正在获取模型列表…</div>}
        {!loadingModels && modelList.length === 0 && modelSelectFor !== null && (
          <div className="hint-card">未获取到模型列表，请检查 API Base URL 和 API Key 是否正确。</div>
        )}

        {/* 模型能力提示 */}
        {activeProfile.textModel && (
          <div className="hint-card">
            {cap.supportsThinking && "当前文本模型支持扩展思考（Extended Thinking），可在收评助手中启用深度思考模式。"}
            {cap.supportsReasoningEffort && "当前文本模型支持推理强度控制（Reasoning Effort），可在收评助手中调节思考程度。"}
            {!cap.supportsThinking && !cap.supportsReasoningEffort && "当前文本模型为标准模型，思考模式将自动关闭。"}
          </div>
        )}

        <div className={clsx("connection-card", modelStatus.state)}><strong>大模型连接：{modelStatusLabel(modelStatus.state)}</strong><span>{modelStatus.detail}</span></div>
        <button className="secondary-action" onClick={() => void handleTestModel(draft)} disabled={testingModel}>
          {testingModel ? <><Loader2 size={17} className="spin" /> 测试中…</> : <><KeyRound size={17} /> 测试大模型连接</>}
        </button>
      </div></Panel></section>}
      {section === "rebate" && <section className="settings-grid single"><Panel title="支付宝返款设置" icon={FileSpreadsheet}><div className="form-stack"><label><span>导出文件名中的名字</span><input value={draft.exportNameOwner} onChange={(event) => set("exportNameOwner", event.target.value)} /></label><label><span>固定尾行支付宝账号</span><input value={draft.fixedTailAccount} onChange={(event) => set("fixedTailAccount", event.target.value)} /></label><label><span>固定尾行姓名</span><input value={draft.fixedTailName} onChange={(event) => set("fixedTailName", event.target.value)} /></label><Toggle checked={draft.autoListenClipboard} label="录入页自动读取剪切板" onChange={(value) => set("autoListenClipboard", value)} /><Toggle checked={draft.enhancedCloudValidation} label="启用云端 AI 二次校验识别结果" onChange={(value) => set("enhancedCloudValidation", value)} /></div></Panel></section>}
      {section === "video" && <section className="settings-grid single"><Panel title="视频批量剪辑设置" icon={Film}><div className="form-stack"><label><span>视频库文件夹</span><input value={draft.videoLibraryDir} onChange={(event) => set("videoLibraryDir", event.target.value)} /></label><button className="secondary-action light" onClick={() => void pickDirectory("videoLibraryDir", "选择视频库文件夹")}>选择视频库</button><label><span>输出文件夹</span><input value={draft.videoOutputDir} onChange={(event) => set("videoOutputDir", event.target.value)} /></label><button className="secondary-action light" onClick={() => void pickDirectory("videoOutputDir", "选择输出文件夹")}>选择输出目录</button><label><span>FFmpeg 路径</span><input value={draft.ffmpegPath} onChange={(event) => set("ffmpegPath", event.target.value)} /></label><button className="secondary-action light" onClick={() => void pickFfmpeg()}>指定 FFmpeg</button><div className="hint-card">切片音乐默认使用内置 CC0 音乐。</div></div></Panel></section>}
      {section === "review" && <section className="settings-grid single"><Panel title="收评助手设置" icon={MessageSquareText}><div className="form-stack"><label><span>收评助手 API 配置</span><select value={draft.reviewApiProfileId || ""} onChange={(event) => set("reviewApiProfileId", event.target.value)}><option value="">跟随全局激活配置</option>{draft.apiProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label><span>图片根目录</span><input value={draft.reviewRootDir} onChange={(event) => set("reviewRootDir", event.target.value)} /></label><button className="secondary-action light" onClick={() => void pickDirectory("reviewRootDir", "选择收评助手图片根目录")}>选择图片根目录</button><label><span>默认工作模式</span><select value={draft.reviewWorkspaceMode} onChange={(event) => set("reviewWorkspaceMode", event.target.value as AppSettings["reviewWorkspaceMode"])}><option value="mixed">混合模式</option><option value="search">搜索模式</option><option value="ai">AI评价模式</option></select></label><label><span>AI评价目标字数：{draft.reviewTargetLength}</span><input type="range" min={30} max={100} step={5} value={draft.reviewTargetLength} onChange={(event) => set("reviewTargetLength", Number(event.target.value))} /></label><label><span>生成快捷键</span><input value={draft.reviewGenerateHotkey || "Ctrl+Enter"} onChange={(event) => set("reviewGenerateHotkey", event.target.value)} placeholder="Ctrl+Enter" /></label><label><span>思考模式 {!cap.supportsThinking && !cap.supportsReasoningEffort && <em style={{ color: "var(--text-dim)", fontSize: "var(--font-xs)" }}>（当前模型不支持）</em>}</span><select value={draft.reviewThinkingMode} onChange={(event) => set("reviewThinkingMode", event.target.value as AppSettings["reviewThinkingMode"])} disabled={!cap.supportsThinking && !cap.supportsReasoningEffort}><option value="off">关闭</option><option value="auto">自动</option><option value="on">开启</option></select></label><label><span>云端更新源 URL</span><input value={draft.updateFeedUrl} onChange={(event) => set("updateFeedUrl", event.target.value)} /></label></div></Panel></section>}
      {section === "title" && <section className="settings-grid single"><Panel title="标题词优化设置" icon={Tags}><div className="form-stack"><label><span>市场关键词 Excel 路径</span><input value={draft.titleKeywordExcelPath} onChange={(event) => set("titleKeywordExcelPath", event.target.value)} /></label><button className="secondary-action light" onClick={() => void pickTitleExcel()}><FileSpreadsheet size={17} /> 选择标题关键词 Excel</button><div className="hint-card">默认读取桌面“市场关键词帛先生.xlsx”。文件更新后会重新解析和加权。</div></div></Panel></section>}
      {section === "compare" && <section className="settings-grid single"><Panel title="评价返款对比设置" icon={Check}><div className="toggle-list"><Toggle checked={draft.compareAutoOpenReminderDialog} label="验证后自动弹出需催促名单" onChange={(value) => set("compareAutoOpenReminderDialog", value)} /><Toggle checked={draft.compareShowPassedRowsAfterVerify} label="右侧验证后显示已通过人员" onChange={(value) => set("compareShowPassedRowsAfterVerify", value)} /></div></Panel></section>}
      <div className="settings-savebar"><span>当前正在调整：{sections.find((item) => item.key === section)?.label}</span><span className="settings-autosave-hint">{lastSaved ? `已自动保存 ${new Date(lastSaved).toLocaleTimeString()}` : ""}</span></div>
    </section>
  );
}

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <button className={clsx("toggle", checked && "on")} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}><i /><span>{label}</span></button>;
}

function FontScalePicker({ value, onChange }: { value: AppSettings["fontScale"]; onChange: (value: AppSettings["fontScale"]) => void }) {
  const options: Array<{ value: AppSettings["fontScale"]; label: string; detail: string }> = [
    { value: "small", label: "小字体", detail: "当前版本大小" },
    { value: "normal", label: "默认", detail: "更易读" },
    { value: "large", label: "大字体", detail: "轻微放大" }
  ];
  return (
    <div className="font-scale-setting">
      <span>字体大小</span>
      <div className="segmented font-scale-options">
        {options.map((item) => (
          <button key={item.value} className={clsx(value === item.value && "active")} onClick={() => onChange(item.value)}>
            <strong>{item.label}</strong>
            <em>{item.detail}</em>
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

function parseClipboardRows(text: string): string[][] {
  return text
    .replace(/\u3000/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.includes("\t")) return line.split("\t").map((cell) => cell.trim());
      if (line.includes(",") && !isLikelyMoneyLine(line)) return line.split(",").map((cell) => cell.trim());
      return [line];
    })
    .filter((row) => row.some(Boolean));
}

function isLikelyMoneyLine(value: string) {
  return /^¥?\s*-?\d{1,3}(,\d{3})*(\.\d+)?$|^¥?\s*-?\d+(\.\d+)?$/.test(value.trim());
}

function sumRebateAmount(values: string[]) {
  return values.reduce((sum, value) => {
    const number = Number(String(value).replace(/[^\d.-]/g, ""));
    return Number.isFinite(number) ? sum + number : sum;
  }, 0);
}

function formatMoney(value: number) {
  return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function isTodayRebateRow(row: RebateRow) {
  if (!row.createdAt) return false;
  const date = new Date(row.createdAt);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function toolForView(view: ViewKey): "home" | ToolboxTool {
  if (view === "home") return "home";
  if (view === "video" || view === "review" || view === "title" || view === "compare" || view === "settings") return view;
  return "rebate";
}

function viewTitle(view: ViewKey) {
  return { home: "工具首页", import: "导入金额与备注", entry: "逐条识别收款信息", preview: "表格预览与修正", export: "导出支付宝模板", video: "视频批量剪辑", review: "收评助手", title: "标题词优化", compare: "评价返款对比", settings: "设置中心" }[view];
}

function toolEyebrow(tool: "home" | ToolboxTool) {
  return { home: "工具首页", rebate: "支付宝批量返款", video: "电商视频制作", review: "评价运营", title: "关键词算法", compare: "评价状态核对", settings: "全局配置" }[tool];
}

function statusLabel(status: RebateRow["status"]) {
  return { pending: "待填", done: "完成", failed: "失败", manual: "手动", skipped: "跳过" }[status];
}

function modelStatusLabel(state: ModelConnectionStatus["state"]) {
  return { unknown: "未测试", testing: "测试中", connected: "已连接", failed: "失败" }[state];
}



