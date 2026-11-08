'use strict';

const { app, ensureAdmin } = require('../server/index');

let ready;

module.exports = async function handler(req, res) {
  ready = ready || ensureAdmin();
  await ready;
  return app(req, res);
};
