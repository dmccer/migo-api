'use strict';

const Service = require('egg').Service;

class ArtService extends Service {
  async top10() {
    return await this.ctx.mysql.select('arts', {
      orders: [[ 'add_time', 'desc' ]],
      limit: 10,
    });
  }
}

module.exports = ArtService;
