import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Clipboard,
  Download,
  Eraser,
  Eye,
  Film,
  FileSpreadsheet,
  KeyRound,
  Loader2,
  Maximize2,
  MessageSquareText,
  Minus,
  Moon,
  PackageCheck,
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
import { CompareWorkbench } from "./CompareWorkbench";
import { ReviewAssistant } from "./ReviewAssistant";
import { TitleOptimizer } from "./TitleOptimizer";
import { VideoWorkbench } from "./VideoWorkbench";
import { buildRows, exportValidationErrors, formatExportFileName, isValidAccount } from "./lib/parsing";
import { recognizePartialByRules, recognizeText, testModelConnection } from "./lib/recognition";
import {
  ApiProfile,
  AppSettings,
  DEFAULT_SETTINGS,
  LocalOcrStatus,
  ModelConnectionStatus,
  RebateRow,
  RebateViewKey,
  RecognitionResult,
  ToolboxTool,
  VideoWorkbenchState,
  getActiveApiProfile,
  getFixedTailRow,
  normalizeSettings,
  switchActiveApiProfile,
  syncActiveApiProfile
} from "./lib/shared";

type ViewKey = "home" | RebateViewKey | "video" | "review" | "title" | "compare" | "settings";
const APP_VERSION = "0.6.2";
const MAKER_CREDIT = "由 Misaki（丛宇航）使用 CodeX 制作";
const CHANGELOG_ITEMS = [
  "剪切板自动读取后直接触发识别，无需再手动点击识别按钮。",
  "开启自动读取 + 自动跳转后，实现全自动 复制→识别→填入→跳转 工作流。",
  "识别逻辑提取为 ref 回调，避免 setInterval 闭包过期问题。",
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
  const [ocrStatus, setOcrStatus] = useState<LocalOcrStatus>({ state: "not-installed", detail: "正在读取状态" });
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
  const [changelogOpen, setChangelogOpen] = useState(false);
  const lastClipboardSignature = useRef("");
  const autoRecognizingRef = useRef(false);

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
    window.alipayWorkbench.loadSettings().then((loaded) => {
      const normalized = normalizeSettings(loaded);
      setSettings(normalized);
      setChangelogOpen(normalized.lastSeenChangelogVersion !== APP_VERSION);
      setSettingsLoaded(true);
    });
    window.alipayWorkbench.getLocalOcrStatus().then(setOcrStatus);
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
      setLastResult(null);
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
        showToast("剪切板已读取，正在自动识别…");
        try { await doRecognizeRef.current(snapshot.text); }
        finally { autoRecognizingRef.current = false; }
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

  async function closeChangelog() {
    setChangelogOpen(false);
    const saved = await window.alipayWorkbench.saveSettings(normalizeSettings({ ...settings, lastSeenChangelogVersion: APP_VERSION }));
    setSettings(saved);
  }

  function openTool(key: "home" | ToolboxTool) {
    setView(key === "rebate" ? "import" : key);
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
    setLastResult(null);
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

  async function recognizeManualText() {
    if (!manualText.trim()) { showToast("请先粘贴要识别的文字。"); return; }
    await doRecognizeRef.current(manualText);
  }

  function applyRecognition(result: RecognitionResult) {
    setLastResult(result);
    setManualAccount(result.account || manualAccount);
    setManualName(result.name || manualName);
    if (result.account && result.name && isValidAccount(result.account)) {
      setRows((prev) =>
        prev.map((row, index) =>
          index === currentIndex
            ? { ...row, account: result.account, name: result.name, status: "done", confidence: result.confidence, reason: result.reason, rawText: result.rawText }
            : row
        )
      );
      showToast(`已识别：${result.name} / ${result.account}`);
      if (settings.autoAdvance) setCurrentIndex((index) => Math.min(index + 1, Math.max(rows.length - 1, 0)));
    } else {
      showToast("已填入可识别字段，请补齐后保存。");
    }
  }

  const doRecognizeRef = useRef<(text: string) => Promise<void>>(async () => {});
  doRecognizeRef.current = async (text: string) => {
    if (!currentRow || !text.trim()) return;
    setRecognizing(true);
    try {
      const partial = recognizePartialByRules(text);
      const result = partial && partial.account && partial.name
        ? partial
        : await recognizeText(text, settings);
      applyRecognition(result);
    } catch { /* auto-recognize silent fail */ }
    finally { setRecognizing(false); }
  };

  function saveManual() {
    if (!currentRow) return;
    if (!isValidAccount(manualAccount)) {
      showToast("支付宝账号必须是手机号或邮箱。");
      return;
    }
    if (!manualName.trim()) {
      showToast("请填写收款方姓名。");
      return;
    }
    setRows((prev) =>
      prev.map((row, index) =>
        index === currentIndex ? { ...row, account: manualAccount.trim(), name: manualName.trim(), status: "manual", confidence: 1 } : row
      )
    );
    showToast("已保存当前行。");
    if (settings.autoAdvance) setCurrentIndex((index) => Math.min(index + 1, Math.max(rows.length - 1, 0)));
  }

  async function copyRemark() {
    if (!currentRow) return;
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
      <aside className="sidebar">
        <div className="brand">
          <BrandGlyph className="brand-mark" />
          <div><strong>{settings.toolboxName}</strong><span>E-commerce ops kit</span></div>
        </div>
        <nav role="navigation" aria-label="工具导航">
          {toolNavItems.map((item) => {
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
        <button className="theme-toggle" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          <span>{theme === "dark" ? "浅色模式" : "深色模式"}</span>
        </button>
      </aside>

      <main className="main">
        {view !== "home" && (
          <header className="topbar">
            <div><p className="eyebrow">{toolEyebrow(activeTool)}</p><h1>{viewTitle(view)}</h1></div>
            <div className="top-actions">
              <span className={clsx("status-pill", settings.ocrMode)}>OCR：{ocrModeLabel(settings.ocrMode)}</span>
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
                    <button onClick={recognizeManualText} disabled={recognizing}>{recognizing ? <Loader2 className="spin" size={18} /> : <Wand2 size={18} />} 重新识别</button>
                  </div>
                </>
              ) : <EmptyState text="请先导入金额和备注。" />}
            </Panel>
            <Panel title="识别结果" icon={Wand2}>
              <div className="form-stack">
                <label><span>收款方支付宝账号</span><input value={manualAccount} onChange={(event) => setManualAccount(event.target.value)} /></label>
                <label><span>收款方姓名</span><input value={manualName} onChange={(event) => setManualName(event.target.value)} /></label>
                <button className="primary" onClick={saveManual}><Check size={18} /> 保存到当前行</button>
              </div>
              {lastResult && <div className="result-box"><strong>{lastResult.source} · {Math.round(lastResult.confidence * 100)}%</strong><span>{lastResult.reason}</span></div>}
            </Panel>
          </section>
        )}

        {view === "preview" && <RowsTable rows={rows} currentIndex={currentIndex} onClear={clearRows} onPick={(index) => { setCurrentIndex(index); setView("entry"); }} />}

        {view === "export" && (
          <section className="grid-two">
            <Panel title="导出校验" icon={Download}>
              <div className="export-name">{exportName}</div>
              <div className="rebate-total-card"><span>本次返款总金额</span><strong>{formatMoney(totalAmount)}</strong><em>{rows.length} 条 · {doneCount} 条已完成</em></div>
              <div className={clsx("import-summary", validationErrors.length && "danger")}>
                <strong>{validationErrors.length ? `发现 ${validationErrors.length} 个问题` : "可以导出"}</strong>
                <span>导出时会自动追加固定尾行：{settings.fixedTailAccount} / {settings.fixedTailName}</span>
              </div>
              <button className="primary" onClick={exportFile} disabled={!rows.length}><Download size={18} /> 导出 Excel</button>
            </Panel>
            <Panel title="问题列表" icon={Eye}>
              <div className="error-list">{validationErrors.length ? validationErrors.map((error) => <span key={error}>{error}</span>) : <EmptyState text="没有发现阻塞导出的问题。" />}</div>
            </Panel>
          </section>
        )}

        {view === "video" && <VideoWorkbench settings={settings} onSaveSettings={saveSettings} onStateChange={setVideoState} showToast={showToast} />}
        {view === "review" && <ReviewAssistant settings={settings} onSaveSettings={saveSettings} showToast={showToast} />}
        {view === "title" && <TitleOptimizer settings={settings} onSaveSettings={saveSettings} showToast={showToast} />}
        {view === "compare" && <CompareWorkbench settings={settings} showToast={showToast} />}
        {view === "settings" && <SettingsView settings={settings} onSave={saveSettings} ocrStatus={ocrStatus} modelStatus={modelStatus} onTestModel={async (draft) => {
          setModelStatus({ state: "testing", detail: "正在测试大模型连接" });
          const result = await testModelConnection(draft);
          setModelStatus(result);
          showToast(result.detail);
          return result;
        }} />}
        <footer className="app-credit">V{APP_VERSION} · 电商运营工具箱 · {MAKER_CREDIT}</footer>
      </main>
      {toast && <div className="toast">{toast}</div>}
      {changelogOpen && <ChangelogDialog onClose={() => void closeChangelog()} />}
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

function ChangelogDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="changelog-backdrop" role="dialog" aria-modal="true" aria-label="更新日志">
      <section className="changelog-card">
        <div className="changelog-mark"><PackageCheck size={22} /></div>
        <p className="eyebrow">版本 V{APP_VERSION}</p>
        <h2>本次更新</h2>
        <div className="changelog-list">
          {CHANGELOG_ITEMS.map((item) => <span key={item}>{item}</span>)}
        </div>
        <button className="primary" onClick={onClose}>知道了</button>
      </section>
    </div>
  );
}

function Panel({ title, icon: Icon, className, action, children }: { title: string; icon: typeof Upload; className?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className={clsx("panel", className)}><div className="panel-title"><div><Icon size={19} /><h2>{title}</h2></div>{action}</div>{children}</section>;
}

function ToolboxHome({ settings, pendingCount, totalAmount, onOpen }: { settings: AppSettings; pendingCount: number; totalAmount: number; onOpen: (view: ViewKey) => void }) {
  return (
    <section className="home-dashboard">
      <div className="home-hero">
        <div className="home-hero-bg" aria-hidden="true" />
        <div className="home-hero-content"><p className="eyebrow">电商运营中控台</p><h1>{settings.toolboxName}</h1><p>把返款、视频、收评、标题优化和核对放在同一个工作台。</p></div>
        <div className="home-metrics"><span className="metric-green"><strong>{formatMoney(totalAmount)}</strong>今日返款总金额</span><span className="metric-gold"><strong>{pendingCount}</strong>待处理笔数</span></div>
      </div>
      <div className="bento-grid">
        <HomeCard className="bento-main" icon={FileSpreadsheet} label="核心工具" title="支付宝批量返款" text="导入金额和备注，识别账号姓名，校验后导出支付宝模板。" onClick={() => onOpen("import")} />
        <HomeCard className="bento-video" icon={Film} label="视频生产" title="批量剪辑" text="模板化短视频，支持帛先生和切片模板。" onClick={() => onOpen("video")} />
        <HomeCard className="bento-review" icon={MessageSquareText} label="评价运营" title="收评助手" text="检索参考图并生成买家好评文案。" onClick={() => onOpen("review")} />
        <HomeCard className="bento-title" icon={Tags} label="关键词算法" title="标题词优化" text="分析已有标题评分，辅助生成严格 54 字节标题。" onClick={() => onOpen("title")} />
        <HomeCard className="bento-compare" icon={Check} label="核对" title="评价返款对比" text="自动去重，差异置顶标红。" onClick={() => onOpen("compare")} />
        <HomeCard className="bento-settings" icon={Settings} label="配置" title="全局设置" text="API、路径、规则与纠偏。" onClick={() => onOpen("settings")} />
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

function RowsTable({ rows, currentIndex, onPick, onClear }: { rows: RebateRow[]; currentIndex: number; onPick: (index: number) => void; onClear: () => void }) {
  return (
    <Panel title="完整预览" icon={Eye} action={<button className="secondary-action danger-text compact" onClick={onClear}><Eraser size={16} /> 清空列表</button>}>
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>序号</th><th>账号</th><th>姓名</th><th>金额</th><th>备注</th><th>状态</th><th>处理</th></tr></thead>
            <tbody>{rows.map((row, index) => <tr key={row.id} className={clsx(index === currentIndex && "selected")}><td>{index + 1}</td><td>{row.account || "待填写"}</td><td>{row.name || "待填写"}</td><td>{row.amount}</td><td>{row.remark}</td><td><span className={clsx("row-status", row.status)}>{statusLabel(row.status)}</span></td><td><button onClick={() => onPick(index)}>编辑</button></td></tr>)}</tbody>
          </table>
        </div>
      ) : <EmptyState text="当前没有返款列表，请先在批量导入中生成。" />}
    </Panel>
  );
}

function SettingsView({ settings, onSave, ocrStatus, modelStatus, onTestModel }: { settings: AppSettings; onSave: (settings: AppSettings) => void; ocrStatus: LocalOcrStatus; modelStatus: ModelConnectionStatus; onTestModel: (settings: AppSettings) => Promise<ModelConnectionStatus> }) {
  const [draft, setDraft] = useState(settings);
  const [section, setSection] = useState<"global" | "rebate" | "video" | "review" | "title" | "compare">("global");
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
  const sections = [
    { key: "global" as const, label: "全局设置", icon: Settings, description: "工具箱名称、API 与 OCR" },
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
      {section === "global" && <section className="settings-grid single"><Panel title="全局设置" icon={Settings}><div className="form-stack"><label><span>工具箱名称</span><input value={draft.toolboxName} onChange={(event) => set("toolboxName", event.target.value)} /></label><FontScalePicker value={draft.fontScale} onChange={(value) => set("fontScale", value)} /><label><span>API Base URL</span><input value={activeProfile.apiBaseUrl} onChange={(event) => setProfile({ apiBaseUrl: event.target.value })} /></label><label><span>API Key</span><input type="password" value={activeProfile.apiKey} onChange={(event) => setProfile({ apiKey: event.target.value })} /></label><label><span>文本模型</span><input value={activeProfile.textModel} onChange={(event) => setProfile({ textModel: event.target.value })} /></label><label><span>视觉模型</span><input value={activeProfile.visionModel} onChange={(event) => setProfile({ visionModel: event.target.value })} /></label><div className={clsx("connection-card", modelStatus.state)}><strong>大模型连接：{modelStatusLabel(modelStatus.state)}</strong><span>{modelStatus.detail}</span></div><button className="secondary-action" onClick={() => void onTestModel(draft)}><KeyRound size={17} /> 测试大模型连接</button><div className="hint-card">OCR 状态：{ocrStatus.detail}</div><div className="hint-card">页面底部会显示：{MAKER_CREDIT}</div></div></Panel></section>}
      {section === "rebate" && <section className="settings-grid single"><Panel title="支付宝返款设置" icon={FileSpreadsheet}><div className="form-stack"><label><span>导出文件名中的名字</span><input value={draft.exportNameOwner} onChange={(event) => set("exportNameOwner", event.target.value)} /></label><label><span>固定尾行支付宝账号</span><input value={draft.fixedTailAccount} onChange={(event) => set("fixedTailAccount", event.target.value)} /></label><label><span>固定尾行姓名</span><input value={draft.fixedTailName} onChange={(event) => set("fixedTailName", event.target.value)} /></label><Toggle checked={draft.autoListenClipboard} label="录入页自动读取剪切板" onChange={(value) => set("autoListenClipboard", value)} /></div></Panel></section>}
      {section === "video" && <section className="settings-grid single"><Panel title="视频批量剪辑设置" icon={Film}><div className="form-stack"><label><span>视频库文件夹</span><input value={draft.videoLibraryDir} onChange={(event) => set("videoLibraryDir", event.target.value)} /></label><button className="secondary-action light" onClick={() => void pickDirectory("videoLibraryDir", "选择视频库文件夹")}>选择视频库</button><label><span>输出文件夹</span><input value={draft.videoOutputDir} onChange={(event) => set("videoOutputDir", event.target.value)} /></label><button className="secondary-action light" onClick={() => void pickDirectory("videoOutputDir", "选择输出文件夹")}>选择输出目录</button><label><span>FFmpeg 路径</span><input value={draft.ffmpegPath} onChange={(event) => set("ffmpegPath", event.target.value)} /></label><button className="secondary-action light" onClick={() => void pickFfmpeg()}>指定 FFmpeg</button><div className="hint-card">切片音乐默认使用内置 CC0 音乐。{MAKER_CREDIT}</div></div></Panel></section>}
      {section === "review" && <section className="settings-grid single"><Panel title="收评助手设置" icon={MessageSquareText}><div className="form-stack"><label><span>图片根目录</span><input value={draft.reviewRootDir} onChange={(event) => set("reviewRootDir", event.target.value)} /></label><button className="secondary-action light" onClick={() => void pickDirectory("reviewRootDir", "选择收评助手图片根目录")}>选择图片根目录</button><label><span>云端更新源 URL</span><input value={draft.updateFeedUrl} onChange={(event) => set("updateFeedUrl", event.target.value)} /></label></div></Panel></section>}
      {section === "title" && <section className="settings-grid single"><Panel title="标题词优化设置" icon={Tags}><div className="form-stack"><label><span>市场关键词 Excel 路径</span><input value={draft.titleKeywordExcelPath} onChange={(event) => set("titleKeywordExcelPath", event.target.value)} /></label><button className="secondary-action light" onClick={() => void pickTitleExcel()}><FileSpreadsheet size={17} /> 选择标题关键词 Excel</button><div className="hint-card">默认读取桌面“市场关键词帛先生.xlsx”。文件更新后会重新解析和加权。</div><div className="hint-card">{MAKER_CREDIT}</div></div></Panel></section>}
      {section === "compare" && <section className="settings-grid single"><Panel title="评价返款对比设置" icon={Check}><div className="toggle-list"><Toggle checked={draft.compareAutoOpenReminderDialog} label="验证后自动弹出需催促名单" onChange={(value) => set("compareAutoOpenReminderDialog", value)} /><Toggle checked={draft.compareShowPassedRowsAfterVerify} label="右侧验证后显示已通过人员" onChange={(value) => set("compareShowPassedRowsAfterVerify", value)} /></div></Panel></section>}
      <div className="settings-savebar"><span>当前正在调整：{sections.find((item) => item.key === section)?.label}</span><button className="primary" onClick={() => onSave(normalizeSettings(draft))}><Check size={18} /> 保存设置</button></div>
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

function ocrModeLabel(mode: AppSettings["ocrMode"]) {
  return { cloud: "云端 OCR", local: "本地 OCR", off: "关闭" }[mode];
}

function statusLabel(status: RebateRow["status"]) {
  return { pending: "待填", done: "完成", failed: "失败", manual: "手动", skipped: "跳过" }[status];
}

function modelStatusLabel(state: ModelConnectionStatus["state"]) {
  return { unknown: "未测试", testing: "测试中", connected: "已连接", failed: "失败" }[state];
}
