'use strict';

/**
 * @param {Egg.Application} app - egg application
 */
module.exports = app => {
  const { router, controller } = app;
  router.get('/', controller.v1.home.index);
  router.get('/api/v1/arts/top10', controller.v1.arts.top10);
  router.resources('musics', '/api/v1/musics', controller.v1.musics);
  router.get('/api/v1/musics/crawl', controller.v1.musics.crawl);
  router.get('/api/v1/musics/patch', controller.v1.musics.patchMediaInfo);
};
