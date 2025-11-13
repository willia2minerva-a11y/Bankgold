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
    
    // البحث أولاً في قاعدة البيانات
    try {
      const dbAccount = await this.db.getAccountByCode(upperCode);
      if (dbAccount) {
        return { ...dbAccount, source: 'database' };
      }
    } catch (error) {
      console.error('❌ خطأ في البحث في قاعدة البيانات:', error);
    }
    
    // البحث في الأرشيفات
    if (this.allAccounts.has(upperCode)) {
      return this.allAccounts.get(upperCode);
    }
    
    return null;
  }

  async activateArchiveAccount(account, userId = null, password = null) {
    try {
      const dbAccount = await this.db.getAccountByCode(account.code);
      if (!dbAccount) {
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
          return true;
        }
      }
      return true;
    } catch (error) {
      console.error('❌ خطأ في تفعيل حساب الأرشيف:', error);
      return false;
    }
  }

  async getAllAccounts() {
    try {
      const dbAccounts = await this.db.getAllAccounts();
      const archiveAccounts = Array.from(this.allAccounts.values());
      
      const allAccountsMap = new Map();
      
      archiveAccounts.forEach(account => {
        allAccountsMap.set(account.code, account);
      });
      
      dbAccounts.forEach(account => {
        allAccountsMap.set(account.code, { ...account, source: 'database' });
      });
      
      return Array.from(allAccountsMap.values());
    } catch (error) {
      console.error('❌ خطأ في جلب جميع الحسابات:', error);
      return Array.from(this.allAccounts.values());
    }
  }

  isAdmin(userId) {
    return this.admins.has(userId);
  }

  isSuperAdmin(userId) {
    return userId === config.adminUserId;
  }

  hasPermission(userId, permission) {
    if (!this.isAdmin(userId)) return false;
    
    const adminType = this.admins.get(userId);
    
    const permissions = {
      'محاسبة': ['انشاء', 'ربط', 'تحويل', 'رصيد', 'ارشيف'],
      'متجر': ['خصم', 'اضافة', 'تعديل'],
      'عام': ['انشاء', 'ربط', 'تحويل', 'رصيد', 'ارشيف', 'خصم', 'اضافة', 'تعديل', 'حظر', 'فك حظر', 'محظورين']
    };
    
    return permissions[adminType]?.includes(permission) || false;
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
    else if (this.currentLetter > 'B' && this.currentNumber > 999) {
      this.currentLetter = String.fromCharCode(this.currentLetter.charCodeAt(0) + 1);
      this.currentNumber = 1;
    }
    
    return `${this.currentLetter}${this.currentNumber.toString().padStart(3, '0')}${this.currentLetter}`;
  }

  async processCommand(userId, message) {
    if (this.isAdmin(userId)) {
      const command = message.trim().toLowerCase();
      return await this.handleAdminCommand(userId, command);
    }

    if (!config.systemSettings.botEnabled) {
      return "⏸️ البوت متوقف حاليًا. الرجاء المحاولة لاحقاً.";
    }

    const timeCheck = this.checkWorkingHours();
    if (!timeCheck.withinHours) {
      return timeCheck.message;
    }

    if (config.systemSettings.maintenanceMode) {
      return config.systemSettings.maintenanceMessage;
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
        if (!this.hasPermission(userId, 'انشاء')) return this.getPermissionDeniedMessage();
        return await this.handleCreate(userId, command);
      }
      else if (command.startsWith('تحويل')) {
        if (!this.hasPermission(userId, 'تحويل')) return this.getPermissionDeniedMessage();
        return await this.handleTransfer(userId, command);
      }
      else if (command.startsWith('حظر')) {
        if (!this.hasPermission(userId, 'حظر')) return this.getPermissionDeniedMessage();
        return await this.handleBan(userId, command);
      }
      else if (command.startsWith('فك حظر')) {
        if (!this.hasPermission(userId, 'فك حظر')) return this.getPermissionDeniedMessage();
        return await this.handleUnban(userId, command);
      }
      else if (command === 'مجموع') {
        if (!this.isSuperAdmin(userId)) return this.getPermissionDeniedMessage();
        return await this.handleTotal(userId);
      }
      else if (command.startsWith('مجموع ')) {
        if (!this.isSuperAdmin(userId)) return this.getPermissionDeniedMessage();
        return await this.handleArchiveTotal(userId, command);
      }
      else if (command.startsWith('ارشيف')) {
        if (!this.hasPermission(userId, 'ارشيف')) return this.getPermissionDeniedMessage();
        return await this.handleArchive(userId, command);
      }
      else if (command.startsWith('توب ')) {
        if (!this.isSuperAdmin(userId)) return this.getPermissionDeniedMessage();
        return await this.handleArchiveTop(userId, command);
      }
      else if (command.startsWith('خصم')) {
        if (!this.hasPermission(userId, 'خصم')) return this.getPermissionDeniedMessage();
        return await this.handleDeduct(userId, command);
      }
      else if (command.startsWith('رصيد')) {
        if (!this.hasPermission(userId, 'رصيد')) return this.getPermissionDeniedMessage();
        return await this.handleBalance(userId, command);
      }
      else if (command.startsWith('اضافة')) {
        if (!this.hasPermission(userId, 'اضافة')) return this.getPermissionDeniedMessage();
        return await this.handleAddBalance(userId, command);
      }
      else if (command.startsWith('تعديل ')) {
        if (!this.hasPermission(userId, 'تعديل')) return this.getPermissionDeniedMessage();
        return await this.handleModifyBalance(userId, command);
      }
      else if (command.startsWith('ايقاف') || command.startsWith('تشغيل')) {
        return await this.handleSystemControl(userId, command);
      }
      else if (command.startsWith('ربط')) {
        if (!this.hasPermission(userId, 'ربط')) return this.getPermissionDeniedMessage();
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
      else if (command === 'توب') {
        if (!this.isSuperAdmin(userId)) return this.getPermissionDeniedMessage();
        return await this.handleTopUsers(userId);
      }
      else if (command === 'اجمالي' || command === 'الكل') {
        if (!this.isSuperAdmin(userId)) return this.getPermissionDeniedMessage();
        return await this.handleTotalGold(userId);
      }
      else if (command === 'محظورين') {
        if (!this.hasPermission(userId, 'محظورين')) return this.getPermissionDeniedMessage();
        return await this.handleBannedUsers(userId);
      }
      else if (command === 'مساعدة' || command === 'اوامر') {
        return await this.handleHelp(userId);
      }
      else if (command === 'حالة النظام') {
        return await this.handleSystemStatus(userId);
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

  getPermissionDeniedMessage() {
    return "❌ ليس لديك الصلاحية لاستخدام هذا الأمر!";
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
      await this.db.updateAccountPassword(account.user_id || userAccount.user_id, passwordHash);
      
      return `✅ تم تعديل كلمة السر بنجاح!\nالحساب: ${code}\nكلمة السر الجديدة: ${newPassword}`;
    } catch (error) {
      console.error('خطأ في تعديل كلمة السر:', error);
      return `❌ فشل في تعديل كلمة السر: ${error.message}`;
    }
  }

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
      const account = await this.findAccount(code);
      if (!account) {
        return `❌ الحساب ${code} غير موجود`;
      }
      
      if (account.source === 'archive') {
        await this.activateArchiveAccount(account);
      }
      
      const [success, response] = await this.modifyBalance(code, newBalance);
      return response;
    } catch (error) {
      console.error('❌ خطأ في تعديل الرصيد:', error);
      return `❌ حدث خطأ في تعديل الرصيد: ${error.message}`;
    }
  }

  checkWorkingHours() {
    if (!config.workingHours.enabled) {
      return { withinHours: true, message: "" };
    }

    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', { 
      hour12: false, 
      timeZone: config.workingHours.timezone 
    }).slice(0, 5);

    const currentTime = timeString;
    const startTime = config.workingHours.startTime;
    const endTime = config.workingHours.endTime;

    if (currentTime < startTime || currentTime > endTime) {
      return {
        withinHours: false,
        message: config.workingHours.offHoursMessage
      };
    }

    return { withinHours: true, message: "" };
  }

  getWelcomeMessage() {
    return `🏦 مرحباً في بنك GOLD

📋 الأوامر المتاحة:
• تسجيل [الكود] [كلمة السر] - تسجيل الدخول
• رصيدي - عرض رصيدك
• معرفي - عرض معرفك
• تعديل كلمة السر [الكود] [كلمة السر الجديدة] - تعديل كلمة السر
• تواصل - التواصل مع المسؤول
• مساعدة - عرض الأوامر المتاحة

🔒 النظام يدعم جميع الحسابات من الأرشيفات A و B`;
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

  async handleArchive(userId, command) {
    if (!this.isAdmin(userId)) {
      return `❌ هذا الأمر للمشرفين فقط`;
    }
    
    const match = command.match(/ارشيف\s+([AB])\s*(\d+)/i) || 
                  command.match(/ارشيف\s+([AB])(\d+)/i);
    
    if (!match) {
      return `❌ صيغة خاطئة! استخدم:\nارشيف [A/B][الرقم]\nمثال: ارشيف A1\nمثال: ارشيف B4`;
    }
    
    const series = match[1].toUpperCase();
    const archiveNum = parseInt(match[2]);
    
    try {
      const archive = await Archive.findOne({ 
        series: series, 
        number: archiveNum 
      });
      
      if (!archive) {
        return `❌ الأرشيف ${series}${archiveNum} غير موجود`;
      }
      
      let archiveText = `الارشيف ${series}${archiveNum} 🗂️\n\n`;
      
      archive.accounts.forEach((account, index) => {
        const accountNumber = index + 1;
        
        let formattedBalance = account.balance.toString();
        if (account.balance >= 1000) {
          formattedBalance = account.balance.toLocaleString().replace(/,/g, ' ');
        }
        
        archiveText += `${accountNumber} _${account.code} ${account.username}\n${formattedBalance} G\n\n`;
      });
      
      return archiveText;
      
    } catch (error) {
      console.error('❌ خطأ في عرض الأرشيف:', error);
      return `❌ حدث خطأ في عرض الأرشيف ${series}${archiveNum}`;
    }
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

  async handleMyBalance(userId) {
    const account = await this.db.getAccountInfo(userId);
    
    if (!account) {
      return `❌ ليس لديك حساب نشط.\n\n📞 للتواصل مع المسؤول لإنشاء حساب، اكتب: تواصل`;
    }
    
    return `💰 رصيدك: ${account.balance} ${config.currency}`;
  }

  async handleMyAccount(userId) {
    const account = await this.db.getAccountInfo(userId);
    
    if (!account) {
      return `❌ ليس لديك حساب نشط.\n\n📞 للتواصل مع المسؤول لإنشاء حساب، اكتب: تواصل`;
    }
    
    return `📋 معلومات حسابك:

👤 الاسم: ${account.username}
🆔 الكود: ${account.code}
💰 الرصيد: ${account.balance} ${config.currency}`;
  }

  async handleGetId(userId) {
    return `🆔 معرفك هو: ${userId}`;
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
• ارشيف [A/B][رقم] - عرض الأرشيف كاملاً
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

  async createAccountWithPassword(userId, username, password, customCode = null) {
    return await this.createAccount(userId, username, password, customCode);
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
      
      await this.db.transferMoney(fromUser, toAccount.user_id, toCode, amount);
      const newBalance = fromAccount.balance - amount;
      
      return [true, `✅ تم التحويل بنجاح!\nالمبلغ: ${amount} ${config.currency}\nإلى: ${toCode}\nرصيدك الجديد: ${newBalance} ${config.currency}`];
    } catch (error) {
      return [false, "❌ فشل في التحويل"];
    }
  }

  async banAccount(adminId, code) {
    if (!this.isAdmin(adminId)) {
      return [false, "غير مصرح لك"];
    }
    
    try {
      const account = await this.findAccount(code);
      if (!account) {
        return [false, "❌ الحساب غير موجود"];
      }
      
      if (account.source === 'archive') {
        await this.activateArchiveAccount(account);
      }
      
      await this.db.updateAccountStatus(account.user_id, 'banned');
      
      return [true, `✅ تم حظر الحساب ${code}`];
    } catch (error) {
      return [false, "❌ فشل في حظر الحساب"];
    }
  }

  async unbanAccount(adminId, code) {
    if (!this.isAdmin(adminId)) {
      return [false, "غير مصرح لك"];
    }
    
    try {
      const account = await this.findAccount(code);
      if (!account) {
        return [false, "❌ الحساب غير موجود"];
      }
      
      await this.db.updateAccountStatus(account.user_id, 'active');
      
      return [true, `✅ تم فك حظر الحساب ${code}`];
    } catch (error) {
      return [false, "❌ فشل في فك حظر الحساب"];
    }
  }

  async adminDeductBalance(adminId, code, amount) {
    if (!this.isAdmin(adminId)) {
      return [false, "غير مصرح لك"];
    }
    
    try {
      const account = await this.findAccount(code);
      if (!account) {
        return [false, "❌ الحساب غير موجود"];
      }
      
      const currentBalance = account.balance;
      if (currentBalance < amount) {
        return [false, "❌ الرصيد غير كاف للخصم"];
      }
      
      const newBalance = currentBalance - amount;
      
      if (account.source === 'archive') {
        await this.activateArchiveAccount(account);
      }
      
      await this.db.updateBalance(account.user_id, newBalance);
      
      return [true, `✅ تم الخصم بنجاح!\nالحساب: ${code}\nالمبلغ: ${amount} ${config.currency}\nالرصيد الجديد: ${newBalance} ${config.currency}`];
    } catch (error) {
      return [false, "❌ فشل في الخصم"];
    }
  }

  async adminAddBalance(adminId, code, amount) {
    if (!this.isAdmin(adminId)) {
      return [false, "غير مصرح لك"];
    }
    
    try {
      const account = await this.findAccount(code);
      if (!account) {
        return [false, "❌ الحساب غير موجود"];
      }
      
      const currentBalance = account.balance;
      const newBalance = currentBalance + amount;
      
      if (account.source === 'archive') {
        await this.activateArchiveAccount(account);
      }
      
      await this.db.updateBalance(account.user_id, newBalance);
      
      return [true, `✅ تم الإضافة بنجاح!\nالحساب: ${code}\nالمبلغ: +${amount} ${config.currency}\nالرصيد الجديد: ${newBalance} ${config.currency}`];
    } catch (error) {
      return [false, "❌ فشل في الإضافة"];
    }
  }

  async linkAccount(code, targetUserId, password) {
    try {
      const account = await this.findAccount(code);
      if (!account) {
        return [false, "❌ الحساب غير موجود"];
      }
      
      if (password.length < 4) {
        return [false, "❌ كلمة السر يجب أن تكون 4 أحرف على الأقل"];
      }
      
      const activated = await this.activateArchiveAccount(account, targetUserId, password);
      if (!activated) {
        return [false, "❌ فشل في تفعيل الحساب من الأرشيف للربط"];
      }
      
      return [true, `✅ تم ربط الحساب بنجاح!\nالكود: ${code}\nالمعرف: ${targetUserId}\nكلمة السر: ${password}`];
    } catch (error) {
      return [false, `❌ فشل في ربط الحساب: ${error.message}`];
    }
  }

  async modifyBalance(code, newBalance) {
    try {
      const account = await this.findAccount(code);
      if (!account) {
        return [false, "❌ الحساب غير موجود"];
      }
      
      if (newBalance < 0) {
        return [false, "❌ الرصيد لا يمكن أن يكون سالباً"];
      }
      
      if (account.source === 'archive') {
        await this.activateArchiveAccount(account);
      }
      
      await this.db.updateBalance(account.user_id, newBalance);
      
      return [true, `✅ تم التعديل بنجاح!\nالحساب: ${code}\nالرصيد الجديد: ${newBalance} ${config.currency}`];
    } catch (error) {
      return [false, "❌ فشل في التعديل"];
    }
  }

  // الدوال الأخرى المبسطة
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

  // الدوال الأخرى المطلوبة ولكن مبسطة
  async handleTotal(userId) {
    try {
      const allAccounts = await this.getAllAccounts();
      
      if (!allAccounts || allAccounts.length === 0) {
        return `📊 لا توجد حسابات في النظام بعد`;
      }
      
      let totalGold = 0;
      allAccounts.forEach(account => {
        totalGold += account.balance;
      });
      
      return `💰 إحصائيات النظام:

• إجمالي الغولد: ${totalGold.toLocaleString()} ${config.currency}
• عدد الحسابات: ${allAccounts.length.toLocaleString()}`;
    } catch (error) {
      return "❌ حدث خطأ في عرض إحصائيات النظام";
    }
  }

  async handleSystemControl(userId, command) {
    if (!this.isAdmin(userId)) {
      return `❌ هذا الأمر للمشرفين فقط`;
    }

    const parts = command.split(' ');
    const action = parts[0];
    const target = parts[1];

    let response = "";

    switch (target) {
      case 'البوت':
        config.systemSettings.botEnabled = (action === 'تشغيل');
        response = `✅ تم ${action} البوت`;
        break;

      case 'الانشاء':
        config.systemSettings.createAccounts = (action === 'تشغيل');
        response = `✅ تم ${action} إنشاء الحسابات`;
        break;

      case 'التحويلات':
        config.systemSettings.transfers = (action === 'تشغيل');
        response = `✅ تم ${action} التحويلات`;
        break;

      default:
        response = `❌ هدف غير معروف. الأهداف المتاحة: البوت، الانشاء، التحويلات`;
    }
    
    return response;
  }

  async handleSystemStatus(userId) {
    const status = config.systemSettings;

    let statusText = `🏦 حالة النظام الحالية

🔧 إعدادات النظام:
• البوت: ${status.botEnabled ? '🟢 نشط' : '🔴 متوقف'}
• إنشاء الحسابات: ${status.createAccounts ? '🟢 مفعل' : '🔴 متوقف'}
• التحويلات: ${status.transfers ? '🟢 مفعلة' : '🔴 متوقفة'}`;

    return statusText;
  }

  // الدوال الأخرى غير المستخدمة بشكل مبسط
  async handleArchiveTotal(userId, command) {
    return "❌ هذه الخاصية غير متاحة حالياً";
  }

  async handleArchiveTop(userId, command) {
    return "❌ هذه الخاصية غير متاحة حالياً";
  }

  async handleTopUsers(userId) {
    return "❌ هذه الخاصية غير متاحة حالياً";
  }

  async handleTotalGold(userId) {
    return "❌ هذه الخاصية غير متاحة حالياً";
  }

  async handleBannedUsers(userId) {
    return "❌ هذه الخاصية غير متاحة حالياً";
  }
}

module.exports = BankSystem;