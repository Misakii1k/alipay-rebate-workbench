import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp, Check, ChevronDown, Copy, Edit3, FolderOpen, Hammer, Image as ImageIcon,
  Keyboard, Loader2, RefreshCw, RotateCcw, Search, Sparkles, Star, StarOff, Trash2, WandSparkles, X
} from "lucide-react";
import clsx from "clsx";
import type { AppSettings, ReviewGenerationOptions, ReviewSearchResult, ReviewThinkingEffort, ReviewThinkingMode, ReviewWorkspaceMode } from "./lib/shared";
import { getReviewApiProfile } from "./lib/shared";

const REVIEW_INITIAL_VISIBLE = 36;
const REVIEW_LOAD_STEP = 24;
const REVIEW_THUMBNAIL_BATCH = 18;
const RECENT_QUERIES_KEY = "review-recent-queries";
const MAX_RECENT_QUERIES = 8;
type ReviewSortMode = "relevance" | "name-asc" | "name-desc" | "time-desc" | "time-asc";
type ReviewFilterMode = "all" | "image" | "folder" | "selected";

interface ReviewSessionState {
  query: string;
  searched: boolean;
  results: ReviewSearchResult[];
  visibleCount: number;
  selected: string[];
  preview: ReviewSearchResult | null;
  copies: string[];
  batchSeed: number;
}

let reviewSessionState: ReviewSessionState | null = null;

interface ScanProgress {
  scanned: number;
  currentDir: string;
  phase: string;
  elapsedMs?: number;
}

export function ReviewAssistant({
  settings,
  onSaveSettings,
  showToast,
  modelConnected = false
}: {
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => Promise<void>;
  showToast: (message: string) => void;
  modelConnected?: boolean;
}) {
  const [query, setQuery] = useState(() => reviewSessionState?.query ?? "");
  const [searched, setSearched] = useState(() => reviewSessionState?.searched ?? false);
  const [searching, setSearching] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [results, setResults] = useState<ReviewSearchResult[]>(() => reviewSessionState?.results ?? []);
  const [visibleCount, setVisibleCount] = useState(() => reviewSessionState?.visibleCount ?? REVIEW_INITIAL_VISIBLE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<string[]>(() => reviewSessionState?.selected ?? []);
  const [preview, setPreview] = useState<ReviewSearchResult | null>(() => reviewSessionState?.preview ?? null);
  const [generating, setGenerating] = useState(false);
  const [copies, setCopies] = useState<string[]>(() => reviewSessionState?.copies ?? []);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [apiConfirmed, setVipConfirmed] = useState(false);
  const [batchSeed, setBatchSeed] = useState(() => reviewSessionState?.batchSeed ?? 1);
  const [customPrompt, setCustomPrompt] = useState(settings.reviewCustomPrompt ?? "");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showModeSelect, setShowModeSelect] = useState(() => reviewSessionState ? false : true);
  const [mode, setModeState] = useState<ReviewWorkspaceMode>(settings.reviewWorkspaceMode);
  const [availableModels, setAvailableModels] = useState<{ id: string; name: string }[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState(() => {
    const profile = getReviewApiProfile(settings);
    return profile.textModel;
  });
  const [sortMode, setSortMode] = useState<ReviewSortMode>(() => settings.reviewScoringEnabled ? "relevance" : "time-desc");
  const [filterMode, setFilterMode] = useState<ReviewFilterMode>("all");
  const [isPointerSelecting, setIsPointerSelecting] = useState(false);
  const pointerSelectModeRef = useRef<"select" | "deselect">("select");
  const [showBackTop, setShowBackTop] = useState(false);
  const [recentQueries, setRecentQueries] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(RECENT_QUERIES_KEY);
      return raw ? (JSON.parse(raw) as string[]).slice(0, MAX_RECENT_QUERIES) : [];
    } catch { return []; }
  });
  const favoriteQueries = useMemo(() => settings.reviewFavoriteQueries ?? [], [settings.reviewFavoriteQueries]);
  const [options, setOptions] = useState({
    emojiLevel: settings.reviewEmojiLevel,
    professionalLevel: settings.reviewProfessionalLevel,
    buyerLevel: settings.reviewBuyerLevel,
    exaggerationLevel: settings.reviewExaggerationLevel,
    sceneLevel: settings.reviewSceneLevel,
    mentionValue: settings.reviewMentionValue,
    productDescription: settings.reviewProductDescription,
    targetLength: settings.reviewTargetLength,
    thinkingMode: settings.reviewThinkingMode,
    thinkingEffort: settings.reviewThinkingEffort
  });
  const loadMoreTimerRef = useRef<number>(0);
  const copyListRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const sortedResults = useMemo(() => {
    const collator = new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "base" });
    const next = [...results];
    if (sortMode === "relevance") next.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    if (sortMode === "name-asc") next.sort((a, b) => collator.compare(a.name, b.name));
    if (sortMode === "name-desc") next.sort((a, b) => collator.compare(b.name, a.name));
    if (sortMode === "time-desc") next.sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0));
    if (sortMode === "time-asc") next.sort((a, b) => (a.mtimeMs ?? 0) - (b.mtimeMs ?? 0));
    return next;
  }, [results, sortMode]);
  const selectablePaths = useCallback((item: ReviewSearchResult) => {
    return [item.path];
  }, []);
  const folderChildPaths = useCallback((item: ReviewSearchResult) => item.kind === "folder" && item.children?.length ? item.children.map((child) => child.path) : [], []);
  const filteredResults = useMemo(() => {
    if (filterMode === "all") return sortedResults;
    if (filterMode === "image") return sortedResults.filter((item) => item.kind === "image");
    if (filterMode === "folder") return sortedResults.filter((item) => item.kind === "folder");
    return sortedResults.filter((item) => {
      const paths = item.kind === "folder" ? [item.path, ...folderChildPaths(item)] : [item.path];
      return paths.some((path) => selectedSet.has(path));
    });
  }, [filterMode, folderChildPaths, selectedSet, sortedResults]);
  const visibleResults = useMemo(() => filteredResults.slice(0, visibleCount), [filteredResults, visibleCount]);
  const visiblePathGroups = useMemo(() => {
    return new Map(visibleResults.map((item) => [item.path, selectablePaths(item)]));
  }, [selectablePaths, visibleResults]);
  const visibleSelectedKeys = useMemo(() => {
    const keys = new Set<string>();
    visiblePathGroups.forEach((paths, key) => {
      if (paths.some((path) => selectedSet.has(path))) keys.add(key);
    });
    return keys;
  }, [selectedSet, visiblePathGroups]);
  const selectedCardCount = visibleSelectedKeys.size;
  const thumbnailLoadKey = useMemo(() => {
    return visibleResults
      .flatMap((item) => {
        if (item.kind === "image" && !item.thumbnailDataUrl) return [item.path];
        if (item.kind === "folder" && item.children) return item.children.filter((c) => !c.thumbnailDataUrl).map((c) => c.path);
        return [];
      })
      .slice(0, REVIEW_THUMBNAIL_BATCH)
      .join("|");
  }, [visibleResults]);
  const rootLabel = settings.reviewRootDir ? compactPath(settings.reviewRootDir) : "尚未选择图片根目录";
  const savedCopies = useMemo(() => settings.reviewSavedCopies ?? [], [settings.reviewSavedCopies]);

  useEffect(() => {
    return () => {
      window.clearTimeout(loadMoreTimerRef.current);
    };
  }, []);

  useEffect(() => {
    reviewSessionState = { query, searched, results, visibleCount, selected, preview, copies, batchSeed };
  }, [batchSeed, copies, preview, query, results, searched, selected, visibleCount]);

  useEffect(() => {
    const onScroll = () => setShowBackTop(window.scrollY > 420);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onPointerUp = () => setIsPointerSelecting(false);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesHotkey(event, settings.reviewGenerateHotkey || "Ctrl+Enter")) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("textarea, input, select") && event.key !== "Enter") return;
      event.preventDefault();
      void generate();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    const off = window.alipayWorkbench.onReviewScanProgress?.((progress) => {
      setScanProgress(progress);
    });
    return () => off?.();
  }, []);

  useEffect(() => {
    if (!searched || !results.length) return;
    let canceled = false;
    const missingPaths = thumbnailLoadKey.split("|").filter(Boolean);
    if (!missingPaths.length) return;
    const loader = window.alipayWorkbench.loadReviewThumbnailBatch || window.alipayWorkbench.loadReviewThumbnails;
    void loader(missingPaths).then((thumbMap: Record<string, string>) => {
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
  }, [searched, thumbnailLoadKey, results.length]);

  function recordRecentQuery(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setRecentQueries((prev) => {
      const next = [trimmed, ...prev.filter((item) => item !== trimmed)].slice(0, MAX_RECENT_QUERIES);
      try { localStorage.setItem(RECENT_QUERIES_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  async function loadModels() {
    setLoadingModels(true);
    try {
      const models = await window.alipayWorkbench.listAvailableModels(settings);
      setAvailableModels(models);
      if (models.length) showToast(`已获取 ${models.length} 个可用模型。`);
      else showToast("未获取到模型列表，请检查 API 配置。");
    } catch {
      showToast("获取模型列表失败，请检查 API 配置。");
    } finally {
      setLoadingModels(false);
    }
  }

  async function handleModelChange(modelId: string) {
    setSelectedModelId(modelId);
    const profile = getReviewApiProfile(settings);
    const profiles = settings.apiProfiles.map((p) =>
      p.id === profile.id ? { ...p, textModel: modelId, visionModel: modelId } : p
    );
    await onSaveSettings({ ...settings, apiProfiles: profiles });
  }

  async function handleCustomPromptSave() {
    await onSaveSettings({ ...settings, reviewCustomPrompt: customPrompt });
    showToast("自定义提示词已保存。");
  }

  async function setMode(nextMode: ReviewWorkspaceMode) {
    setModeState(nextMode);
    await onSaveSettings({ ...settings, reviewWorkspaceMode: nextMode });
  }

  async function toggleScoring(enabled: boolean) {
    await onSaveSettings({ ...settings, reviewScoringEnabled: enabled });
    showToast(enabled ? "已开启相关性评分。" : "已关闭相关性评分，搜索会更轻量。");
  }

  function clearContext() {
    setSelected([]);
    setCopies([]);
    setBatchSeed(1);
    setVipConfirmed(false);
    setPreview(results[0] ?? null);
    showToast("上下文已清空，可以开始新一轮生成。");
  }

  async function ensureRoot() {
    if (settings.reviewRootDir) return settings.reviewRootDir;
    const result = await window.alipayWorkbench.selectDirectory("首次使用收评助手：选择图片根目录");
    if (result.canceled || !result.paths[0]) return "";
    await onSaveSettings({ ...settings, reviewRootDir: result.paths[0] });
    return result.paths[0];
  }

  async function searchAssets(overrideQuery?: string) {
    const q = (overrideQuery ?? query).trim();
    if (!q) {
      showToast("请输入要检索的商品名、颜色或型号。");
      return;
    }
    if (overrideQuery !== undefined) setQuery(overrideQuery);
    const root = await ensureRoot();
    if (!root) return;
    window.clearTimeout(loadMoreTimerRef.current);
    setSearching(true);
    setSearched(true);
    setScanProgress({ scanned: 0, currentDir: "", phase: "start" });
    try {
      const found = await window.alipayWorkbench.scanReviewAssets(root, q, settings);
      setResults(found);
      setSelected([]);
      setVisibleCount(REVIEW_INITIAL_VISIBLE);
      setSortMode(settings.reviewScoringEnabled ? "relevance" : "time-desc");
      setFilterMode("all");
      setLoadingMore(false);
      setPreview(found[0] ?? null);
      recordRecentQuery(q);
      showToast(found.length ? `检索到 ${found.length} 个相关图片。` : "没有找到相关图片。");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "检索失败");
    } finally {
      setSearching(false);
      window.setTimeout(() => setScanProgress(null), 1200);
    }
  }

  async function rebuildIndex() {
    const root = settings.reviewRootDir;
    if (!root) {
      showToast("请先选择图片根目录。");
      return;
    }
    setSearching(true);
    setScanProgress({ scanned: 0, currentDir: "", phase: "start" });
    try {
      const result = await window.alipayWorkbench.rebuildReviewIndex(root);
      if (result.ok) showToast(`索引重建完成，共 ${result.total} 张图片。`);
      else showToast("索引重建失败，请检查目录权限。");
    } finally {
      setSearching(false);
      window.setTimeout(() => setScanProgress(null), 1200);
    }
  }

  function toggle(item: ReviewSearchResult) {
    const paths = visiblePathGroups.get(item.path) ?? selectablePaths(item);
    setSelected((prev) => {
      const prevSet = new Set(prev);
      const allSelected = paths.every((path) => prevSet.has(path));
      return allSelected ? prev.filter((path) => !paths.includes(path)) : [...new Set([...prev, ...paths])];
    });
  }

  function applyPointerSelection(item: ReviewSearchResult, mode = pointerSelectModeRef.current) {
    const paths = selectablePaths(item);
    setSelected((prev) => {
      const prevSet = new Set(prev);
      if (mode === "select") paths.forEach((path) => prevSet.add(path));
      else paths.forEach((path) => prevSet.delete(path));
      return [...prevSet];
    });
    setPreview(item);
  }

  function beginPointerSelection(item: ReviewSearchResult) {
    const paths = selectablePaths(item);
    const allSelected = paths.every((path) => selectedSet.has(path));
    pointerSelectModeRef.current = allSelected ? "deselect" : "select";
    setIsPointerSelecting(true);
    applyPointerSelection(item, allSelected ? "deselect" : "select");
  }

  function selectFolderChildren(item: ReviewSearchResult) {
    const paths = folderChildPaths(item);
    if (!paths.length) return;
    setSelected((prev) => [...new Set([...prev, ...paths])]);
    setPreview(item);
    showToast(`已选中文件夹内 ${paths.length} 张图片。`);
  }

  function selectAllVisible() {
    const all = visibleResults.flatMap(selectablePaths);
    setSelected([...new Set(all)]);
  }

  function dragPathsFor(item: ReviewSearchResult) {
    const paths = visiblePathGroups.get(item.path) ?? selectablePaths(item);
    return paths.some((path) => selectedSet.has(path)) && selected.length ? selected : paths;
  }

  function loadMoreResults() {
    if (loadingMore || visibleCount >= results.length) return;
    setLoadingMore(true);
    window.clearTimeout(loadMoreTimerRef.current);
    loadMoreTimerRef.current = window.setTimeout(() => {
      setVisibleCount((count) => Math.min(count + REVIEW_LOAD_STEP, results.length));
      setLoadingMore(false);
    }, 90);
  }

  async function pickRoot() {
    const result = await window.alipayWorkbench.selectDirectory("选择收评助手图片根目录");
    if (result.canceled || !result.paths[0]) return;
    await onSaveSettings({ ...settings, reviewRootDir: result.paths[0] });
    showToast("收评助手根目录已更新。");
  }

  async function generate(nextBatch = false) {
    if (!selected.length && mode !== "ai") {
      showToast("请先选择至少一张参考图片。");
      return;
    }
    if (!apiConfirmed && !modelConnected) {
      setVipConfirmed(true);
      showToast("AI 生成功能将调用大模型 API，请确认 API 配置可用。");
      return;
    }
    const seed = nextBatch ? batchSeed + 1 : batchSeed;
    setBatchSeed(seed);
    setGenerating(true);
    requestAnimationFrame(() => copyListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    try {
      const payload: ReviewGenerationOptions = {
        query,
        selectedPaths: selected,
        productDescription: options.productDescription,
        targetLength: options.targetLength,
        thinkingMode: options.thinkingMode,
        thinkingEffort: options.thinkingEffort,
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
      requestAnimationFrame(() => copyListRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
      await onSaveSettings({
        ...settings,
        reviewEmojiLevel: options.emojiLevel,
        reviewProfessionalLevel: options.professionalLevel,
        reviewBuyerLevel: options.buyerLevel,
        reviewExaggerationLevel: options.exaggerationLevel,
        reviewSceneLevel: options.sceneLevel,
        reviewMentionValue: options.mentionValue,
        reviewProductDescription: options.productDescription,
        reviewTargetLength: options.targetLength,
        reviewThinkingMode: options.thinkingMode,
        reviewThinkingEffort: options.thinkingEffort
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "AI 生成失败");
    } finally {
      setGenerating(false);
    }
  }

  async function copyToClipboard(text: string) {
    await window.alipayWorkbench.writeClipboardText(text);
    showToast("文案已复制。");
  }

  async function copyAll() {
    if (!copies.length) return;
    const all = copies.map((c, i) => `${i + 1}. ${c}`).join("\n");
    await window.alipayWorkbench.writeClipboardText(all);
    showToast(`已复制全部 ${copies.length} 条文案。`);
  }

  function startEditCopy(index: number) {
    setEditingIndex(index);
    setEditingText(copies[index] || "");
  }

  function saveEditCopy() {
    if (editingIndex === null) return;
    setCopies((prev) => prev.map((c, i) => (i === editingIndex ? editingText : c)));
    setEditingIndex(null);
    setEditingText("");
    showToast("文案已修改。");
  }

  async function toggleStarCopy(text: string) {
    const list = settings.reviewSavedCopies ?? [];
    const isStarred = list.includes(text);
    const next = isStarred ? list.filter((c) => c !== text) : [text, ...list].slice(0, 200);
    await onSaveSettings({ ...settings, reviewSavedCopies: next });
    showToast(isStarred ? "已取消收藏。" : "已收藏到我的文案。");
  }

  async function removeSavedCopy(text: string) {
    const next = (settings.reviewSavedCopies ?? []).filter((c) => c !== text);
    await onSaveSettings({ ...settings, reviewSavedCopies: next });
  }

  async function toggleFavoriteQuery(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    const isFavorite = favoriteQueries.includes(trimmed);
    const next = isFavorite ? favoriteQueries.filter((item) => item !== trimmed) : [trimmed, ...favoriteQueries.filter((item) => item !== trimmed)].slice(0, 100);
    await onSaveSettings({ ...settings, reviewFavoriteQueries: next });
    showToast(isFavorite ? "已取消搜索收藏。" : "已加入搜索收藏。");
  }

  async function saveHotkey(value: string) {
    const normalized = normalizeHotkey(value);
    if (!normalized) {
      showToast("快捷键格式无效，例如 Ctrl+Enter 或 Alt+G。");
      return;
    }
    await onSaveSettings({ ...settings, reviewGenerateHotkey: normalized });
  }

  return (
    <section className={clsx("review-assistant review-v2", searched && "searched")}>
      <div ref={topRef} className="review-v2-top-anchor" />
      {showModeSelect ? (
        <ModeSelectPage mode={mode} onSelect={(nextMode) => { setModeState(nextMode); setShowModeSelect(false); onSaveSettings({ ...settings, reviewWorkspaceMode: nextMode }); }} />
      ) : (
        <>
          <ReviewModeTabs
            mode={mode}
            onModeChange={(nextMode) => void setMode(nextMode)}
            scoringEnabled={settings.reviewScoringEnabled}
            onToggleScoring={(enabled) => void toggleScoring(enabled)}
          />
          <ReviewHero
            mode={mode}
            query={query}
            setQuery={setQuery}
            onSearch={() => void searchAssets()}
            searching={searching}
            recentQueries={recentQueries}
            favoriteQueries={favoriteQueries}
            onPickRecent={(q) => void searchAssets(q)}
            onToggleFavorite={(q) => void toggleFavoriteQuery(q)}
            onPickRoot={pickRoot}
            rootLabel={rootLabel}
            onRebuildIndex={() => void rebuildIndex()}
            inputRef={inputRef}
          />

      {(searching || scanProgress) && (
        <ReviewScanProgressBar progress={scanProgress} searching={searching} />
      )}

      {(mode === "search" || mode === "mixed") && searched && (
        <div className="review-v2-workspace">
          <div className="review-v2-results-col">
            <ReviewToolbar
              selectedImages={selected.length}
              selectedCards={selectedCardCount}
              totalResults={results.length}
              visibleCount={Math.min(visibleCount, results.length)}
              onSelectAll={selectAllVisible}
              onClear={() => setSelected([])}
              searching={searching}
              sortMode={sortMode}
              onSortChange={setSortMode}
              filterMode={filterMode}
              onFilterChange={setFilterMode}
              scoringEnabled={settings.reviewScoringEnabled}
            />

            {results.length === 0 && !searching && <ReviewEmptyState query={query} />}

            <ReviewResultGrid
              items={visibleResults}
              scoringEnabled={settings.reviewScoringEnabled}
              selectedKeys={visibleSelectedKeys}
              onToggle={(item) => { toggle(item); setPreview(item); }}
              onPointerSelect={beginPointerSelection}
              onPointerEnterSelect={(item) => { if (isPointerSelecting) applyPointerSelection(item); }}
              onSelectFolderChildren={selectFolderChildren}
              onPreview={setPreview}
              dragPathsFor={dragPathsFor}
            />

            {filteredResults.length > visibleCount && (
              <button className="review-v2-load-more" onClick={loadMoreResults} disabled={loadingMore}>
                {loadingMore ? <Loader2 className="spin" size={16} /> : null}
                加载更多（剩余 {filteredResults.length - visibleCount} 个）
              </button>
            )}
          </div>

          <ReviewPreviewPanel preview={preview} selectedImages={selected.length} selectedCards={selectedCardCount} scoringEnabled={settings.reviewScoringEnabled} />
        </div>
      )}

      {(mode === "ai" || mode === "mixed") && (
        <ReviewAIPanel
          query={query}
          setQuery={setQuery}
          options={options}
          setOptions={setOptions}
          customPrompt={customPrompt}
          setCustomPrompt={setCustomPrompt}
          onSaveCustomPrompt={() => void handleCustomPromptSave()}
          advancedOpen={advancedOpen}
          setAdvancedOpen={setAdvancedOpen}
          availableModels={availableModels}
          selectedModelId={selectedModelId}
          onModelChange={(id) => void handleModelChange(id)}
          loadingModels={loadingModels}
          onLoadModels={() => void loadModels()}
          onGenerate={() => generate(false)}
          onNextBatch={() => generate(true)}
          generating={generating}
          hasCopies={copies.length > 0}
          canGenerate={selected.length > 0 || mode === "ai"}
          onClearContext={clearContext}
          hotkey={settings.reviewGenerateHotkey || "Ctrl+Enter"}
          onSaveHotkey={(value) => void saveHotkey(value)}
        />
      )}

      {(mode === "ai" || mode === "mixed") && copies.length > 0 && (
        <ReviewCopyResultList
          copies={copies}
          savedCopies={savedCopies}
          editingIndex={editingIndex}
          editingText={editingText}
          onSetEditingText={setEditingText}
          onStartEdit={startEditCopy}
          onSaveEdit={saveEditCopy}
          onCancelEdit={() => { setEditingIndex(null); setEditingText(""); }}
          onCopy={(text) => void copyToClipboard(text)}
          onCopyAll={() => void copyAll()}
          onToggleStar={(text) => void toggleStarCopy(text)}
          copyListRef={copyListRef}
        />
      )}

      {(mode === "ai" || mode === "mixed") && savedCopies.length > 0 && (
        <ReviewSavedCopies
          savedCopies={savedCopies}
          open={historyOpen}
          onToggle={() => setHistoryOpen((v) => !v)}
          onCopy={(text) => void copyToClipboard(text)}
          onRemove={(text) => void removeSavedCopy(text)}
        />
      )}
      {showBackTop && (
        <button className="review-v2-back-top" onClick={() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} title="回到顶部" aria-label="回到顶部">
          <ArrowUp size={16} />
        </button>
      )}
        </>
      )}
    </section>
  );
}

function ReviewModeTabs({ mode, onModeChange, scoringEnabled, onToggleScoring }: { mode: ReviewWorkspaceMode; onModeChange: (mode: ReviewWorkspaceMode) => void; scoringEnabled: boolean; onToggleScoring: (enabled: boolean) => void }) {
  const modeOptions: Array<{ key: ReviewWorkspaceMode; label: string; icon: typeof Search }> = [
    { key: "search", label: "搜索模式", icon: Search },
    { key: "ai", label: "AI评价", icon: WandSparkles },
    { key: "mixed", label: "混合模式", icon: Sparkles }
  ];
  return (
    <div className="review-v2-mode-bar">
      <div className="review-v2-mode-switch" role="tablist" aria-label="收评助手模式">
        {modeOptions.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.key} type="button" role="tab" aria-selected={mode === item.key} className={clsx(mode === item.key && "active")} onClick={() => onModeChange(item.key)}>
              <Icon size={14} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
      {mode !== "ai" && (
        <div className="review-v2-score-toggle">
          <button type="button" className={clsx("review-v2-score-switch", scoringEnabled && "on")} role="switch" aria-checked={scoringEnabled} onClick={() => onToggleScoring(!scoringEnabled)} title={scoringEnabled ? "相关性评分已开启" : "相关性评分已关闭"}>
            <i className="review-v2-score-switch-thumb" />
          </button>
          <div className="review-v2-score-labels">
            <span>相关性评分</span>
            <em>{scoringEnabled ? "优先高相关" : "关闭省性能"}</em>
          </div>
        </div>
      )}
    </div>
  );
}

function ModeSelectPage({ mode, onSelect }: { mode: ReviewWorkspaceMode; onSelect: (m: ReviewWorkspaceMode) => void }) {
  const [open, setOpen] = useState(false);
  const modeConfig = {
    search: { icon: Search, label: "搜索模式", desc: "搜索商品参考图", color: "var(--green)", points: ["按关键词检索图片", "预览和选择参考图", "分类浏览文件夹", "拖拽导出到其他应用"] },
    ai: { icon: WandSparkles, label: "AI评价模式", desc: "AI 生成好评文案", color: "var(--blue)", points: ["输入商品名称和描述", "调整 Emoji / 买家味等风格", "批量生成并收藏文案", "字数控制与思考模式"] },
    mixed: { icon: Sparkles, label: "混合模式", desc: "搜索 + AI 生成完整流程", color: "var(--gold)", points: ["搜索图片 + AI 生成", "智能评分优先匹配好图", "一键连招：选图→生成", "收藏和管理全部文案"] }
  };
  const current = modeConfig[mode];

  return (
    <div className="review-mode-select-page">
      <div className="review-mode-select-hero">
        <Sparkles size={26} />
        <h2>收评助手</h2>
        <p>选择一种工作模式开始评价运营，也可稍后在顶部切换</p>
      </div>
      <div className="review-mode-select-cards">
        {(Object.entries(modeConfig) as Array<[ReviewWorkspaceMode, typeof modeConfig.search]>).map(([key, config]) => (
          <button key={key} className={clsx("review-mode-select-card", mode === key && "active")} onClick={() => onSelect(key)}>
            <div className="review-mode-card-illustration">
              <config.icon size={48} />
            </div>
            <h3>{config.label}</h3>
            <p className="review-mode-card-desc">{config.desc}</p>
            <ul className="review-mode-card-points">
              {config.points.map((point) => <li key={point}>{point}</li>)}
            </ul>
            {mode === key && <span className="review-mode-card-current"><Check size={14} /> 当前模式</span>}
          </button>
        ))}
      </div>
      <div className="review-mode-select-footer">
        <span>默认模式：</span>
        <div className="review-mode-select-footer-dropdown" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }} tabIndex={-1}>
          <button onClick={() => setOpen(!open)}>
            <current.icon size={16} />
            <span>{current.label}</span>
            <ChevronDown size={14} className={clsx("review-mode-chev", open && "open")} />
          </button>
          {open && (
            <div className="review-mode-select-footer-menu">
              {(Object.entries(modeConfig) as Array<[ReviewWorkspaceMode, typeof modeConfig.search]>).map(([key, config]) => (
                <button key={key} className={clsx(mode === key && "active")} onClick={() => { onSelect(key); setOpen(false); }}>
                  <config.icon size={14} />
                  <strong>{config.label}</strong>
                  <span>{config.desc}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewHero({
  mode,
  query, setQuery, onSearch, searching, recentQueries, favoriteQueries, onPickRecent, onToggleFavorite, onPickRoot, rootLabel, onRebuildIndex, inputRef
}: {
  mode: ReviewWorkspaceMode;
  query: string;
  setQuery: (v: string) => void;
  onSearch: () => void;
  searching: boolean;
  recentQueries: string[];
  favoriteQueries: string[];
  onPickRecent: (q: string) => void;
  onToggleFavorite: (q: string) => void;
  onPickRoot: () => void;
  rootLabel: string;
  onRebuildIndex: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
}) {
  return (
    <div className="review-v2-hero">
      <div className="review-v2-hero-head">
        <Sparkles size={22} />
        <strong>收评助手</strong>
      </div>

      {mode !== "ai" && (
        <div className="review-v2-search">
          <div className="review-v2-search-input">
            <Search size={20} />
            <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onSearch(); }} placeholder="搜索商品、颜色或型号，例如：彩棉317" />
            <button className="review-v2-search-btn" onClick={onSearch} disabled={searching}>{searching ? <Loader2 className="spin" size={18} /> : <Search size={16} />}</button>
          </div>
          <div className="review-v2-meta-row">
            <button className="review-v2-root-pill" onClick={onPickRoot}><FolderOpen size={14} /><span>{rootLabel}</span></button>
            <button className="review-v2-root-pill ghost" onClick={onRebuildIndex} title="忽略缓存，重新扫描全目录"><Hammer size={14} /><span>重建索引</span></button>
          </div>
        </div>
      )}

      {mode !== "ai" && (recentQueries.length > 0 || favoriteQueries.length > 0) && (
        <div className="review-v2-query-memory">
          {favoriteQueries.length > 0 && (
            <div className="review-v2-recent">
              <span className="review-v2-recent-label">搜索收藏</span>
              {favoriteQueries.map((q) => (
                <span key={q} className="review-v2-memory-chip favorite">
                  <button onClick={() => onPickRecent(q)}>{q}</button>
                  <button onClick={() => onToggleFavorite(q)} title="取消收藏"><Star size={12} /></button>
                </span>
              ))}
            </div>
          )}
          {recentQueries.length > 0 && (
            <div className="review-v2-recent">
              <span className="review-v2-recent-label">最近搜索</span>
              {recentQueries.map((q) => {
                const starred = favoriteQueries.includes(q);
                return (
                  <span key={q} className="review-v2-memory-chip">
                    <button onClick={() => onPickRecent(q)}>{q}</button>
                    <button className={clsx(starred && "starred")} onClick={() => onToggleFavorite(q)} title={starred ? "取消收藏" : "收藏搜索"}>
                      {starred ? <Star size={12} /> : <StarOff size={12} />}
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReviewScanProgressBar({ progress, searching }: { progress: ScanProgress | null; searching: boolean }) {
  if (!progress && !searching) return null;
  const phase = progress?.phase || "start";
  const phaseLabel: Record<string, string> = { start: "开始扫描", walking: "扫描目录中", indexed: "索引完成", "loaded-cache": "命中缓存", scoring: "正在打分", done: "完成" };
  return (
    <div className={clsx("review-v2-progress", phase === "done" && "done")}>
      <Loader2 className={clsx(searching && "spin")} size={14} />
      <span className="review-v2-progress-phase">{phaseLabel[phase] || phase}</span>
      {progress?.scanned ? <strong>{progress.scanned.toLocaleString()} 个文件</strong> : null}
      {progress?.currentDir ? <em className="review-v2-progress-dir">{compactPath(progress.currentDir)}</em> : null}
    </div>
  );
}

function ReviewToolbar({ selectedImages, selectedCards, totalResults, visibleCount, onSelectAll, onClear, searching, sortMode, onSortChange, filterMode, onFilterChange, scoringEnabled }: { selectedImages: number; selectedCards: number; totalResults: number; visibleCount: number; onSelectAll: () => void; onClear: () => void; searching: boolean; sortMode: ReviewSortMode; onSortChange: (mode: ReviewSortMode) => void; filterMode: ReviewFilterMode; onFilterChange: (mode: ReviewFilterMode) => void; scoringEnabled: boolean; }) {
  return (
    <div className="review-v2-toolbar">
      <span className="review-v2-toolbar-status">{searching ? "正在检索" : totalResults > 0 ? "按匹配度展示 " + visibleCount + " / " + totalResults : "无结果"}</span>
      <div className="review-v2-toolbar-actions">
        <select className="review-v2-toolbar-select" value={filterMode} onChange={(event) => onFilterChange(event.target.value as ReviewFilterMode)}>
          <option value="all">全部</option>
          <option value="image">图片</option>
          <option value="folder">文件夹</option>
          <option value="selected">已选</option>
        </select>
        <select className="review-v2-toolbar-select" value={sortMode} onChange={(event) => onSortChange(event.target.value as ReviewSortMode)}>
          {scoringEnabled && <option value="relevance">相关度</option>}
          <option value="time-desc">时间新到旧</option>
          <option value="time-asc">时间旧到新</option>
          <option value="name-asc">文件名 A-Z</option>
          <option value="name-desc">文件名 Z-A</option>
        </select>
        {selectedImages > 0 && (<><span className="review-v2-selected-chip review-v2-selected-chip-readable"><Check size={12} /> {selectedCards} 个卡片 / 共 {selectedImages} 张图</span><span className="review-v2-drag-hint">拖拽缩略图即可同时移动全部所选</span><button className="review-v2-toolbar-btn" onClick={onClear}>清空选中</button></>)}
        {selectedImages > 0 && <button className="review-v2-toolbar-btn" onClick={onClear}>取消全选</button>}
        {totalResults > 0 && <button className="review-v2-toolbar-btn" onClick={onSelectAll}>全选可见</button>}
      </div>
    </div>
  );
}

function ReviewEmptyState({ query }: { query: string }) {
  return <div className="review-v2-empty"><ImageIcon size={48} /><strong>{query ? "没有找到“" + query + "”相关图片" : "未搜索"}</strong><span>试试换个关键词，或检查图片根目录是否正确。</span></div>;
}

function ReviewResultGrid({ items, scoringEnabled = true, selectedKeys, onToggle, onPointerSelect, onPointerEnterSelect, onSelectFolderChildren, onPreview, dragPathsFor }: { items: ReviewSearchResult[]; scoringEnabled?: boolean; selectedKeys: Set<string>; onToggle: (item: ReviewSearchResult) => void; onPointerSelect: (item: ReviewSearchResult) => void; onPointerEnterSelect: (item: ReviewSearchResult) => void; onSelectFolderChildren: (item: ReviewSearchResult) => void; onPreview: (item: ReviewSearchResult) => void; dragPathsFor: (item: ReviewSearchResult) => string[]; }) {
  return (
    <div className="review-v2-grid">
      {items.map((item) => {
        const isFolder = item.kind === "folder";
        const isSelected = selectedKeys.has(item.path);
        return (
          <button key={item.path} className={clsx("review-v2-card", isFolder && "is-folder", isSelected && "selected")} draggable onClick={() => onToggle(item)} onPointerDown={() => onPreview(item)} onPointerEnter={() => onPointerEnterSelect(item)} onMouseEnter={() => onPreview(item)} onDragStart={(event) => { const paths = dragPathsFor(item); onPreview(item); event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("text/plain", paths.join("\n")); if (window.alipayWorkbench.startDragFiles) { event.preventDefault(); void window.alipayWorkbench.startDragFiles(paths); } else { event.dataTransfer.setData("text/uri-list", paths.join("\n")); } }}>
            <div className="review-v2-thumb">
              {item.thumbnailDataUrl ? <img src={item.thumbnailDataUrl} alt={item.name} /> : <ImageIcon size={28} />}
              {isFolder && item.children && item.children.length > 1 && <span className="review-v2-folder-badge"><FolderOpen size={12} /> {item.children.length}</span>}
              {scoringEnabled && <span className="review-v2-score">{item.score}</span>}
              {isSelected && <span className="review-v2-check"><Check size={14} /></span>}
            </div>
            <strong className="review-v2-name">{item.name}</strong><em className="review-v2-reason">{item.reason}</em>
            {isFolder && item.children?.length ? <span className="review-v2-folder-select" onClick={(event) => { event.stopPropagation(); onSelectFolderChildren(item); }}>选中整个文件夹</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function ReviewPreviewPanel({ preview, selectedImages, selectedCards, scoringEnabled = true }: { preview: ReviewSearchResult | null; selectedImages: number; selectedCards: number; scoringEnabled?: boolean }) {
  return (
    <aside className="review-v2-preview">
      <div className="review-v2-preview-image">{preview?.thumbnailDataUrl ? <img src={preview.thumbnailDataUrl} alt={preview.name} /> : <div className="review-v2-preview-empty"><ImageIcon size={32} /><span>选择图片后预览</span></div>}</div>
      <div className="review-v2-preview-info">
        <strong>{preview?.name || "未选择"}</strong><span>{preview?.path || ""}</span>
        {preview?.kind === "folder" && preview.children && <em>文件夹包含 {preview.children.length} 张图</em>}
        <div className="review-v2-preview-stats"><span><Check size={12} /> {selectedCards} 个卡片 / 共 {selectedImages} 张图</span>{scoringEnabled && preview?.score !== undefined && <span><Star size={12} /> 评分 {preview.score}</span>}</div>
      </div>
    </aside>
  );
}

function ReviewAIPanel({ query, setQuery, options, setOptions, customPrompt, setCustomPrompt, onSaveCustomPrompt, advancedOpen, setAdvancedOpen, availableModels, selectedModelId, onModelChange, loadingModels, onLoadModels, onGenerate, onNextBatch, generating, hasCopies, canGenerate, onClearContext, hotkey, onSaveHotkey }: { query: string; setQuery: (value: string) => void; options: { emojiLevel: number; professionalLevel: number; buyerLevel: number; exaggerationLevel: number; sceneLevel: number; mentionValue: boolean; productDescription: string; targetLength: number; thinkingMode: ReviewThinkingMode; thinkingEffort: ReviewThinkingEffort; }; setOptions: React.Dispatch<React.SetStateAction<{ emojiLevel: number; professionalLevel: number; buyerLevel: number; exaggerationLevel: number; sceneLevel: number; mentionValue: boolean; productDescription: string; targetLength: number; thinkingMode: ReviewThinkingMode; thinkingEffort: ReviewThinkingEffort; }>>; customPrompt: string; setCustomPrompt: (v: string) => void; onSaveCustomPrompt: () => void; advancedOpen: boolean; setAdvancedOpen: (v: boolean) => void; availableModels: { id: string; name: string }[]; selectedModelId: string; onModelChange: (id: string) => void; loadingModels: boolean; onLoadModels: () => void; onGenerate: () => void; onNextBatch: () => void; generating: boolean; hasCopies: boolean; canGenerate: boolean; onClearContext: () => void; hotkey: string; onSaveHotkey: (value: string) => void; }) {
  return (
    <section className="review-v2-ai-panel">
      <div className="review-v2-ai-head"><WandSparkles size={18} /><strong>AI 生成好评</strong><span className="review-v2-ai-tag">高级功能</span><div className="review-v2-ai-model"><select value={selectedModelId} onChange={(e) => onModelChange(e.target.value)}>{availableModels.length === 0 && <option value={selectedModelId}>{selectedModelId || "未选择模型"}</option>}{availableModels.map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}</select><button className="review-v2-ai-refresh" onClick={onLoadModels} disabled={loadingModels} title="刷新可用模型">{loadingModels ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}</button></div></div>
      <div className="review-v2-sliders">
        <label className="review-v2-desc review-v2-query-field"><span>商品/搜索词</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="例如：彩棉317 夏季长裤" /></label>
        <label className="review-v2-desc review-v2-length-field"><span>目标字数：{options.targetLength}</span><input type="range" min={30} max={100} step={5} value={options.targetLength} onChange={(e) => setOptions((p) => ({ ...p, targetLength: Number(e.target.value) }))} /></label>
        <SliderCompact label="Emoji" value={options.emojiLevel} onChange={(v) => setOptions((p) => ({ ...p, emojiLevel: v }))} />
        <SliderCompact label="专业" value={options.professionalLevel} onChange={(v) => setOptions((p) => ({ ...p, professionalLevel: v }))} />
        <SliderCompact label="买家味" value={options.buyerLevel} onChange={(v) => setOptions((p) => ({ ...p, buyerLevel: v }))} />
        <SliderCompact label="夸张度" value={options.exaggerationLevel} onChange={(v) => setOptions((p) => ({ ...p, exaggerationLevel: v }))} />
        <SliderCompact label="场景化" value={options.sceneLevel} onChange={(v) => setOptions((p) => ({ ...p, sceneLevel: v }))} />
        <label className="review-v2-toggle"><span>性价比</span><input type="checkbox" checked={options.mentionValue} onChange={(e) => setOptions((p) => ({ ...p, mentionValue: e.target.checked }))} /><span className="review-v2-toggle-track"><span className="review-v2-toggle-thumb" /></span></label>
      </div>
      <div className="review-v2-thinking-row"><label><span>思考模式</span><select value={options.thinkingMode} onChange={(e) => setOptions((p) => ({ ...p, thinkingMode: e.target.value as ReviewThinkingMode }))}><option value="off">关闭</option><option value="fast">快速</option><option value="balanced">均衡</option><option value="deep">深度</option></select></label><label><span>思考程度</span><select value={options.thinkingEffort} onChange={(e) => setOptions((p) => ({ ...p, thinkingEffort: e.target.value as ReviewThinkingEffort }))}><option value="minimal">minimal</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></label></div>
      <label className="review-v2-desc review-v2-hotkey"><span><Keyboard size={13} /> 生成快捷键</span><input value={hotkey} onChange={(e) => onSaveHotkey(e.target.value)} placeholder="Ctrl+Enter" /></label>
      <label className="review-v2-desc"><span>商品描述补充</span><textarea value={options.productDescription} onChange={(e) => setOptions((p) => ({ ...p, productDescription: e.target.value }))} placeholder="补充商品卖点，让好评更贴合（可选）" /></label>
      <button className="review-v2-advanced-toggle" onClick={() => setAdvancedOpen(!advancedOpen)}><ChevronDown size={14} className={clsx("review-v2-chev", advancedOpen && "open")} />高级：自定义提示词</button>
      {advancedOpen && <label className="review-v2-desc"><span>自定义提示词（追加在系统指令后）</span><textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} onBlur={onSaveCustomPrompt} placeholder="例如：多用口语化表达，不要使用书面语" /></label>}
      <div className="review-v2-buttons"><button className="review-v2-primary" onClick={onGenerate} disabled={generating || !canGenerate || !query.trim()}>{generating ? <Loader2 className="spin" size={18} /> : <WandSparkles size={18} />}{hasCopies ? "重新生成" : "AI 生成好评"}</button><button className="review-v2-secondary" onClick={onNextBatch} disabled={generating || !hasCopies}>换一批</button><button className="review-v2-ghost" onClick={onClearContext}><RotateCcw size={14} /> 清空</button></div>
      {generating && <div className="review-v2-gen-status"><Loader2 className="spin" size={14} /> AI 正在生成文案，请稍候</div>}
    </section>
  );
}

function ReviewCopyResultList({ copies, savedCopies, editingIndex, editingText, onSetEditingText, onStartEdit, onSaveEdit, onCancelEdit, onCopy, onCopyAll, onToggleStar, copyListRef }: { copies: string[]; savedCopies: string[]; editingIndex: number | null; editingText: string; onSetEditingText: (v: string) => void; onStartEdit: (index: number) => void; onSaveEdit: () => void; onCancelEdit: () => void; onCopy: (text: string) => void; onCopyAll: () => void; onToggleStar: (text: string) => void; copyListRef: React.RefObject<HTMLDivElement>; }) {
  return (
    <section className="review-v2-copy-section" ref={copyListRef}>
      <div className="review-v2-copy-head"><strong>已生成 {copies.length} 条文案</strong><span>点击复制 · 编辑改写 · 星标收藏</span><button className="review-v2-copy-all" onClick={onCopyAll}><Copy size={14} /> 复制全部</button></div>
      <div className="review-v2-copy-list">{copies.map((copy, index) => { const isStarred = savedCopies.includes(copy); const isEditing = editingIndex === index; const charCount = copy.length; return <article key={index + '-' + copy.slice(0, 6)} className="review-v2-copy-card">{!isEditing && <><div className="review-v2-copy-text" onClick={() => onCopy(copy)}><Copy size={14} className="review-v2-copy-icon" /><span>{copy}</span></div><div className="review-v2-copy-meta"><span>{charCount} 字</span><button className="review-v2-copy-action" onClick={() => onStartEdit(index)} title="编辑"><Edit3 size={13} /></button><button className={clsx("review-v2-copy-action", isStarred && "starred")} onClick={() => onToggleStar(copy)} title={isStarred ? "取消收藏" : "收藏"}>{isStarred ? <Star size={13} /> : <StarOff size={13} />}</button></div></>}{isEditing && <div className="review-v2-copy-edit"><textarea value={editingText} onChange={(e) => onSetEditingText(e.target.value)} rows={3} /><div className="review-v2-copy-edit-actions"><button className="review-v2-secondary" onClick={onSaveEdit}>保存</button><button className="review-v2-ghost" onClick={onCancelEdit}>取消</button></div></div>}</article>; })}</div>
    </section>
  );
}

function ReviewSavedCopies({ savedCopies, open, onToggle, onCopy, onRemove }: { savedCopies: string[]; open: boolean; onToggle: () => void; onCopy: (text: string) => void; onRemove: (text: string) => void; }) {
  return <section className={clsx("review-v2-saved", open && "open")}><button className="review-v2-saved-toggle" onClick={onToggle}><Star size={14} /><strong>我的收藏文案（{savedCopies.length}）</strong><ChevronDown size={14} className={clsx("review-v2-chev", open && "open")} /></button>{open && <div className="review-v2-saved-list">{savedCopies.map((text, i) => <article key={i + '-' + text.slice(0, 6)} className="review-v2-saved-card"><span onClick={() => onCopy(text)}>{text}</span><button className="review-v2-copy-action" onClick={() => onRemove(text)} title="删除"><Trash2 size={13} /></button></article>)}</div>}</section>;
}

function SliderCompact({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return <label className="review-v2-slider"><span className="review-v2-slider-label">{label}</span><input type="range" min={0} max={5} value={value} onChange={(event) => onChange(Number(event.target.value))} /><em className="review-v2-slider-value">{value}</em></label>;
}

function compactPath(value: string) {
  const parts = value.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return value;
  return parts[0] + "\\...\\" + parts.slice(-2).join("\\");
}

function normalizeHotkey(value: string) {
  const parts = value.split("+").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return "";
  const key = parts.at(-1);
  if (!key) return "";
  const modifiers = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()));
  const normalizedModifiers: string[] = [];
  if (modifiers.has("ctrl") || modifiers.has("control")) normalizedModifiers.push("Ctrl");
  if (modifiers.has("alt") || modifiers.has("option")) normalizedModifiers.push("Alt");
  if (modifiers.has("shift")) normalizedModifiers.push("Shift");
  if (modifiers.has("meta") || modifiers.has("cmd") || modifiers.has("command")) normalizedModifiers.push("Meta");
  const normalizedKey = key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);
  if (!normalizedModifiers.length && normalizedKey !== "Enter") return "";
  return [...normalizedModifiers, normalizedKey].join("+");
}

function matchesHotkey(event: KeyboardEvent, hotkey: string) {
  const normalized = normalizeHotkey(hotkey);
  if (!normalized) return false;
  const parts = normalized.split("+");
  const key = parts.at(-1)?.toLowerCase();
  const wants = new Set(parts.slice(0, -1));
  const eventKey = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
  return (
    eventKey === key &&
    event.ctrlKey === wants.has("Ctrl") &&
    event.altKey === wants.has("Alt") &&
    event.shiftKey === wants.has("Shift") &&
    event.metaKey === wants.has("Meta")
  );
}
