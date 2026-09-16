'use strict';

/**
 * 「小说 / 反元复宋」分类页的定制呈现：
 *   - 网格状卡片布局（复用 Butterfly 首页的 recent-post 卡片组件）
 *   - 按章节序号正序排列（第1章 → 第N章），而不是默认的日期倒序
 *   - 去掉侧边栏，网格占满整行
 *
 * 只影响这一个分类页，其他分类页保持 Butterfly 默认的归档列表样式。
 *
 * 实现说明（踩过的坑，改之前先读）：
 *   1. Hexo 的 View 构造器把布局路径硬拼在「主题目录/layout/」下
 *      （node_modules/hexo/dist/theme/view.js 第 25 行）。站点根部的 layout/ 不生效，
 *      themes/<主题名>/ 一旦存在又会整包顶掉 npm 主题。所以这里在构建期把布局
 *      从 source/_layouts/ 复制进主题的 layout/ 目录，源码仍留在仓库里。
 *   2. 主题 layout.pug 第 3 行会用 theme.aside.display.category 强制覆盖 page.aside：
 *      只要 getPageType 看到 `category` 字段就返回 'category'，aside: false 会被无视。
 *      因此这里刻意不传 category，改传 type 落到 else 分支，才能关掉侧边栏。
 *   3. 章节正文不在本仓库：CI 会先从 sepwolves/FanYuanFuSong 抓取到
 *      source/_posts/fan-yuan-fu-song/ 再构建，所以排序只能在构建期现算。
 */

const fs = require('fs');
const path = require('path');

// 目标分类名
const TARGET_CATEGORY = '反元复宋';

// 自定义布局：源文件在 source/_layouts/，构建期复制进主题
const VIEW_NAME = 'category-grid';
const VIEW_SRC = path.join(hexo.base_dir, 'source', '_layouts', VIEW_NAME + '.pug');

/**
 * 从标题里抽章节序号，兼容两种命名：
 *   "第24章_工业的筹码"  → 24
 *   "021_初装火铳"       → 21
 * 抽不到时排到最后。
 */
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
  const category = locals.categories.findOne({ name: TARGET_CATEGORY });
  if (!category) return;

  const posts = category.posts.toArray();

  posts.sort((a, b) => {
    const na = extractChapterNumber(a.title);
    const nb = extractChapterNumber(b.title);
    if (na !== nb) return na - nb;
    return a.date - b.date;
  });

  return {
    path: category.path,
    layout: [VIEW_NAME],
    data: {
      // 刻意不传 `category` 字段，否则主题会强制打开侧边栏（见文件头说明 2）
      type: 'novel-grid',
      // 供布局显示分类名
      categoryName: category.name,
      posts: posts,
      current: 1,
      total: 1,
      page: 1,
      prev: 0,
      next: 0,
      prev_link: '',
      next_link: '',
      // 关闭侧边栏
      aside: false
    }
  };
});
