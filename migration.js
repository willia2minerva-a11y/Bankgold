require('dotenv').config();
const MongoDB = require('./mongodb');
const Archive = require('./models/Archive');
const Account = require('./models/Account');

// استيراد الأرشيفات الحالية
const archiveA = require('./archives/archiveA');
const archiveB = require('./archives/archiveB');

class DataMigration {
  constructor() {
    this.db = new MongoDB();
  }

  async migrate() {
    try {
      console.log('🚀 بدء عملية تحويل البيانات إلى MongoDB...');

      // مسح البيانات القديمة أولاً
      await Archive.deleteMany({});
      await Account.deleteMany({});
      console.log('✅ تم مسح البيانات القديمة');

      // تحويل الأرشيفات A
      await this.migrateSeries('A', archiveA);
      
      // تحويل الأرشيفات B  
      await this.migrateSeries('B', archiveB);

      console.log('✅ تم تحويل جميع البيانات بنجاح!');
    } catch (error) {
      console.error('❌ خطأ في تحويل البيانات:', error);
    } finally {
      await this.db.disconnect();
    }
  }

  async migrateSeries(series, archives) {
    console.log(`📁 تحويل سلسلة ${series}...`);
    
    for (const [key, archiveData] of Object.entries(archives)) {
      try {
        // إنهارك الأرشيف في MongoDB
        const archive = new Archive({
          name: archiveData.name,
          series: series,
          number: parseInt(key.replace(series, '')),
          start: archiveData.start,
          end: archiveData.end,
          accounts: archiveData.accounts.map(acc => ({
            ...acc,
            source: 'archive',
            status: this.determineStatus(acc.username, acc.balance)
          }))
        });

        await archive.save();

        // إنهارك الحسابات المنفردة للبحث السريع
        for (const acc of archiveData.accounts) {
          const account = new Account({
            code: acc.code,
            username: acc.username,
            balance: acc.balance,
            status: this.determineStatus(acc.username, acc.balance),
            source: 'archive',
            archive_ref: key
          });

          await account.save();
        }

        console.log(`✅ تم تحويل الأرشيف ${key}`);
      } catch (error) {
        console.error(`❌ خطأ في تحويل الأرشيف ${key}:`, error.message);
      }
    }
  }

  determineStatus(username, balance) {
    // إذا كان الاسم يحتوي على إشارة حظر أو الرصيد 0 مع إشارة حظر
    const bannedIndicators = ['🚫', '❌', 'محظور', 'محظورة'];
    const hasBannedIndicator = bannedIndicators.some(indicator => 
      username.includes(indicator)
    );
    
    return hasBannedIndicator ? 'banned' : 'active';
  }
}

// تشغيل التحويل إذا تم استدعاء الملف مباشرة
if (require.main === module) {
  const migration = new DataMigration();
  migration.migrate();
}

module.exports = DataMigration;
