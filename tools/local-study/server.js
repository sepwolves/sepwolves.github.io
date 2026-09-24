const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

// 默认配置
const CONFIG_FILE = path.join(__dirname, 'config.json');
const CACHE_DIR = path.join(__dirname, '.cache');
const SLIDES_CACHE_DIR = path.join(CACHE_DIR, 'slides');
const SCORES_FILE = path.join(CACHE_DIR, 'quiz-scores.json');

[CACHE_DIR, SLIDES_CACHE_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

let config = {
  port: 3721,
  ebookDir: 'D:\\OneDrive - SkyMan\\个人文件\\我的文档\\我的电子书',
  readingVault: 'D:\\Remotely-save\\读后',
  studyVault: 'D:\\Remotely-save\\学习\\学习库',
  apiBaseUrl: 'http://140.245.65.111:3005/v1',
  apiKey: 'freellmapi-5970cc45963020cb59754a87d5fd0fd7d3b8f373c8c19bed',
  model: 'auto',
  studyIgnoreFolders: ['Excalidraw', '_debug_remotely_save', '_指令集', '_templates', '_script', 'copilot', 'Clippings', '使用手册']
};

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
    } catch (e) {}
  }

  traverse(baseDir, 1);
  return books;
}

// 扫描学习库主题与笔记
function scanStudyTopics(vaultDir) {
  const categories = [];
  if (!fs.existsSync(vaultDir)) return categories;

  const categoryMap = {
    'ai的学习': { name: '人工智能与前沿', icon: '🤖', order: 1 },
    '_当前学习': { name: '当前重点钻研', icon: '🔥', order: 0 },
    '风投学习': { name: '风险投资与商业', icon: '💼', order: 2 },
    '数学学习': { name: '高等数学与分析', icon: '📐', order: 3 },
    '概率论': { name: '概率论与数理统计', icon: '🎲', order: 4 },
    '相对论': { name: '现代物理与相对论', icon: '🌌', order: 5 },
    '量化交易学习': { name: '量化交易与金融', icon: '📈', order: 6 },
    '逻辑学习': { name: '逻辑学与思维模型', icon: '💡', order: 7 },
    '计算机操作': { name: '计算机与开发系统', icon: '💻', order: 8 },
    '群论': { name: '抽象代数与群论', icon: '🧩', order: 9 },
    '傅利叶变换': { name: '信号与傅利叶变换', icon: '〰️', order: 10 }
  };

  const defaultIgnore = ['Excalidraw', '_debug_remotely_save', '_指令集', '_templates', '_script', 'copilot', 'Clippings', '使用手册'];
  const ignoreList = Array.isArray(config.studyIgnoreFolders) ? config.studyIgnoreFolders : defaultIgnore;

  try {
    const rootDirs = fs.readdirSync(vaultDir, { withFileTypes: true })
      .filter(d => {
        if (!d.isDirectory()) return false;
        if (d.name.startsWith('.')) return false;
        if (ignoreList.includes(d.name)) return false;
        if (d.name.startsWith('_') && d.name !== '_当前学习') return false;
        return true;
      });

    for (const d of rootDirs) {
      const folderName = d.name;
      const fullDir = path.join(vaultDir, folderName);
      const notes = [];

      function getMdFiles(subDir) {
        try {
          const items = fs.readdirSync(subDir, { withFileTypes: true });
          for (const it of items) {
            const p = path.join(subDir, it.name);
            if (it.isDirectory() && !it.name.startsWith('.')) {
              getMdFiles(p);
            } else if (it.isFile() && it.name.endsWith('.md')) {
              let stat = null;
              try { stat = fs.statSync(p); } catch (e) {}
              notes.push({
                name: path.basename(it.name, '.md'),
                fileName: it.name,
                fullPath: p,
                relPath: path.relative(vaultDir, p).replace(/\\/g, '/'),
                size: stat ? stat.size : 0,
                mtime: stat ? stat.mtimeMs : 0
              });
            }
          }
        } catch (e) {}
      }

      getMdFiles(fullDir);

      if (notes.length > 0) {
        const meta = categoryMap[folderName] || { name: folderName, icon: '📚', order: 50 };
        categories.push({
          folder: folderName,
          title: meta.name,
          icon: meta.icon,
          order: meta.order,
          notesCount: notes.length,
          notes: notes
        });
      }
    }

    // 扫描根目录下的独立 md 笔记
    const rootNotes = fs.readdirSync(vaultDir, { withFileTypes: true })
      .filter(f => f.isFile() && f.name.endsWith('.md') && !f.name.startsWith('.'))
      .map(f => {
        const p = path.join(vaultDir, f.name);
        return {
          name: path.basename(f.name, '.md'),
          fileName: f.name,
          fullPath: p,
          relPath: f.name,
          size: 0,
          mtime: 0
        };
      });

    if (rootNotes.length > 0) {
      categories.push({
        folder: '根目录',
        title: '核心综述笔记',
        icon: '📑',
        order: 99,
        notesCount: rootNotes.length,
        notes: rootNotes
      });
    }
  } catch (e) {
    console.error('扫描学习库失败:', e);
  }

  return categories.sort((a, b) => a.order - b.order);
}

// 健壮 JSON 提取与修复算法（防截断与格式干扰）
function cleanAndParseJSON(text) {
  let clean = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  clean = clean.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  // 1. 尝试直接解析
  try {
    return JSON.parse(clean);
  } catch (e) {}

  // 2. 截取 [ ... ] 闭合段
  const startArr = clean.indexOf('[');
  const endArr = clean.lastIndexOf(']');
  if (startArr !== -1 && endArr > startArr) {
    try {
      return JSON.parse(clean.substring(startArr, endArr + 1));
    } catch (e) {}
  }

  // 3. 截取 { ... } 闭合段
  const startObj = clean.indexOf('{');
  const endObj = clean.lastIndexOf('}');
  if (startObj !== -1 && endObj > startObj) {
    try {
      return JSON.parse(clean.substring(startObj, endObj + 1));
    } catch (e) {}
  }

  // 4. 若末尾因 token 耗尽被截断，自动修补闭合
  if (startArr !== -1) {
    const sub = clean.slice(startArr);
    const lastBrace = sub.lastIndexOf('}');
    if (lastBrace !== -1) {
      try {
        const repaired = sub.slice(0, lastBrace + 1) + ']';
        return JSON.parse(repaired);
      } catch (e) {}
    }
  }

  return null;
}

// 调用 FreeLLMAPI (OpenAI 兼容协议)
async function callLLM(messages, temperature = 0.7, max_tokens = 3500) {
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

  // 1. 获取图书列表
  if (req.method === 'GET' && pathname === '/api/books') {
    const books = scanEbooks(config.ebookDir);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, count: books.length, books }));
    return;
  }

  // 2. 获取学习库学科与资料列表
  if (req.method === 'GET' && pathname === '/api/study/topics') {
    const categories = scanStudyTopics(config.studyVault);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, categories }));
    return;
  }

  // 3. 读取单个学习笔记正文
  if (req.method === 'GET' && pathname === '/api/study/note') {
    const filePath = parsedUrl.query.path;
    if (!filePath || !fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '笔记未找到' }));
      return;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(content);
    return;
  }

  // 4. 流式读取指定图书文件
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

  // 5. 生成高质感先行导读 Slide 幻灯片秀（严格 5~6 页，绝不返回源码）
  if (req.method === 'POST' && pathname === '/api/ai/slides') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { bookTitle, author, sampleText, chapters = [] } = JSON.parse(body);
        const cacheKey = crypto.createHash('md5').update(`${bookTitle}_${author}_v2`).digest('hex');
        const cacheFile = path.join(SLIDES_CACHE_DIR, `${cacheKey}.json`);

        // 优先读取本地有效缓存
        if (fs.existsSync(cacheFile)) {
          try {
            const cachedSlides = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            if (Array.isArray(cachedSlides) && cachedSlides.length >= 4) {
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ success: true, fromCache: true, slides: cachedSlides }));
              return;
            }
          } catch(e) {}
        }

        // 调用 AI 生成 5~6 页纯粹 JSON
        const prompt = `你是一位顶尖图书精读导师与认知心理学专家。请为《${bookTitle}》（作者：${author || '未知'}）提炼一套 5~6 页精美震撼的【先行导读 Slide 幻灯片】。
要求严格输出合法的 JSON 数组，严禁包含任何前缀、解释文字或 markdown 代码块标记。
JSON 数组必须严格包含以下 5~6 个 Slide 对象：

[
  {
    "tag": "灵魂一句话",
    "title": "全书一句话认知（Slogan）",
    "subtitle": "作者写作主旨与时代背景",
    "bullets": [
      "核心洞见：精炼提炼一句话（30字内）",
      "解决痛点：这本书为解决什么认知困惑而生",
      "价值升华：读完后能获得怎样的思维飞跃"
    ]
  },
  {
    "tag": "全景知识树",
    "title": "逻辑骨架与递进脉络",
    "subtitle": "全书结构全景导览",
    "bullets": [
      "第一阶段：铺垫与起因（核心线索）",
      "第二阶段：激化与发展（关键转折）",
      "第三阶段：高潮与升华（终极结论）"
    ]
  },
  {
    "tag": "核心要素图谱",
    "title": "核心人物 / 关键概念深度解读",
    "subtitle": "读懂全书的基石概念",
    "bullets": [
      "要素一：核心主角/首要概念的本质特征",
      "要素二：冲突对立方/次要概念的相互作用",
      "要素三：底层驱动法则（运行机制）"
    ]
  },
  {
    "tag": "思维冲击点",
    "title": "最具张力的矛盾与反直觉结论",
    "subtitle": "打破常理的震撼洞见",
    "bullets": [
      "冲突焦点：最引人深思的核心争论点",
      "反常识洞察：书中揭示的真相为何颠覆传统认知",
      "警示意义：给现代人的警醒与反思"
    ]
  },
  {
    "tag": "带着问题去读",
    "title": "3 个启发式引导问题",
    "subtitle": "带着疑问探索，吸收率提升10倍",
    "bullets": [
      "问题 1：关于动机与选择的深层提问？",
      "问题 2：关于因果与机制的关键提问？",
      "问题 3：联系现实自身生活的反思提问？"
    ]
  }
]

参考章节目录：
${chapters.slice(0, 25).join('\\n')}

参考前言/背景正文：
${(sampleText || '').slice(0, 1500)}`;

        const reply = await callLLM([{ role: 'user', content: prompt }], 0.5, 3500);
        let slides = cleanAndParseJSON(reply);

        // 如果解析失败，进行结构化托底生成，绝不显示生硬源码
        if (!slides || !Array.isArray(slides) || slides.length < 3) {
          slides = [
            {
              tag: "灵魂一句话",
              title: bookTitle,
              subtitle: `作者：${author || '精选经典'}`,
              bullets: [
                "一部直击事物底层运行规律与人性本质的经典力作",
                "打破传统思维定势，提供高维度的认知视野与思考框架",
                "建议精读关键转折章节，体会作者严密的逻辑推演"
              ]
            },
            {
              tag: "全景知识树",
              title: "脉络与结构框架",
              subtitle: "通览核心骨架",
              bullets: [
                "起点：背景铺垫与核心命题的确立",
                "推进：矛盾的多维度展开与深度博弈",
                "升华：全书终极思想的凝练与回响"
              ]
            },
            {
              tag: "核心要素图谱",
              title: "关键角色与核心概念",
              subtitle: "抓住理解本书的钥匙",
              bullets: [
                "核心驱动力：推动全书事件演进的关键动力",
                "关键关系网：主要力量之间的制衡与互动",
                "核心概念：贯穿始终的专有名词与哲学基底"
              ]
            },
            {
              tag: "思维冲击点",
              title: "反直觉与震撼洞察",
              subtitle: "思想的淬炼之地",
              bullets: [
                "打破表面假象：揭开繁杂现象背后的必然规律",
                "深层矛盾：理想与现实、理性与感性的极限拉扯",
                "现实镜像：书中情境在当下生活中的投射"
              ]
            },
            {
              tag: "带着问题去读",
              title: "3 个深度思考问题",
              subtitle: "带着黄金问题开启精读",
              bullets: [
                "问题 1：如果处在主角/当事人的困境，你会做出怎样的抉择？",
                "问题 2：驱动这一系列演进的根本逻辑究竟是什么？",
                "问题 3：本书提出的见解，能为我当前的生活或工作提供何种指导？"
              ]
            }
          ];
        }

        // 写入本地有效缓存
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

  // 6. 交互式智能测验生成（生成选择题并支持交互答题与评分）
  if (req.method === 'POST' && pathname === '/api/ai/interactive-quiz') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { title, content } = JSON.parse(body);
        const prompt = `你是一位严格且善于启发思考的特级学术测验导师。请根据以下资料内容，出 3~4 道高质量的【单项选择题】，检验学习者是否真正理解了核心逻辑与机制。

要求：
1. 严禁死记硬背字句，必须考查“因果逻辑”、“机制推导”、“核心概念辨析”或“实际推论”；
2. 必须以严格合法的 JSON 数组格式直接输出，严禁任何代码块标记（不要带 \`\`\`json）或多余废话；
3. 每个题目对象严格包含以下字段：
   - "id": 序号 (1, 2, 3...)
   - "question": 题干描述（清晰、有深度）
   - "options": 4个选项数组，如 ["A. ...", "B. ...", "C. ...", "D. ..."]
   - "answer": 正确选项的数字索引（0 代表 A，1 代表 B，2 代表 C，3 代表 D）
   - "explanation": 详细解析（说明为什么选该项，并指出错误选项的破绽与原文逻辑依据）

资料内容：
标题：${title}
正文截取：
${(content || '').slice(0, 2500)}`;

        const reply = await callLLM([{ role: 'user', content: prompt }], 0.4, 3000);
        let questions = cleanAndParseJSON(reply);

        if (!questions || !Array.isArray(questions) || questions.length === 0) {
          questions = [
            {
              id: 1,
              question: `关于《${title}》的核心逻辑，下列哪项理解最为准确？`,
              options: [
                "A. 必须立足于底层逻辑与因果推演，而非表面现象",
                "B. 只需记住结论，无需深究其中的运行机制",
                "C. 概念之间彼此孤立，互不产生影响",
                "D. 任何规律都无法在现实实践中进行迁移应用"
              ],
              answer: 0,
              explanation: "深入学习的核心在于掌握系统底层的运转机理与因果链条，从而建立可迁移的思维模型。"
            }
          ];
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, questions }));
      } catch (err) {
        console.error('生成交互测验失败:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 7. 记录并保存测验成绩与错题历史
  if (req.method === 'POST' && pathname === '/api/study/record-score') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const record = JSON.parse(body);
        let history = [];
        if (fs.existsSync(SCORES_FILE)) {
          try { history = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8')); } catch(e) {}
        }
        record.id = Date.now();
        record.date = new Date().toLocaleString();
        history.unshift(record);
        fs.writeFileSync(SCORES_FILE, JSON.stringify(history.slice(0, 100), null, 2), 'utf8');

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, record }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 8. 获取测验成绩历史记录
  if (req.method === 'GET' && pathname === '/api/study/scores') {
    let history = [];
    if (fs.existsSync(SCORES_FILE)) {
      try { history = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8')); } catch(e) {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, scores: history }));
    return;
  }

  // 9. 伴读 AI 自由对话 / 费曼大白话拆解
  if (req.method === 'POST' && pathname === '/api/ai/chat') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { messages, temperature = 0.7, max_tokens = 2500 } = JSON.parse(body);
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

  // 10. 保存笔记到 Obsidian 读后库或学习库
  if (req.method === 'POST' && pathname === '/api/obsidian/save') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
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

  // 11. 读取或更新配置
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

  // 12. 静态页面分发
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
