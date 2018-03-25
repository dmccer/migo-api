'use strict';

const Service = require('egg').Service;
const MusicCategory = require('../constant/music-category');

class MusicService extends Service {
  constructor(...args) {
    super(...args);

    this.db = this.app.mysql;
  }

  /**
   * 批量新增曲子
   * @param {Array} musics 曲子列表
   * @return {Object} 新增结果对象
   */
  async batchCreate(musics) {
    return await this.db.insert('musics', musics);
  }

  /**
   * 查询某分类记录
   * @param {string} category 分类
   * @param {number} page 页码
   * @param {number} size 每页记录数
   * @return {Object} 结果集
   */
  async query(category, page = 0, size = 15) {
    return await this.db.select('musics', {
      where: { type: MusicCategory[category] },
      orders: [[ 'add_time', 'desc' ]],
      limit: size,
      offset: page,
    });
  }

  async findNoneMedia() {
    return await this.db.select('musics', {
      where: { has_media: 2 },
      orders: [[ 'add_time', 'desc' ]],
    });
  }

  async update(music) {
    return await this.db.update('musics', music);
  }
}

module.exports = MusicService;
