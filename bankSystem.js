const Database = require('./database');
const config = require('./config');

class BankSystem {
  constructor() {
    this.db = new Database();
    this.currentLetter = config.currentLetter;
    this.currentNumber = config.currentNumber;
  }

  getNextCode() {
    this.currentNumber += 1;

    if (this.currentNumber > 999) {
      this.currentNumber = 1;
      this.currentLetter = 'C';
    }

    return `${this.currentLetter}${this.currentNumber.toString().padStart(3, '0')}${this.currentLetter}`;
  }

  async processAdminCommand(adminId, command) {
    if (adminId !== config.adminUserId) {
      return "❌ غير مصرح لك";
    }

    command = command.trim();

    // نمط: خصم 10000G للكود A610A السبب اشترى 10 بطاقات نجم الغولد
    const deductMatch = command.match(/خصم\s+(\d+)G\s+للکود\s+(\w+)\s+السبب\s+(.+)/);
    if (deductMatch) {
      const amount = this.parseAmount(deductMatch[1]);
      const code = deductMatch[2].toUpperCase();
      const reason = deductMatch[3];
      
      const [success, response] = await this.adminDeductBalance(adminId, code, amount, reason);
      
      if (success) {
        const archiveInfo = this.getArchiveByCode(code);
        const archiveText = await this.getArchive(archiveInfo.number, archiveInfo.series);
        return response + "\n\n" + archiveText;
      }
      return response;
    }

    // نمط: اضافة 5000G للكود B700B السبب مكافأة
    const addMatch = command.match(/اضافة\s+(\d+)G\s+للکود\s+(\w+)\s+السبب\s+(.+)/);
    if (addMatch) {
      const amount = this.parseAmount(addMatch[1]);
      const code = addMatch[2].toUpperCase();
      const reason = addMatch[3];
      
      const [success, response] = await this.adminAddBalance(adminId, code, amount, reason);
      
      if (success) {
        const archiveInfo = this.getArchiveByCode(code);
        const archiveText = await this.getArchive(archiveInfo.number, archiveInfo.series);
        return response + "\n\n" + archiveText;
      }
      return response;
    }

    // نمط: انشاء كيم شيريونغ
    const createMatch = command.match(/انشاء\s+(.+)/);
    if (createMatch) {
      const username = createMatch[1].trim();
      const [success, response] = await this.createAccount(null, username);
      
      if (success) {
        return `✅ ${response.message}\n\n📋 ${JSON.stringify(response.card.data, null, 2)}`;
      }
      return response;
    }

    // نمط: ارشيف 5
    const archiveMatch = command.match(/ارشيف\s+(\d+)/);
    if (archiveMatch) {
      const archiveNum = parseInt(archiveMatch[1]);
      return await this.getArchive(archiveNum, 'A');
    }

    // نمط: ارشيف ب 2
    const archiveSeriesMatch = command.match(/ارشيف\s+(\w)\s+(\d+)/);
    if (archiveSeriesMatch) {
      const series = archiveSeriesMatch[1].toUpperCase();
      const archiveNum = parseInt(archiveSeriesMatch[2]);
      return await this.getArchive(archiveNum, series);
    }

    // نمط: بحث كيم
    const searchMatch = command.match(/بحث\s+(.+)/);
    if (searchMatch) {
      const searchTerm = searchMatch[1];
      return await this.searchAccounts(searchTerm);
    }

    return `❌ أمر غير معروف. الأوامر المتاحة:

💰 **العمليات المالية:**
• خصم [مبلغ]G للكود [الكود] السبب [السبب]
• اضافة [مبلغ]G للكود [الكود] السبب [السبب]

👤 **إدارة الحسابات:**
• انشاء [الاسم]

📊 **الاستعلامات:**
• ارشيف [رقم] - للأرشيفات A
• ارشيف [السلسلة] [رقم] - لأي سلسلة
• بحث [اسم أو كود]

مثال:
خصم 10000G للكود A610A السبب اشترى 10 بطاقات نجم الغولد
انشاء كيم شيريونغ
ارشيف 5
ارشيف ب 2
بحث كيم`;
  }

  async getArchive(archiveNumber, series = 'A') {
    const startNum = (archiveNumber - 1) * config.archiveSize;
    const endNum = startNum + config.archiveSize - 1;
    
    const accounts = await this.db.getAllAccounts();
    const archiveAccounts = accounts.filter(acc => {
      if (!acc.code || acc.code[0] !== series) return false;
      const accNumber = parseInt(acc.code.slice(1, 4));
      return accNumber >= startNum && accNumber <= endNum;
    });

    return this.formatArchiveDisplay(archiveAccounts, archiveNumber, series);
  }

  formatArchiveDisplay(accounts, archiveNumber, series) {
    if (accounts.length === 0) {
      return `📁 الأرشيف ${archiveNumber} (السلسلة ${series}):\nلا توجد حسابات في هذا الأرشيف`;
    }

    let text = `📁 الأرشيف ${archiveNumber} (السلسلة ${series}):\n\n`;
    let totalBalance = 0;
    
    accounts.forEach(account => {
      text += `${account.code} ${account.username}\n${account.balance} ${config.currency}\n\n`;
      totalBalance += account.balance;
    });
    
    text += `--- الإحصاءات ---\n`;
    text += `إجمالي الحسابات: ${accounts.length}\n`;
    text += `إجمالي الأرصدة: ${totalBalance} ${config.currency}\n`;
    text += `متوسط الرصيد: ${Math.round(totalBalance / accounts.length)} ${config.currency}`;
    
    return text;
  }

  getArchiveByCode(code) {
    const series = code[0];
    const number = parseInt(code.slice(1, 4));
    const archiveNumber = Math.floor(number / config.archiveSize) + 1;
    
    return {
      series: series,
      number: archiveNumber
    };
  }

  parseAmount(amountStr) {
    return parseFloat(amountStr.replace(/\s/g, ''));
  }

  async adminDeductBalance(adminId, code, amount, reason = '') {
    if (adminId !== config.adminUserId) {
      return [false, "غير مصرح لك"];
    }

    const account = await this.db.getAccountByCode(code);
    if (!account) {
      return [false, "❌ الحساب غير موجود"];
    }

    if (config.blacklistedAccounts.includes(code)) {
      return [false, "❌ لا يمكن تعديل حساب محظور"];
    }

    const currentBalance = account.balance;
    if (currentBalance < amount) {
      return [false, "❌ الرصيد غير كاف للخصم"];
    }

    const newBalance = currentBalance - amount;
    try {
      await this.db.updateBalance(account.user_id, newBalance);
      await this.db.logOperation('deduct', amount, null, code, reason, adminId);
      
      return [true, `✅ تم الخصم بنجاح!\nالحساب: ${code}\nالمبلغ: ${amount} ${config.currency}\nالسبب: ${reason}\nالرصيد الجديد: ${newBalance} ${config.currency}`];
    } catch (error) {
      return [false, "❌ فشل في الخصم"];
    }
  }

  async adminAddBalance(adminId, code, amount, reason = '') {
    if (adminId !== config.adminUserId) {
      return [false, "غير مصرح لك"];
    }

    const account = await this.db.getAccountByCode(code);
    if (!account) {
      return [false, "❌ الحساب غير موجود"];
    }

    if (config.blacklistedAccounts.includes(code)) {
      return [false, "❌ لا يمكن تعديل حساب محظور"];
    }

    const currentBalance = account.balance;
    const newBalance = currentBalance + amount;
    
    try {
      await this.db.updateBalance(account.user_id, newBalance);
      await this.db.logOperation('add', amount, null, code, reason, adminId);
      
      return [true, `✅ تم الإضافة بنجاح!\nالحساب: ${code}\nالمبلغ: ${amount} ${config.currency}\nالسبب: ${reason}\nالرصيد الجديد: ${newBalance} ${config.currency}`];
    } catch (error) {
      return [false, "❌ فشل في الإضافة"];
    }
  }

  async createAccount(userId, username, customCode = null) {
    let code;
    if (customCode) {
      code = customCode.toUpperCase();
      // التحقق من أن الكود غير مستخدم
      const existing = await this.db.getAccountByCode(code);
      if (existing) {
        return [false, "❌ الكود مستخدم مسبقاً"];
      }
    } else {
      code = this.getNextCode();
    }

    try {
      await this.db.createAccount(userId, code, username, config.initialBalance);
      
      const cardData = this.generateCreateCard(code, username);
      
      return [true, {
        message: `✅ تم إنشاء الحساب بنجاح!`,
        card: cardData,
        account: { code, username, balance: config.initialBalance }
      }];
    } catch (error) {
      return [false, "❌ فشل في إنشاء الحساب: " + error.message];
    }
  }

  async searchAccounts(searchTerm) {
    const accounts = await this.db.getAllAccounts();
    const results = accounts.filter(account => 
      account.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      account.username.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (results.length === 0) {
      return `🔍 لا توجد نتائج للبحث عن: "${searchTerm}"`;
    }

    let text = `🔍 نتائج البحث عن "${searchTerm}":\n\n`;
    results.forEach(account => {
      text += `${account.code} ${account.username}\n${account.balance} ${config.currency}\n\n`;
    });

    text += `--- العدد الإجمالي: ${results.length} ---`;
    return text;
  }

  generateCreateCard(code, username) {
    const currentDate = new Date().toLocaleDateString('ar-EG');
    const archiveLetter = code[0];
    
    return {
      type: 'create_card',
      template: 'FB_IMG_17620077890456013.jpg',
      data: {
        bank_name: "GOLD BANK",
        code: code,
        date: currentDate,
        archive: archiveLetter,
        username: username,
        balance: config.initialBalance + ' ' + config.currency
      }
    };
  }

  // إحصائيات النظام
  async getSystemStats() {
    const accounts = await this.db.getAllAccounts();
    const totalAccounts = accounts.length;
    const totalBalance = accounts.reduce((sum, acc) => sum + acc.balance, 0);
    const activeAccounts = accounts.filter(acc => acc.balance > 0).length;
    
    return {
      totalAccounts,
      totalBalance,
      activeAccounts,
      averageBalance: totalBalance / totalAccounts
    };
  }
}

module.exports = BankSystem;
