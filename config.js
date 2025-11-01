require('dotenv').config();

module.exports = {
  // إعدادات فيسبوك
  pageAccessToken: process.env.PAGE_ACCESS_TOKEN,
  verifyToken: process.env.VERIFY_TOKEN,
  adminUserId: process.env.ADMIN_USER_ID,
  
  // إعدادات البنك
  initialBalance: 15,
  currency: "G",
  
  // السلسلة الحالية
  currentLetter: 'B',
  currentNumber: 771,
  
  // الأرشيفات
  archiveSize: 100,
  
  // الحسابات المحظورة
  blacklistedAccounts: [
    'B146B', 'B166B', 'B170B', 'B195B', 'B230B', 
    'B312B', 'B324B', 'B347B', 'B354B', 'B378B', 
    'B408B', 'B580B', 'B690B', 'B719B'
  ],
  
  // قاعدة البيانات
  dbPath: "bank_database.db"
};
