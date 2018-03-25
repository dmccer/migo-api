'use strict';

const Controller = require('egg').Controller;
const musicCrawler = require('../../spider/crawl');

class MusicController extends Controller {
  constructor(...args) {
    super(...args);
    this.db = this.app.mysql;
  }

  async crawl() {
    const { musics, categories } = await musicCrawler.crawlMusicInfo();
    const { literals } = this.db;

    const ret = musics.map(function(music) {
      return {
        name: music.name,
        author: music.author,
        type: categories[music.categoryId].name,
        url: music.download,
        external_id: music.id,
        add_time: literals.now,
        update_time: literals.now,
      };
    });

    this.ctx.body = await this.ctx.service.music.batchCreate(ret);
  }

  async patchMediaInfo() {
    const noneMediaMusics = await this.ctx.service.music.findNoneMedia();

    if (!noneMediaMusics.length) {
      this.ctx.body = {
        code: 0,
        msg: '暂无需要爬取媒体文件的曲子',
      };
    }

    this.ctx.body = await musicCrawler.loadMedias(this.app.config.mediaDir, noneMediaMusics, this.ctx.service.music.update.bind(this.ctx.service.music));
  }

  async index() {
    const { category, page, size } = this.ctx.query;

    this.ctx.body = await this.ctx.service.music.query(category, parseInt(page, 10), parseInt(size, 10));
  }
}

module.exports = MusicController;
