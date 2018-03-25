'use strict';

const path = require('path');

module.exports = appInfo => {
  const config = exports = {};

  // use for cookie sign key, should change to your own and keep security
  config.keys = appInfo.name + '_yhx@926';

  // add your config here
  config.middleware = [];
  config.bodyParser = {
    jsonLimit: '10mb',
  };
  config.mediaDir = path.join(appInfo.baseDir, 'media');

  return config;
};
