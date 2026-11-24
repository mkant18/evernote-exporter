'use strict';

const { exportArchive } = require('../core/storage/archive');
process.once('message', async (options) => {
  try { process.send({ result: await exportArchive(options) }); }
  catch (error) { process.send({ error: error.message }); }
  finally { process.disconnect(); }
});
