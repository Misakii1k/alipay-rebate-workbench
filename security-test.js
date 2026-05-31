/**
 * 安全修复验证测试脚本
 * 运行方式: node security-test.js
 */

const path = require('path');

console.log('🔒 安全修复验证测试\n');

// ==================== 测试 1: HTTPS 强制校验 ====================
console.log('📋 测试 1: HTTPS 强制校验');
console.log('-----------------------------------');

function validateApiUrl(url) {
  if (!url) return;
  if (!url.startsWith("https://") && !url.startsWith("http://localhost") && !url.startsWith("http://127.0.0.1")) {
    throw new Error("安全错误：API Base URL 必须使用 HTTPS 协议，以保护 API Key 不被窃取。本地测试可使用 localhost 或 127.0.0.1。");
  }
}

const httpsTests = [
  { url: 'https://api.openai.com/v1', shouldPass: true },
  { url: 'http://api.openai.com/v1', shouldPass: false },
  { url: 'http://localhost:8080', shouldPass: true },
  { url: 'http://127.0.0.1:3000', shouldPass: true },
  { url: 'http://192.168.1.1', shouldPass: false },
];

httpsTests.forEach(test => {
  try {
    validateApiUrl(test.url);
    if (test.shouldPass) {
      console.log(`✅ PASS: ${test.url} - 允许访问`);
    } else {
      console.log(`❌ FAIL: ${test.url} - 应该被拒绝但通过了`);
    }
  } catch (error) {
    if (!test.shouldPass) {
      console.log(`✅ PASS: ${test.url} - 正确拒绝`);
    } else {
      console.log(`❌ FAIL: ${test.url} - 不应该被拒绝: ${error.message}`);
    }
  }
});

// ==================== 测试 2: Excel 公式注入防护 ====================
console.log('\n📋 测试 2: Excel 公式注入防护');
console.log('-----------------------------------');

function sanitizeCellText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (text === "") return null;
  if (/^[=+\-@\t\r]/.test(text)) return `'${text}`;
  return text;
}

const excelTests = [
  { input: '=1+1', expected: "'=1+1" },
  { input: '+CMD|"/c calc"', expected: "'+CMD|\"/c calc\"" },
  { input: '-2+5', expected: "'-2+5" },
  { input: '@SUM(A1:A10)', expected: "'@SUM(A1:A10)" },
  { input: '正常文本', expected: '正常文本' },
  { input: '138****5678', expected: '138****5678' },
];

excelTests.forEach(test => {
  const result = sanitizeCellText(test.input);
  if (result === test.expected) {
    console.log(`✅ PASS: "${test.input}" → "${result}"`);
  } else {
    console.log(`❌ FAIL: "${test.input}" → "${result}" (期望: "${test.expected}")`);
  }
});

// ==================== 测试 3: Everything 命令注入防护 ====================
console.log('\n📋 测试 3: Everything 命令注入防护');
console.log('-----------------------------------');

function sanitizeEverythingQuery(query) {
  return query
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

const everythingTests = [
  { input: 'regex:.*', expected: 'regex' },
  { input: 'path:C:\\Windows', expected: 'path C Windows' },
  { input: '连衣裙 红色', expected: '连衣裙 红色' },
  { input: 'file<>|&^!()"test', expected: 'file test' },
  { input: 'product-name_123', expected: 'product-name_123' },
];

everythingTests.forEach(test => {
  const result = sanitizeEverythingQuery(test.input);
  if (result === test.expected) {
    console.log(`✅ PASS: "${test.input}" → "${result}"`);
  } else {
    console.log(`❌ FAIL: "${test.input}" → "${result}" (期望: "${test.expected}")`);
  }
});

// ==================== 测试 4: 敏感数据脱敏 ====================
console.log('\n📋 测试 4: 敏感数据脱敏');
console.log('-----------------------------------');

function sanitizeForLog(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    return obj
      .replace(/sk-[a-zA-Z0-9]{20,}/g, "sk-***")
      .replace(/\b(1[3-9]\d)(\d{4})(\d{4})\b/g, "$1****$3")
      .replace(/\b([a-zA-Z0-9._%+-]{1,2})[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/gi, "$1***@$2");
  }
  return obj;
}

const sanitizeTests = [
  { input: 'sk-1234567890abcdefghijklmnop', expected: 'sk-***' },
  { input: '手机号: 13812345678', expected: '手机号: 138****5678' },
  { input: 'email: test@example.com', expected: 'email: te***@example.com' },
  { input: '正常文本不受影响', expected: '正常文本不受影响' },
];

sanitizeTests.forEach(test => {
  const result = sanitizeForLog(test.input);
  if (result === test.expected) {
    console.log(`✅ PASS: "${test.input}" → "${result}"`);
  } else {
    console.log(`❌ FAIL: "${test.input}" → "${result}" (期望: "${test.expected}")`);
  }
});

// ==================== 测试 5: 路径遍历防护 ====================
console.log('\n📋 测试 5: 路径遍历防护');
console.log('-----------------------------------');

function validatePathSafety(targetPath, allowedRoots) {
  if (!targetPath) {
    throw new Error("路径不能为空");
  }

  const resolved = path.resolve(targetPath);
  const normalized = path.normalize(resolved).toLowerCase();

  const forbiddenPaths = [
    path.normalize("C:\\Windows").toLowerCase(),
    path.normalize("C:\\Program Files").toLowerCase(),
    path.normalize("C:\\Program Files (x86)").toLowerCase(),
  ];

  for (const forbidden of forbiddenPaths) {
    if (normalized === forbidden || normalized.startsWith(forbidden + path.sep)) {
      throw new Error(`安全错误：禁止访问系统目录 ${forbidden}`);
    }
  }

  if (allowedRoots && allowedRoots.length > 0) {
    const isAllowed = allowedRoots.some((root) => {
      if (!root) return false;
      const normalizedRoot = path.normalize(path.resolve(root)).toLowerCase();
      return normalized === normalizedRoot || normalized.startsWith(normalizedRoot + path.sep);
    });

    if (!isAllowed) {
      throw new Error("安全错误：路径不在允许访问的目录范围内");
    }
  }
}

const pathTests = [
  { path: 'C:\\Windows\\System32', shouldPass: false, desc: '系统目录' },
  { path: 'C:\\Program Files\\test', shouldPass: false, desc: 'Program Files' },
  { path: 'C:\\Users\\87850\\Desktop', shouldPass: true, desc: '用户桌面' },
  { path: 'C:\\Users\\87850\\Documents', shouldPass: true, desc: '用户文档' },
];

pathTests.forEach(test => {
  try {
    validatePathSafety(test.path);
    if (test.shouldPass) {
      console.log(`✅ PASS: ${test.desc} - 允许访问`);
    } else {
      console.log(`❌ FAIL: ${test.desc} - 应该被拒绝但通过了`);
    }
  } catch (error) {
    if (!test.shouldPass) {
      console.log(`✅ PASS: ${test.desc} - 正确拒绝`);
    } else {
      console.log(`❌ FAIL: ${test.desc} - 不应该被拒绝`);
    }
  }
});

// ==================== 总结 ====================
console.log('\n' + '='.repeat(50));
console.log('✅ 所有安全修复验证测试完成！');
console.log('='.repeat(50));
console.log('\n建议进一步测试：');
console.log('1. 启动应用 (npm run dev)');
console.log('2. 尝试设置 HTTP API URL，应显示错误提示');
console.log('3. 导出包含 =1+1 的 Excel，检查单元格是否显示为纯文本');
console.log('4. 检查日志文件，确认敏感信息已脱敏');
console.log('5. 检查 settings.json，确认 apiKey 为加密格式');
