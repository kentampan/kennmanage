require('dotenv').config();

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN || '',
  MONGODB_URI: process.env.MONGODB_URI || '',
  ADMIN_IDS: process.env.ADMIN_IDS
    ? process.env.ADMIN_IDS.split(',').map(id => Number(id.trim())).filter(id => id > 0)
    : [],
};

console.log("Admin IDs:", module.exports.ADMIN_IDS);
