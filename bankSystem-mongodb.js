const Database = require('./database-mongodb');
const config = require('./config');
const { hashPassword, verifyPassword, generateUserCode } = require('./utils/security');
const Archive = require('./models/Archive');
const Account = require('./models/Account');

class BankSystem {
  constructor() {
    this.db = new Database();
    this.currentLetter = config.currentLetter;
    this.currentNumber = config.currentNumber;
    this.loginSessions = new Map();
    this.admins = new Map([[config.adminUserId, 'عام']]);
    
    console.log(`🚀 تهيئة النظام - السلسلة الحالية: ${this.currentLetter}، الرقم الحالي: ${this.currentNumber}`);
    
    this.loadAllArchives();
  }

  async loadAllArchives() {
    try {
      console.log('🔄 جاري تحميل الأرشيفات...');
      this.allAccounts = new Map();
      
      const archivesA = await Archive.find({ series: 'A' });
      for (const archive of archivesA) {
        for (const account of archive.accounts) {
          this.allAccounts.set(account.code, {
            ...account,
            source: 'archive',
            archive_ref: `A${archive.number}`,
            status: 'active',
            user_id: account.user_id || null
          });
        }
      }
      
      const archivesB = await Archive.find({ series: 'B' });
      for (const archive of archivesB) {
        for (const account of archive.accounts) {
          this.allAccounts.set(account.code, {
            ...account,
            source: 'archive',
            archive_ref: `B${archive.number}`,
            status: 'active',
            user_id: account.user_id || null
          });
        }
      }
      
      console.log(`✅ تم تحميل ${this.allAccounts.size} حساب من الأرشيفات`);
    } catch (error) {
      console.error('❌ خطأ في تحميل الأرشيفات:', error);
      this.allAccounts = new Map();
    }
  }

  async findAccount(code) {
    const upperCode = code.toUpperCase();
    
    // البحث في الأرشيفات أولاً (أسرع)
    if (this.allAccounts.has(upperCode)) {
      return this.allAccounts.get(upperCode);
    }
    
    // البحث في قاعدة البيانات
    try {
      const dbAccount = await this.db.getAccountByCode(upperCode);
      if (dbAccount) {
        return { ...dbAccount, source: 'database' };
      }
    } catch (error) {
      console.error('❌ خطأ في البحث في قاعدة البيانات:', error);
    }
    
    return null;
  }

  async activateArchiveAccount(account, userId = null, password = null) {
    try {
      console.log(`🔧 محاولة تفعيل حساب الأرشيف: ${account.code}`);
      
      const dbAccount = await this.db.getAccountByCode(account.code);
      if (!dbAccount) {
        console.log(`🆕 إنشاء حساب جديد من الأرشيف: ${account.code}`);
        const passwordHash = password ? hashPassword(password) : hashPassword('default123');
        const success = await this.db.createAccount(
          userId || config.adminUserId,
          account.code,
          account.username,
          passwordHash,
          account.balance
        );
        
        if (success) {
          console.log(`✅ تم تفعيل الحساب من الأرشيف: ${account.code}`);
          // تحديث الذاكرة المؤقتة
          await this.refreshAccountCache(account.code);
          return true;
        } else {
          console.error(`❌ فشل في إنشاء الحساب: ${account.code}`);
          return false;
        }
      } else {
        console.log(`🔄 الحساب موجود بالفعل، تحديث البيانات: ${account.code}`);
        // تحديث البيانات إذا كان الحساب موجوداً
        await this.db.updateBalance(dbAccount.user_id, account.balance);
        await this.refreshAccountCache(account.code);
        return true;
      }
    } catch (error) {
      console.error('❌ خطأ في تفعيل حساب الأرشيف:', error);
      return false;
    }
  }

  async refreshAccountCache(code) {
    try {
      const dbAccount = await this.db.getAccountByCode(code);
      if (dbAccount) {
        this.allAccounts.set(code, {
          ...dbAccount,
          source: 'database',
          status: dbAccount.status || 'active',
          user_id: dbAccount.user_id
        });
        console.log(`🔄 تم تحديث الذاكرة المؤقتة للحساب: ${code}`);
      }
    } catch (error) {
      console.error('❌ خطأ في تحديث الذاكرة المؤقتة:', error);
    }
  }

  // دالة الأرشيف المحدثة مع التقسيم
  async handleArchive(userId, command) {
    if (!this.isAdmin(userId)) {
      return `❌ هذا الأمر للمشرفين فقط`;
    }
    
    const match = command.match(/ارشيف\s+([AB])\s*(\d+)\s*(\d*)/i) || 
                  command.match(/ارشيف\s+([AB])(\d+)\s*(\d*)/i);
    
    if (!match) {
      return `❌ صيغة خاطئة! استخدم:\nارشيف [A/B][الرقم] [الصفحة]\nمثال: ارشيف A1\nمثال: ارشيف B4 2`;
    }
    
    const series = match[1].toUpperCase();
    const archiveNum = parseInt(match[2]);
    const page = match[3] ? parseInt(match[3]) : 1;
    
    try {
      console.log(`🔍 جلب الأرشيف: ${series}${archiveNum} - الصفحة ${page}`);
      
      const archive = await Archive.findOne({ 
        series: series, 
        number: archiveNum 
      });
      
      if (!archive) {
        return `❌ الأرشيف ${series}${archiveNum} غير موجود`;
      }
      
      // تقسيم الأرشيف إلى صفحات (50 حساب لكل صفحة)
      const accountsPerPage = 50;
      const totalPages = Math.ceil(archive.accounts.length / accountsPerPage);
      
      if (page < 1 || page > totalPages) {
        return `❌ الصفحة ${page} غير موجودة. الأرشيف يحتوي على ${totalPages} صفحات.`;
      }
      
      const startIndex = (page - 1) * accountsPerPage;
      const endIndex = Math.min(startIndex + accountsPerPage, archive.accounts.length);
      const pageAccounts = archive.accounts.slice(startIndex, endIndex);
      
      let archiveText = `الارشيف ${series}${archiveNum} 🗂️ | الصفحة ${page} من ${totalPages}\n\n`;
      
      pageAccounts.forEach((account, index) => {
        const accountNumber = startIndex + index + 1;
        
        let formattedBalance = account.balance.toString();
        if (account.balance >= 1000) {
          formattedBalance = account.balance.toLocaleString().replace(/,/g, ' ');
        }
        
        archiveText += `${accountNumber} _${account.code} ${account.username}\n${formattedBalance} G\n\n`;
      });
      
      // إضافة تذييل للتنقل بين الصفحات
      if (totalPages > 1) {
        archiveText += `---\n📄 الصفحات: `;
        
        if (page > 1) {
          archiveText += `◀️ ${page - 1} `;
        }
        
        archiveText += `[ ${page} ]`;
        
        if (page < totalPages) {
          archiveText += ` ▶️ ${page + 1}`;
        }
        
        archiveText += `\nاستخدم: ارشيف ${series}${archiveNum} [رقم الصفحة]`;
      }
      
      return archiveText;
      
    } catch (error) {
      console.error('❌ خطأ في عرض الأرشيف:', error);
      return `❌ حدث خطأ في عرض الأرشيف ${series}${archiveNum}`;
    }
  }

  // الدوال الأخرى المهملة للإصلاح
  async modifyBalance(code, newBalance) {
    try {
      console.log(`🔄 محاولة تعديل الرصيد: ${code} -> ${newBalance}`);
      
      const account = await this.findAccount(code);
      if (!account) {
        return [false, "❌ الحساب غير موجود"];
      }
      
      if (newBalance < 0) {
        return [false, "❌ الرصيد لا يمكن أن يكون سالباً"];
      }
      
      // إذا كان الحساب من الأرشيف، نفعله أولاً
      if (account.source === 'archive') {
        console.log(`🔧 تفعيل حساب الأرشيف: ${code}`);
        const activated = await this.activateArchiveAccount(account);
        if (!activated) {
          return [false, "❌ فشل في تفعيل الحساب من الأرشيف"];
        }
      }
      
      // الحصول على الحساب المحدث
      const updatedAccount = await this.findAccount(code);
      if (!updatedAccount || !updatedAccount.user_id) {
        return [false, "❌ لا يمكن العثور على معرف المستخدم للحساب"];
      }
      
      console.log(`💾 تحديث الرصيد في قاعدة البيانات: ${code}`);
      await this.db.updateBalance(updatedAccount.user_id, newBalance);
      
      // تحديث الذاكرة المؤقتة
      await this.refreshAccountCache(code);
      
      return [true, `✅ تم التعديل بنجاح!\nالحساب: ${code}\nالرصيد الجديد: ${newBalance} ${config.currency}`];
    } catch (error) {
      console.error('❌ خطأ في التعديل:', error);
      return [false, "❌ فشل في التعديل - حاول مرة أخرى"];
    }
  }

  async banAccount(adminId, code) {
    try {
      console.log(`🔄 محاولة حظر الحساب: ${code}`);
      
      const account = await this.findAccount(code);
      if (!account) {
        return [false, "❌ الحساب غير موجود"];
      }
      
      // إذا كان الحساب من الأرشيف، نفعله أولاً
      if (account.source === 'archive') {
        console.log(`🔧 تفعيل حساب الأرشيف للحظر: ${code}`);
        const activated = await this.activateArchiveAccount(account);
        if (!activated) {
          return [false, "❌ فشل في تفعيل الحساب من الأرشيف"];
        }
      }
      
      // الحصول على الحساب المحدث
      const updatedAccount = await this.findAccount(code);
      if (!updatedAccount || !updatedAccount.user_id) {
        return [false, "❌ لا يمكن العثور على معرف المستخدم للحساب"];
      }
      
      console.log(`🔒 حظر الحساب في قاعدة البيانات: ${code} - المستخدم: ${updatedAccount.user_id}`);
      await this.db.updateAccountStatus(updatedAccount.user_id, 'banned');
      
      // تحديث الذاكرة المؤقتة
      await this.refreshAccountCache(code);
      
      return [true, `✅ تم حظر الحساب ${code}`];
    } catch (error) {
      console.error('❌ خطأ في الحظر:', error);
      return [false, "❌ فشل في حظر الحساب - حاول مرة أخرى"];
    }
  }

  async linkAccount(code, targetUserId, password) {
    try {
      console.log(`🔄 محاولة ربط الحساب: ${code} -> ${targetUserId}`);
      
      const account = await this.findAccount(code);
      if (!account) {
        return [false, "❌ الحساب غير موجود"];
      }
      
      if (password.length < 4) {
        return [false, "❌ كلمة السر يجب أن تكون 4 أحرف على الأقل"];
      }
      
      console.log(`🔧 تفعيل وربط حساب الأرشيف: ${code}`);
      
      // تفعيل الحساب أولاً مع الربط بالمستخدم الجديد
      const activated = await this.activateArchiveAccount(account, targetUserId, password);
      if (!activated) {
        return [false, "❌ فشل في تفعيل الحساب من الأرشيف للربط"];
      }
      
      // تأكيد أن الحساب مفعل ومربوط
      const updatedAccount = await this.db.getAccountByCode(code);
      if (updatedAccount && updatedAccount.user_id === targetUserId) {
        await this.refreshAccountCache(code);
        return [true, `✅ تم ربط الحساب بنجاح!\nالكود: ${code}\nالمعرف: ${targetUserId}\nكلمة السر: ${password}`];
      } else {
        return [false, "❌ فشل في تأكيد الربط - حاول مرة أخرى"];
      }
    } catch (error) {
      console.error('❌ خطأ في الربط:', error);
      return [false, `❌ فشل في ربط الحساب - حاول مرة أخرى`];
    }
  }

  async adminAddBalance(adminId, code, amount) {
    try {
      console.log(`🔄 محاولة إضافة رصيد: ${code} -> +${amount}`);
      
      const account = await this.findAccount(code);
      if (!account) {
        return [false, "❌ الحساب غير موجود"];
      }
      
      const currentBalance = account.balance;
      const newBalance = currentBalance + amount;
      
      // إذا كان الحساب من الأرشيف، نفعله أولاً
      if (account.source === 'archive') {
        console.log(`🔧 تفعيل حساب الأرشيف للإضافة: ${code}`);
        const activated = await this.activateArchiveAccount(account);
        if (!activated) {
          return [false, "❌ فشل في تفعيل الحساب من الأرشيف"];
        }
      }
      
      // الحصول على الحساب المحدث
      const updatedAccount = await this.findAccount(code);
      if (!updatedAccount || !updatedAccount.user_id) {
        return [false, "❌ لا يمكن العثور على معرف المستخدم للحساب"];
      }
      
      console.log(`💾 إضافة الرصيد في قاعدة البيانات: ${code} -> ${newBalance}`);
      await this.db.updateBalance(updatedAccount.user_id, newBalance);
      
      // تحديث الذاكرة المؤقتة
      await this.refreshAccountCache(code);
      
      return [true, `✅ تم الإضافة بنجاح!\nالحساب: ${code}\nالمبلغ: +${amount} ${config.currency}\nالرصيد الجديد: ${newBalance} ${config.currency}`];
    } catch (error) {
      console.error('❌ خطأ في الإضافة:', error);
      return [false, "❌ فشل في الإضافة - حاول مرة أخرى"];
    }
  }

  async adminDeductBalance(adminId, code, amount) {
    try {
      console.log(`🔄 محاولة خصم رصيد: ${code} -> -${amount}`);
      
      const account = await this.findAccount(code);
      if (!account) {
        return [false, "❌ الحساب غير موجود"];
      }
      
      const currentBalance = account.balance;
      if (currentBalance < amount) {
        return [false, "❌ الرصيد غير كاف للخصم"];
      }
      
      const newBalance = currentBalance - amount;
      
      // إذا كان الحساب من الأرشيف، نفعله أولاً
      if (account.source === 'archive') {
        console.log(`🔧 تفعيل حساب الأرشيف للخصم: ${code}`);
        const activated = await this.activateArchiveAccount(account);
        if (!activated) {
          return [false, "❌ فشل في تفعيل الحساب من الأرشيف"];
        }
      }
      
      // الحصول على الحساب المحدث
      const updatedAccount = await this.findAccount(code);
      if (!updatedAccount || !updatedAccount.user_id) {
        return [false, "❌ لا يمكن العثور على معرف المستخدم للحساب"];
      }
      
      console.log(`💾 خصم الرصيد في قاعدة البيانات: ${code}`);
      await this.db.updateBalance(updatedAccount.user_id, newBalance);
      
      // تحديث الذاكرة المؤقتة
      await this.refreshAccountCache(code);
      
      return [true, `✅ تم الخصم بنجاح!\nالحساب: ${code}\nالمبلغ: ${amount} ${config.currency}\nالرصيد الجديد: ${newBalance} ${config.currency}`];
    } catch (error) {
      console.error('❌ خطأ في الخصم:', error);
      return [false, "❌ فشل في الخصم - حاول مرة أخرى"];
    }
  }

  // الدوال المساعدة الأساسية
  isAdmin(userId) {
    return this.admins.has(userId);
  }

  isSuperAdmin(userId) {
    return userId === config.adminUserId;
  }

  async processCommand(userId, message) {
    if (this.isAdmin(userId)) {
      const command = message.trim().toLowerCase();
      return await this.handleAdminCommand(userId, command);
    }

    if (!config.systemSettings.botEnabled) {
      return "⏸️ البوت متوقف حاليًا. الرجاء المحاولة لاحقاً.";
    }

    const command = message.trim().toLowerCase();
    
    const publicCommands = ['معرفي', 'مساعدة', 'اوامر', 'تسجيل', 'رصيدي', 'تواصل', 'تعديل كلمة السر'];
    const isPublicCommand = publicCommands.some(cmd => command.startsWith(cmd) || command === cmd);
    
    if (isPublicCommand) {
      return await this.handlePublicCommand(userId, command);
    }
    
    if (!this.loginSessions.has(userId)) {
      return this.getWelcomeMessage();
    }
    
    try {
      if (command.startsWith('تحويل')) {
        return await this.handleTransfer(userId, command);
      }
      else if (command === 'معرفي') {
        return await this.handleGetId(userId);
      }
      else if (command === 'رصيدي') {
        return await this.handleMyBalance(userId);
      }
      else if (command === 'حالتي') {
        return await this.handleMyAccount(userId);
      }
      else if (command === 'مساعدة' || command === 'اوامر') {
        return await this.handleHelp(userId);
      }
      else if (command === 'تسجيل خروج') {
        return await this.handleLogout(userId);
      }
      else if (command.startsWith('تعديل كلمة السر')) {
        return await this.handleChangePassword(userId, command);
      }
      else {
        return this.getUnknownCommandResponse(command);
      }
    } catch (error) {
      console.error('❌ خطأ في معالجة الأمر:', error);
      return `❌ حدث خطأ: ${error.message}`;
    }
  }

  async handleAdminCommand(userId, command) {
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
      else if (command.startsWith('فك حظر')) {
        return await this.handleUnban(userId, command);
      }
      else if (command.startsWith('ارشيف')) {
        return await this.handleArchive(userId, command);
      }
      else if (command.startsWith('خصم')) {
        return await this.handleDeduct(userId, command);
      }
      else if (command.startsWith('رصيد')) {
        return await this.handleBalance(userId, command);
      }
      else if (command.startsWith('اضافة')) {
        return await this.handleAddBalance(userId, command);
      }
      else if (command.startsWith('تعديل ')) {
        return await this.handleModifyBalance(userId, command);
      }
      else if (command.startsWith('ربط')) {
        return await this.handleLinkAccount(userId, command);
      }
      else if (command.startsWith('اضف مشرف')) {
        return await this.handleAddAdmin(userId, command);
      }
      else if (command.startsWith('احذف مشرف')) {
        return await this.handleRemoveAdmin(userId, command);
      }
      else if (command === 'معرفي') {
        return await this.handleGetId(userId);
      }
      else if (command === 'مساعدة' || command === 'اوامر') {
        return await this.handleHelp(userId);
      }
      else if (command.startsWith('تعديل كلمة السر')) {
        return await this.handleChangePassword(userId, command);
      }
      else {
        return this.getUnknownCommandResponse(command);
      }
    } catch (error) {
      console.error('❌ خطأ في معالجة أمر المدير:', error);
      return `❌ حدث خطأ: ${error.message}`;
    }
  }

  // الدوال الأساسية الأخرى
  async handleModifyBalance(userId, command) {
    if (!this.isAdmin(userId)) {
      return `❌ هذا الأمر للمشرفين فقط`;
    }
    
    const match = command.match(/تعديل\s+(\w+)\s+(\d+)/i);
    if (!match) {
      return `❌ صيغة خاطئة! استخدم:\nتعديل [الكود] [الرصيد الجديد]\nمثال: تعديل B700B 5000`;
    }
    
    const code = match[1].toUpperCase();
    const newBalance = parseInt(match[2]);
    
    if (newBalance < 0) {
      return `❌ الرصيد لا يمكن أن يكون سالباً`;
    }
    
    try {
      const [success, response] = await this.modifyBalance(code, newBalance);
      return response;
    } catch (error) {
      console.error('❌ خطأ في تعديل الرصيد:', error);
      return `❌ حدث خطأ في تعديل الرصيد: ${error.message}`;
    }
  }

  async handleBan(userId, command) {
    if (!this.isAdmin(userId)) {
      return `❌ هذا الأمر للمشرفين فقط`;
    }
    
    const match = command.match(/حظر\s+(\w+)/i);
    if (!match) {
      return `❌ صيغة خاطئة! استخدم:\nحظر [الكود]\nمثال: حظر A100A`;
    }
    
    const code = match[1].toUpperCase();
    const [success, response] = await this.banAccount(userId, code);
    return response;
  }

  async handleLinkAccount(userId, command) {
    if (!this.isAdmin(userId)) {
      return `❌ هذا الأمر للمشرفين فقط`;
    }
    
    const match = command.match(/ربط\s+(\w+)\s+(\d+)\s+(\S+)/);
    if (!match) {
      return `❌ صيغة خاطئة! استخدم:\nربط [الكود] [المعرف] [كلمة السر]\nمثال: ربط B415B 24570538679239653 erwin1234`;
    }
    
    const code = match[1].toUpperCase();
    const targetUserId = match[2];
    const password = match[3];
    
    const [success, response] = await this.linkAccount(code, targetUserId, password);
    return response;
  }

  async handleAddBalance(userId, command) {
    if (!this.isAdmin(userId)) {
      return `❌ هذا الأمر للمشرفين فقط`;
    }
    
    const match = command.match(/اضافة\s+(\d+)g?\s+(\w+)/i);
    if (!match) {
      return `❌ صيغة خاطئة! استخدم:\nاضافة [المبلغ] [الكود]\nمثال: اضافة 5000 B700B`;
    }
    
    const amount = parseFloat(match[1]);
    const code = match[2].toUpperCase();
    
    const [success, response] = await this.adminAddBalance(userId, code, amount);
    return response;
  }

  async handleDeduct(userId, command) {
    if (!this.isAdmin(userId)) {
      return `❌ هذا الأمر للمشرفين فقط`;
    }
    
    const match = command.match(/خصم\s+(\d+)g?\s+(\w+)/i);
    if (!match) {
      return `❌ صيغة خاطئة! استخدم:\nخصم [المبلغ] [الكود]\nمثال: خصم 10000 A610A`;
    }
    
    const amount = parseFloat(match[1]);
    const code = match[2].toUpperCase();
    
    const [success, response] = await this.adminDeductBalance(userId, code, amount);
    return response;
  }

  // باقي الدوال الأساسية...
  getWelcomeMessage() {
    return `🏦 مرحباً في بنك GOLD

📋 الأوامر المتاحة:
• تسجيل [الكود] [كلمة السر] - تسجيل الدخول
• رصيدي - عرض رصيدك
• معرفي - عرض معرفك
• تعديل كلمة السر [الكود] [كلمة السر الجديدة] - تعديل كلمة السر
• تواصل - التواصل مع المسؤول
• مساعدة - عرض الأوامر المتاحة`;
  }

  async handleGetId(userId) {
    return `🆔 معرفك هو: ${userId}`;
  }

  async handleMyBalance(userId) {
    const account = await this.db.getAccountInfo(userId);
    if (!account) {
      return `❌ ليس لديك حساب نشط.`;
    }
    return `💰 رصيدك: ${account.balance} ${config.currency}`;
  }

  async handleMyAccount(userId) {
    const account = await this.db.getAccountInfo(userId);
    if (!account) {
      return `❌ ليس لديك حساب نشط.`;
    }
    return `📋 معلومات حسابك:

👤 الاسم: ${account.username}
🆔 الكود: ${account.code}
💰 الرصيد: ${account.balance} ${config.currency}`;
  }

  async handleHelp(userId) {
    const isAdmin = this.isAdmin(userId);
    
    let helpText = `🏦 أوامر بنك GOLD - المساعدة

`;
    
    if (isAdmin) {
      helpText += `🔧 أوامر المشرفين:
• انشاء [الاسم] - إنشاء حساب جديد
• ربط [الكود] [المعرف] [كلمة السر] - ربط حساب
• تحويل [المبلغ] [الكود] - تحويل غولد
• رصيد [الكود] - استعلام عن رصيد حساب
• ارشيف [A/B][رقم] [صفحة] - عرض الأرشيف (مثال: ارشيف B4 2)
• خصم [المبلغ] [الكود] - خصم غولد
• اضافة [المبلغ] [الكود] - إضافة غولد
• تعديل [الكود] [الرصيد] - تعديل الرصيد مباشرة
• حظر [الكود] - حظر حساب
• فك حظر [الكود] - فك حظر حساب
• تعديل كلمة السر [الكود] [كلمة السر] - تعديل كلمة السر
`;
    } else {
      helpText += `👤 أوامر المستخدم:
• تسجيل [الكود] [كلمة السر] - تسجيل الدخول
• رصيدي - عرض رصيدك
• حالتي - عرض معلومات حسابك
• تحويل [المبلغ] [الكود] - تحويل غولد
• تعديل كلمة السر [الكود] [كلمة السر الجديدة] - تعديل كلمة سر حسابك
• معرفي - عرض معرفك
• تسجيل خروج - تسجيل الخروج
• تواصل - التواصل مع المسؤول
`;
    }
    
    return helpText;
  }

  getUnknownCommandResponse(command) {
    return `❌ الأمر "${command}" غير معروف!\n\n🔍 اكتب مساعدة لعرض جميع الأوامر المتاحة.`;
  }

  async handleLogout(userId) {
    this.loginSessions.delete(userId);
    return `✅ تم تسجيل الخروج بنجاح!`;
  }

  // الدوال الأخرى الأساسية...
  async handleCreate(userId, command) {
    if (!this.isAdmin(userId)) {
      return "❌ إنشاء الحسابات متاح للمشرفين فقط.";
    }
    
    const parts = command.split(' ');
    if (parts.length < 2) {
      return `❌ صيغة خاطئة! استخدم:\nانشاء [الاسم الكامل]`;
    }
    
    const username = parts.slice(1).join(' ').trim();
    if (!username) {
      return `❌ يرجى إدخال اسم صحيح`;
    }
    
    const [success, response] = await this.createAccount(userId, username);
    
    if (success) {
      return `✅ تم إنشاء الحساب بنجاح!

📋 معلومات الحساب:
الكود: ${response.account.code}
الاسم: ${response.account.username}
الرصيد: ${response.account.balance} ${config.currency}`;
    } else {
      return response;
    }
  }

  async createAccount(userId, username, password = null, customCode = null) {
    let code = customCode || this.getNextCode();
    const passwordHash = password ? hashPassword(password) : hashPassword('default123');
    
    try {
      await this.db.createAccount(userId, code, username, passwordHash, config.initialBalance);
      
      return [true, {
        account: { code, username, balance: config.initialBalance }
      }];
    } catch (error) {
      return [false, `❌ فشل في إنشاء الحساب: ${error.message}`];
    }
  }

  getNextCode() {
    this.currentNumber += 1;
    
    if (this.currentLetter === 'B' && this.currentNumber > 999) {
      this.currentLetter = 'C';
      this.currentNumber = 1;
    }
    else if (this.currentLetter === 'C' && this.currentNumber > 999) {
      this.currentLetter = 'D';
      this.currentNumber = 1;
    }
    
    return `${this.currentLetter}${this.currentNumber.toString().padStart(3, '0')}${this.currentLetter}`;
  }

  async handleUnban(userId, command) {
    if (!this.isAdmin(userId)) {
      return `❌ هذا الأمر للمشرفين فقط`;
    }
    
    const match = command.match(/فك حظر\s+(\w+)/i);
    if (!match) {
      return `❌ صيغة خاطئة! استخدم:\nفك حظر [الكود]\nمثال: فك حظر A100A`;
    }
    
    const code = match[1].toUpperCase();
    const [success, response] = await this.unbanAccount(userId, code);
    return response;
  }

  async unbanAccount(adminId, code) {
    try {
      const account = await this.findAccount(code);
      if (!account) {
        return [false, "❌ الحساب غير موجود"];
      }
      
      // إذا كان الحساب من الأرشيف، نفعله أولاً
      if (account.source === 'archive') {
        console.log(`🔧 تفعيل حساب الأرشيف لفك الحظر: ${code}`);
        const activated = await this.activateArchiveAccount(account);
        if (!activated) {
          return [false, "❌ فشل في تفعيل الحساب من الأرشيف"];
        }
      }
      
      // الحصول على الحساب المحدث
      const updatedAccount = await this.findAccount(code);
      if (!updatedAccount || !updatedAccount.user_id) {
        return [false, "❌ لا يمكن العثور على معرف المستخدم للحساب"];
      }
      
      await this.db.updateAccountStatus(updatedAccount.user_id, 'active');
      
      // تحديث الذاكرة المؤقتة
      await this.refreshAccountCache(code);
      
      return [true, `✅ تم فك حظر الحساب ${code}`];
    } catch (error) {
      return [false, "❌ فشل في فك حظر الحساب"];
    }
  }

  async handleBalance(userId, command) {
    if (!this.isAdmin(userId)) {
      return `❌ هذا الأمر للمشرفين فقط`;
    }
    
    const match = command.match(/رصيد\s+(\w+)/i);
    if (!match) {
      return `❌ صيغة خاطئة! استخدم:\nرصيد [كود الحساب]\nمثال: رصيد A100A\nمثال: رصيد B700B`;
    }
    
    const code = match[1].toUpperCase();
    
    try {
      const account = await this.findAccount(code);
      
      if (!account) {
        return `❌ الحساب ${code} غير موجود`;
      }
      
      return `💰 رصيد الحساب:

الكود: ${account.code}
الاسم: ${account.username}
الرصيد: ${account.balance} ${config.currency}`;
    } catch (error) {
      return `❌ حدث خطأ في عرض رصيد الحساب`;
    }
  }

  async handleAddAdmin(userId, command) {
    if (!this.isSuperAdmin(userId)) {
      return `❌ هذا الأمر للمدير الأساسي فقط`;
    }
    
    const match = command.match(/اضف مشرف\s+(\d+)\s+(\S+)/);
    if (!match) {
      return `❌ صيغة خاطئة! استخدم:\nاضف مشرف [المعرف] [النوع]\nالأنواع: محاسبة، متجر، عام\nمثال: اضف مشرف 24570538679239653 محاسبة`;
    }
    
    const adminId = match[1];
    const adminType = match[2];
    
    const validTypes = ['محاسبة', 'متجر', 'عام'];
    if (!validTypes.includes(adminType)) {
      return `❌ نوع المشرف غير صحيح!\nالأنواع المتاحة: ${validTypes.join('، ')}`;
    }
    
    if (this.admins.has(adminId)) {
      return `❌ هذا المستخدم مشرف بالفعل!`;
    }
    
    this.admins.set(adminId, adminType);
    return `✅ تم إضافة المشرف بنجاح!\nالمعرف: ${adminId}\nالنوع: ${adminType}`;
  }

  async handleRemoveAdmin(userId, command) {
    if (!this.isSuperAdmin(userId)) {
      return `❌ هذا الأمر للمدير الأساسي فقط`;
    }
    
    const match = command.match(/احذف مشرف\s+(\d+)/);
    if (!match) {
      return `❌ صيغة خاطئة! استخدم:\nاحذف مشرف [المعرف]\nمثال: احذف مشرف 24570538679239653`;
    }
    
    const adminId = match[1];
    
    if (!this.admins.has(adminId)) {
      return `❌ هذا المستخدم ليس مشرفاً!`;
    }
    
    if (adminId === config.adminUserId) {
      return `❌ لا يمكن حذف المدير الأساسي!`;
    }
    
    this.admins.delete(adminId);
    return `✅ تم حذف المشرف بنجاح!\nالمعرف: ${adminId}`;
  }

  async handleChangePassword(userId, command) {
    const match = command.match(/تعديل كلمة السر\s+(\S+)\s+(\S+)/);
    if (!match) {
      return `❌ صيغة خاطئة! استخدم:\nتعديل كلمة السر [الكود] [كلمة السر الجديدة]\nمثال: تعديل كلمة السر B700B newpassword123`;
    }
    
    const code = match[1].toUpperCase();
    const newPassword = match[2];
    
    if (newPassword.length < 4) {
      return `❌ كلمة السر يجب أن تكون 4 أحرف على الأقل`;
    }
    
    try {
      const account = await this.findAccount(code);
      if (!account) {
        return `❌ الحساب ${code} غير موجود`;
      }
      
      if (account.source === 'archive') {
        await this.activateArchiveAccount(account, account.user_id, newPassword);
      }
      
      const userAccount = await this.db.getAccountInfo(userId);
      if (!userAccount || (userAccount.code !== code && !this.isAdmin(userId))) {
        return `❌ ليس لديك صلاحية لتعديل كلمة السر لهذا الحساب`;
      }
      
      const passwordHash = hashPassword(newPassword);
      
      // الحصول على الحساب المحدث
      const updatedAccount = await this.findAccount(code);
      if (!updatedAccount || !updatedAccount.user_id) {
        return `❌ لا يمكن العثور على معرف المستخدم للحساب`;
      }
      
      await this.db.updateAccountPassword(updatedAccount.user_id, passwordHash);
      
      return `✅ تم تعديل كلمة السر بنجاح!\nالحساب: ${code}\nكلمة السر الجديدة: ${newPassword}`;
    } catch (error) {
      console.error('خطأ في تعديل كلمة السر:', error);
      return `❌ فشل في تعديل كلمة السر: ${error.message}`;
    }
  }

  async handleTransfer(userId, command) {
    if (!config.systemSettings.transfers && !this.isAdmin(userId)) {
      return "⏸️ التحويلات متوقفة حاليًا. الرجاء المحاولة لاحقاً.";
    }
    
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

  async transferMoney(fromUser, toCode, amount) {
    if (amount <= 0) {
      return [false, "❌ المبلغ يجب أن يكون موجباً"];
    }
    
    const fromAccount = await this.db.getAccountInfo(fromUser);
    if (!fromAccount || fromAccount.balance < amount) {
      return [false, "❌ رصيد غير كافٍ"];
    }
    
    const toAccount = await this.findAccount(toCode);
    if (!toAccount) {
      return [false, "❌ الحساب المستلم غير موجود"];
    }
    
    try {
      if (toAccount.source === 'archive') {
        await this.activateArchiveAccount(toAccount);
      }
      
      // الحصول على الحساب المحدث
      const updatedToAccount = await this.findAccount(toCode);
      if (!updatedToAccount || !updatedToAccount.user_id) {
        return [false, "❌ لا يمكن العثور على معرف المستخدم للحساب المستلم"];
      }
      
      await this.db.transferMoney(fromUser, updatedToAccount.user_id, toCode, amount);
      const newBalance = fromAccount.balance - amount;
      
      return [true, `✅ تم التحويل بنجاح!\nالمبلغ: ${amount} ${config.currency}\nإلى: ${toCode}\nرصيدك الجديد: ${newBalance} ${config.currency}`];
    } catch (error) {
      return [false, "❌ فشل في التحويل"];
    }
  }

  async handlePublicCommand(userId, command) {
    try {
      if (command === 'معرفي') {
        return await this.handleGetId(userId);
      }
      else if (command === 'مساعدة' || command === 'اوامر') {
        return await this.handleHelp(userId);
      }
      else if (command.startsWith('تسجيل')) {
        return await this.handleLogin(userId, command);
      }
      else if (command.startsWith('رصيدي')) {
        return await this.handleMyBalance(userId);
      }
      else if (command.startsWith('تواصل')) {
        return "📞 للتواصل مع المسؤول لإنشاء حساب:\nراسل: @المسؤول";
      }
      else if (command.startsWith('تعديل كلمة السر')) {
        return await this.handleChangePassword(userId, command);
      }
      else {
        return this.getWelcomeMessage();
      }
    } catch (error) {
      console.error('❌ خطأ في معالجة الأمر العام:', error);
      return `❌ حدث خطأ: ${error.message}`;
    }
  }

  async handleLogin(userId, command) {
    const match = command.match(/تسجيل\s+(\w+)\s+(\S+)/);
    if (!match) {
      return `❌ صيغة خاطئة! استخدم:\nتسجيل [الكود] [كلمة السر]\nمثال: تسجيل B700B mypassword123`;
    }
    
    const code = match[1].toUpperCase();
    const password = match[2];
    
    try {
      const account = await this.findAccount(code);
      if (!account) {
        return `❌ الكود غير صحيح!`;
      }
      
      if (account.status === 'banned') {
        return `❌ الحساب محظور!\n\n📞 للاستفسار عن سبب الحظر، تواصل مع المسؤول`;
      }
      
      if (account.source === 'archive') {
        const dbAccount = await this.db.getAccountByCode(code);
        
        if (!dbAccount) {
          const activated = await this.activateArchiveAccount(account, userId, password);
          if (!activated) {
            return `❌ فشل في تفعيل الحساب من الأرشيف.`;
          }
          
          const newDbAccount = await this.db.getAccountByCode(code);
          if (!newDbAccount) {
            return `❌ فشل في تفعيل الحساب.`;
          }
          
          this.loginSessions.set(userId, true);
          await this.db.updateLastLogin(newDbAccount.user_id);
          
          return `✅ تم تفعيل وتسجيل الدخول بنجاح!\nمرحباً بك ${newDbAccount.username}\n\n💰 رصيدك: ${newDbAccount.balance} ${config.currency}`;
        } else {
          if (!verifyPassword(password, dbAccount.password)) {
            return `❌ كلمة السر غير صحيحة!`;
          }
          
          this.loginSessions.set(userId, true);
          await this.db.updateLastLogin(dbAccount.user_id);
          
          return `✅ تم تسجيل الدخول بنجاح!\nمرحباً بك ${dbAccount.username}\n\n💰 رصيدك: ${dbAccount.balance} ${config.currency}`;
        }
      } else {
        if (!verifyPassword(password, account.password)) {
          return `❌ كلمة السر غير صحيحة!`;
        }
        
        this.loginSessions.set(userId, true);
        await this.db.updateLastLogin(account.user_id);
        
        return `✅ تم تسجيل الدخول بنجاح!\nمرحباً بعودتك ${account.username}\n\n💰 رصيدك: ${account.balance} ${config.currency}`;
      }
    } catch (error) {
      console.error('❌ خطأ في تسجيل الدخول:', error);
      return `❌ حدث خطأ في تسجيل الدخول: ${error.message}`;
    }
  }
}

module.exports = BankSystem;
