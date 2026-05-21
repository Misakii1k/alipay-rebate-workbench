import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, FolderOpen, Image as ImageIcon, Loader2, Search, Sparkles, WandSparkles } from "lucide-react";
import clsx from "clsx";
import type { AppSettings, ReviewGenerationOptions, ReviewSearchResult } from "./lib/shared";

export function ReviewAssistant({
  settings,
  onSaveSettings,
  showToast
}: {
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => Promise<void>;
  showToast: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ReviewSearchResult[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<ReviewSearchResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copies, setCopies] = useState<string[]>([]);
  const [vipConfirmed, setVipConfirmed] = useState(false);
  const [batchSeed, setBatchSeed] = useState(1);
  const [options, setOptions] = useState({
    emojiLevel: settings.reviewEmojiLevel,
    professionalLevel: settings.reviewProfessionalLevel,
    buyerLevel: settings.reviewBuyerLevel,
    exaggerationLevel: settings.reviewExaggerationLevel,
    sceneLevel: settings.reviewSceneLevel,
    mentionValue: settings.reviewMentionValue,
    productDescription: settings.reviewProductDescription
  });
  const searchTimerRef = useRef<number>(0);

  const visibleResults = useMemo(() => (expanded ? results : results.slice(0, 36)), [expanded, results]);
  const rootLabel = settings.reviewRootDir ? compactPath(settings.reviewRootDir) : "尚未选择图片根目录";

  useEffect(() => {
    if (!searched || !results.length) return;
    let canceled = false;
    const missingPaths = visibleResults
      .flatMap((item) => {
        if (item.kind === "image" && !item.thumbnailDataUrl) return [item.path];
        if (item.kind === "folder" && item.children) return item.children.filter((c) => !c.thumbnailDataUrl).map((c) => c.path);
        return [];
      })
      .slice(0, 40);
    if (!missingPaths.length) return;
    void window.alipayWorkbench.loadReviewThumbnails(missingPaths).then((thumbMap) => {
      if (canceled) return;
      setResults((prev) =>
        prev.map((item) => {
          if (item.kind === "image" && thumbMap[item.path]) return { ...item, thumbnailDataUrl: thumbMap[item.path] };
          if (item.kind === "folder" && item.children) {
            const updatedChildren = item.children.map((c) => (thumbMap[c.path] ? { ...c, thumbnailDataUrl: thumbMap[c.path] } : c));
            return { ...item, children: updatedChildren, thumbnailDataUrl: item.thumbnailDataUrl || updatedChildren[0]?.thumbnailDataUrl };
          }
          return item;
        })
      );
    });
    return () => { canceled = true; };
  }, [searched, visibleResults.length, expanded]);

  async function ensureRoot() {
    if (settings.reviewRootDir) return settings.reviewRootDir;
    const result = await window.alipayWorkbench.selectDirectory("首次使用收评助手：选择图片根目录");
    if (result.canceled || !result.paths[0]) return "";
    await onSaveSettings({ ...settings, reviewRootDir: result.paths[0] });
    return result.paths[0];
  }

  async function searchAssets() {
    if (!query.trim()) {
      showToast("请输入要检索的商品名、颜色或型号。");
      return;
    }
    const root = await ensureRoot();
    if (!root) return;
    setSearching(true);
    setSearched(true);
    try {
      const found = await window.alipayWorkbench.scanReviewAssets(root, query.trim());
      setResults(found);
      setSelected([]);
      setPreview(found[0] ?? null);
      showToast(found.length ? `检索到 ${found.length} 个相关图片。` : "没有找到相关图片。");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "检索失败");
    } finally {
      setSearching(false);
    }
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    window.clearTimeout(searchTimerRef.current);
  }

  function selectablePaths(item: ReviewSearchResult) {
    if (item.kind === "folder" && item.children?.length) return item.children.map((child) => child.path);
    return [item.path];
  }

  function toggle(item: ReviewSearchResult) {
    const paths = selectablePaths(item);
    setSelected((prev) => {
      const allSelected = paths.every((path) => prev.includes(path));
      return allSelected ? prev.filter((path) => !paths.includes(path)) : [...new Set([...prev, ...paths])];
    });
  }

  async function pickRoot() {
    const result = await window.alipayWorkbench.selectDirectory("选择收评助手图片根目录");
    if (result.canceled || !result.paths[0]) return;
    await onSaveSettings({ ...settings, reviewRootDir: result.paths[0] });
    showToast("收评助手根目录已更新。");
  }

  async function generate(nextBatch = false) {
    if (!selected.length) {
      showToast("请先选择至少一张参考图片。");
      return;
    }
    if (!vipConfirmed) {
      setVipConfirmed(true);
      showToast("高级版/VIP AI 功能将调用大模型 API，请确认 API 配置可用。");
      return;
    }
    const seed = nextBatch ? batchSeed + 1 : batchSeed;
    setBatchSeed(seed);
    setGenerating(true);
    try {
      const payload: ReviewGenerationOptions = {
        query,
        selectedPaths: selected,
        productDescription: options.productDescription,
        emojiLevel: options.emojiLevel,
        professionalLevel: options.professionalLevel,
        buyerLevel: options.buyerLevel,
        exaggerationLevel: options.exaggerationLevel,
        sceneLevel: options.sceneLevel,
        mentionValue: options.mentionValue,
        batchSeed: seed
      };
      const result = await window.alipayWorkbench.generateReviewCopy(settings, payload);
      setCopies(result.copies);
      await onSaveSettings({
        ...settings,
        reviewEmojiLevel: options.emojiLevel,
        reviewProfessionalLevel: options.professionalLevel,
        reviewBuyerLevel: options.buyerLevel,
        reviewExaggerationLevel: options.exaggerationLevel,
        reviewSceneLevel: options.sceneLevel,
        reviewMentionValue: options.mentionValue,
        reviewProductDescription: options.productDescription
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "AI 生成失败");
    } finally {
      setGenerating(false);
    }
  }

  function resetCycle() {
    setSelected([]);
    setCopies([]);
    setPreview(results[0] ?? null);
  }

  return (
    <section className={clsx("review-assistant", searched && "searched")}>
      <div className="review-search-shell">
        <div className="review-hero-title">
          <span><Sparkles size={22} /></span>
          <strong>收评助手</strong>
          <em>按商品名检索参考图，AI 生成更自然的买家好评文案</em>
        </div>

        <div className="review-search-card">
          <div className="review-card-meta">
            <span>素材检索</span>
            <strong>{selected.length} 已选</strong>
            <strong>{results.length} 结果</strong>
          </div>

          <div className="review-search-box">
            <Search size={20} />
            <input
              value={query}
              onChange={(event) => handleQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void searchAssets();
              }}
              placeholder="搜索商品、颜色或型号，例如：彩棉317"
            />
            <button onClick={searchAssets} disabled={searching}>{searching ? <Loader2 className="spin" size={18} /> : "搜索"}</button>
          </div>

          <button className="review-root-pill" onClick={pickRoot}>
            <FolderOpen size={16} />
            <span>图片根目录</span>
            <strong>{rootLabel}</strong>
            <em>更改</em>
          </button>
        </div>
      </div>

      {searched && (
        <div className="review-workspace">
          <div className="review-results">
            <div className="review-status">{searching ? "开始检索..." : `按匹配度展示 ${results.length} 个结果`}</div>
            <div className="review-file-grid">
              {visibleResults.map((item) => (
                <button
                  key={item.path}
                  className={clsx(selectablePaths(item).some((path) => selected.includes(path)) && "selected")}
                  draggable
                  onClick={() => {
                    toggle(item);
                    setPreview(item);
                  }}
                  onDragStart={(event) => {
                    const paths = selectablePaths(item);
                    event.dataTransfer.setData("text/uri-list", paths.join("\n"));
                    event.dataTransfer.setData("text/plain", paths.join("\n"));
                  }}
                >
                  <span className="review-thumb">{item.thumbnailDataUrl ? <img src={item.thumbnailDataUrl} /> : <ImageIcon size={26} />}</span>
                  <strong>{item.name}</strong>
                  <em>{item.score} · {item.reason}</em>
                </button>
              ))}
            </div>
            {results.length > 36 && <button className="secondary-action light full" onClick={() => setExpanded((value) => !value)}>{expanded ? "收起" : "展开更多"}</button>}
          </div>

          <aside className="review-preview">
            {preview?.thumbnailDataUrl ? <img src={preview.thumbnailDataUrl} /> : <div className="empty">选择图片后预览</div>}
            <div><strong>{preview?.name || "未选择"}</strong><span>{preview?.path || ""}</span></div>
          </aside>
        </div>
      )}

      {searched && (
        <div className="review-ai-panel">
          <div className="review-ai-title"><WandSparkles size={20} /> AI生成好评 <span>高级版 VIP</span></div>
          <div className="review-controls">
            <Slider label="Emoji程度" value={options.emojiLevel} onChange={(value) => setOptions((prev) => ({ ...prev, emojiLevel: value }))} />
            <Slider label="专业程度" value={options.professionalLevel} onChange={(value) => setOptions((prev) => ({ ...prev, professionalLevel: value }))} />
            <Slider label="买家视角" value={options.buyerLevel} onChange={(value) => setOptions((prev) => ({ ...prev, buyerLevel: value }))} />
            <Slider label="语气夸张" value={options.exaggerationLevel} onChange={(value) => setOptions((prev) => ({ ...prev, exaggerationLevel: value }))} />
            <Slider label="场景化表达" value={options.sceneLevel} onChange={(value) => setOptions((prev) => ({ ...prev, sceneLevel: value }))} />
            <label className="review-check"><input type="checkbox" checked={options.mentionValue} onChange={(event) => setOptions((prev) => ({ ...prev, mentionValue: event.target.checked }))} /> 加入性价比表达</label>
            <textarea value={options.productDescription} onChange={(event) => setOptions((prev) => ({ ...prev, productDescription: event.target.value }))} placeholder="补充商品描述，让好评更贴合" />
          </div>
          <div className="button-row review-buttons">
            <button className="primary" onClick={() => generate(false)} disabled={generating}>{generating ? <Loader2 className="spin" size={18} /> : <WandSparkles size={18} />} AI生成好评文案</button>
            <button className="secondary-action" onClick={() => generate(true)} disabled={generating || !copies.length}>换一批</button>
            <button className="secondary-action light" onClick={resetCycle}>完成并重置</button>
          </div>
          <div className="review-copy-list">
            {copies.map((copy, index) => (
              <button key={`${copy}-${index}`} onClick={() => { void window.alipayWorkbench.writeClipboardText(copy); showToast("文案已复制。"); }}>
                <Copy size={16} />
                <span>{copy}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function compactPath(value: string) {
  const parts = value.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return value;
  return `${parts[0]}\\...\\${parts.slice(-2).join("\\")}`;
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="review-slider">
      <span>{label}</span>
      <input type="range" min={0} max={5} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <em>{value}</em>
    </label>
  );
}
