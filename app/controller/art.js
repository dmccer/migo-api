'use strict';

const Controller = require('egg').Controller;

class ArtController extends Controller {
  async top10() {
    this.ctx.body = await this.ctx.service.art.top10();
  }
}

module.exports = ArtController;
