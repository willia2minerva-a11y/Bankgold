require('dotenv').config();

module.exports = {
  pageAccessToken: process.env.PAGE_ACCESS_TOKEN,
  verifyToken: process.env.VERIFY_TOKEN,
  adminUserId: process.env.ADMIN_USER_ID,
  
  initialBalance: 15,
  currency: "G",
  
  // بداية السلسلة الجديدة - بعد B771B
  currentLetter: 'B',
  currentNumber: 771,
  
  archiveSize: 100,
  blacklistedAccounts: ['B146B', 'B166B', 'B170B', 'B195B', 'B230B', 'B312B', 'B324B', 'B347B', 'B354B', 'B378B', 'B408B', 'B580B', 'B690B', 'B719B'],
  
  dbPath: "bank_database.db"
};
