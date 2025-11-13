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

  static async findOne({ series, number }) {
    try {
      const archiveDir = path.join(__dirname, '..', 'archives', `archive${series}`);
      const archivePath = path.join(archiveDir, `${series}${number}.js`);
      
      if (!fs.existsSync(archivePath)) {
        return null;
      }

      delete require.cache[require.resolve(archivePath)];
      const archiveData = require(archivePath);
      
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

  static async find({ series }) {
    try {
      const archiveDir = path.join(__dirname, '..', 'archives', `archive${series}`);
      
      if (!fs.existsSync(archiveDir)) {
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
      
      return archives.sort((a, b) => a.number - b.number);
    } catch (error) {
      console.error('❌ خطأ في البحث عن الأرشيفات:', error);
      return [];
    }
  }

  static async getAvailableArchives(series) {
    try {
      const archives = await this.find({ series });
      
      if (archives.length === 0) {
        return `لا توجد أرشيفات في سلسلة ${series}`;
      }
      
      return archives.map(arch => 
        `• ${arch.series}${arch.number}: ${arch.name}`
      ).join('\n');
    } catch (error) {
      return "❌ خطأ في تحميل الأرشيفات";
    }
  }
}

module.exports = Archive;
