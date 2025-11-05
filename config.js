require('dotenv').config();

// إضافة نظام حفظ الإعدادات
const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, 'settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
      console.log('✅ تم تحميل الإعدادات من الملف');
      return settings;
    }
  } catch (error) {
    console.error('❌ خطأ في تحميل الإعدادات:', error);
  }
  
  // الإعدادات الافتراضية
  return {
    currentLetter: 'B',
    currentNumber: 771
  };
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    console.log('✅ تم حفظ الإعدادات في الملف');
    return true;
  } catch (error) {
    console.error('❌ خطأ في حفظ الإعدادات:', error);
    return false;
  }
}

const savedSettings = loadSettings();

module.exports = {
  // إعدادات فيسبوك
  pageAccessToken: process.env.PAGE_ACCESS_TOKEN,
  verifyToken: process.env.VERIFY_TOKEN,
  adminUserId: process.env.ADMIN_USER_ID ? process.env.ADMIN_USER_ID.trim() : '',
  
  // إعدادات البنك
  initialBalance: 15,
  currency: "G",
  
  // السلسلة الحالية (محمولة من الملف)
  currentLetter: savedSettings.currentLetter,
  currentNumber: savedSettings.currentNumber,
  
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
  dbPath: "bank_database.db",
  
  // دوال الحفظ والتحميل
  saveSettings,
  loadSettings
};
