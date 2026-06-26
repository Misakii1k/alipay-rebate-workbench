import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  Clipboard,
  FileJson,
  FileSpreadsheet,
  Lightbulb,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Wand2,
  X,
  TrendingUp,
  GitCompare,
  ListChecks,
  KeyRound
} from "lucide-react";
import clsx from "clsx";
import type {
  AppSettings,
  TitleAnalysisResult,
  TitleCandidate,
  TitleKeywordData,
  TitleRecommendation,
  TitleScoreResult
} from "./lib/shared";

const DEFAULT_AI_JSON = `{
  "productName": "彩棉317夏季长裤",
  "season": "夏季",
  "category": "长裤",
  "material": "彩棉",
  "fit": "直筒",
  "features": ["薄款", "凉感", "休闲", "运动"],
  "mustInclude": ["棉麻", "亚麻", "纯棉", "男款", "裤子"],
  "avoidBrands": true
}`;
const ANALYSIS_VISIBLE_MS = 2800;
const FLOW_WORD_POSITIONS = [
  ["8%", "14%"], ["22%", "78%"], ["34%", "20%"], ["48%", "82%"],
  ["62%", "18%"], ["76%", "74%"], ["88%", "34%"], ["14%", "50%"],
  ["72%", "46%"], ["42%", "58%"]
];

type TitleTab = "keywords" | "rules" | "advice";

function waitForVisibleAnalysis(startedAt: number, skipDelay = false) {
  if (skipDelay) return Promise.resolve();
  const remaining = ANALYSIS_VISIBLE_MS - (Date.now() - startedAt);
  return remaining > 0 ? new Promise((resolve) => window.setTimeout(resolve, remaining)) : Promise.resolve();
}

function shouldSkipAnalysisDelay(settings: AppSettings, resolvedPerformanceMode?: Exclude<AppSettings["performanceMode"], "auto">) {
  const mode = settings.performanceMode ?? "auto";
  if (mode === "low") return true;
  if (mode === "quality" || mode === "balanced") return false;
  if (resolvedPerformanceMode === "low") return true;
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

function splitTitleTargets(value: string) {
  return String(value || "").split(/[\s,，、;；\n\r]+/).map((word) => word.trim()).filter(Boolean);
}

function titleCandidateDisplayScore(candidate: Pick<TitleCandidate, "score" | "strategy">): number {
  const raw = candidate.strategy === "stacked-v2" ? candidate.score : candidate.score / 12;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function TitleOptimizer({
  settings,
  resolvedPerformanceMode,
  onSaveSettings,
  showToast
}: {
  settings: AppSettings;
  resolvedPerformanceMode?: Exclude<AppSettings["performanceMode"], "auto">;
  onSaveSettings: (settings: AppSettings) => Promise<void>;
  showToast: (message: string) => void;
}) {
  const [keywordData, setKeywordData] = useState<TitleKeywordData | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [productName, setProductName] = useState("彩棉317夏季长裤");
  const [currentTitle, setCurrentTitle] = useState("帛先生棉麻卫裤凉感裤子男款薄款直筒裤男夏季亚麻裤纯棉休闲裤子");
  const [categoryName, setCategoryName] = useState("");
  const [aiJson, setAiJson] = useState(DEFAULT_AI_JSON);
  const [analysis, setAnalysis] = useState<TitleAnalysisResult | null>(null);
  const [generated, setGenerated] = useState<TitleScoreResult | null>(null);
  const [error, setError] = useState("");
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TitleTab>("keywords");
  const [compareCandidate, setCompareCandidate] = useState<TitleCandidate | null>(null);
  const [extraKeywordsDraft, setExtraKeywordsDraft] = useState(settings.titleExtraKeywords);
  const analyzeRequestRef = useRef(0);
  const generateRequestRef = useRef(0);
  const skipAnalysisDelay = shouldSkipAnalysisDelay(settings, resolvedPerformanceMode);

  const categories = keywordData?.categories ?? [];
  const selectedCategory = useMemo(
    () => categories.find((item) => item.name === categoryName),
    [categories, categoryName]
  );
  const hasKeywordWarnings = (keywordData?.warnings.length ?? 0) > 0;

  useEffect(() => {
    void loadData();
  }, [settings.titleKeywordExcelPath]);

  useEffect(() => {
    setExtraKeywordsDraft(settings.titleExtraKeywords);
  }, [settings.titleExtraKeywords]);

  useEffect(() => {
    if (extraKeywordsDraft === settings.titleExtraKeywords) return;
    const timer = window.setTimeout(() => {
      void onSaveSettings({ ...settings, titleExtraKeywords: extraKeywordsDraft });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [extraKeywordsDraft, onSaveSettings, settings]);

  const saveExtraKeywordsNow = () => {
    if (extraKeywordsDraft === settings.titleExtraKeywords) return;
    void onSaveSettings({ ...settings, titleExtraKeywords: extraKeywordsDraft });
  };

  const settingsForTitleRun = () => {
    const next = { ...settings, titleExtraKeywords: extraKeywordsDraft };
    if (extraKeywordsDraft !== settings.titleExtraKeywords) void onSaveSettings(next);
    return next;
  };

  const loadData = async () => {
    setLoadingData(true);
    setError("");
    try {
      const data = await window.alipayWorkbench.loadTitleKeywordData(settings);
      setKeywordData(data);
      if (!categoryName && data.categories[0]) setCategoryName(data.categories[0].name);
    } catch (caught) {
      setKeywordData(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoadingData(false);
    }
  };

  const pickExcel = async () => {
    const result = await window.alipayWorkbench.selectTitleKeywordExcel();
    if (!result.canceled && result.paths[0]) {
      await onSaveSettings({ ...settings, titleKeywordExcelPath: result.paths[0] });
      showToast("标题关键词 Excel 路径已更新。");
    }
  };

  const analyze = async () => {
    const startedAt = Date.now();
    const requestSeq = analyzeRequestRef.current + 1;
    analyzeRequestRef.current = requestSeq;
    setAnalyzing(true);
    setError("");
    setAnalysis(null);
    try {
      const runSettings = settingsForTitleRun();
      const next = await window.alipayWorkbench.analyzeTitle(runSettings, {
        productName,
        title: currentTitle,
        categoryName: categoryName || undefined,
        strategy: "stacked-v2",
        targetKeywords: splitTitleTargets(extraKeywordsDraft)
      });
      await waitForVisibleAnalysis(startedAt, skipAnalysisDelay);
      if (analyzeRequestRef.current !== requestSeq) return;
      setAnalysis(next);
      setActiveTab("keywords");
      if (!next.ok || next.grade === "blocked") setError(next.message);
    } catch (caught) {
      await waitForVisibleAnalysis(startedAt, skipAnalysisDelay);
      if (analyzeRequestRef.current !== requestSeq) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (analyzeRequestRef.current === requestSeq) setAnalyzing(false);
    }
  };

  const generateFromJson = async () => {
    const startedAt = Date.now();
    const requestSeq = generateRequestRef.current + 1;
    generateRequestRef.current = requestSeq;
    setGenerating(true);
    setError("");
    setGenerated(null);
    try {
      const parsed = JSON.parse(aiJson) as { productName?: string; category?: string };
      const nextProductName = String(parsed.productName || productName).trim();
      if (nextProductName) setProductName(nextProductName);
      const runSettings = settingsForTitleRun();
      const next = await window.alipayWorkbench.generateTitleCandidates(runSettings, {
        productName: nextProductName || productName,
        categoryName: categoryName || parsed.category || undefined,
        variantCount: 5,
        strategy: "stacked-v2",
        targetKeywords: splitTitleTargets(extraKeywordsDraft)
      });
      await waitForVisibleAnalysis(startedAt, skipAnalysisDelay);
      if (generateRequestRef.current !== requestSeq) return;
      setGenerated(next);
      if (!next.ok) setError(next.message);
    } catch (caught) {
      await waitForVisibleAnalysis(startedAt, skipAnalysisDelay);
      if (generateRequestRef.current !== requestSeq) return;
      setError(caught instanceof Error ? caught.message : "商品 JSON 格式不正确，请检查引号和逗号。");
    } finally {
      if (generateRequestRef.current === requestSeq) setGenerating(false);
    }
  };

  const generateCandidates = async () => {
    const startedAt = Date.now();
    const requestSeq = generateRequestRef.current + 1;
    generateRequestRef.current = requestSeq;
    setGenerating(true);
    setError("");
    setGenerated(null);
    try {
      const runSettings = settingsForTitleRun();
      const next = await window.alipayWorkbench.generateTitleCandidates(runSettings, {
        productName,
        categoryName: categoryName || undefined,
        variantCount: 5,
        strategy: "stacked-v2",
        targetKeywords: splitTitleTargets(extraKeywordsDraft)
      });
      await waitForVisibleAnalysis(startedAt, skipAnalysisDelay);
      if (generateRequestRef.current !== requestSeq) return;
      setGenerated(next);
      if (!next.ok) setError(next.message);
      showToast("已使用叠词实验版生成候选。");
    } catch (caught) {
      await waitForVisibleAnalysis(startedAt, skipAnalysisDelay);
      if (generateRequestRef.current !== requestSeq) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (generateRequestRef.current === requestSeq) setGenerating(false);
    }
  };

  const copyText = async (text: string, message: string) => {
    await window.alipayWorkbench.writeClipboardText(text);
    showToast(message);
  };

  const aiPrompt = useMemo(() => buildBrowserAiPrompt(productName), [productName]);

  return (
    <section className="title-optimizer title-v2">
      <TitleInputCard
        productName={productName}
        setProductName={setProductName}
        currentTitle={currentTitle}
        setCurrentTitle={setCurrentTitle}
        categoryName={categoryName}
        setCategoryName={setCategoryName}
        categoryPickerOpen={categoryPickerOpen}
        setCategoryPickerOpen={setCategoryPickerOpen}
        categories={categories}
        selectedCategory={selectedCategory}
        keywordData={keywordData}
        analyzing={analyzing}
        loadingData={loadingData}
        onAnalyze={() => void analyze()}
        onReload={() => void loadData()}
        onPickExcel={() => void pickExcel()}
        onOpenAi={() => setAiDrawerOpen(true)}
        extraKeywordsDraft={extraKeywordsDraft}
        setExtraKeywordsDraft={setExtraKeywordsDraft}
        onSaveExtraKeywords={saveExtraKeywordsNow}
        settings={settings}
        onSaveSettings={onSaveSettings}
        showToast={showToast}
      />

      {(error || hasKeywordWarnings) && (
        <div className={clsx("title-v2-message", error && "danger")}>
          <strong>{error || "数据提醒"}</strong>
          {(keywordData?.warnings ?? []).slice(0, 4).map((warning) => <span key={warning}>{warning}</span>)}
        </div>
      )}

      {(analyzing || generating) && (
        skipAnalysisDelay
          ? <TitleLoadingNotice label={analyzing ? "正在分析标题" : "正在生成候选"} />
          : <TitleAnalyzeAnimation label={analyzing ? "正在分析标题" : "正在生成候选"} />
      )}

      {analysis && !compareCandidate && (
        <TitleScorePanel
          analysis={analysis}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onCopy={(text, msg) => void copyText(text, msg)}
          onCompare={(candidate) => setCompareCandidate(candidate)}
        />
      )}

      {compareCandidate && analysis && (
        <TitleCompareView
          original={analysis}
          candidate={compareCandidate}
          onExit={() => setCompareCandidate(null)}
          onCopy={(text, msg) => void copyText(text, msg)}
        />
      )}

      {generated && generated.candidates.length > 0 ? (
        <section className="title-v2-candidates">
          <div className="title-v2-section-head">
            <Sparkles size={16} />
            <h3>叠词实验版候选标题</h3>
            <span>{generated.candidates.length} 个</span>
          </div>
          <div className="title-v2-candidate-grid">
            {generated.candidates.map((candidate, index) => (
              <TitleCandidateCardV2
                key={candidate.id}
                candidate={candidate}
                index={index}
                onCopy={() => void copyText(candidate.title, "标题已复制。")}
                onCompare={analysis ? () => setCompareCandidate(candidate) : undefined}
              />
            ))}
          </div>
        </section>
      ) : !generating && (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2L9 9H2l5.5 4.5L5 21l7-4.5 7 4.5-2.5-7.5L22 9h-7z" />
            </svg>
          </div>
          <div className="empty-state-title">暂无候选</div>
          <div className="empty-state-desc">输入商品关键词后,将在此显示优化后的标题候选</div>
        </div>
      )}

      <TitleAIDrawer
        open={aiDrawerOpen}
        onClose={() => setAiDrawerOpen(false)}
        aiJson={aiJson}
        setAiJson={setAiJson}
        aiPrompt={aiPrompt}
        generating={generating}
        loadingData={loadingData}
        onGenerate={() => void generateFromJson()}
        onCopyPrompt={() => void copyText(aiPrompt, "AI 提示词已复制。")}
      />
    </section>
  );
}

function TitleInputCard({
  productName,
  setProductName,
  currentTitle,
  setCurrentTitle,
  categoryName,
  setCategoryName,
  categoryPickerOpen,
  setCategoryPickerOpen,
  categories,
  selectedCategory,
  keywordData,
  analyzing,
  loadingData,
  onAnalyze,
  onReload,
  onPickExcel,
  onOpenAi,
  extraKeywordsDraft,
  setExtraKeywordsDraft,
  onSaveExtraKeywords,
  settings,
  onSaveSettings,
  showToast
}: {
  productName: string;
  setProductName: (v: string) => void;
  currentTitle: string;
  setCurrentTitle: (v: string) => void;
  categoryName: string;
  setCategoryName: (v: string) => void;
  categoryPickerOpen: boolean;
  setCategoryPickerOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  categories: Array<{ name: string; keywordCount: number }>;
  selectedCategory: { name: string } | undefined;
  keywordData: TitleKeywordData | null;
  analyzing: boolean;
  loadingData: boolean;
  onAnalyze: () => void;
  onReload: () => void;
  onPickExcel: () => void;
  onOpenAi: () => void;
  extraKeywordsDraft: string;
  setExtraKeywordsDraft: (value: string) => void;
  onSaveExtraKeywords: () => void;
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => Promise<void>;
  showToast: (message: string) => void;
}) {
  return (
    <section className="title-v2-input-card">
      <div className="title-v2-input-head">
        <Search size={19} />
        <h2>标题分析</h2>
        <div className="title-v2-data-badge">
          <FileSpreadsheet size={14} />
          <span>{keywordData ? `${keywordData.totalKeywords} 词库` : "未加载"}</span>
        </div>
        <label className="title-v2-ai-switch">
          <input
            type="checkbox"
            checked={settings.titleAiSelectionEnabled}
            onChange={async (event) => {
              await onSaveSettings({ ...settings, titleAiSelectionEnabled: event.target.checked });
              showToast(event.target.checked ? "已开启旧版 AI 选词" : "已关闭旧版 AI 选词");
            }}
          />
          <span className="title-v2-ai-switch-track"><span className="title-v2-ai-switch-thumb" /></span>
          <span>旧版 AI 选词</span>
        </label>
      </div>
      <div className="title-v2-input-grid">
        <label className="title-v2-field">
          <span>商品名</span>
          <input value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="例如：彩棉317夏季长裤" />
        </label>
        <label className="title-v2-field title-v2-field-category">
          <span>类目</span>
          <div className="title-v2-category-picker">
            <button
              type="button"
              className={clsx("title-v2-category-trigger", categoryPickerOpen && "open")}
              onClick={() => setCategoryPickerOpen((open) => !open)}
             title="展开或收起类目选择">
              <span>{selectedCategory ? selectedCategory.name : "自动"}</span>
              <ChevronDown size={14} className={clsx("title-v2-chev", categoryPickerOpen && "open")} />
            </button>
            {categoryPickerOpen && (
              <div className="title-v2-category-menu">
                <button type="button" className={clsx(!categoryName && "active")} onClick={() => { setCategoryName(""); setCategoryPickerOpen(false); }} title="使用自动类目匹配">
                  <strong>自动匹配</strong><span>按商品名</span>
                </button>
                {categories.slice(0, 32).map((category) => (
                  <button type="button" key={category.name} className={clsx(category.name === categoryName && "active")} onClick={() => { setCategoryName(category.name); setCategoryPickerOpen(false); }} title="选择这个标题类目">
                    <strong>{category.name}</strong><span>{category.keywordCount}词</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </label>
      </div>
      <label className="title-v2-field">
        <span>标题（含帛先生前缀）</span>
        <textarea
          className="title-v2-textarea"
          value={currentTitle}
          onChange={(event) => setCurrentTitle(event.target.value)}
          placeholder="粘贴完整标题，含帛先生前缀"
        />
      </label>
      <label className="title-v2-field">
        <span>目标搜索词（空格/逗号分隔，越靠前越重要）</span>
        <input
          value={extraKeywordsDraft}
          onChange={(event) => setExtraKeywordsDraft(event.target.value)}
          onBlur={onSaveExtraKeywords}
          placeholder="例如：天丝莱赛尔男士裤子夏薄款 休闲裤 直筒裤"
        />
      </label>
      <div className="title-v2-buttons">
        <button className="title-v2-primary" onClick={onAnalyze} disabled={analyzing || loadingData} title="分析当前标题的搜索权重评分，对比市场关键词数据">
          {analyzing ? <Loader2 className="spin" size={18} /> : <Search size={18} />} 分析评分
        </button>
        <button className="title-v2-secondary" onClick={onOpenAi} title="使用叠词实验版生成严格 60 字节候选">
          <Wand2 size={16} /> 生成实验版候选
        </button>
        <button className="title-v2-ghost" onClick={onReload} disabled={loadingData} title="重新加载市场关键词 Excel 数据">
          {loadingData ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />} 刷新数据
        </button>
        <button className="title-v2-ghost" onClick={onPickExcel} title="选择新的市场关键词 Excel 文件">
          <FileSpreadsheet size={15} /> 选 Excel
        </button>
      </div>
    </section>
  );
}

function TitleScorePanel({
  analysis,
  activeTab,
  setActiveTab,
  onCopy,
  onCompare
}: {
  analysis: TitleAnalysisResult;
  activeTab: TitleTab;
  setActiveTab: (t: TitleTab) => void;
  onCopy: (text: string, msg: string) => void;
  onCompare: (candidate: TitleCandidate) => void;
}) {
  const breakdown = analysis.scoreBreakdown ?? { keywordScore: 0, byteScore: 0, blueOceanScore: 0 };
  const gradeColor =
    analysis.grade === "excellent" ? "var(--green)" :
    analysis.grade === "good" ? "var(--gold)" :
    analysis.grade === "needs-work" ? "#fb923c" : "var(--red)";

  return (
    <section className="title-v2-score-panel">
      <div className="title-v2-hero">
        <div className="title-v2-hero-main">
          <div className="title-v2-score-ring" style={{ "--score": analysis.score, "--color": gradeColor } as CSSProperties}>
            <div className="title-v2-score-inner">
              <strong>{analysis.score}</strong>
              <span>{gradeLabel(analysis.grade)}</span>
            </div>
          </div>
          <div className="title-v2-hero-info">
            <span className="title-v2-hero-tag" style={{ color: gradeColor, borderColor: gradeColor }}>{gradeLabel(analysis.grade)}</span>
            <p>{analysis.message}</p>
            <div className="title-v2-hero-bytes">
              <div><strong>{analysis.bodyBytes}</strong><span>/54 主体字节</span></div>
              <div><strong>{analysis.totalBytes}</strong><span>/60 整条字节</span></div>
              <div><strong>{analysis.substringHits.length}</strong><span>叠加命中</span></div>
            </div>
          </div>
        </div>
        <div className="title-v2-rings-row">
          <DimRing label="关键词" value={breakdown.keywordScore} color="var(--green)" icon={<KeyRound size={14} />} />
          <DimRing label="字节利用" value={breakdown.byteScore} color="var(--gold)" icon={<TrendingUp size={14} />} />
          <DimRing label="蓝海词" value={breakdown.blueOceanScore} color="var(--blue)" icon={<Sparkles size={14} />} />
        </div>
      </div>

      {analysis.candidate && (
        <button className="title-v2-original-line" onClick={() => onCopy(analysis.title, "标题已复制。")} title="复制当前原标题">
          <Clipboard size={14} />
          <span>{analysis.title}</span>
        </button>
      )}

      <div className="title-v2-tabs">
        <button className={clsx(activeTab === "keywords" && "active")} onClick={() => setActiveTab("keywords")} title="查看关键词命中">
          <KeyRound size={14} /> 关键词命中
          <em>{analysis.substringHits.length}</em>
        </button>
        <button className={clsx(activeTab === "rules" && "active")} onClick={() => setActiveTab("rules")} title="查看标题规则检查">
          <ListChecks size={14} /> 规则检查
          {analysis.candidate && <em>{analysis.candidate.ruleChecks.filter((r) => !r.passed).length} 个未通过</em>}
        </button>
        <button className={clsx(activeTab === "advice" && "active")} onClick={() => setActiveTab("advice")} title="查看优化建议">
          <Lightbulb size={14} /> 优化建议
          <em>{analysis.recommendations.length}</em>
        </button>
      </div>

      <div className="title-v2-tab-body">
        {activeTab === "keywords" && (
          <div className="title-v2-hit-list">
            {analysis.substringHits.length === 0 ? (
              <span className="title-v2-empty-line">尚未命中任何 Excel 关键词，建议参考下方推荐标题调整词序。</span>
            ) : (
              analysis.substringHits.slice(0, 32).map((hit) => (
                <span
                  key={`${hit.start}-${hit.keyword}`}
                  className={clsx("title-v2-hit", hit.value >= 20 ? "high" : hit.value >= 8 ? "mid" : "low")}
                >
                  {hit.keyword}
                  {hit.rank ? <em>#{hit.rank}</em> : null}
                </span>
              ))
            )}
          </div>
        )}
        {activeTab === "rules" && analysis.candidate && (
          <div className="title-v2-rule-list">
            {analysis.candidate.ruleChecks.map((rule) => (
              <div key={rule.key} className={clsx("title-v2-rule", rule.passed ? "ok" : rule.required ? "danger" : "warn")}>
                {rule.passed ? <Check size={14} /> : <X size={14} />}
                <strong>{rule.label}</strong>
                <span>{rule.detail}</span>
              </div>
            ))}
          </div>
        )}
        {activeTab === "advice" && (
          <div className="title-v2-reco-grid">
            {analysis.recommendations.length === 0 ? (
              <span className="title-v2-empty-line">没有明显可优化的点，当前标题已经比较合格。</span>
            ) : (
              analysis.recommendations.map((item) => (
                <RecommendationCardV2 key={item.message} item={item} />
              ))
            )}
          </div>
        )}
      </div>

      {analysis.suggestedTitles.length > 0 && (
        <div className="title-v2-suggested">
          <div className="title-v2-section-head">
            <Sparkles size={16} />
            <h3>系统推荐标题</h3>
            <span>{analysis.suggestedTitles.length} 个</span>
          </div>
          <div className="title-v2-candidate-grid">
            {analysis.suggestedTitles.map((candidate) => (
              <TitleCandidateCardV2
                key={candidate.id}
                candidate={candidate}
                onCopy={() => onCopy(candidate.title, "标题已复制。")}
                onCompare={() => onCompare(candidate)}
              />
            ))}
          </div>
        </div>
      )}

      {analysis.endingAdvice && (
        <div className="title-v2-ending">{analysis.endingAdvice}</div>
      )}
    </section>
  );
}

function DimRing({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ReactNode }) {
  const safeValue = Math.max(0, Math.min(100, value));
  return (
    <div className="title-v2-dim-ring" style={{ "--ring-value": safeValue, "--ring-color": color } as CSSProperties}>
      <div className="title-v2-dim-ring-circle">
        <strong>{Math.round(safeValue)}</strong>
      </div>
      <div className="title-v2-dim-ring-info">
        <span>{icon} {label}</span>
        <em>满分 100</em>
      </div>
    </div>
  );
}

function TitleCandidateCardV2({
  candidate,
  onCopy,
  onCompare,
  index
}: {
  candidate: TitleCandidate;
  onCopy: () => void;
  onCompare?: () => void;
  index?: number;
}) {
  const [rulesOpen, setRulesOpen] = useState(false);
  const failedRequired = candidate.ruleChecks.filter((rule) => rule.required && !rule.passed);
  const displayScore = titleCandidateDisplayScore(candidate);
  const scoreColor = displayScore >= 80 ? "var(--green)" : displayScore >= 60 ? "var(--gold)" : "var(--red)";

  return (
    <article className={clsx("title-v2-candidate", index !== undefined && "list-item", failedRequired.length > 0 && "warned")} data-mode={candidate.mode} style={index !== undefined ? { "--i": index } as CSSProperties : undefined}>
      <div className="title-v2-candidate-head">
        <span className="title-v2-mode-chip" data-mode={candidate.mode}>{candidate.label}</span>
        <div className="title-v2-candidate-score" style={{ "--score": displayScore, "--color": scoreColor } as CSSProperties}>
          <strong>{displayScore}</strong>
        </div>
        <span className="title-v2-candidate-bytes">{candidate.totalBytes}/60 字节</span>
      </div>
      <div className="title-v2-candidate-title">
        {renderHighlighted(candidate.title, candidate.keywordHits)}
      </div>
      {candidate.targetHits && candidate.targetHits.length > 0 && (
        <div className="title-v2-candidate-rules">
          {candidate.targetHits.slice(0, 6).map((hit) => (
            <div key={`${hit.target}-${hit.matched}`} className="title-v2-rule-mini ok">
              <Check size={11} /> {hit.target === hit.matched ? hit.target : `${hit.target}→${hit.matched}`}
            </div>
          ))}
        </div>
      )}
      {candidate.unplacedTerms && candidate.unplacedTerms.length > 0 && (
        <div className="title-v2-warn-line">未放入目标词：{candidate.unplacedTerms.slice(0, 5).join("、")}</div>
      )}
      {candidate.sourceTerms && candidate.sourceTerms.length > 0 && (
        <div className="title-v2-candidate-rules">
          {candidate.sourceTerms.slice(0, 8).map((term, index) => (
            <div key={`${term.text}-${index}`} className="title-v2-rule-mini">
              {term.text}{term.rank ? ` #${term.rank}` : ""}{term.parent && term.parent !== term.text ? ` / ${term.parent}` : ""}
            </div>
          ))}
        </div>
      )}
      <div className="title-v2-candidate-actions">
        <button className="title-v2-action" onClick={onCopy} title="复制这个标题">
          <Clipboard size={13} /> 复制
        </button>
        {onCompare && (
          <button className="title-v2-action" onClick={onCompare} title="加入标题对比">
            <GitCompare size={13} /> 加入对比
          </button>
        )}
        <button className="title-v2-action ghost" onClick={() => setRulesOpen((v) => !v)} title="展开或收起规则详情">
          <ListChecks size={13} /> 规则{rulesOpen ? "收起" : "展开"}
        </button>
      </div>
      {rulesOpen && (
        <div className="title-v2-candidate-rules">
          {candidate.ruleChecks.map((rule) => (
            <div key={rule.key} className={clsx("title-v2-rule-mini", rule.passed ? "ok" : rule.required ? "danger" : "warn")}>
              {rule.passed ? <Check size={11} /> : <X size={11} />} {rule.label}
            </div>
          ))}
        </div>
      )}
      {failedRequired.length > 0 && (
        <div className="title-v2-warn-line">硬规则未通过：{failedRequired.map((r) => r.label).join("、")}</div>
      )}
    </article>
  );
}

function renderHighlighted(title: string, hits: Array<{ keyword: string; weight: number }>) {
  if (!hits.length) return <span>{title}</span>;
  const sorted = [...hits].sort((a, b) => b.keyword.length - a.keyword.length);
  const segments: Array<{ text: string; weight: number } | { text: string }> = [{ text: title }];
  for (const hit of sorted) {
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      if ("weight" in seg) continue;
      const idx = seg.text.indexOf(hit.keyword);
      if (idx < 0) continue;
      const before = seg.text.slice(0, idx);
      const after = seg.text.slice(idx + hit.keyword.length);
      const inserts: typeof segments = [];
      if (before) inserts.push({ text: before });
      inserts.push({ text: hit.keyword, weight: hit.weight });
      if (after) inserts.push({ text: after });
      segments.splice(i, 1, ...inserts);
    }
  }
  return (
    <>
      {segments.map((seg, idx) => {
        if (!("weight" in seg)) return <span key={idx}>{seg.text}</span>;
        const cls = seg.weight >= 20 ? "hit-high" : seg.weight >= 8 ? "hit-mid" : "hit-low";
        return <em key={idx} className={cls}>{seg.text}</em>;
      })}
    </>
  );
}

function TitleCompareView({
  original,
  candidate,
  onExit,
  onCopy
}: {
  original: TitleAnalysisResult;
  candidate: TitleCandidate;
  onExit: () => void;
  onCopy: (text: string, msg: string) => void;
}) {
  const originalScore = Math.max(0, Math.min(100, Math.round(original.score)));
  const candidateScore = titleCandidateDisplayScore(candidate);
  const diff = candidateScore - originalScore;
  const diffColor = diff > 0 ? "var(--green)" : diff < 0 ? "var(--red)" : "var(--muted)";

  const originalKeywords = new Set((original.candidate?.keywordHits ?? []).map((h) => h.keyword));
  const candidateKeywords = new Set(candidate.keywordHits.map((h) => h.keyword));
  const both = [...originalKeywords].filter((k) => candidateKeywords.has(k));
  const onlyOriginal = [...originalKeywords].filter((k) => !candidateKeywords.has(k));
  const onlyCandidate = [...candidateKeywords].filter((k) => !originalKeywords.has(k));

  const originalRules = original.candidate?.ruleChecks ?? [];
  const candidateRules = candidate.ruleChecks;
  const candidateBetter = candidateRules.filter((cr) => {
    const orig = originalRules.find((or) => or.key === cr.key);
    return cr.passed && orig && !orig.passed;
  });
  const originalBetter = originalRules.filter((or) => {
    const cand = candidateRules.find((cr) => cr.key === or.key);
    return or.passed && cand && !cand.passed;
  });

  return (
    <section className="title-v2-compare">
      <div className="title-v2-compare-head">
        <ArrowLeftRight size={18} />
        <h3>原标题 vs 推荐对比</h3>
        <button className="title-v2-ghost" onClick={onExit} title="退出标题对比">
          <X size={14} /> 退出对比
        </button>
      </div>

      <div className="title-v2-compare-cols">
        <div className="title-v2-compare-col">
          <span className="title-v2-compare-tag">原标题</span>
          <div className="title-v2-compare-score-wrap">
            <strong className="title-v2-compare-score">{originalScore}</strong>
            <em className="title-v2-compare-score-unit">/100</em>
          </div>
          <button className="title-v2-compare-title" onClick={() => onCopy(original.title, "原标题已复制。")} title="复制这个对比标题">
            {original.title}
          </button>
          <div className="title-v2-compare-meta">
            <span>主体 {original.bodyBytes}/54</span>
            <span>整条 {original.totalBytes}/60</span>
            <span>命中 {original.substringHits.length}</span>
          </div>
        </div>
        <div className="title-v2-compare-arrow">
          <ArrowLeftRight size={20} />
          <em className={clsx(diff > 0 ? "up" : diff < 0 ? "down" : "")} style={{ color: diffColor }}>
            {diff > 0 ? `+${diff}` : diff}
          </em>
          <span>分差</span>
        </div>
        <div className="title-v2-compare-col">
          <span className="title-v2-compare-tag highlight">推荐</span>
          <div className="title-v2-compare-score-wrap">
            <strong className="title-v2-compare-score highlight">{candidateScore}</strong>
            <em className="title-v2-compare-score-unit">/100</em>
          </div>
          <button className="title-v2-compare-title" onClick={() => onCopy(candidate.title, "推荐标题已复制。")} title="复制这个对比标题">
            {candidate.title}
          </button>
          <div className="title-v2-compare-meta">
            <span>整条 {candidate.totalBytes}/60</span>
            <span>命中 {candidate.keywordHits.length}</span>
          </div>
        </div>
      </div>

      <div className="title-v2-compare-keywords">
        <h4>关键词分布</h4>
        <div className="title-v2-keyword-cols">
          <div>
            <span className="label">仅原标题</span>
            <div className="chips">
              {onlyOriginal.length === 0 ? <em>无</em> : onlyOriginal.map((k) => <span key={k} className="chip orig">{k}</span>)}
            </div>
          </div>
          <div>
            <span className="label">两者共有</span>
            <div className="chips">
              {both.length === 0 ? <em>无</em> : both.map((k) => <span key={k} className="chip both">{k}</span>)}
            </div>
          </div>
          <div>
            <span className="label">仅推荐</span>
            <div className="chips">
              {onlyCandidate.length === 0 ? <em>无</em> : onlyCandidate.map((k) => <span key={k} className="chip cand">{k}</span>)}
            </div>
          </div>
        </div>
      </div>

      {(candidateBetter.length > 0 || originalBetter.length > 0) && (
        <div className="title-v2-compare-rules">
          <h4>规则差异</h4>
          {candidateBetter.length > 0 && (
            <div className="title-v2-rule-diff up">
              <strong>推荐通过、原标题未通过：</strong>
              {candidateBetter.map((r) => <span key={r.key}><Check size={12} /> {r.label}</span>)}
            </div>
          )}
          {originalBetter.length > 0 && (
            <div className="title-v2-rule-diff down">
              <strong>原标题通过、推荐反而未通过：</strong>
              {originalBetter.map((r) => <span key={r.key}><X size={12} /> {r.label}</span>)}
            </div>
          )}
        </div>
      )}

      <div className="title-v2-compare-summary">
        {diff > 0
          ? `换成推荐预计提升 ${diff} 分（百分制）${candidateBetter.length > 0 ? `，主要改进在 ${candidateBetter.map((r) => r.label).join("、")}` : ""}。`
          : diff < 0
            ? `推荐分数反而比原标题低 ${Math.abs(diff)} 分（百分制），谨慎替换。`
            : "两者分数持平，可根据风格偏好自行选择。"}
      </div>
    </section>
  );
}

function TitleAIDrawer({
  open,
  onClose,
  aiJson,
  setAiJson,
  aiPrompt,
  generating,
  loadingData,
  onGenerate,
  onCopyPrompt
}: {
  open: boolean;
  onClose: () => void;
  aiJson: string;
  setAiJson: (v: string) => void;
  aiPrompt: string;
  generating: boolean;
  loadingData: boolean;
  onGenerate: () => void;
  onCopyPrompt: () => void;
}) {
  if (!open) return null;
  return (
    <div className="title-v2-drawer-backdrop" onClick={onClose}>
      <aside className="title-v2-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="title-v2-drawer-head">
          <Wand2 size={18} />
          <h3>AI 生成候选</h3>
          <button className="title-v2-ghost" onClick={onClose} title="关闭弹窗"><X size={15} /></button>
        </div>
        <div className="title-v2-drawer-body">
          <div className="title-v2-drawer-step">
            <span className="title-v2-step">①</span>
            <strong>把这段提示词喂给浏览器里的 AI</strong>
            <button className="title-v2-ghost-line" onClick={onCopyPrompt} title="复制 AI 提示词">
              <Clipboard size={13} /> 复制提示词
            </button>
            <pre className="title-v2-prompt-box">{aiPrompt}</pre>
          </div>
          <div className="title-v2-drawer-step">
            <span className="title-v2-step">②</span>
            <strong>把 AI 返回的 JSON 贴在这里</strong>
            <textarea className="title-v2-json-box" value={aiJson} onChange={(e) => setAiJson(e.target.value)} />
          </div>
          <div className="title-v2-drawer-actions">
            <button className="title-v2-primary" onClick={onGenerate} disabled={generating || loadingData} title="根据 JSON 生成候选标题">
              {generating ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />} 生成 5 个候选
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function TitleAnalyzeAnimation({ label }: { label: string }) {
  const words = ["夏季", "薄款", "凉感", "棉麻", "亚麻", "男款", "直筒裤", "休闲裤", "卫裤", "五分裤"];
  return (
    <section className="title-flow-stage" aria-label="正在分析标题">
      <div className="title-flow-box">
        <FileJson size={24} />
        <span>{label}</span>
      </div>
      {words.map((word, index) => {
        const [x, y] = FLOW_WORD_POSITIONS[index % FLOW_WORD_POSITIONS.length];
        return <span key={word} className="title-flow-word" style={{ "--i": index, "--x": x, "--y": y } as CSSProperties}>{word}</span>;
      })}
    </section>
  );
}

function TitleLoadingNotice({ label }: { label: string }) {
  return (
    <section className="title-v2-loading-line" aria-label={label}>
      <Loader2 className="spin" size={18} />
      <strong>{label}</strong>
      <span>低配模式下已关闭词语飞行动画。</span>
    </section>
  );
}

function RecommendationCardV2({ item }: { item: TitleRecommendation }) {
  const typeLabels: Record<string, string> = {
    insert: "插入/替换",
    reorder: "词序调整",
    "missing-element": "缺少元素",
    "unhit-keyword": "未命中",
    "byte-tip": "字节利用",
    "blue-ocean": "蓝海词",
    "root-hint": "高频词根",
    duplicate: "重复词"
  };
  return (
    <div className={clsx("title-v2-reco", `reco-${item.type}`)}>
      <div className="title-v2-reco-head">
        <Lightbulb size={14} />
        <span>{typeLabels[item.type] ?? item.type}</span>
        {item.estimatedGain > 0 && <em>+{item.estimatedGain} 分</em>}
      </div>
      <strong>{item.message}</strong>
      {item.detail && <p>{item.detail}</p>}
    </div>
  );
}

function buildBrowserAiPrompt(productName: string) {
  return `请读取当前浏览器页面里的商品详情，只返回 JSON，不要解释。字段包括 productName、season、category、material、fit、features、mustInclude、avoidBrands。商品参考：${productName || "未填写"}。要求：不要输出第三方品牌；裤子类保留裤型和材质；短袖类优先判断半袖/短袖。`;
}

function gradeLabel(grade: TitleAnalysisResult["grade"]) {
  if (grade === "excellent") return "优秀";
  if (grade === "good") return "可用";
  if (grade === "needs-work") return "待优化";
  return "需修改";
}
