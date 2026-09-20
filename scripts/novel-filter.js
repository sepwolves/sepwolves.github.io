'use strict';

const fs = require('fs');
const path = require('path');
const pagination = require('hexo-pagination');

/**
 * 判定文章是否为小说章节：
 * 1. 物理路径位于 fan-yuan-fu-song 目录下
 * 2. 分类包含「反元复宋」或「小说」
 */
function isNovelPost(post) {
  if (!post) return false;
  if (post.source && post.source.includes('fan-yuan-fu-song')) return true;
  if (post.categories && post.categories.length) {
    const cats = post.categories.toArray ? post.categories.toArray() : post.categories;
    if (cats.some(c => c && (c.name === '反元复宋' || c.name === '小说'))) return true;
  }
  return false;
}

/**
 * 从章节标题提取章节序号
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

// 缓存排好序的全部小说章节列表
let cachedNovelChapters = [];

// ==========================================
// 1. 注册模板 Helper
// ==========================================
hexo.extend.helper.register('isNovelPage', function (page) {
  return isNovelPost(page);
});

hexo.extend.helper.register('getNovelChapters', function () {
  if (cachedNovelChapters.length > 0) return cachedNovelChapters;
  const Post = hexo.model('Post');
  const novels = Post.filter(p => isNovelPost(p)).toArray();
  novels.sort((a, b) => {
    const na = extractChapterNumber(a.title);
    const nb = extractChapterNumber(b.title);
    if (na !== nb) return na - nb;
    return a.date - b.date;
  });
  cachedNovelChapters = novels.map(p => ({
    title: p.title,
    path: p.path,
    date: p.date ? p.date.valueOf() : 0
  }));
  return cachedNovelChapters;
});

// ==========================================
// 2. 首页生成器：彻底排除小说章节
// ==========================================
hexo.extend.generator.register('index', function (locals) {
  const config = this.config;
  const posts = locals.posts.filter(post => !isNovelPost(post)).sort(config.index_generator.order_by);
  posts.data.sort((a, b) => (b.sticky || 0) - (a.sticky || 0));

  const paginationDir = config.index_generator.pagination_dir || config.pagination_dir || 'page';
  const path = config.index_generator.path || '';

  return pagination(path, posts, {
    perPage: config.index_generator.per_page,
    layout: config.index_generator.layout || ['index', 'archive'],
    format: paginationDir + '/%d/',
    data: {
      __index: true
    }
  });
});

// ==========================================
// 3. 归档生成器：归档时间轴排除小说章节
// ==========================================
const fmtNum = num => num.toString().padStart(2, '0');

hexo.extend.generator.register('archive', function (locals) {
  const { config } = this;
  let archiveDir = config.archive_dir;
  const paginationDir = config.pagination_dir || 'page';
  const allPosts = locals.posts.filter(post => !isNovelPost(post)).sort(config.archive_generator.order_by || '-date');
  const perPage = config.archive_generator.per_page;
  const result = [];

  if (!allPosts.length) return;

  if (archiveDir[archiveDir.length - 1] !== '/') archiveDir += '/';

  function generate(path, posts, options = {}) {
    options.archive = true;

    result.push(...pagination(path, posts, {
      perPage,
      layout: ['archive', 'index'],
      format: paginationDir + '/%d/',
      data: options
    }));
  }

  generate(archiveDir, allPosts);

  if (!config.archive_generator.yearly) return result;

  const posts = {};

  allPosts.forEach(post => {
    const date = post.date;
    const year = date.year();
    const month = date.month() + 1;

    if (!Object.prototype.hasOwnProperty.call(posts, year)) {
      posts[year] = [
        [], [], [], [], [], [], [], [], [], [], [], [], []
      ];
    }

    posts[year][0].push(post);
    posts[year][month].push(post);

    if (config.archive_generator.daily) {
      const day = date.date();
      if (!Object.prototype.hasOwnProperty.call(posts[year][month], 'day')) {
        posts[year][month].day = {};
      }
      (posts[year][month].day[day] || (posts[year][month].day[day] = [])).push(post);
    }
  });

  const { Query } = this.model('Post');
  const years = Object.keys(posts);
  let year, data, month, monthData, url;

  for (let i = 0, len = years.length; i < len; i++) {
    year = +years[i];
    data = posts[year];
    url = archiveDir + year + '/';
    if (!data[0].length) continue;

    generate(url, new Query(data[0]), { year });

    if (!config.archive_generator.monthly && !config.archive_generator.daily) continue;

    for (month = 1; month <= 12; month++) {
      monthData = data[month];
      if (!monthData.length) continue;
      if (config.archive_generator.monthly) {
        generate(url + fmtNum(month) + '/', new Query(monthData), {
          year,
          month
        });
      }

      if (!config.archive_generator.daily) continue;

      for (let day = 1; day <= 31; day++) {
        const dayData = monthData.day[day];
        if (!dayData || !dayData.length) continue;
        generate(url + fmtNum(month) + '/' + fmtNum(day) + '/', new Query(dayData), {
          year,
          month,
          day
        });
      }
    }
  }

  return result;
});

// ==========================================
// 4. 模板变量过滤：侧边栏最新文章和文章计数只统计非小说博文
// ==========================================
hexo.extend.filter.register('template_locals', function (locals) {
  if (locals && locals.site && locals.site.posts) {
    locals.site.posts = locals.site.posts.filter(post => !isNovelPost(post));
  }
  return locals;
});

// ==========================================
// 5. 渲染过滤：确保小说页面注入 series 标识
// ==========================================
hexo.extend.filter.register('before_post_render', function (data) {
  if (isNovelPost(data)) {
    data.series = '《反元复宋》目录';
  }
  return data;
});

// ==========================================
// 6. before_generate 阶段：
//    - 同步定制 Pug 组件
//    - 初始化小说章节缓存与 hexo._seriesGroups
//    - 劫持并增强 post 生成器（保持与 Butterfly random_cover 兼容）
// ==========================================
const SERIES_VIEW_SRC = path.join(hexo.base_dir, 'source', '_layouts', 'card_post_series.pug');

hexo.extend.filter.register('before_generate', function () {
  const Post = hexo.model('Post');
  const novels = Post.filter(p => isNovelPost(p)).toArray();

  novels.sort((a, b) => {
    const na = extractChapterNumber(a.title);
    const nb = extractChapterNumber(b.title);
    if (na !== nb) return na - nb;
    return a.date - b.date;
  });

  cachedNovelChapters = novels.map(p => ({
    title: p.title,
    path: p.path,
    date: p.date ? p.date.valueOf() : 0
  }));

  // 注入 hexo._seriesGroups 供 Butterfly 内部系列功能使用
  hexo._seriesGroups = hexo._seriesGroups || {};
  hexo._seriesGroups['《反元复宋》目录'] = cachedNovelChapters;

  // 将定制的 card_post_series.pug 同步注入主题 widget 目录与 Hexo theme view 缓存
  if (fs.existsSync(SERIES_VIEW_SRC)) {
    const destDir = path.join(hexo.theme_dir, 'layout', 'includes', 'widget');
    const dest = path.join(destDir, 'card_post_series.pug');
    try {
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(SERIES_VIEW_SRC, dest);
      const pugContent = fs.readFileSync(SERIES_VIEW_SRC, 'utf8');
      hexo.theme.setView('includes/widget/card_post_series.pug', pugContent);
    } catch (err) {
      hexo.log.error('[novel-filter] 注入 card_post_series.pug 失败: %s', err.message);
    }
  }

  // 劫持 post 生成器：在 Butterfly random_cover 处理完成后，
  // 隔离普通文章与小说章节的上一篇/下一篇互联，并为小说章节绑定 series
  const origPostGen = hexo.extend.generator.get('post');
  if (origPostGen) {
    hexo.extend.generator.register('post', function (locals) {
      return Promise.resolve(origPostGen.call(this, locals)).then(posts => {
        const regular = [];
        const novel = [];

        for (let i = 0; i < posts.length; i++) {
          const item = posts[i];
          if (isNovelPost(item.data)) {
            novel.push(item);
          } else {
            regular.push(item);
          }
        }

        // 小说章节严格按序号正序排序
        novel.sort((a, b) => {
          const na = extractChapterNumber(a.data.title);
          const nb = extractChapterNumber(b.data.title);
          if (na !== nb) return na - nb;
          return a.data.date - b.data.date;
        });

        // 普通博文按时间顺序相连
        for (let i = 0; i < regular.length; i++) {
          regular[i].data.prev = i > 0 ? regular[i - 1].data : null;
          regular[i].data.next = i < regular.length - 1 ? regular[i + 1].data : null;
        }

        // 小说章节只在小说章节间按章节序号正序跳转 (配合 Butterfly 默认 post_pagination: 1)
        for (let i = 0; i < novel.length; i++) {
          novel[i].data.series = '《反元复宋》目录';
          novel[i].data.next = i > 0 ? novel[i - 1].data : null;
          novel[i].data.prev = i < novel.length - 1 ? novel[i + 1].data : null;
        }

        return posts;
      });
    });
  }
}, 100);

// ==========================================
// 7. 增强 groupPosts helper，保证章节目录严格按章节数字正序排列 (1 -> 100)
// ==========================================
hexo.extend.helper.register('groupPosts', function () {
  const groups = hexo._seriesGroups || {};
  const result = {};

  Object.keys(groups).forEach(key => {
    const arr = groups[key].slice();
    arr.sort((a, b) => {
      const na = extractChapterNumber(a.title);
      const nb = extractChapterNumber(b.title);
      if (na !== nb) return na - nb;
      return a.date - b.date;
    });
    result[key] = arr;
  });

  return result;
});
