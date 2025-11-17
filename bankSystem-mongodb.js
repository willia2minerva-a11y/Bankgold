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
            ...account.toObject ? account.toObject() : account,
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
            ...account.toObject ? account.toObject() : account,
            source: 'archive',
            archive_ref: `B${archive.number}`,
            status: 'active',
            user_id: account.user_id || null
          });
        }
      }
      
      console.log(`✅ تم تحميل ${this.allAccounts.size} حساب من الأرشيفات`);
      
      // تحميل الحسابات من قاعدة البيانات أيضاً
      const dbAccounts = await this.db.getAllAccounts();
      for (const account of dbAccounts) {
        this.allAccounts.set(account.code, {
          ...account,
          source: 'database',
          status: account.status || 'active'
        });
      }
      console.log(`✅ تم تحميل ${dbAccounts.length} حساب من قاعدة البيانات`);
      
    } catch (error) {
      console.error('❌ خطأ في تحميل الأرشيفات:', error);
      this.allAccounts = new Map();
    }
  }

  async findAccount(code) {
    const upperCode = code.toUpperCase();
    
    console.log(`🔍 البحث عن الحساب: ${upperCode}`);
    
    // البحث في الذاكرة المؤقتة أولاً
    if (this.allAccounts.has(upperCode)) {
      const account = this.allAccounts.get(upperCode);
      console.log(`✅ تم العثور على الحساب في الذاكرة: ${upperCode} - المصدر: ${account.source}`);
      return account;
    }
    
    // البحث في قاعدة البيانات
    try {
      const dbAccount = await this.db.getAccountByCode(upperCode);
      if (dbAccount) {
        console.log(`✅ تم العثور على الحساب في قاعدة البيانات: ${upperCode}`);
        const accountData = {
          ...dbAccount,
          source: 'database'
        };
        // تخزين في الذاكرة المؤقتة
        this.allAccounts.set(upperCode, accountData);
        return accountData;
      }
    } catch (error) {
      console.error('❌ خطأ في البحث في قاعدة البيانات:', error);
    }
    
    console.log(`❌ الحساب غير موجود: ${upperCode}`);
    return null;
  }

  async activateArchiveAccount(account, userId = null, password = null) {
    try {
      console.log(`🔧 محاولة تفعيل حساب الأرشيف: ${account.code}`);
      
      // البحث أولاً إذا كان الحساب موجوداً في قاعدة البيانات
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
        console.log(`🔄 الحساب موجود بالفعل في قاعدة البيانات: ${account.code}`);
        // تحديث البيانات إذا كان الحساب موجوداً
        if (userId && dbAccount.user_id !== userId) {
          await this.db.updateAccountUserId(dbAccount.user_id, userId);
        }
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
      
      console.log(`📊 معلومات الحساب: ${account.code} - المصدر: ${account.source} - المستخدم: ${account.user_id}`);
      
      // إذا كان الحساب من الأرشيف، نفعله أولاً
      if (account.source === 'archive') {
        console.log(`🔧 تفعيل حساب الأرشيف: ${code}`);
        const activated = await this.activateArchiveAccount(account);
        if (!activated) {
          return [false, "❌ فشل في تفعيل الحساب من الأرشيف"];
        }
      }
      
      // البحث عن الحساب المحدث
      const updatedAccount = await this.findAccount(code);
      if (!updatedAccount || !updatedAccount.user_id) {
        console.log(`❌ لا يمكن العثور على معرف المستخدم للحساب: ${code}`);
        return [false, "❌ لا يمكن العثور على معرف المستخدم للحساب"];
      }
      
      console.log(`💾 تحديث الرصيد في قاعدة البيانات: ${code} -> ${newBalance} للمستخدم: ${updatedAccount.user_id}`);
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
      
      console.log(`📊 معلومات الحساب: ${account.code} - المصدر: ${account.source} - المستخدم: ${account.user_id}`);
      
      // إذا كان الحساب من الأرشيف، نفعله أولاً
      if (account.source === 'archive') {
        console.log(`🔧 تفعيل حساب الأرشيف للحظر: ${code}`);
        const activated = await this.activateArchiveAccount(account);
        if (!activated) {
          return [false, "❌ فشل في تفعيل الحساب من الأرشيف"];
        }
      }
      
      // البحث عن الحساب المحدث
      const updatedAccount = await this.findAccount(code);
      if (!updatedAccount || !updatedAccount.user_id) {
        console.log(`❌ لا يمكن العثور على معرف المستخدم للحساب: ${code}`);
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
      
      console.log(`📊 معلومات الحساب: ${account.code} - المصدر: ${account.source}`);
      
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
      
      console.log(`📊 معلومات الحساب: ${account.code} - المصدر: ${account.source} - الرصيد الحالي: ${currentBalance}`);
      
      // إذا كان الحساب من الأرشيف، نفعله أولاً
      if (account.source === 'archive') {
        console.log(`🔧 تفعيل حساب الأرشيف للإضافة: ${code}`);
        const activated = await this.activateArchiveAccount(account);
        if (!activated) {
          return [false, "❌ فشل في تفعيل الحساب من الأرشيف"];
        }
      }
      
      // البحث عن الحساب المحدث
      const updatedAccount = await this.findAccount(code);
      if (!updatedAccount || !updatedAccount.user_id) {
        console.log(`❌ لا يمكن العثور على معرف المستخدم للحساب: ${code}`);
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

  // ... باقي الدوال بنفس النمط

  async processCommand(userId, message) {
    try {
      console.log(`📨 معالجة أمر من ${userId}: ${message}`);
      
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

  // ... باقي الدوال بدون تغيير

}

module.exports = BankSystem;