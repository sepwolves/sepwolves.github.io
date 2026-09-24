const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

// 默认配置
const CONFIG_FILE = path.join(__dirname, 'config.json');
const CACHE_DIR = path.join(__dirname, '.cache');

let config = {
  port: 3721,
  ebookDir: 'D:\\OneDrive - SkyMan\\个人文件\\我的文档\\我的电子书',
  readingVault: 'D:\\Remotely-save\\读后',
  studyVault: 'D:\\Remotely-save\\学习\\学习库',
  apiBaseUrl: 'http://140.245.65.111:3005/v1',
  apiKey: 'freellmapi-5970cc45963020cb59754a87d5fd0fd7d3b8f373c8c19bed',
  model: 'auto'
};

// 初始化缓存目录
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}
const SLIDES_CACHE_DIR = path.join(CACHE_DIR, 'slides');
if (!fs.existsSync(SLIDES_CACHE_DIR)) {
  fs.mkdirSync(SLIDES_CACHE_DIR, { recursive: true });
}

// 加载本地配置
if (fs.existsSync(CONFIG_FILE)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    config = { ...config, ...loaded };
  } catch (e) {
    console.error('加载 config.json 失败，使用默认配置:', e.message);
  }
} else {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {}
}

// 递归扫描电子书目录
function scanEbooks(baseDir, maxDepth = 3) {
  const books = [];
  if (!fs.existsSync(baseDir)) return books;

  function traverse(dir, currentDepth) {
    if (currentDepth > maxDepth) return;
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith('.') || item.name === 'node_modules') continue;
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          traverse(fullPath, currentDepth + 1);
        } else if (item.isFile()) {
          const ext = path.extname(item.name).toLowerCase();
          if (['.epub', '.txt', '.md'].includes(ext)) {
            let stat = null;
            try { stat = fs.statSync(fullPath); } catch (e) {}
            const relPath = path.relative(baseDir, fullPath);
            const parentDir = path.dirname(relPath);
            books.push({
              name: path.basename(item.name, ext),
              fileName: item.name,
              fullPath: fullPath,
              relPath: relPath.replace(/\\/g, '/'),
              folder: parentDir === '.' ? '根目录' : parentDir.replace(/\\/g, '/'),
              ext: ext.slice(1),
              size: stat ? stat.size : 0,
              mtime: stat ? stat.mtimeMs : 0
            });
          }
        }
      }
    } catch (e) {
      console.error(`读取目录失败: ${dir}`, e.message);
    }
  }

  traverse(baseDir, 1);
  return books;
}

// 获取 Obsidian 库的子目录列表
function getVaultFolders(vaultDir) {
  if (!fs.existsSync(vaultDir)) return [];
  try {
    return fs.readdirSync(vaultDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.') && d.name !== '_templates' && d.name !== '_debug_remotely_save')
      .map(d => d.name);
  } catch (e) {
    return [];
  }
}

// 调用 FreeLLMAPI (OpenAI 兼容协议)
async function callLLM(messages, temperature = 0.7, max_tokens = 2500) {
  const apiUrl = `${config.apiBaseUrl.replace(/\/+$/, '')}/chat/completions`;
  const reqBody = {
    model: config.model || 'auto',
    messages: messages,
    temperature: temperature,
    max_tokens: max_tokens
  };

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(reqBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API 响应错误 (${response.status}): ${errorText}`);
  }

  const resJson = await response.json();
  return resJson.choices && resJson.choices[0] && resJson.choices[0].message
    ? resJson.choices[0].message.content
    : '';
}

// 创建 HTTP 服务
const server = http.createServer(async (req, res) => {
  // CORS 响应头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 1. 获取书籍列表
  if (req.method === 'GET' && pathname === '/api/books') {
    const books = scanEbooks(config.ebookDir);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, count: books.length, books }));
    return;
  }

  // 2. 流式读取指定书籍文件内容
  if (req.method === 'GET' && pathname === '/api/book/file') {
    const filePath = parsedUrl.query.path;
    if (!filePath || !fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '文件未找到' }));
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    let contentType = 'application/octet-stream';
    if (ext === '.epub') contentType = 'application/epub+zip';
    else if (ext === '.txt') contentType = 'text/plain; charset=utf-8';
    else if (ext === '.md') contentType = 'text/markdown; charset=utf-8';

    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Content-Disposition': `inline; filename="${encodeURIComponent(path.basename(filePath))}"`
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    return;
  }

  // 3. 生成先行导读 Slide 幻灯片（带本地缓存）
  if (req.method === 'POST' && pathname === '/api/ai/slides') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { bookTitle, author, sampleText, chapters = [] } = JSON.parse(body);
        const cacheKey = crypto.createHash('md5').update(`${bookTitle}_${author}_${chapters.slice(0, 10).join('_')}`).digest('hex');
        const cacheFile = path.join(SLIDES_CACHE_DIR, `${cacheKey}.json`);

        // 优先读取本地缓存
        if (fs.existsSync(cacheFile)) {
          const cachedSlides = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, fromCache: true, slides: cachedSlides }));
          return;
        }

        // 调用 AI 生成
        const prompt = `你是一位顶级的读书导师。请为图书《${bookTitle}》（作者：${author || '未知'}）提炼一套 5~6 页精练震撼的【先行导读 Slide 幻灯片】。
要求以 JSON 数组格式直接输出（不要包裹多余 markdown 代码块），包含以下 5~6 个 Slide 对象：
1. 灵魂一句话（slogan、核心价值）
2. 知识/脉络全景图（3~4个核心骨架）
3. 核心概念/人物图谱（关键术语或出场核心人物简明解析）
4. 核心矛盾与思维冲击点（最精彩、最具冲击力的洞见）
5. 带着这3个问题去读（引导深入思考的关键问题）

示例格式：
[
  {
    "type": "intro",
    "tag": "灵魂速览",
    "title": "一句话核心认知",
    "subtitle": "...",
    "bullets": ["要点1...", "要点2..."]
  },
  ...
]

参考章节目录：
${chapters.slice(0, 30).join('\\n')}

参考前言/样章正文：
${(sampleText || '').slice(0, 1500)}`;

        const reply = await callLLM([{ role: 'user', content: prompt }], 0.6, 2000);
        let slides = null;
        try {
          const jsonMatch = reply.match(/\[\s*\{[\s\S]*\}\s*\]/);
          if (jsonMatch) {
            slides = JSON.parse(jsonMatch[0]);
          } else {
            slides = JSON.parse(reply);
          }
        } catch (e) {
          console.error('解析 Slide JSON 失败，使用格式化回退:', reply);
          slides = [
            { type: "intro", tag: "灵魂速览", title: bookTitle, subtitle: `作者：${author || '未知'}`, bullets: ["欢迎开启本书精读之旅", "点击下一页查看全书要点"] },
            { type: "overview", tag: "全书导览", title: "导读要点", bullets: [reply.slice(0, 300)] }
          ];
        }

        // 写入本地缓存
        fs.writeFileSync(cacheFile, JSON.stringify(slides, null, 2), 'utf8');

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, fromCache: false, slides }));
      } catch (err) {
        console.error('生成 Slide 失败:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 4. 伴读 AI 问答 / 费曼大白话 / 章节测验
  if (req.method === 'POST' && pathname === '/api/ai/chat') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { messages, temperature = 0.7, max_tokens = 2000 } = JSON.parse(body);
        const reply = await callLLM(messages, temperature, max_tokens);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, reply }));
      } catch (err) {
        console.error('AI 对话失败:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 5. 保存笔记 / 读后感到 Obsidian 库
  if (req.method === 'POST' && pathname === '/api/obsidian/save') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { vaultType = 'reading', subfolder = '', fileName, content, append = false } = JSON.parse(body);
        const targetVault = vaultType === 'study' ? config.studyVault : config.readingVault;
        
        let targetDir = targetVault;
        if (subfolder && subfolder.trim()) {
          targetDir = path.join(targetVault, subfolder.trim());
        }
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        const safeFileName = (fileName.endsWith('.md') ? fileName : `${fileName}.md`).replace(/[\/\\:*?"<>|]/g, '_');
        const targetFilePath = path.join(targetDir, safeFileName);

        if (append && fs.existsSync(targetFilePath)) {
          fs.appendFileSync(targetFilePath, `\n\n${content}`, 'utf8');
        } else {
          fs.writeFileSync(targetFilePath, content, 'utf8');
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, savedPath: targetFilePath }));
      } catch (err) {
        console.error('保存 Obsidian 失败:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 6. 获取 Obsidian 目录分类列表
  if (req.method === 'GET' && pathname === '/api/obsidian/folders') {
    const readingFolders = getVaultFolders(config.readingVault);
    const studyFolders = getVaultFolders(config.studyVault);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, readingFolders, studyFolders }));
    return;
  }

  // 7. 读取或更新配置
  if (req.method === 'GET' && pathname === '/api/config') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      config: {
        ...config,
        apiKeyMasked: config.apiKey ? `${config.apiKey.slice(0, 10)}...${config.apiKey.slice(-6)}` : ''
      }
    }));
    return;
  }
  if (req.method === 'POST' && pathname === '/api/config') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const newConf = JSON.parse(body);
        config = { ...config, ...newConf };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, config }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 8. 默认服务前端 SPA HTML
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    const htmlPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(htmlPath).pipe(res);
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
});

const PORT = config.port || 3721;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 智学伴读 · 本地直读工作台已成功启动！`);
  console.log(`📖 访问地址: http://127.0.0.1:${PORT}`);
  console.log(`📂 书库源头: ${config.ebookDir}`);
  console.log(`📝 读后归宿: ${config.readingVault}`);
  console.log(`🎓 智学归宿: ${config.studyVault}`);
  console.log(`🤖 AI 模型 : FreeLLMAPI (${config.model})`);
  console.log(`======================================================\n`);
});
