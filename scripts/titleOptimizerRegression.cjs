const assert = require("node:assert/strict");
const { analyzeTitleScore, generateTitleScore, getGBKByteLength } = require("../dist-electron/src/lib/titleOptimizer.js");

const keywords = [
  "夏季薄款凉感棉麻短裤",
  "亚麻裤子男款",
  "2026新款直筒休闲运动裤",
  "休闲裤男",
  "直筒裤男",
  "卫裤男",
  "裤子男款",
  "男裤",
  "薄款凉感",
  "棉麻亚麻",
  "纯棉短裤",
  "五分裤男",
  "速干直筒裤",
  "冰丝运动裤",
  "阔腿裤子",
  "夏季亚麻裤子男款",
  "直筒休闲裤",
  "棉麻短裤男款"
];

const blueOceanWords = ["凉感裤子男款", "夏季亚麻裤", "薄款直筒裤男", "速干运动裤男", "五分裤子男"];

const keywordData = {
  excelPath: "mock.xlsx",
  loadedAt: new Date().toISOString(),
  modifiedAt: new Date().toISOString(),
  categories: [
    {
      name: "休闲裤男",
      source: "mixed",
      keywords: keywords.map((keyword, index) => ({
        keyword,
        category: "休闲裤男",
        source: index % 3 === 0 ? "breakdown" : "market",
        rank: index + 1,
        weight: 150 - index * 3
      })),
      blueOceanWords: blueOceanWords.map((keyword, index) => ({
        keyword,
        category: "休闲裤男",
        source: "blue-ocean",
        weight: 150 - index * 5,
        blueOceanScore: 150 - index * 5
      })),
      keywordCount: keywords.length + blueOceanWords.length
    }
  ],
  totalKeywords: keywords.length + blueOceanWords.length,
  warnings: []
};

function assertCandidateBasics(result, productName) {
  if (!result.ok) {
    console.error(`${productName} failed`, {
      message: result.message,
      diagnostics: result.diagnostics,
      warnings: result.warnings,
      product: result.product
    });
  }
  assert.equal(result.ok, true, `${productName} should generate candidates`);
  assert.ok(result.candidates.length > 0, `${productName} should include at least one candidate`);
  for (const candidate of result.candidates) {
    assert.equal(candidate.bodyBytes, 54, `${candidate.title} body bytes`);
    assert.equal(candidate.totalBytes, 60, `${candidate.title} total bytes`);
    assert.equal(getGBKByteLength(candidate.body), 54, `${candidate.title} GBK body`);
    assert.equal(getGBKByteLength(candidate.title), 60, `${candidate.title} GBK total`);
    assert.equal(candidate.ruleChecks.every((rule) => !rule.required || rule.passed), true, `${candidate.title} required rules`);
  }
}

function assertContainsAny(title, words, label) {
  assert.equal(words.some((word) => title.includes(word)), true, `${title} should include ${label}`);
}

const coloredCotton = generateTitleScore(keywordData, "彩棉317夏季长裤", undefined, 5);
assertCandidateBasics(coloredCotton, "彩棉317夏季长裤");
assertContainsAny(coloredCotton.candidates[0].title, ["棉麻"], "棉麻");
assertContainsAny(coloredCotton.candidates[0].title, ["亚麻"], "亚麻");
assertContainsAny(coloredCotton.candidates[0].title, ["纯棉"], "纯棉");
assertContainsAny(coloredCotton.candidates[0].title, ["男士", "男款"], "男士/男款");
assertContainsAny(coloredCotton.candidates[0].title, ["裤子"], "裤子");
assertContainsAny(coloredCotton.candidates[0].title, ["直筒裤"], "直筒裤");
assertContainsAny(coloredCotton.candidates[0].title, ["休闲裤"], "休闲裤");
assertContainsAny(coloredCotton.candidates[0].title, ["卫裤"], "卫裤");

const baiye = generateTitleScore(keywordData, "百叶317夏季裤子", undefined, 5);
assertCandidateBasics(baiye, "百叶317夏季裤子");
assertContainsAny(baiye.candidates[0].title, ["速干"], "速干");

const linenShorts = generateTitleScore(keywordData, "棉麻夏季短裤", undefined, 5);
assertCandidateBasics(linenShorts, "棉麻夏季短裤");
assertContainsAny(linenShorts.candidates[0].title, ["棉麻"], "棉麻");
assertContainsAny(linenShorts.candidates[0].title, ["亚麻"], "亚麻");
assertContainsAny(linenShorts.candidates[0].title, ["五分裤"], "五分裤");
assertContainsAny(linenShorts.candidates[0].title, ["直筒裤"], "直筒裤");

const analyzed = analyzeTitleScore(keywordData, {
  productName: "彩棉317夏季长裤",
  title: coloredCotton.candidates[0].title
});
assert.equal(analyzed.ok, true, "analysis should complete");
assert.equal(analyzed.bodyBytes, 54, "analysis should report 54 body bytes");
assert.equal(analyzed.totalBytes, 60, "analysis should report 60 total bytes");
assert.ok(analyzed.score >= 70, `analysis score should be usable, got ${analyzed.score}`);
assert.equal(analyzed.grade !== "blocked", true, "valid generated title should not be blocked");

const badAnalysis = analyzeTitleScore(keywordData, {
  productName: "彩棉317夏季长裤",
  title: "彩棉317夏季长裤"
});
assert.equal(badAnalysis.grade, "blocked", "title without prefix and required words should be blocked");
assert.equal(badAnalysis.candidate.ruleChecks.some((rule) => rule.key === "prefix" && !rule.passed), true, "prefix rule should fail");

const missingSeason = generateTitleScore(keywordData, "百叶317裤子", undefined, 5);
assert.equal(missingSeason.ok, false, "missing season should block generation");
assert.equal(missingSeason.candidates.length, 0, "missing season should not return candidates");

const largeKeywordData = {
  ...keywordData,
  categories: Array.from({ length: 10 }, (_, categoryIndex) => {
    const baseCategory = keywordData.categories[0];
    const marketNoise = Array.from({ length: 650 }, (_, index) => ({
      keyword: index % 2 === 0 ? `夏季薄款直筒裤男款${categoryIndex}${index}` : `男裤休闲裤卫裤${categoryIndex}${index}`,
      category: categoryIndex === 0 ? "休闲裤男" : `测试裤子男${categoryIndex}`,
      source: index % 5 === 0 ? "breakdown" : "market",
      rank: index + 100,
      weight: Math.max(20, 130 - (index % 90))
    }));
    const blueNoise = Array.from({ length: 260 }, (_, index) => ({
      keyword: index % 2 === 0 ? `速干运动裤男${categoryIndex}${index}` : `夏季亚麻裤子男款${categoryIndex}${index}`,
      category: categoryIndex === 0 ? "休闲裤男" : `测试裤子男${categoryIndex}`,
      source: "blue-ocean",
      weight: Math.max(18, 120 - (index % 80)),
      blueOceanScore: Math.max(18, 120 - (index % 80))
    }));
    return {
      ...baseCategory,
      name: categoryIndex === 0 ? "休闲裤男" : `测试裤子男${categoryIndex}`,
      keywords: [...baseCategory.keywords, ...marketNoise],
      blueOceanWords: [...baseCategory.blueOceanWords, ...blueNoise],
      keywordCount: baseCategory.keywordCount + marketNoise.length + blueNoise.length
    };
  })
};
largeKeywordData.totalKeywords = largeKeywordData.categories.reduce((sum, category) => sum + category.keywordCount, 0);

const largeStartedAt = Date.now();
const largePoolResult = generateTitleScore(largeKeywordData, "彩棉317夏季长裤", undefined, 5);
const largeElapsedMs = Date.now() - largeStartedAt;
assertCandidateBasics(largePoolResult, "large pool 彩棉317夏季长裤");
assert.ok((largePoolResult.diagnostics?.recalledSize ?? 0) <= 150, "large pool recalled size should stay capped");
assert.ok(largeElapsedMs < 2500, `large pool generation should stay fast, got ${largeElapsedMs}ms`);

console.log("titleOptimizerRegression passed", {
  coloredCotton: coloredCotton.candidates[0].title,
  baiye: baiye.candidates[0].title,
  linenShorts: linenShorts.candidates[0].title,
  analysis: { score: analyzed.score, grade: analyzed.grade },
  diagnostics: coloredCotton.diagnostics,
  largePool: {
    elapsedMs: largeElapsedMs,
    recalledSize: largePoolResult.diagnostics?.recalledSize,
    generatedCount: largePoolResult.diagnostics?.generatedCount
  }
});
