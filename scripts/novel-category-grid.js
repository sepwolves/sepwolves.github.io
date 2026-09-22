'use strict';

/**
 * 「小说 / 各部小说」分类页的通用定制呈现：
 *   - 网格状卡片布局（复用 Butterfly 首页的 recent-post 卡片组件）
 *   - 按章节序号正序排列（第1章 → 第N章），而不是默认的日期倒序
 *   - 去掉侧边栏，网格占满整行
 *
 * 自动识别属于「小说」子分类的分类页，其他普通分类页保持 Butterfly 默认的归档列表样式。
 */

const fs = require('fs');
const path = require('path');

// 自定义布局：源文件在 source/_layouts/，构建期复制进主题
const VIEW_NAME = 'category-grid';
const VIEW_SRC = path.join(hexo.base_dir, 'source', '_layouts', VIEW_NAME + '.pug');

function isNovelPost(post) {
  if (!post) return false;
  if (post.type === 'novel') return true;
  if (post.source) {
    const s = post.source.replace(/\\/g, '/');
    if (s.includes('novels/') || s.includes('fan-yuan-fu-song')) return true;
  }
  if (post.categories && post.categories.length) {
    const cats = post.categories.toArray ? post.categories.toArray() : post.categories;
    if (cats.some(c => c && (c.name === '小说' || (c.parent && typeof c.parent === 'object' && c.parent.name === '小说')))) {
      return true;
    }
  }
  if (post.series && post.series.includes('目录')) return true;
  return false;
}

function extractChapterNumber(title) {
  if (!title) return Number.MAX_SAFE_INTEGER;
  const cn = title.match(/第\s*(\d+)\s*章/);
  if (cn) return parseInt(cn[1], 10);
  const leading = title.match(/^(\d+)\s*[_\-.\s]/);
  if (leading) return parseInt(leading[1], 10);
  const any = title.match(/(\d+)/);
  if (any) return parseInt(any[1], 10);
  return Number.MAX_SAFE_INTEGER;
}

// 构建前把布局复制进主题目录，并注册进视图表
hexo.extend.filter.register('before_generate', function () {
  if (!fs.existsSync(VIEW_SRC)) {
    hexo.log.warn('[novel-category-grid] 布局源文件不存在: %s', VIEW_SRC);
    return;
  }

  const themeLayoutDir = path.join(hexo.theme_dir, 'layout');
  const dest = path.join(themeLayoutDir, VIEW_NAME + '.pug');

  try {
    fs.mkdirSync(themeLayoutDir, { recursive: true });
    fs.copyFileSync(VIEW_SRC, dest);
    hexo.theme.setView(VIEW_NAME + '.pug', fs.readFileSync(dest, 'utf8'));
    hexo.log.debug('[novel-category-grid] 布局已注入: %s', dest);
  } catch (err) {
    hexo.log.error('[novel-category-grid] 注入布局失败: %s', err.message);
  }
}, 1);

hexo.extend.generator.register('novel_category_grid', function (locals) {
  const pages = [];

  locals.categories.forEach(category => {
    // 顶级汇总「小说」分类跳过或交给导航页，只针对具体小说（如「反元复宋」、「我靠做梦成了股神」等）
    if (category.name === '小说') return;

    const posts = category.posts.toArray();
    const novelPosts = posts.filter(p => isNovelPost(p));
    if (novelPosts.length === 0) return;

    novelPosts.sort((a, b) => {
      const na = extractChapterNumber(a.title);
      const nb = extractChapterNumber(b.title);
      if (na !== nb) return na - nb;
      return a.date - b.date;
    });

    pages.push({
      path: category.path,
      layout: [VIEW_NAME],
      data: {
        // 刻意不传 `category` 字段，否则主题会强制打开侧边栏
        type: 'novel-grid',
        categoryName: category.name,
        posts: novelPosts,
        current: 1,
        total: 1,
        page: 1,
        prev: 0,
        next: 0,
        prev_link: '',
        next_link: '',
        aside: false
      }
    });
  });

  return pages;
});
