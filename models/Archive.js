const fs = require('fs');
const path = require('path');

class Archive {
  constructor(series, number, name, start, end, accounts) {
    this.series = series;
    this.number = number;
    this.name = name;
    this.start = start;
    this.end = end;
    this.accounts = accounts;
  }

  // دالة ثابتة للحصول على الأرشيف بناءً على السلسلة والرقم
  static async findOne({ series, number }) {
    try {
      const archiveDir = path.join(__dirname, '..', 'archives', `archive${series}`);
      const archivePath = path.join(archiveDir, `${series}${number}.js`);
      
      console.log(`🔍 محاولة تحميل الأرشيف من: ${archivePath}`);
      
      if (!fs.existsSync(archivePath)) {
        console.log(`❌ ملف الأرشيف غير موجود: ${archivePath}`);
        return null;
      }

      // حذف الكاش لضمان تحميل أحدث نسخة
      delete require.cache[require.resolve(archivePath)];
      
      // استيراد ملف الأرشيف
      const archiveData = require(archivePath);
      
      console.log(`✅ تم تحميل الأرشيف: ${archiveData.name} - ${archiveData.accounts.length} حساب`);
      
      return new Archive(
        series,
        number,
        archiveData.name || `أرشيف ${series}${number}`,
        archiveData.start || 'غير محدد',
        archiveData.end || 'غير محدد',
        archiveData.accounts || []
      );
    } catch (error) {
      console.error('❌ خطأ في قراءة الأرشيف:', error);
      return null;
    }
  }

  // دالة ثابتة للحصول على جميع الأرشيفات في سلسلة معينة
  static async find({ series }) {
    try {
      const archiveDir = path.join(__dirname, '..', 'archives', `archive${series}`);
      
      if (!fs.existsSync(archiveDir)) {
        console.log(`❌ مجلد السلسلة غير موجود: ${archiveDir}`);
        return [];
      }
      
      const files = fs.readdirSync(archiveDir);
      const archives = [];
      
      for (const file of files) {
        if (file.endsWith('.js') && file.startsWith(series)) {
          const number = parseInt(file.replace(`${series}`, '').replace('.js', ''));
          if (!isNaN(number)) {
            const archivePath = path.join(archiveDir, file);
            try {
              // حذف الكاش
              delete require.cache[require.resolve(archivePath)];
              const archiveData = require(archivePath);
              
              archives.push(new Archive(
                series,
                number,
                archiveData.name || `أرشيف ${series}${number}`,
                archiveData.start || 'غير محدد',
                archiveData.end || 'غير محدد',
                archiveData.accounts || []
              ));
            } catch (error) {
              console.error(`❌ خطأ في تحميل الأرشيف ${file}:`, error);
            }
          }
        }
      }
      
      // ترتيب الأرشيفات حسب الرقم
      return archives.sort((a, b) => a.number - b.number);
    } catch (error) {
      console.error('❌ خطأ في البحث عن الأرشيفات:', error);
      return [];
    }
  }

  // دالة للحصول على الأرشيفات المتاحة (للعرض في الرسائل)
  static async getAvailableArchives(series) {
    try {
      const archives = await this.find({ series });
      
      if (archives.length === 0) {
        return `لا توجد أرشيفات في سلسلة ${series}`;
      }
      
      return archives.map(arch => 
        `• ${arch.series}${arch.number}: ${arch.name} (${arch.start} - ${arch.end}) - ${arch.accounts.length} حساب`
      ).join('\n');
    } catch (error) {
      console.error('❌ خطأ في ج الأرشيفات المتاحة:', error);
      return "❌ خطأ في تحميل الأرشيفات";
    }
  }
}

module.exports = Archive;
