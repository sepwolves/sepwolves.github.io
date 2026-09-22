'use strict';

const fs = require('fs');
const path = require('path');
const pagination = require('hexo-pagination');

/**
 * 判定文章是否为小说章节：
 * 1. 物理路径位于 novels/ 目录下或历史 fan-yuan-fu-song 目录
 * 2. 分类包含「小说」或属于小说的子分类
 * 3. 具有 type: novel 或 series 标记
 */
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

/**
 * 从文章中解析具体的小说书名：
 * 依次尝试：post.book -> series -> categories 中「小说」后面的子分类 -> source 路径 -> 默认小说
 */
function getBookName(post) {
  if (!post) return '默认作品';
  if (post.book) return post.book;
  if (post.series) {
    const m = post.series.match(/《(.*?)》/);
    if (m) return m[1];
  }
  if (post.categories && post.categories.length) {
    const cats = post.categories.toArray ? post.categories.toArray() : post.categories;
    const catNames = cats.map(c => (typeof c === 'string' ? c : c.name)).filter(Boolean);
    const novelIdx = catNames.indexOf('小说');
    if (novelIdx !== -1 && novelIdx + 1 < catNames.length) {
      return catNames[novelIdx + 1];
    }
    for (const name of catNames) {
      if (name !== '小说') return name;
    }
  }
  if (post.source) {
    const s = post.source.replace(/\\/g, '/');
    const m = s.match(/novels\/([^/]+)/);
    if (m) return m[1];
    if (s.includes('fan-yuan-fu-song')) return '反元复宋';
  }
  return '反元复宋';
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

// 缓存排好序的全部小说章节（按书名分桶）
let cachedNovelChaptersByBook = {};

// ==========================================
// 1. 注册模板 Helper
// ==========================================
hexo.extend.helper.register('isNovelPage', function (page) {
  return isNovelPost(page || this.page);
});

hexo.extend.helper.register('getBookName', function (page) {
  return getBookName(page || this.page);
});

hexo.extend.helper.register('getNovelChapters', function (page) {
  const currentPost = page || this.page;
  const bookName = getBookName(currentPost);
  if (cachedNovelChaptersByBook[bookName] && cachedNovelChaptersByBook[bookName].length > 0) {
    return cachedNovelChaptersByBook[bookName];
  }

  const Post = hexo.model('Post');
  const novels = Post.filter(p => isNovelPost(p) && getBookName(p) === bookName).toArray();
  novels.sort((a, b) => {
    const na = extractChapterNumber(a.title);
    const nb = extractChapterNumber(b.title);
    if (na !== nb) return na - nb;
    return a.date - b.date;
  });
  const chapters = novels.map(p => ({
    title: p.title,
    path: p.path,
    date: p.date ? p.date.valueOf() : 0
  }));
  cachedNovelChaptersByBook[bookName] = chapters;
  return chapters;
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
// 5. 渲染过滤：确保小说页面动态注入对应的 series 标识
// ==========================================
hexo.extend.filter.register('before_post_render', function (data) {
  if (isNovelPost(data)) {
    const bookName = getBookName(data);
    data.series = `《${bookName}》目录`;
  }
  return data;
});

// ==========================================
// 6. before_generate 阶段：
//    - 同步定制 Pug 组件
//    - 按小说书名分组初始化章节缓存与 hexo._seriesGroups
//    - 劫持并增强 post 生成器：实现同部小说章节正序互联
// ==========================================
const SERIES_VIEW_SRC = path.join(hexo.base_dir, 'source', '_layouts', 'card_post_series.pug');

hexo.extend.filter.register('before_generate', function () {
  const Post = hexo.model('Post');
  const allNovels = Post.filter(p => isNovelPost(p)).toArray();

  cachedNovelChaptersByBook = {};
  hexo._seriesGroups = hexo._seriesGroups || {};

  const novelsByBook = {};
  allNovels.forEach(p => {
    const bName = getBookName(p);
    if (!novelsByBook[bName]) novelsByBook[bName] = [];
    novelsByBook[bName].push(p);
  });

  Object.keys(novelsByBook).forEach(bName => {
    const list = novelsByBook[bName];
    list.sort((a, b) => {
      const na = extractChapterNumber(a.title);
      const nb = extractChapterNumber(b.title);
      if (na !== nb) return na - nb;
      return a.date - b.date;
    });

    const chapters = list.map(p => ({
      title: p.title,
      path: p.path,
      date: p.date ? p.date.valueOf() : 0
    }));

    cachedNovelChaptersByBook[bName] = chapters;
    hexo._seriesGroups[`《${bName}》目录`] = chapters;
  });

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

  // 劫持 post 生成器：按小说分组管理上一篇/下一篇跳转
  const origPostGen = hexo.extend.generator.get('post');
  if (origPostGen) {
    hexo.extend.generator.register('post', function (locals) {
      return Promise.resolve(origPostGen.call(this, locals)).then(posts => {
        const regular = [];
        const novelsByBookItems = {};

        for (let i = 0; i < posts.length; i++) {
          const item = posts[i];
          if (isNovelPost(item.data)) {
            const bName = getBookName(item.data);
            if (!novelsByBookItems[bName]) novelsByBookItems[bName] = [];
            novelsByBookItems[bName].push(item);
          } else {
            regular.push(item);
          }
        }

        // 普通博文按时间顺序相连
        for (let i = 0; i < regular.length; i++) {
          regular[i].data.prev = i > 0 ? regular[i - 1].data : null;
          regular[i].data.next = i < regular.length - 1 ? regular[i + 1].data : null;
        }

        // 各部小说章节：只在同部小说的章节间按序号正序跳转
        Object.keys(novelsByBookItems).forEach(bName => {
          const bookPosts = novelsByBookItems[bName];
          bookPosts.sort((a, b) => {
            const na = extractChapterNumber(a.data.title);
            const nb = extractChapterNumber(b.data.title);
            if (na !== nb) return na - nb;
            return a.data.date - b.data.date;
          });

          for (let i = 0; i < bookPosts.length; i++) {
            bookPosts[i].data.series = `《${bName}》目录`;
            // Butterfly post_pagination: 1 下，prev 取 next，next 取 prev
            bookPosts[i].data.next = i > 0 ? bookPosts[i - 1].data : null;
            bookPosts[i].data.prev = i < bookPosts.length - 1 ? bookPosts[i + 1].data : null;
          }
        });

        return posts;
      });
    });
  }
}, 100);

// ==========================================
// 7. 增强 groupPosts helper，保证章节目录严格按章节数字正序排列 (1 -> N)
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
