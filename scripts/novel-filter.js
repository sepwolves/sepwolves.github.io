'use strict';

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

// ==========================================
// 1. 首页生成器：彻底排除小说章节
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
// 2. 归档生成器：归档时间轴排除小说章节
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
// 3. 模板变量过滤：侧边栏最新文章和文章计数只统计非小说博文
// ==========================================
hexo.extend.filter.register('template_locals', function (locals) {
  if (locals && locals.site && locals.site.posts) {
    locals.site.posts = locals.site.posts.filter(post => !isNovelPost(post));
  }
  return locals;
});

// ==========================================
// 4. 文章上一篇/下一篇互联：
//    - 普通博文只在普通博文间跳转
//    - 小说章节只在小说章节间按章节序号正序跳转
// ==========================================
hexo.extend.generator.register('post', function (locals) {
  const allPosts = locals.posts.toArray();

  const regularPosts = allPosts.filter(p => !isNovelPost(p)).sort((a, b) => b.date - a.date);
  const novelPosts = allPosts.filter(p => isNovelPost(p)).sort((a, b) => {
    const na = extractChapterNumber(a.title);
    const nb = extractChapterNumber(b.title);
    if (na !== nb) return na - nb;
    return a.date - b.date;
  });

  // 普通博文按时间顺序相连
  for (let i = 0; i < regularPosts.length; i++) {
    regularPosts[i].prev = i > 0 ? regularPosts[i - 1] : null;
    regularPosts[i].next = i < regularPosts.length - 1 ? regularPosts[i + 1] : null;
  }

  // 小说章节按序号正序相连 (配合 Butterfly 默认 post_pagination: 1)
  for (let i = 0; i < novelPosts.length; i++) {
    novelPosts[i].next = i > 0 ? novelPosts[i - 1] : null;
    novelPosts[i].prev = i < novelPosts.length - 1 ? novelPosts[i + 1] : null;
  }

  return allPosts.map(post => {
    const { path, layout } = post;
    if (!layout || layout === 'false') {
      return { path, data: post.content };
    }
    const layouts = ['post', 'page', 'index'];
    if (layout !== 'post') layouts.unshift(layout);
    post.__post = true;
    return {
      path,
      layout: layouts,
      data: post
    };
  });
});
