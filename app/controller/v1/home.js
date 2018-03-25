'use strict';

const Controller = require('egg').Controller;

class HomeController extends Controller {
  index() {
    this.ctx.body = 'Welcome!';
  }
}

module.exports = HomeController;
