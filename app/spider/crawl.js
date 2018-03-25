'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const log4js = require('log4js');
const queue = require('queue');
const Queue = require('better-queue');
const mkdirp = require('mkdirp');

const Conf = require('./conf');

const PROTOCOL = 'http://';
const HOST = 'music.guqu.net';
const TARGET_URL = `${PROTOCOL}${HOST}`;

const appenders = [ 'app' ];
if (process.env.NODE_ENV === 'development') {
  appenders.unshift('out');
}
log4js.configure({
  appenders: {
    app: {
      type: 'dateFile',
      filename: `logs/${Conf.log.cat}.log`,
      maxLogSize: 20480,
      backups: 10,
    },
    out: {
      type: 'console',
    },
  },
  categories: {
    default: { appenders, level: 'debug' },
  },
});
const logger = log4js.getLogger();

/**
 * 解码 html
 * @param {*} res 待解码页面
 * @param {*} charset 编码
 * @return {string} 解码后页面字符串
 */
function decodeHtml(res, charset = 'utf8') {
  return iconv.decode(res, charset);
}

/**
 * 默认请求头
 */
const defaultHeaders = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.94 Safari/537.36',
  Host: HOST,
  Referer: TARGET_URL,
};


async function crawlHomePage() {
  logger.info('1. 获取主页面...');
  try {
    const homeRes = await axios(TARGET_URL, {
      responseType: 'arraybuffer',
      headers: defaultHeaders,
    });
    const homeRet = decodeHtml(homeRes.data, 'gb2312');
    const $ = cheerio.load(homeRet, {
      normalizeWhitespace: true,
      decodeEntities: false,
    });

    logger.info('  主页面获取成功');

    logger.info('2. 开始分析主页面数据...');
    const $categories = $('.im_c3 dl');
    const ret = [];
    $categories.each((i, category) => {
      ret.push(analyzeCategory($(category)));
    });
    logger.info('  分析主页面数据成功');

    return ret;
  } catch (err) {
    logger.error(`  获取主页面失败, ${err.message}`);
  }
}

function analyzeCategory($category) {
  const $categoryLink = $category.find('.im_tm1 a');
  const url = $categoryLink.attr('href');
  const name = $categoryLink.text();

  return {
    name, url,
  };
}

/**
 * 给 job 生成 id
 * @param {*} fn fn
 * @param {*} id id
 * @return {function} fn
 */
function genIdentifiedJob(fn, id) {
  const _fn = fn;
  _fn.id = id;

  return _fn;
}

// 队列式抓取分类的分页信息
function loadPageInfoOfCategory(list) {
  return new Promise(function(resolve, reject) {
    const q = queue();
    // 单个 job 超时时间
    q.timeout = 5000;
    // job 结果集
    const ret = [];

    list.forEach((item, index) => {
      q.push(genIdentifiedJob(function() {
        return axios(item.url, {
          responseType: 'arraybuffer',
          headers: defaultHeaders,
        }).then(function(res) {
          const html = decodeHtml(res.data, 'gb2312');
          const detail = analyzeCategoryPageInfo(html);
          ret.push(Object.assign({ index }, list[index], detail));
        });
      }, index));
    });

    q.on('success', (result, job) => {
      logger.info(`job-${job.id} 成功`);
    });

    q.on('error', (err, job) => {
      logger.error(`job-${job.id} 出错, ${err.message}`);
    });

    q.on('timeout', (next, job) => {
      logger.error(`job-${job.id} 超时`);
      next();
    });

    q.start(function(err) {
      if (err) {
        logger.error(`jobs 出错: ${err.message}`);

        reject(err);

        return;
      }

      resolve(ret);
    });
  });
}

// 分析详情页面，提取数据
function analyzeCategoryPageInfo(html) {
  const $ = cheerio.load(html, {
    normalizeWhitespace: true,
    decodeEntities: false,
  });
  const $b = $('.showpage b');
  const total = $b.eq(0).text().trim();
  const size = $b.eq(1).text().trim();

  return {
    total,
    size,
    prefix: 'List_',
  };
}

function loadMusicInfos(list) {
  return new Promise(function(resolve) {
    // job 结果集
    let ret = [];
    const q = new Queue(({ url, categoryId, pageId }, cb) => {
      return axios(url, {
        responseType: 'arraybuffer',
        headers: defaultHeaders,
      }).then(function(res) {
        const html = decodeHtml(res.data, 'gb2312');
        const list = analyzeMusicInfo(html, categoryId, pageId);
        ret = ret.concat(list);
        cb(null, list);
      }).catch(function(err) {
        cb(err);
      });
    }, { concurrent: 30 });

    let totalPageCount = 0;

    list.forEach((item, index) => {
      const total = parseInt(item.total);
      const size = parseInt(item.size);
      const count = Math.ceil(total / size);

      totalPageCount += count;

      for (let i = 0; i < count; i++) {
        const page = `${item.prefix}${i}.html`;
        const url = `${item.url}${i === 0 ? '' : page}`;

        q.push({
          id: `${item.name}-${index}-${i}: ${url}`,
          categoryId: item.index,
          pageId: i,
          url,
        });
      }
    });

    q.on('task_finish', function(taskId) {
      logger.info(`job-${taskId} 成功`);
    });

    q.on('task_failed', function(taskId, err) {
      logger.error(`job-${taskId} 出错, ${err.message}`);
    });

    q.on('drain', function() {
      console.log('count: ', totalPageCount);
      resolve(ret);
    });
  });
}

function analyzeMusicInfo(html, categoryId, pageId) {
  const $ = cheerio.load(html, {
    normalizeWhitespace: true,
    decodeEntities: false,
  });
  const $ul = $('.pub .c628 ul').not('.c628title');
  const ret = [];
  $ul.each(function(i, ul) {
    const $a = $(ul).find('div a');
    const author = $(ul).find('span').text();

    const href = $a.attr('href');
    const hrefSplited = href.split('/');
    const id = hrefSplited[hrefSplited.length - 1].replace('.html', '');
    const name = $a.text().split(' ')[0];

    ret.push({
      index: i,
      id,
      name,
      author,
      categoryId,
      pageId,
    });
  });

  return ret;
}

function loadMusicDownloadUrl(musics) {
  return new Promise(function(resolve) {
    // job 结果集
    const ret = [];
    const q = new Queue(({ url, index }, cb) => {
      return axios(url, {
        responseType: 'arraybuffer',
        headers: defaultHeaders,
      }).then(function(res) {
        const html = decodeHtml(res.data, 'gb2312');
        const download = analyzeMusicDownloadUrl(html);
        ret.push(Object.assign({}, musics[index], { download }));
        cb(null, download);
      }).catch(cb);
    }, { concurrent: 30, maxRetries: 10, retryDelay: 1000 });

    musics.forEach(({ id, name }, index) => {
      const url = `http://music.guqu.net/guquplayer1.asp?Musicid=${id}&urlid=1`;
      q.push({
        id: `${name}-${id}: ${url}`,
        url,
        index,
      });
    });

    q.on('task_finish', function(taskId) {
      logger.info(`job-${taskId} 成功`);
    });

    q.on('task_failed', function(taskId, err) {
      logger.error(`job-${taskId} 出错, ${err.message}`);
    });

    q.on('drain', function() {
      resolve(ret);
    });
  });
}

function analyzeMusicDownloadUrl(html) {
  const $ = cheerio.load(html, {
    normalizeWhitespace: true,
    decodeEntities: false,
  });
  return $('#MediaPlayer1 param[name="URL"]').attr('value').trim();
}

function loadMusicFile(dir, downloads, update) {
  return new Promise(function(resolve) {
    // job 结果集
    const ret = [];
    const q = new Queue(({ alias, id, url, type }, cb) => {
      return axios(url, {
        responseType: 'stream',
      }).then(function(res) {
        const filename = path.join(dir, type, `${alias}${path.extname(url)}`);
        mkdirp.sync(path.dirname(filename));
        res.data.pipe(fs.createWriteStream(filename));
        res.data.on('end', () => {
          const r = { id, path: path.join(type, `${alias}${path.extname(url)}`), has_media: 1 };
          ret.push(r);
          update(r);
          cb(null, filename);
        });
      }).catch(cb);
    }, { concurrent: 30, maxRetries: 10, retryDelay: 1000 });

    downloads.forEach(({ id, name, url, type }, index) => {
      q.push({
        alias: `${name}-${id}`,
        url,
        id,
        type,
        index,
      });
    });

    q.on('task_finish', function(taskId) {
      logger.info(`job-${taskId} 成功`);
    });

    q.on('task_failed', function(taskId, err) {
      logger.error(`job-${taskId} 出错, ${err.message}`);
    });

    q.on('drain', function() {
      resolve(ret);
    });
  });
}

// 爬取主流程
async function crawl() {
  try {
    // logger.info('------------ 渗透目标站点 -------------')
    // __cookies = await infiltrate();

    logger.info('------------ 抓取古曲分类列表 -------------');
    const list = await crawlHomePage();
    logger.info(`列表数据：${JSON.stringify(list)}`);

    const targetCrawlCategories = filterCategories(list, [ '古筝曲', '古琴曲', '埙曲' ]);

    logger.info('------------ 抓取古曲分类的分页信息 -------------');
    const categoryPageInfo = await loadPageInfoOfCategory(targetCrawlCategories);
    logger.info(`********** 成功抓取 ${categoryPageInfo.length} 条, 失败 ${targetCrawlCategories.length - categoryPageInfo.length} 条 ***********`);
    logger.info(`分页数据：${JSON.stringify(categoryPageInfo)}`);

    logger.info('------------ 抓取古曲信息 -------------');
    const musics = await loadMusicInfos(categoryPageInfo);
    // fs.writeFileSync(path.join(__dirname, 'music.json'), JSON.stringify(musics));
    // logger.info(`歌曲数据：${JSON.stringify(musics)}`);

    logger.info('------------ 抓取古曲下载地址 ----------------');
    const downloads = await loadMusicDownloadUrl(musics);
    // fs.writeFileSync(path.join(__dirname, 'downloads.json'), JSON.stringify(downloads));

    return { musics: downloads, categories: targetCrawlCategories };

    // axios({
    //   method: 'post',
    //   url: 'http://127.0.0.1:7001/api/v1/musics',
    //   data: {
    //     musics: downloads,
    //     categories: targetCrawlCategories,
    //   },
    // }).then(function(ret) {
    //   logger.info(`结果: ${JSON.stringify(ret.data)}`);
    // });

    // logger.info('------------ 抓取古曲文件 ----------------');
    // const downloadDir = path.join(__dirname, 'download');
    // if (!fs.existsSync(downloadDir)) {
    //   fs.mkdirSync(downloadDir);
    // }
    // await loadMusicFile(downloads);

    // logger.info('------------ 写入数据库 -------------');
    // saveToDB(details);
  } catch (err) {
    logger.error(`抓取出错: ${err.message}`);
  }
}

function filterCategories(categories, categoryNames) {
  return categories.filter(function(category) {
    return categoryNames.indexOf(category.name) !== -1;
  });
}

async function loadMedias(dir, musics, update) {
  logger.info('------------ 抓取古曲文件 ----------------');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
  return await loadMusicFile(dir, musics, update);
}

module.exports = {
  crawlMusicInfo: crawl,
  loadMedias,
};
