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
  
  // الأمان
  salt: process.env.PASSWORD_SALT || 'bankgold_secret_salt_2024',
  
  // إعدادات التحكم بالنظام
  systemSettings: {
    botEnabled: true,
    createAccounts: true,
    transfers: true,
    maintenanceMode: false,
    maintenanceMessage: "🛠️ النظام تحت الصيانة. الرجاء المحاولة لاحقاً."
  },
  
  // أوقات العمل
  workingHours: {
    enabled: false,
    startTime: "08:00",
    endTime: "22:00", 
    timezone: "Asia/Riyadh",
    offHoursMessage: "⏰ البوت متوقف خارج أوقات العمل. أوقات العمل: 8:00 صباحاً - 10:00 مساءً"
  },
  
  // الحسابات المحظورة
  blacklistedAccounts: [
    'B146B', 'B166B', 'B170B', 'B195B', 'B230B', 
    'B312B', 'B324B', 'B347B', 'B354B', 'B378B', 
    'B408B', 'B580B', 'B690B', 'B719B'
  ],
  
  // قاعدة البيانات
  dbPath: "bank_database.db"
};
