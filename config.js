require('dotenv').config();

module.exports = {
  pageAccessToken: process.env.PAGE_ACCESS_TOKEN,
  verifyToken: process.env.VERIFY_TOKEN,
  adminUserId: process.env.ADMIN_USER_ID,
  
  initialBalance: 15,
  currency: "G",
  
  currentLetter: 'B',
  currentNumber: 771,
  
  archiveSize: 100,
  blacklistedAccounts: [],
  
  dbPath: "bank_database.db"
};
