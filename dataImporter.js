const Database = require('./database-mongodb');
const config = require('./config');
const { hashPassword } = require('./utils/security');

class DataImporter {
  constructor() {
    this.db = new Database();
  }

  async importAllData() {
    console.log('بدء استيراد جميع البيانات...');
    
    await this.importSeriesA();
    await this.importSeriesB();
    
    console.log('تم استيراد جميع البيانات بنجاح!');
  }

  async importSeriesA() {
    console.log('جاري استيراد السلسلة A...');
    const accounts = this.getSeriesAData();
    
    for (const account of accounts) {
      if (account.balance === null) continue;
      
      try {
        await this.db.createAccount(
          null,
          account.code,
          account.username,
          null, // كلمة المرور (سيتم استخدام الافتراضية)
          account.balance
        );
      } catch (error) {
        console.log(`خطأ في استيراد ${account.code}: ${error.message}`);
      }
    }
  }

  async importSeriesB() {
    console.log('جاري استيراد السلسلة B...');
    const accounts = this.getSeriesBData();
    
    for (const account of accounts) {
      if (account.balance === null) continue;
      
      try {
        await this.db.createAccount(
          null,
          account.code,
          account.username,
          null, // كلمة المرور (سيتم استخدام الافتراضية)
          account.balance
        );
      } catch (error) {
        console.log(`خطأ في استيراد ${account.code}: ${error.message}`);
      }
    }
  }

  parseBalance(balanceStr) {
    if (!balanceStr || balanceStr === '00 G' || balanceStr === '0 G' || balanceStr === 'G') return 0;
    if (balanceStr.includes('محظور') || balanceStr.includes('🚫') || balanceStr.includes('❌')) return null;
    
    const cleanStr = balanceStr.toString()
      .replace(/\s/g, '')
      .replace('G', '')
      .replace('ـ', '')
      .replace('---', '');
    
    return parseFloat(cleanStr) || 0;
  }

  getSeriesAData() {
    // سيتم إضافة جميع الـ 1000 حساب من السلسلة A
    return [
      { code: 'A000A', username: 'ابراهيم ألخليل', balance: 904 },
      { code: 'A001A', username: 'A K I R A', balance: 170 },
      { code: 'A002A', username: 'ندى', balance: 0 },
      // ... جميع حسابات السلسلة A حتى A999A
    ];
  }

  getSeriesBData() {
    return [
      { code: 'B000B', username: 'موفا', balance: 95 },
      { code: 'B001B', username: 'كرولو', balance: 15 },
      { code: 'B002B', username: 'اياتو كن', balance: 15 },
      { code: 'B003B', username: 'Akae Nm', balance: 15 },
      { code: 'B004B', username: 'Nasro', balance: 0 },
      { code: 'B005B', username: 'Gojou Satoru', balance: 0 },
      { code: 'B006B', username: 'Zoro', balance: 0 },
      { code: 'B007B', username: 'Rayliyana', balance: 0 },
      { code: 'B008B', username: 'عاصفة', balance: 31791 },
      { code: 'B009B', username: 'كيوتة', balance: 2134 },
      { code: 'B010B', username: 'كيوب', balance: 0 },
      { code: 'B011B', username: 'Mozart', balance: 0 },
      { code: 'B012B', username: 'Arije', balance: 0 },
      { code: 'B013B', username: 'فؤاد انتيك', balance: 0 },
      { code: 'B014B', username: 'ملاك', balance: 0 },
      // ... سيتم إضافة جميع حسابات السلسلة B حتى B771B
      { code: 'B771B', username: 'سيلينا', balance: 15 }
    ];
  }
}

module.exports = DataImporter;
