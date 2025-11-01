const Database = require('./database');
const config = require('./config');
const archiveA = require('./archives/archiveA');
const archiveB = require('./archives/archiveB');

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

  async processCommand(userId, message) {
    const command = message.trim().toLowerCase();
    
    try {
      if (command.startsWith('انشاء')) {
        return await this.handleCreate(userId, command);
      }
      else if (command.startsWith('تحويل')) {
        return await this.handleTransfer(userId, command);
      }
      else if (command.startsWith('حظر')) {
        return await this.handleBan(userId, command);
      }
      else if (command === 'مجموع') {
        return await this.handleTotal(userId);
      }
      else if (command.startsWith('ارشيف')) {
        return await this.handleArchive(command);
      }
      else if (command.startsWith('خصم')) {
        return await this.handleDeduct(userId, command);
      }
      else if (command.startsWith('رصيد')) {
        return await this.handleBalance(command);
      }
      else if (command === 'معرفي') {
        return await this.handleGetId(userId);
      }
      else if (command === 'مساعدة' || command === 'اوامر') {
        return await this.handleHelp(userId);
      }
      else {
        return this.getUnknownCommandResponse(command);
      }
      
    } catch (error) {
      return `❌ حدث خطأ: ${error.message}`;
    }
  }

  async handleCreate(userId, command) {
    const parts = command.split(' ');
    if (parts.length < 2) {
      return `❌ صيغة خاطئة! استخدم:\nانشاء [الاسم الكامل]\nمثال: انشاء كيم شيريونغ`;
    }
    
    const username = parts.slice(1).join(' ').trim();
    if (!username) {
      return `❌ يرجى إدخال اسم صحيح`;
    }
    
    const [success, response] = await this.createAccount(userId, username);
    
    if (success) {
      return `✅ تم إنشاء الحساب بنجاح!\n\n📋 معلومات الحساب:\nالكود: ${response.account.code}\nالاسم: ${response.account.username}\nالرصيد: ${response.account.balance} ${config.currency}\n\n💳 تم إضافة البطاقة إلى الأرشيف`;
    } else {
      return response;
    }
  }

  async handleTransfer(userId, command) {
    const match = command.match(/تحويل\s+(\d+)g?\s+لـ?\s*(\w+)/i);
    if (!match) {
      return `❌ صيغة خاطئة! استخدم:\nتحويل [المبلغ] [كود المستلم]\nمثال: تحويل 100 B700B`;
    }
    
    const amount = parseFloat(match[1]);
    const toCode = match[2].toUpperCase();
    
    if (amount <= 0) {
      return `❌ المبلغ يجب أن يكون أكبر من الصفر`;
    }
    
    const [success, response] = await this.transferMoney(userId, toCode, amount);
    return response;
  }

  async handleBan(userId, command) {
    if (userId !== config.adminUserId) {
      return `❌ هذا الأمر للمشرف فقط`;
    }
    
    const match = command.match(/حظر\s+(\w+)/i);
    if (!match) {
      return `❌ صيغة خاطئة! استخدم:\nحظر [الكود]\nمثال: حظر A100A`;
    }
    
    const code = match[1].toUpperCase();
    const [success, response] = await this.banAccount(userId, code);
    return response;
  }

  async handleTotal(userId) {
    if (userId !== config.adminUserId) {
      return `❌ هذا الأمر للمشرف فقط`;
    }
    
    const accounts = await this.db.getAllAccounts();
    let totalGold = 0;
    let activeAccounts = 0;
    
    accounts.forEach(account => {
      totalGold += account.balance;
      if (account.balance > 0) activeAccounts++;
    });
    
    return `💰 إحصائيات النظام:\n\n• إجمالي الغولد: ${totalGold.toLocaleString()} ${config.currency}\n• عدد الحسابات: ${accounts.length.toLocaleString()}\n• الحسابات النشطة: ${activeAccounts.toLocaleString()}\n• متوسط الرصيد: ${Math.round(totalGold / accounts.length)} ${config.currency}`;
  }

  async handleArchive(command) {
    const match = command.match(/ارشيف\s+(\w)(\d+)/i);
    if (!match) {
      return `❌ صيغة خاطئة! استخدم:\nارشيف [الحرف][الرقم]\nمثال: ارشيف A1\nمثال: ارشيف B2`;
    }
    
    const series = match[1].toUpperCase();
    const archiveNum = match[2];
    const archiveKey = series + archiveNum;
    
    let archiveData;
    if (series === 'A') {
      archiveData = archiveA[archiveKey];
    } else if (series === 'B') {
      archiveData = archiveB[archiveKey];
    } else {
      return `❌ الأرشيف غير موجود. السلاسل المتاحة: A, B`;
    }
    
    if (!archiveData) {
      const availableArchives = this.getAvailableArchives(series);
      return `❌ الأرشيف ${archiveKey} غير موجود\n\n📂 الأرشيفات المتاحة:\n${availableArchives}`;
    }
    
    return this.formatArchiveDisplay(archiveData);
  }

  async handleDeduct(userId, command) {
    if (userId !== config.adminUserId) {
      return `❌ هذا الأمر للمشرف فقط`;
    }
    
    const match = command.match(/خصم\s+(\d+)g?\s+لـ?\s*(\w+)\s+السبب\s+(.+)/i);
    if (!match) {
      return `❌ صيغة خاطئة! استخدم:\nخصم [المبلغ] [الكود] السبب [السبب]\nمثال: خصم 10000 A610A السبب اشترى 10 بطاقات نجم الغولد`;
    }
    
    const amount = parseFloat(match[1]);
    const code = match[2].toUpperCase();
    const reason = match[3];
    
    const [success, response] = await this.adminDeductBalance(userId, code, amount, reason);
    return response;
  }

  async handleBalance(command) {
    const match = command.match(/رصيد\s+(\w+)/i);
    if (!match) {
      return `❌ صيغة خاطئة! استخدم:\nرصيد [كود الحساب]\nمثال: رصيد A100A\nمثال: رصيد B700B`;
    }
    
    const code = match[1].toUpperCase();
    
    // البحث في الأرشيفات أولاً
    const archiveResult = this.searchInArchives(code);
    if (archiveResult) {
      return archiveResult;
    }
    
    // إذا لم يوجد في الأرشيفات، البحث في قاعدة البيانات
    const account = await this.db.getAccountByCode(code);
    
    if (!account) {
      return `❌ الحساب ${code} غير موجود`;
    }
    
    return `💰 رصيد الحساب:\n\nالكود: ${account.code}\nالاسم: ${account.username}\nالرصيد: ${account.balance} ${config.currency}\nالحالة: ${account.status === 'active' ? '🟢 نشط' : '🔴 محظور'}`;
  }

  searchInArchives(code) {
    const series = code[0].toUpperCase();
    const number = parseInt(code.slice(1, 4));
    const archiveNum = Math.floor(number / 100) + 1;
    const archiveKey = series + archiveNum;
    
    let archiveData;
    if (series === 'A') {
      archiveData = archiveA[archiveKey];
    } else if (series === 'B') {
      archiveData = archiveB[archiveKey];
    } else {
      return null;
    }
    
    if (!archiveData) return null;
    
    const account = archiveData.accounts.find(acc => acc.code === code);
    if (!account) return null;
    
    return `💰 رصيد الحساب:\n\nالكود: ${account.code}\nالاسم: ${account.username}\nالرصيد: ${account.balance} ${config.currency}\nالمصدر: الأرشيف ${archiveKey}`;
  }

  async handleGetId(userId) {
    return `🆔 معرفك هو: ${userId}`;
  }

  async handleHelp(userId) {
    const isAdmin = userId === config.adminUserId;
    
    let helpText = `🏦 **أوامر بنك GOLD - المساعدة**\n\n`;
    
    helpText += `👤 **أوامر المستخدم:**\n`;
    helpText += `• \`انشاء [الاسم]\` - إنشاء حساب جديد\n`;
    helpText += `• \`تحويل [المبلغ] [الكود]\` - تحويل غولد\n`;
    helpText += `• \`رصيد [الكود]\` - استعلام عن رصيد حساب\n`;
    helpText += `• \`معرفي\` - عرض معرفك\n`;
    helpText += `• \`مساعدة\` - عرض هذه الرسالة\n\n`;
    
    helpText += `📊 **أوامر الأرشيف:**\n`;
    helpText += `• \`ارشيف A1\` - الأرشيف الأول من A (A000A-A099A)\n`;
    helpText += `• \`ارشيف A2\` - الأرشيف الثاني من A (A100A-A199A)\n`;
    helpText += `• \`ارشيف A3\` - الأرشيف الثالث من A (A200A-A299A)\n`;
    helpText += `• \`ارشيف A4\` - الأرشيف الرابع من A (A300A-A399A)\n`;
    helpText += `• \`ارشيف A5\` - الأرشيف الخامس من A (A400A-A499A)\n`;
    helpText += `• \`ارشيف A6\` - الأرشيف السادس من A (A500A-A599A)\n`;
    helpText += `• \`ارشيف A7\` - الأرشيف السابع من A (A600A-A699A)\n`;
    helpText += `• \`ارشيف A8\` - الأرشيف الثامن من A (A700A-A799A)\n`;
    helpText += `• \`ارشيف A9\` - الأرشيف التاسع من A (A800A-A899A)\n`;
    helpText += `• \`ارشيف A10\` - الأرشيف العاشر من A (A900A-A999A)\n\n`;
    
    helpText += `• \`ارشيف B1\` - الأرشيف الأول من B (B000B-B099B)\n`;
    helpText += `• \`ارشيف B2\` - الأرشيف الثاني من B (B100B-B199B)\n`;
    helpText += `• \`ارشيف B3\` - الأرشيف الثالث من B (B200B-B299B)\n`;
    helpText += `• \`ارشيف B4\` - الأرشيف الرابع من B (B300B-B399B)\n`;
    helpText += `• \`ارشيف B5\` - الأرشيف الخامس من B (B400B-B499B)\n`;
    helpText += `• \`ارشيف B6\` - الأرشيف السادس من B (B500B-B599B)\n`;
    helpText += `• \`ارشيف B7\` - الأرشيف السابع من B (B600B-B699B)\n`;
    helpText += `• \`ارشيف B8\` - الأرشيف الثامن من B (B700B-B771B)\n\n`;
    
    if (isAdmin) {
      helpText += `⚡ **أوامر المشرف:**\n`;
      helpText += `• \`حظر [الكود]\` - حظر حساب\n`;
      helpText += `• \`مجموع\` - إجمالي الغولد\n`;
      helpText += `• \`خصم [المبلغ] [الكود] السبب [السبب]\` - خصم غولد\n\n`;
    }
    
    helpText += `📋 **معلومات النظام:**\n`;
    helpText += `• الرصيد الابتدائي: 15 ${config.currency}\n`;
    helpText += `• السلسلة الحالية: ${this.currentLetter}\n`;
    helpText += `• التالي: ${this.getNextCode()}\n`;
    helpText += `• إجمالي الحسابات: 1,771 حساب\n`;
    helpText += `• الأرشيفات: 10 لـA و 8 لـB`;
    
    return helpText;
  }

  getAvailableArchives(series) {
    let archives = [];
    if (series === 'A') {
      archives = Object.keys(archiveA).map(key => `• ${key}: ${archiveA[key].start} - ${archiveA[key].end}`);
    } else if (series === 'B') {
      archives = Object.keys(archiveB).map(key => `• ${key}: ${archiveB[key].start} - ${archiveB[key].end}`);
    }
    return archives.join('\n');
  }

  getUnknownCommandResponse(command) {
    return `❌ الأمر "${command}" غير معروف!\n\n🔍 اكتب \`مساعدة\` لعرض جميع الأوامر المتاحة.\n\n💡 تلميح: تأكد من كتابة الأمر بشكل صحيح.`;
  }

  formatArchiveDisplay(archiveData) {
    let text = `📁 ${archiveData.name}\n`;
    text += `📍 من ${archiveData.start} إلى ${archiveData.end}\n\n`;
    
    let totalBalance = 0;
    let accountCount = 0;
    
    archiveData.accounts.forEach(account => {
      text += `${account.code} ${account.username}\n${account.balance} ${config.currency}\n\n`;
      totalBalance += account.balance;
      accountCount++;
    });
    
    text += `--- الإحصاءات ---\n`;
    text += `• عدد الحسابات: ${accountCount}\n`;
    text += `• إجمالي الغولد: ${totalBalance} ${config.currency}\n`;
    text += `• متوسط الرصيد: ${Math.round(totalBalance / accountCount)} ${config.currency}`;
    
    return text;
  }

  async createAccount(userId, username, customCode = null) {
    let code = customCode || this.getNextCode();
    
    try {
      await this.db.createAccount(userId, code, username, config.initialBalance);
      
      return [true, {
        message: "تم الإنشاء بنجاح",
        account: { code, username, balance: config.initialBalance }
      }];
    } catch (error) {
      return [false, `❌ فشل في إنشاء الحساب: ${error.message}`];
    }
  }

  async transferMoney(fromUser, toCode, amount) {
    if (amount <= 0) {
      return [false, "❌ المبلغ يجب أن يكون موجباً"];
    }
    
    const fromBalance = await this.db.getBalance(fromUser);
    if (fromBalance < amount) {
      return [false, "❌ رصيد غير كافٍ"];
    }
    
    const toAccount = await this.db.getAccountByCode(toCode);
    if (!toAccount) {
      return [false, "❌ الحساب المستلم غير موجود"];
    }
    
    if (toAccount.status !== 'active') {
      return [false, "❌ لا يمكن التحويل لحساب محظور"];
    }
    
    try {
      await this.db.transferMoney(fromUser, toAccount.user_id, toCode, amount);
      const newBalance = fromBalance - amount;
      
      return [true, `✅ تم التحويل بنجاح!\nالمبلغ: ${amount} ${config.currency}\nإلى: ${toCode}\nرصيدك الجديد: ${newBalance} ${config.currency}`];
    } catch (error) {
      return [false, "❌ فشل في التحويل"];
    }
  }

  async banAccount(adminId, code) {
    if (adminId !== config.adminUserId) {
      return [false, "غير مصرح لك"];
    }
    
    const account = await this.db.getAccountByCode(code);
    if (!account) {
      return [false, "❌ الحساب غير موجود"];
    }
    
    try {
      await this.db.updateAccountStatus(account.user_id, 'banned');
      config.blacklistedAccounts.push(code);
      
      return [true, `✅ تم حظر الحساب ${code}`];
    } catch (error) {
      return [false, "❌ فشل في حظر الحساب"];
    }
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
}

module.exports = BankSystem;
