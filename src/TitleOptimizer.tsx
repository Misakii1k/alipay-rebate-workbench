import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Bot, Check, Clipboard, FileJson, FileSpreadsheet, Loader2, RefreshCw, Search, Sparkles, Wand2, X } from "lucide-react";
import clsx from "clsx";
import type { AppSettings, TitleAnalysisResult, TitleCandidate, TitleKeywordData, TitleScoreResult } from "./lib/shared";

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
  ["8%", "14%"],
  ["22%", "78%"],
  ["34%", "20%"],
  ["48%", "82%"],
  ["62%", "18%"],
  ["76%", "74%"],
  ["88%", "34%"],
  ["14%", "50%"],
  ["72%", "46%"],
  ["42%", "58%"]
];

function waitForVisibleAnalysis(startedAt: number) {
  const remaining = ANALYSIS_VISIBLE_MS - (Date.now() - startedAt);
  return remaining > 0 ? new Promise((resolve) => window.setTimeout(resolve, remaining)) : Promise.resolve();
}

export function TitleOptimizer({
  settings,
  onSaveSettings,
  showToast
}: {
  settings: AppSettings;
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

  const categories = keywordData?.categories ?? [];
  const selectedCategory = useMemo(
    () => categories.find((item) => item.name === categoryName),
    [categories, categoryName]
  );
  const hasKeywordWarnings = (keywordData?.warnings.length ?? 0) > 0;

  useEffect(() => {
    void loadData();
  }, [settings.titleKeywordExcelPath]);

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
    setAnalyzing(true);
    setError("");
    setAnalysis(null);
    try {
      const next = await window.alipayWorkbench.analyzeTitle(settings, {
        productName,
        title: currentTitle,
        categoryName: categoryName || undefined
      });
      await waitForVisibleAnalysis(startedAt);
      setAnalysis(next);
      if (!next.ok || next.grade === "blocked") setError(next.message);
    } catch (caught) {
      await waitForVisibleAnalysis(startedAt);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setAnalyzing(false);
    }
  };

  const generateFromJson = async () => {
    const startedAt = Date.now();
    setGenerating(true);
    setError("");
    setGenerated(null);
    try {
      const parsed = JSON.parse(aiJson) as { productName?: string; category?: string };
      const nextProductName = String(parsed.productName || productName).trim();
      if (nextProductName) setProductName(nextProductName);
      const next = await window.alipayWorkbench.generateTitleCandidates(settings, {
        productName: nextProductName || productName,
        categoryName: categoryName || parsed.category || undefined,
        variantCount: 5
      });
      await waitForVisibleAnalysis(startedAt);
      setGenerated(next);
      if (!next.ok) setError(next.message);
    } catch (caught) {
      await waitForVisibleAnalysis(startedAt);
      setError(caught instanceof Error ? caught.message : "商品 JSON 格式不正确，请检查引号和逗号。");
    } finally {
      setGenerating(false);
    }
  };

  const copyText = async (text: string, message: string) => {
    await window.alipayWorkbench.writeClipboardText(text);
    showToast(message);
  };

  const aiPrompt = useMemo(() => buildBrowserAiPrompt(productName), [productName]);

  return (
    <section className="title-optimizer">
      <div className="title-grid">
        <section className="panel title-input-panel">
          <div className="panel-title"><Search size={19} /><h2>优化标题分析</h2></div>
          <div className="form-stack">
            <label>
              <span>商品名 / 系列 / 材质 / 季节</span>
              <input value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="例如：彩棉317夏季长裤" />
            </label>
            <label>
              <span>已有标题</span>
              <textarea className="title-textarea" value={currentTitle} onChange={(event) => setCurrentTitle(event.target.value)} placeholder="粘贴你自己写好的完整标题，建议包含帛先生前缀。" />
            </label>
            <label>
              <span>优先类目</span>
              <div className="title-category-picker">
                <button
                  type="button"
                  className={clsx("title-category-trigger", categoryPickerOpen && "open")}
                  onClick={() => setCategoryPickerOpen((open) => !open)}
                >
                  <span>{selectedCategory ? selectedCategory.name : "自动匹配"}</span>
                  <em>{selectedCategory ? `${selectedCategory.keywordCount}词` : "按商品名匹配"}</em>
                </button>
                {categoryPickerOpen && (
                  <div className="title-category-menu">
                    <button
                      type="button"
                      className={clsx(!categoryName && "active")}
                      onClick={() => {
                        setCategoryName("");
                        setCategoryPickerOpen(false);
                      }}
                    >
                      <strong>自动匹配</strong>
                      <span>按商品名匹配</span>
                    </button>
                    {categories.slice(0, 32).map((category) => (
                      <button
                        type="button"
                        key={category.name}
                        className={clsx(category.name === categoryName && "active")}
                        onClick={() => {
                          setCategoryName(category.name);
                          setCategoryPickerOpen(false);
                        }}
                      >
                        <strong>{category.name}</strong>
                        <span>{category.keywordCount}词</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </label>
            <div className="button-row">
              <button className="primary" onClick={analyze} disabled={analyzing || loadingData}>
                {analyzing ? <Loader2 className="spin" size={18} /> : <Search size={18} />} 分析标题并评分
              </button>
              <button className="secondary-action light" onClick={() => void loadData()} disabled={loadingData}>
                {loadingData ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />} 重新读取 Excel
              </button>
              <button className="secondary-action light" onClick={() => void pickExcel()}>
                <FileSpreadsheet size={17} /> 选择 Excel
              </button>
            </div>
          </div>
          {(error || hasKeywordWarnings) && (
            <div className={clsx("title-message", error && "danger")}>
              <strong>{error || "数据提醒"}</strong>
              {(keywordData?.warnings ?? []).slice(0, 4).map((warning) => <span key={warning}>{warning}</span>)}
            </div>
          )}
        </section>

        <section className="panel title-ai-panel">
          <div className="panel-title"><Bot size={19} /><h2>浏览器 AI 辅助</h2></div>
          <div className="title-path-card">
            <FileSpreadsheet size={18} />
            <div>
              <strong>{keywordData ? `${keywordData.totalKeywords} 个关键词已加载` : "关键词数据未加载"}</strong>
              <span>{settings.titleKeywordExcelPath}</span>
            </div>
          </div>
          <div className="title-data-stats">
            <span><strong>{categories.length}</strong>类目</span>
            {selectedCategory
              ? <span><strong>{selectedCategory.keywordCount}</strong>当前类目</span>
              : <span><strong>自动</strong>类目匹配</span>}
          </div>
          <label>
            <span>给浏览器 AI 的提示词</span>
            <textarea className="small-textarea title-prompt-box" value={aiPrompt} readOnly />
          </label>
          <div className="button-row">
            <button className="secondary-action light" onClick={() => void copyText(aiPrompt, "AI 提示词已复制。")}>
              <Clipboard size={16} /> 复制提示词
            </button>
          </div>
        </section>
      </div>

      {(analyzing || generating) && <TitleAnalyzeAnimation label={analyzing ? "正在分析标题" : "正在生成候选"} />}

      {analysis && (
        <section className="panel title-results">
          <div className="title-result-head">
            <div>
              <p className="eyebrow">标题评分 / 规则检查 / 关键词命中</p>
              <h2>标题分析结果</h2>
            </div>
            <span className={clsx("title-result-state", analysis.grade === "blocked" ? "danger" : "ok")}>{gradeLabel(analysis.grade)} · {analysis.score} 分</span>
          </div>
          {analysis.diagnostics && (
            <div className="title-diagnostics">
              <span>原始词池 <strong>{analysis.diagnostics.poolSize}</strong></span>
              <span>召回词池 <strong>{analysis.diagnostics.recalledSize}</strong></span>
              <span>耗时 <strong>{analysis.diagnostics.elapsedMs}ms</strong></span>
            </div>
          )}
          <div className="title-analysis-strip">
            <div className="title-score-card">
              <span>综合评分</span>
              <strong>{analysis.score}</strong>
              <em>{analysis.message}</em>
            </div>
            <div className="title-check-panel">
              <TitleMetric label="主体" value={`${analysis.bodyBytes}/54`} ok={analysis.bodyBytes === 54} />
              <TitleMetric label="整条" value={`${analysis.totalBytes}/60`} ok={analysis.totalBytes === 60} />
              <TitleMetric label="命中" value={`${analysis.candidate?.keywordHits.length ?? 0}`} ok={(analysis.candidate?.keywordHits.length ?? 0) > 0} />
            </div>
          </div>
          {analysis.candidate && <TitleCandidateCard candidate={analysis.candidate} onCopy={() => void copyText(analysis.title, "标题已复制。")} compact />}
          <div className="title-recommendations">
            {analysis.recommendations.map((item) => <span key={item}>{item}</span>)}
          </div>
        </section>
      )}

      <section className="panel title-generator-panel">
        <div className="panel-title"><Wand2 size={19} /><h2>生成标题辅助区</h2></div>
        <div className="title-generator-layout">
          <label>
            <span>浏览器 AI 返回的商品 JSON</span>
            <textarea className="title-json-box" value={aiJson} onChange={(event) => setAiJson(event.target.value)} />
          </label>
          <div className="title-generator-side">
            <button className="primary" onClick={generateFromJson} disabled={generating || loadingData}>
              {generating ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />} 根据 JSON 生成候选
            </button>
            {generated && (
              <div className="title-candidate-grid title-generated-inline">
                {generated.candidates.map((candidate) => (
                  <TitleCandidateCard key={candidate.id} candidate={candidate} onCopy={() => void copyText(candidate.title, "标题已复制。")} />
                ))}
              </div>
            )}
            <div className="title-message">
              <strong>生成逻辑</strong>
              <span>先让浏览器 AI 读取商品详情并整理成 JSON，再交给本地算法生成严格 54/60 字节标题。</span>
              <span>主流程仍然是分析你写好的标题，生成只作为辅助参考。</span>
            </div>
          </div>
        </div>
      </section>
    </section>
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

function TitleMetric({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className={clsx("title-metric-line", ok ? "ok" : "warn")}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TitleCandidateCard({ candidate, onCopy, compact = false }: { candidate: TitleCandidate; onCopy: () => void; compact?: boolean }) {
  const failedRules = candidate.ruleChecks.filter((rule) => rule.required && !rule.passed);
  return (
    <article className={clsx("title-candidate-card", compact && "compact")}>
      <div className="title-candidate-top">
        <span className="title-mode">{candidate.label}</span>
        {candidate.score > 0 && <strong className="title-score-mini">评分 {candidate.score}</strong>}
      </div>
      <button className="title-copy-line" onClick={onCopy}>
        <Clipboard size={16} />
        <span>{candidate.title}</span>
      </button>
      <div className="title-rule-list">
        {candidate.ruleChecks.slice(0, compact ? 10 : 8).map((rule) => (
          <span key={rule.key} className={clsx(rule.passed ? "ok" : rule.required ? "danger" : "warn")}>
            {rule.passed ? <Check size={13} /> : <X size={13} />} {rule.label}
          </span>
        ))}
      </div>
      <div className="title-hit-list">
        {candidate.keywordHits.slice(0, compact ? 14 : 10).map((hit) => (
          <span key={`${hit.source}-${hit.keyword}`}>{hit.keyword}</span>
        ))}
      </div>
      {!compact && (
        <div className="title-token-row">
          {candidate.tokens.slice(0, 14).map((token) => <span key={token}>{token}</span>)}
        </div>
      )}
      {failedRules.length > 0 && <div className="title-message danger"><strong>仍有硬规则未通过，不建议使用。</strong></div>}
    </article>
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
