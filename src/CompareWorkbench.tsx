import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCopy, Eraser, Play, X } from "lucide-react";
import { normalizeCompareName, parseCompareEntries } from "./lib/compare";
import { AppSettings } from "./lib/shared";

export function CompareWorkbench({ settings, showToast }: { settings: AppSettings; showToast: (message: string) => void }) {
  const [reviewedInput, setReviewedInput] = useState("");
  const [rebatedInput, setRebatedInput] = useState("");
  const [verified, setVerified] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTab, setDialogTab] = useState<"remind" | "reviewed">("remind");
  const rightListRef = useRef<HTMLDivElement | null>(null);

  const reviewedEntries = useMemo(() => parseCompareEntries(reviewedInput), [reviewedInput]);
  const rebatedEntries = useMemo(() => parseCompareEntries(rebatedInput), [rebatedInput]);
  const comparison = useMemo(() => {
    const reviewedKeys = new Set(reviewedEntries.map((entry) => normalizeCompareName(entry.name)));
    const rebatedKeys = new Set(rebatedEntries.map((entry) => normalizeCompareName(entry.name)));
    const leftOnly = reviewedEntries.filter((entry) => !rebatedKeys.has(normalizeCompareName(entry.name)));
    const rightOnly = rebatedEntries.filter((entry) => !reviewedKeys.has(normalizeCompareName(entry.name)));
    const matched = rebatedEntries.filter((entry) => reviewedKeys.has(normalizeCompareName(entry.name)));
    return { leftOnly, rightOnly, matched };
  }, [reviewedEntries, rebatedEntries]);

  useEffect(() => {
    if (verified) rightListRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [verified, comparison.rightOnly.length]);

  function verify() {
    setVerified(true);
    setDialogOpen(settings.compareAutoOpenReminderDialog);
    showToast(`已完成对比：需催促 ${comparison.leftOnly.length} 人，表单状态待改 ${comparison.rightOnly.length} 人。`);
  }

  async function copyName(name: string) {
    await window.alipayWorkbench.writeClipboardText(name);
    showToast(`已复制：${name}`);
  }

  function clearReviewed() {
    setReviewedInput("");
    setVerified(false);
  }

  function clearRebated() {
    setRebatedInput("");
    setVerified(false);
  }

  const rightList = verified
    ? [...comparison.rightOnly, ...(settings.compareShowPassedRowsAfterVerify ? comparison.matched : [])]
    : rebatedEntries;

  return (
    <section className="compare-workbench">
      <div className="tool-header">
        <div>
          <p className="eyebrow">评价返款对比</p>
          <h1>评价与返款状态验证</h1>
        </div>
        <div className="status-pill double-check">去重后对比 · 差异置顶</div>
      </div>

      <div className="compare-grid">
        <div className="compare-column" data-tour="compare-left">
          <div className="compare-column-title">
            <div>
              <strong>已发评价</strong>
              <span>支持多轮少量粘贴，自动处理多余回车</span>
            </div>
            <button type="button" onClick={clearReviewed} title="清空已发评价名单"><Eraser size={16} /> 清空</button>
          </div>
          <textarea
            value={reviewedInput}
            onChange={(event) => {
              setReviewedInput(event.target.value);
              setVerified(false);
            }}
            placeholder="把已发评价名单粘贴到这里"
          />
          <div className="compare-count">清洗后 {reviewedEntries.length} 人</div>
        </div>

        <div className="compare-column" data-tour="compare-right">
          <div className="compare-column-title">
            <div>
              <strong>已返款</strong>
              <span>可粘贴大量数据，验证后异常会自动置顶标红</span>
            </div>
            <button type="button" onClick={clearRebated} title="清空已返款名单"><Eraser size={16} /> 清空</button>
          </div>
          <div ref={rightListRef} className="rebate-result-list">
            {verified ? (
              rightList.length ? rightList.map((entry) => {
                const isProblem = comparison.rightOnly.some((item) => normalizeCompareName(item.name) === normalizeCompareName(entry.name));
                return (
                  <button key={`${entry.name}-${entry.source}`} type="button" className={isProblem ? "problem" : ""} onClick={() => copyName(entry.name)} title="复制这个姓名">
                    <strong>{entry.name}</strong>
                    <span>{isProblem ? "已评价但表单状态未改，请进入微信工作表中修改其状态" : "已通过验证"}</span>
                  </button>
                );
              }) : <div className="empty">暂无清洗结果。</div>
            ) : (
              <textarea
                value={rebatedInput}
                onChange={(event) => setRebatedInput(event.target.value)}
                placeholder="把已返款名单粘贴到这里"
              />
            )}
          </div>
          <div className="compare-count">清洗后 {rebatedEntries.length} 人</div>
        </div>
      </div>

      <div className="compare-actions" data-tour="compare-actions">
        <button className="primary" type="button" onClick={verify} title="对比已发评价和已返款名单，找出差异"><Play size={18} /> 开始验证</button>
        {verified && <button className="secondary-action light" type="button" onClick={() => setVerified(false)} title="返回编辑名单数据">返回编辑</button>}
        {verified && !dialogOpen && <button className="secondary-action light" type="button" onClick={() => setDialogOpen(true)} title="查看发了评价但没返款的人员名单">查看需催促名单</button>}
      </div>

      {dialogOpen && verified && (
        <div className="compare-dialog-backdrop">
          <div className="compare-dialog">
            <button className="dialog-close" type="button" onClick={() => setDialogOpen(false)} title="关闭弹窗"><X size={18} /></button>
            <div className="compare-dialog-tabs">
              <button type="button" className={dialogTab === "remind" ? "active" : ""} onClick={() => setDialogTab("remind")} title="查看需催促名单">需催促 ({comparison.leftOnly.length})</button>
              <button type="button" className={dialogTab === "reviewed" ? "active" : ""} onClick={() => setDialogTab("reviewed")} title="查看已评价名单">已评价 ({comparison.matched.length})</button>
            </div>
            {dialogTab === "remind" ? (
              <>
                <h2>还未评价，需催促</h2>
                <p>以下名单来自左侧多出的部分。点击姓名即可复制，方便逐个催促。</p>
                <div className="copy-name-list">
                  {comparison.leftOnly.length ? comparison.leftOnly.map((entry) => (
                    <button key={`${entry.name}-${entry.source}`} type="button" onClick={() => copyName(entry.name)} title="复制这个姓名">
                      <ClipboardCopy size={15} /> {entry.name}
                    </button>
                  )) : <div className="empty">没有需要催促的人员。</div>}
                </div>
              </>
            ) : (
              <>
                <h2>已评价人员</h2>
                <p>以下人员已完成评价且已返款，无需操作。点击姓名即可复制。</p>
                <div className="copy-name-list">
                  {comparison.matched.length ? comparison.matched.map((entry) => (
                    <button key={`${entry.name}-${entry.source}`} type="button" onClick={() => copyName(entry.name)} title="复制这个姓名">
                      <ClipboardCopy size={15} /> {entry.name}
                    </button>
                  )) : <div className="empty">没有已评价的人员。</div>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
