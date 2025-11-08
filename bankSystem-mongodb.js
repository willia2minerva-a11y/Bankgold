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
    
    // تحميل جميع الحسابات من الأرشيفات إلى الذاكرة
    this.loadAllArchives();
  }

  // تحميل جميع الحسابات من الأرشيفات
  async loadAllArchives() {
    try {
      console.log('🔄 جاري تحميل الأرشيفات...');
      this.allAccounts = new Map();
      
      // تحميل الأرشيفات من السلسلة A
      const archivesA = await Archive.find({ series: 'A' });
      for (const archive of archivesA) {
        for (const account of archive.accounts) {
          this.allAccounts.set(account.code, {
            ...account,
            source: 'archive',
            archive_ref: `A${archive.number}`
          });
        }
      }
      
      // تحميل الأرشيفات من السلسلة B
      const archivesB = await Archive.find({ series: 'B' });
      for (const archive of archivesB) {
        for (const account of archive.accounts) {
          this.allAccounts.set(account.code, {
            ...account,
            source: 'archive',
            archive_ref: `B${archive.number}`
          });
        }
      }
      
      console.log(`✅ تم تحميل ${this.allAccounts.size} حساب من الأرشيفات`);
    } catch (error) {
      console.error('❌ خطأ في تحميل الأرشيفات:', error);
      this.allAccounts = new Map();
    }
  }

  // البحث عن حساب في الأرشيفات أو قاعدة البيانات
  async findAccount(code) {
    const upperCode = code.toUpperCase();
    
    // البحث أولاً في قاعدة البيانات (الحسابات المنشأة حديثاً)
    const dbAccount = await this.db.getAccountByCode(upperCode);
    if (dbAccount) {
      return { ...dbAccount, source: 'database' };
    }
    
    // إذا لم يوجد في قاعدة البيانات، ابحث في الأرشيفات
    if (this.allAccounts.has(upperCode)) {
      return this.allAccounts.get(upperCode);
    }
    
    return null;
  }

  // الحصول على جميع الحسابات (من الأرشيفات وقاعدة البيانات)
  async getAllAccounts() {
    try {
      const dbAccounts = await this.db.getAllAccounts();
      const archiveAccounts = Array.from(this.allAccounts.values());
      
      // دمج الحسابات مع إعطاء الأولوية لقاعدة البيانات (في حالة وجود تكرار)
      const allAccountsMap = new Map();
      
      // إضافة حسابات الأرشيفات أولاً
      archiveAccounts.forEach(account => {
        allAccountsMap.set(account.code, account);
      });
      
      // إضافة/استبدال بحسابات قاعدة البيانات
      dbAccounts.forEach(account => {
        allAccountsMap.set(account.code, { ...account, source: 'database' });
      });
      
      return Array.from(allAccountsMap.values());
    } catch (error) {
      console.error('❌ خطأ في جلب جميع الحسابات:', error);
      return Array.from(this.allAccounts.values());
    }
  }

  // دالة مساعدة للتحقق من المدير أو المشرف
  isAdmin(userId) {
    return this.admins.has(userId);
  }

  // دالة للتحقق من المدير الأساسي فقط
  isSuperAdmin(userId) {
    return userId === config.adminUserId;
  }

  // التحقق من صلاحيات المشرف
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
    
    if (this.currentNumber > 999) {
      this.currentNumber = 1;
      this.currentLetter = 'C';
    }
    
    return `${this.currentLetter}${this.currentNumber.toString().padStart(3, '0')}${this.currentLetter}`;
  }

  // التحقق من حالة النظام قبل معالجة أي أمر
  async processCommand(userId, message) {
    // السماح للمدير باستخدام الأوامر دون تسجيل دخول
    if (this.isAdmin(userId)) {
      const command = message.trim().toLowerCase();
      return await this.handleAdminCommand(userId, command);
    }

    // التحقق من حالة البوت العامة
    if (!config.systemSettings.botEnabled) {
      return config.systemSettings.maintenanceMode ? 
        config.systemSettings.maintenanceMessage : 
        "⏸️ البوت متوقف حاليًا. الرجاء المحاولة لاحقاً.";
    }

    // التحقق من أوقات العمل
    const timeCheck = this.checkWorkingHours();
    if (!timeCheck.withinHours) {
      return timeCheck.message;
    }

    // التحقق من وضع الصيانة
    if (config.systemSettings.maintenanceMode) {
      return config.systemSettings.maintenanceMessage;
    }

    const command = message.trim().toLowerCase();
    
    // الأوامر المسموحة بدون تسجيل دخول
    const publicCommands = ['معرفي', 'مساعدة', 'اوامر', 'تسجيل', 'رصيدي', 'تواصل', 'تعديل كلمة السر'];
    const isPublicCommand = publicCommands.some(cmd => command.startsWith(cmd) || command === cmd);
    
    if (isPublicCommand) {
      return await this.handlePublicCommand(userId, command);
    }
    
    // التحقق إذا كان المستخدم مسجل الدخول
    if (!this.loginSessions.has(userId)) {
      return this.getWelcomeMessage();
    }
    
    // إذا كان مسجل الدخول، نعالج الأوامر العادية
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

  // معالجة أوامر المديرين (بدون تسجيل دخول)
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
      else if (command.startsWith('ارشيف')) {
        if (!this.hasPermission(userId, 'ارشيف')) return this.getPermissionDeniedMessage();
        return await this.handleArchive(userId, command);
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
      else if (command.startsWith('ايقاف') || command.startsWith('تشغيل')) {
        return await this.handleSystemControl(userId, command);
      }
      else if (command.startsWith('ربط')) {
        if (!this.hasPermission(userId, 'ربط')) return this.getPermissionDeniedMessage();
        return await this.handleLinkAccount(userId, command);
      }
      else if (command.startsWith('تعديل')) {
        if (!this.hasPermission(userId, 'تعديل')) return this.getPermissionDeniedMessage();
        return await this.handleModifyBalance(userId, command);
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

  // رسالة رفض الصلاحية
  getPermissionDeniedMessage() {
    return "❌ ليس لديك الصلاحية لاستخدام هذا الأمر!";
  }

  // معالجة الأوامر العامة (بدون تسجيل دخول)
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
        return "📞 للتواصل مع المسؤول لإنشاء حساب:\nراسل: @المسؤول\nأو انتظر حتى يتم فتح إنشاء الحسابات";
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

  // أمر تعديل كلمة السر الجديد
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
      
      // إذا كان الحساب من الأرشيف، نحتاج إلى إنشاؤه في قاعدة البيانات أولاً
      if (account.source === 'archive') {
        const [success, response] = await this.createAccount(userId, account.username, newPassword, code);
        if (!success) {
          return response;
        }
        return `✅ تم إنشاء وتفعيل الحساب من الأرشيف!\nالكود: ${code}\nكلمة السر الجديدة: ${newPassword}`;
      }
      
      // التحقق من أن المستخدم هو صاحب الحساب أو مشرف
      if (account.user_id !== userId && !this.isAdmin(userId)) {
        return `❌ ليس لديك صلاحية لتعديل كلمة السر لهذا الحساب`;
      }
      
      const passwordHash = hashPassword(newPassword);
      await this.db.updateAccountPassword(account.user_id, passwordHash);
      
      return `✅ تم تعديل كلمة السر بنجاح!\nالحساب: ${code}\nكلمة السر الجديدة: ${newPassword}`;
    } catch (error) {
      console.error('خطأ في تعديل كلمة السر:', error);
      return `❌ فشل في تعديل كلمة السر`;
    }
  }

  // التحقق من أوقات العمل
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

  // رسالة ترحيب للمستخدمين الجدد
  getWelcomeMessage() {
    return `🏦 مرحباً في بنك GOLD

📋 الأوامر المتاحة:
• تسجيل [الكود] [كلمة السر] - تسجيل الدخول (لأي حساب في الأرشيفات)
• رصيدي - عرض رصيدك
• معرفي - عرض معرفك
• تعديل كلمة السر [الكود] [كلمة السر الجديدة] - تعديل كلمة السر
• تواصل - التواصل مع المسؤول
• مساعدة - عرض الأوامر المتاحة

🔒 النظام يدعم جميع الحسابات من الأرشيفات A و B`;
  }

  // تسجيل الدخول (يدعم الأرشيفات وقاعدة البيانات)
  async handleLogin(userId, command) {
    const match = command.match(/تسجيل\s+(\w+)\s+(\S+)/);
    if (!match) {
      return `❌ صيغة خاطئة! استخدم:\nتسجيل [الكود] [كلمة السر]\nمثال: تسجيل B700B mypassword123`;
    }
    
    const code = match[1].toUpperCase();
    const password = match[2];
    
    // البحث عن الحساب في الأرشيفات أو قاعدة البيانات
    const account = await this.findAccount(code);
    if (!account) {
      return `❌ الكود غير صحيح!`;
    }
    
    // إذا كان الحساب من الأرشيف، نتحقق من كلمة السر الافتراضية أو ننشئه
    if (account.source === 'archive') {
      // كلمة السر الافتراضية للأرشيفات
      const defaultPassword = '123456';
      if (password !== defaultPassword) {
        return `❌ كلمة السر غير صحيحة! كلمة السر الافتراضية للأرشيفات هي: ${defaultPassword}`;
      }
      
      // إنشاء الحساب في قاعدة البيانات إذا لم يكن موجوداً
      const existingDbAccount = await this.db.getAccountByCode(code);
      if (!existingDbAccount) {
        const [success, response] = await this.createAccount(userId, account.username, defaultPassword, code);
        if (!success) {
          return `❌ فشل في تفعيل الحساب من الأرشيف: ${response}`;
        }
      }
      
      // تحديث معلومات الحساب
      const updatedAccount = await this.db.getAccountByCode(code);
      this.loginSessions.set(userId, true);
      await this.db.updateLastLogin(updatedAccount.user_id);
      
      return `✅ تم تسجيل الدخول بنجاح!\nمرحباً بك ${account.username}\n\n💰 رصيدك: ${account.balance} ${config.currency}\n\n🔒 نوصي بتغيير كلمة السر باستخدام: تعديل كلمة السر ${code} [كلمة السر الجديدة]`;
    }
    
    // إذا كان الحساب من قاعدة البيانات
    if (!verifyPassword(password, account.password)) {
      return `❌ كلمة السر غير صحيحة!`;
    }
    
    if (account.status !== 'active') {
      return `❌ الحساب محظور!\n\n📞 للاستفسار عن سبب الحظر، تواصل مع المسؤول`;
    }
    
    this.loginSessions.set(userId, true);
    await this.db.updateLastLogin(account.user_id);
    
    return `✅ تم تسجيل الدخول بنجاح!\nمرحباً بعودتك ${account.username}\n\n💰 رصيدك: ${account.balance} ${config.currency}`;
  }

  // ربط حساب (للمشرف فقط)
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

  // تعديل الرصيد (للمشرف فقط)
  async handleModifyBalance(userId, command) {
    if (!this.isAdmin(userId)) {
      return `❌ هذا الأمر للمشرفين فقط`;
    }
    
    const match = command.match(/تعديل\s+(\w+)\s+(\d+)/);
    if (!match) {
      return `❌ صيغة خاطئة! استخدم:\nتعديل [الكود] [الرصيد الجديد]\nمثال: تعديل B415B 2000`;
    }
    
    const code = match[1].toUpperCase();
    const newBalance = parseFloat(match[2]);
    
    const [success, response] = await this.modifyBalance(code, newBalance);
    return response;
  }

  // إضافة مشرف (للمدير الأساسي فقط)
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
    return `✅ تم إضافة المشرف بنجاح!\nالمعرف: ${adminId}\nالنوع: ${adminType}\n\n⚠️ يمكن للمشرف استخدام الأوامر الخاصة بنوعه فقط`;
  }

  // حذف مشرف (للمدير الأساسي فقط)
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

  // فك حظر حساب (للمشرفين فقط)
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

  // عرض أعلى 10 مستخدمين (للمدير الأساسي فقط)
  async handleTopUsers(userId) {
    try {
      const allAccounts = await this.getAllAccounts();
      
      // تصفية الحسابات النشطة وترتيبها حسب الرصيد
      const activeAccounts = allAccounts
        .filter(acc => acc.balance > 0 && acc.status !== 'banned')
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 10);
      
      if (activeAccounts.length === 0) {
        return "📊 لا توجد حسابات نشطة لعرضها";
      }
      
      let topText = "🏆 أعلى 10 حسابات حسب الرصيد:\n\n";
      
      activeAccounts.forEach((account, index) => {
        const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : "🔸";
        const source = account.source === 'archive' ? ' (الأرشيف)' : '';
        topText += `${medal} ${account.code} - ${account.username}${source}\n   💰 ${account.balance} ${config.currency}\n\n`;
      });
      
      const totalGold = activeAccounts.reduce((sum, acc) => sum + acc.balance, 0);
      topText += `---\nإجمالي أعلى 10: ${totalGold} ${config.currency}`;
      
      return topText;
    } catch (error) {
      console.error('❌ خطأ في عرض التوب:', error);
      return "❌ حدث خطأ في عرض أعلى الحسابات";
    }
  }

  // عرض إجمالي الغولد في الأرشيفات (للمدير الأساسي فقط)
  async handleTotalGold(userId) {
    try {
      const allAccounts = await this.getAllAccounts();
      const totalGold = allAccounts.reduce((sum, acc) => sum + acc.balance, 0);
      const totalAccounts = allAccounts.length;
      
      const archiveAccounts = allAccounts.filter(acc => acc.source === 'archive');
      const databaseAccounts = allAccounts.filter(acc => acc.source === 'database');
      
      return `💰 إجمالي الغولد في النظام:

📊 الإحصائيات:
• إجمالي الغولد: ${totalGold.toLocaleString()} ${config.currency}
• عدد الحسابات: ${totalAccounts.toLocaleString()}
• متوسط الرصيد: ${totalAccounts > 0 ? Math.round(totalGold / totalAccounts) : 0} ${config.currency}

📁 المصادر:
• الأرشيفات: ${archiveAccounts.length} حساب
• قاعدة البيانات: ${databaseAccounts.length} حساب
• الحسابات النشطة: ${allAccounts.filter(acc => acc.balance > 0).length} حساب`;
    } catch (error) {
      console.error('❌ خطأ في عرض الإجمالي:', error);
      return "❌ حدث خطأ في عرض الإجمالي";
    }
  }

  // عرض المحظورين
  async handleBannedUsers(userId) {
    try {
      const allAccounts = await this.getAllAccounts();
      const bannedAccounts = allAccounts.filter(acc => acc.status === 'banned');
      
      if (bannedAccounts.length === 0) {
        return "✅ لا توجد حسابات محظورة حالياً";
      }
      
      let bannedText = "🚫 الحسابات المحظورة:\n\n";
      
      bannedAccounts.forEach(account => {
        bannedText += `• ${account.code} - ${account.username}\n`;
      });
      
      bannedText += `\n---\nإجمالي المحظورين: ${bannedAccounts.length} حساب`;
      
      return bannedText;
    } catch (error) {
      console.error('❌ خطأ في عرض المحظورين:', error);
      return "❌ حدث خطأ في عرض المحظورين";
    }
  }

  // التحكم في النظام (للمشرفين فقط)
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
        response = `✅ تم ${action} البوت ${action === 'تشغيل' ? 'بنجاح' : 'بنجاح'}`;
        break;

      case 'الانشاء':
        config.systemSettings.createAccounts = (action === 'تشغيل');
        response = `✅ تم ${action} إنشاء الحسابات ${action === 'تشغيل' ? 'بنجاح' : 'بنجاح'}`;
        break;

      case 'التحويلات':
        config.systemSettings.transfers = (action === 'تشغيل');
        response = `✅ تم ${action} التحويلات ${action === 'تشغيل' ? 'بنجاح' : 'بنجاح'}`;
        break;

      case 'الصيانة':
        config.systemSettings.maintenanceMode = (action === 'ايقاف');
        response = `✅ تم ${action === 'ايقاف' ? 'تفعيل' : 'إلغاء'} وضع الصيانة`;
        break;

      case 'الاوقات':
        config.workingHours.enabled = (action === 'تشغيل');
        response = `✅ تم ${action} نظام أوقات العمل ${action === 'تشغيل' ? 'بنجاح' : 'بنجاح'}`;
        break;

      default:
        response = `❌ هدف غير معروف. الأهداف المتاحة: البوت، الانشاء، التحويلات، الصيانة، الاوقات`;
    }

    await this.db.logSystemOperation('system_control', target, action, userId);
    
    return response;
  }

  // عرض حالة النظام
  async handleSystemStatus(userId) {
    const status = config.systemSettings;
    const workingHours = config.workingHours;
    const timeCheck = this.checkWorkingHours();

    let statusText = `🏦 حالة النظام الحالية

🔧 إعدادات النظام:
• البوت: ${status.botEnabled ? '🟢 نشط' : '🔴 متوقف'}
• إنشاء الحسابات: ${status.createAccounts ? '🟢 مفعل' : '🔴 متوقف'}
• التحويلات: ${status.transfers ? '🟢 مفعلة' : '🔴 متوقفة'}
• وضع الصيانة: ${status.maintenanceMode ? '🟡 مفعل' : '🔴 غير مفعل'}
• أوقات العمل: ${workingHours.enabled ? '🟢 مفعلة' : '🔴 غير مفعلة'}

`;

    if (workingHours.enabled) {
      statusText += `⏰ أوقات العمل:
• من: ${workingHours.startTime}
• إلى: ${workingHours.endTime}
• الحالة الآن: ${timeCheck.withinHours ? '🟢 ضمن أوقات العمل' : '🔴 خارج أوقات العمل'}

`;
    }

    try {
      const allAccounts = await this.getAllAccounts();
      const activeAccounts = allAccounts.filter(acc => acc.balance > 0).length;
      const totalGold = allAccounts.reduce((sum, acc) => sum + acc.balance, 0);
      
      statusText += `📊 الإحصائيات:
• إجمالي الحسابات: ${allAccounts.length}
• الحسابات النشطة: ${activeAccounts}
• إجمالي الغولد: ${totalGold.toLocaleString()} ${config.currency}
• السلسلة الحالية: ${this.currentLetter}
• التالي: ${this.getNextCode()}`;
    } catch (error) {
      statusText += `❌ خطأ في تحميل الإحصائيات`;
    }

    return statusText;
  }

  async handleCreate(userId, command) {
    if (!this.isAdmin(userId)) {
      return "❌ إنشاء الحسابات متاح للمشرفين فقط.\n\n📞 للتواصل مع المسؤول لإنشاء حساب، اكتب: تواصل";
    }
    
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
      return `✅ تم إنشاء الحساب بنجاح!

📋 معلومات الحساب:
الكود: ${response.account.code}
الاسم: ${response.account.username}
الرصيد: ${response.account.balance} ${config.currency}

💳 تم إضافة البطاقة إلى الأرشيف`;
    } else {
      return response;
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

  async handleTotal(userId) {
    if (!this.isSuperAdmin(userId)) {
      return `❌ هذا الأمر للمدير الأساسي فقط`;
    }
    
    try {
      const allAccounts = await this.getAllAccounts();
      
      if (!allAccounts || allAccounts.length === 0) {
        return `📊 لا توجد حسابات في النظام بعد`;
      }
      
      let totalGold = 0;
      let activeAccounts = 0;
      
      allAccounts.forEach(account => {
        totalGold += account.balance;
        if (account.balance > 0 && account.status !== 'banned') {
          activeAccounts++;
        }
      });
      
      const averageBalance = allAccounts.length > 0 ? Math.round(totalGold / allAccounts.length) : 0;
      
      return `💰 إحصائيات النظام:

• إجمالي الغولد: ${totalGold.toLocaleString()} ${config.currency}
• عدد الحسابات: ${allAccounts.length.toLocaleString()}
• الحسابات النشطة: ${activeAccounts.toLocaleString()}
• متوسط الرصيد: ${averageBalance} ${config.currency}`;
    } catch (error) {
      console.error('❌ خطأ في عرض المجموع:', error);
      return "❌ حدث خطأ في عرض إحصائيات النظام";
    }
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
      console.log(`🔍 البحث عن الأرشيف: ${series}${archiveNum}`);
      
      const archive = await Archive.findOne({ 
        series: series, 
        number: archiveNum 
      });
      
      if (!archive) {
        console.log(`❌ الأرشيف غير موجود: ${series}${archiveNum}`);
        const availableArchives = await this.getAvailableArchives(series);
        return `❌ الأرشيف ${series}${archiveNum} غير موجود\n\n📂 الأرشيفات المتاحة في سلسلة ${series}:\n${availableArchives}`;
      }
      
      console.log(`✅ تم العثور على الأرشيف: ${archive.name} - ${archive.accounts.length} حساب`);
      return this.formatArchiveDisplay(archive);
    } catch (error) {
      console.error('❌ خطأ في عرض الأرشيف:', error);
      return `❌ حدث خطأ في عرض الأرشيف ${series}${archiveNum}: ${error.message}`;
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

  // أمر إضافة رصيد (للمشرفين فقط)
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

  // عرض رصيد حساب (للمشرفين فقط)
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
      
      const sourceText = account.source === 'archive' ? 'الأرشيف' : 'قاعدة البيانات';
      const statusText = account.status === 'active' ? '🟢 نشط' : '🔴 محظور';
      
      return `💰 رصيد الحساب:

الكود: ${account.code}
الاسم: ${account.username}
الرصيد: ${account.balance} ${config.currency}
الحالة: ${statusText}
المصدر: ${sourceText}`;
    } catch (error) {
      console.error('خطأ في عرض الرصيد:', error);
      return `❌ حدث خطأ في عرض رصيد الحساب`;
    }
  }

  // عرض رصيدي (للمستخدم العادي)
  async handleMyBalance(userId) {
    // البحث عن الحساب المرتبط بهذا المستخدم
    const account = await this.db.getAccountInfo(userId);
    
    if (!account) {
      return `❌ ليس لديك حساب نشط.\n\n💡 يمكنك تسجيل الدخول بأي حساب من الأرشيفات باستخدام:\nتسجيل [الكود] 123456\n\n📋 الأكواد المتاحة في الأرشيفات A و B`;
    }
    
    return `💰 رصيدك: ${account.balance} ${config.currency}`;
  }

  // عرض حالتي (للمستخدم العادي)
  async handleMyAccount(userId) {
    const account = await this.db.getAccountInfo(userId);
    
    if (!account) {
      return `❌ ليس لديك حساب نشط.\n\n💡 يمكنك تسجيل الدخول بأي حساب من الأرشيفات باستخدام:\nتسجيل [الكود] 123456\n\n📋 الأكواد المتاحة في الأرشيفات A و B`;
    }
    
    return `📋 معلومات حسابك:

👤 الاسم: ${account.username}
🆔 الكود: ${account.code}
💰 الرصيد: ${account.balance} ${config.currency}
📅 الحالة: ${account.status === 'active' ? '🟢 نشط' : '🔴 محظور'}`;
  }

  async handleGetId(userId) {
    return `🆔 معرفك هو: ${userId}`;
  }

  async handleHelp(userId) {
    const isAdmin = this.isAdmin(userId);
    const isSuperAdmin = this.isSuperAdmin(userId);
    const adminType = this.admins.get(userId);
    
    let helpText = `🏦 أوامر بنك GOLD - المساعدة

💡 النظام يدعم جميع الحسابات من الأرشيفات A و B
🔐 كلمة السر الافتراضية للأرشيفات: 123456

`;
    
    if (isAdmin) {
      helpText += `⚡ أوامر التحكم بالنظام:
• تشغيل البوت / ايقاف البوت - تشغيل/إيقاف البوت
• تشغيل الانشاء / ايقاف الانشاء - السماح/منع إنشاء حسابات
• تشغيل التحويلات / ايقاف التحويلات - السماح/منع التحويلات
• ايقاف الصيانة / تشغيل الصيانة - تفعيل/إلغاء وضع الصيانة
• تشغيل الاوقات / ايقاف الاوقات - تفعيل/إلغاء أوقات العمل
• حالة النظام - عرض حالة النظام المفصلة

`;
      
      helpText += `🔧 الأوامر المتاحة لك (${adminType}):
`;
      
      if (this.hasPermission(userId, 'انشاء')) {
        helpText += `• انشاء [الاسم] [كلمة السر] - إنشاء حساب جديد\n`;
      }
      if (this.hasPermission(userId, 'ربط')) {
        helpText += `• ربط [الكود] [المعرف] [كلمة السر] - ربط حساب\n`;
      }
      if (this.hasPermission(userId, 'تحويل')) {
        helpText += `• تحويل [المبلغ] [الكود] - تحويل غولد\n`;
      }
      if (this.hasPermission(userId, 'رصيد')) {
        helpText += `• رصيد [الكود] - استعلام عن رصيد حساب\n`;
      }
      if (this.hasPermission(userId, 'ارشيف')) {
        helpText += `• ارشيف [A/B][رقم] - عرض الأرشيفات\n`;
      }
      if (this.hasPermission(userId, 'خصم')) {
        helpText += `• خصم [المبلغ] [الكود] - خصم غولد\n`;
      }
      if (this.hasPermission(userId, 'اضافة')) {
        helpText += `• اضافة [المبلغ] [الكود] - إضافة غولد\n`;
      }
      if (this.hasPermission(userId, 'تعديل')) {
        helpText += `• تعديل [الكود] [الرصيد] - تعديل الرصيد مباشرة\n`;
      }
      if (this.hasPermission(userId, 'حظر')) {
        helpText += `• حظر [الكود] - حظر حساب\n`;
      }
      if (this.hasPermission(userId, 'فك حظر')) {
        helpText += `• فك حظر [الكود] - فك حظر حساب\n`;
      }
      if (this.hasPermission(userId, 'محظورين')) {
        helpText += `• محظورين - عرض قائمة المحظورين\n`;
      }
      helpText += `• تعديل كلمة السر [الكود] [كلمة السر] - تعديل كلمة السر\n`;
      
      helpText += `\n`;
      
      if (isSuperAdmin) {
        helpText += `👑 أوامر المدير الأساسي:
• مجموع - إجمالي الغولد
• توب - أعلى 10 حسابات
• اجمالي / الكل - إجمالي الغولد في الأرشيفات
• اضف مشرف [المعرف] [النوع] - إضافة مشرف جديد
• احذف مشرف [المعرف] - حذف مشرف

`;
      }
    } else {
      helpText += `👤 أوامر المستخدم:
• تسجيل [الكود] [123456] - تسجيل الدخول (لحسابات الأرشيفات)
• رصيدي - عرض رصيدك
• حالتي - عرض معلومات حسابك
• تحويل [المبلغ] [الكود] - تحويل غولد
• تعديل كلمة السر [الكود] [كلمة السر الجديدة] - تعديل كلمة سر حسابك
• معرفي - عرض معرفك
• حالة النظام - عرض حالة النظام
• تسجيل خروج - تسجيل الخروج
• تواصل - التواصل مع المسؤول
• مساعدة - عرض هذه الرسالة

`;
    }
    
    // إضافة معلومات النظام للمشرفين فقط
    if (isAdmin) {
      try {
        const allAccounts = await this.getAllAccounts();
        const totalGold = allAccounts.reduce((sum, acc) => sum + acc.balance, 0);
        
        helpText += `📊 معلومات النظام:
• الرصيد الابتدائي: 15 ${config.currency}
• إجمالي الحسابات: ${allAccounts.length}
• إجمالي الغولد: ${totalGold.toLocaleString()} ${config.currency}
• السلسلة الحالية: ${this.currentLetter}
• التالي: ${this.getNextCode()}`;
      } catch (error) {
        helpText += `📊 معلومات النظام: ❌ خطأ في تحميل الإحصائيات`;
      }
    }
    
    return helpText;
  }

  async getAvailableArchives(series) {
    try {
      return await Archive.getAvailableArchives(series);
    } catch (error) {
      console.error('❌ خطأ في تحميل الأرشيفات:', error);
      return "❌ خطأ في تحميل الأرشيفات";
    }
  }

  getUnknownCommandResponse(command) {
    return `❌ الأمر "${command}" غير معروف!\n\n🔍 اكتب مساعدة لعرض جميع الأوامر المتاحة.\n\n💡 تلميح: تأكد من كتابة الأمر بشكل صحيح.`;
  }

  formatArchiveDisplay(archiveData) {
    let text = `📁 ${archiveData.name}\n`;
    text += `📍 من ${archiveData.start} إلى ${archiveData.end}\n\n`;
    
    let totalBalance = 0;
    let accountCount = 0;
    
    // عرض أول 20 حساب فقط لتجنب الرسالة الطويلة
    const displayAccounts = archiveData.accounts.slice(0, 20);
    
    displayAccounts.forEach(account => {
      text += `${account.code} ${account.username}\n${account.balance} ${config.currency}\n\n`;
      totalBalance += account.balance;
      accountCount++;
    });
    
    // إذا كان هناك أكثر من 20 حساب، أضف ملاحظة
    if (archiveData.accounts.length > 20) {
      text += `... و ${archiveData.accounts.length - 20} حساب آخر\n\n`;
    }
    
    // حساب الإجمالي لجميع الحسابات
    const totalAllAccounts = archiveData.accounts.reduce((sum, acc) => sum + acc.balance, 0);
    
    text += `--- الإحصاءات ---\n`;
    text += `• عدد الحسابات: ${archiveData.accounts.length}\n`;
    text += `• إجمالي الغولد: ${totalAllAccounts} ${config.currency}\n`;
    text += `• متوسط الرصيد: ${archiveData.accounts.length > 0 ? Math.round(totalAllAccounts / archiveData.accounts.length) : 0} ${config.currency}`;
    
    return text;
  }

  async createAccount(userId, username, password = null, customCode = null) {
    let code = customCode || this.getNextCode();
    const passwordHash = password ? hashPassword(password) : hashPassword('default123');
    
    try {
      await this.db.createAccount(userId, code, username, passwordHash, config.initialBalance);
      
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
    
    const fromAccount = await this.db.getAccountInfo(fromUser);
    if (!fromAccount || fromAccount.balance < amount) {
      return [false, "❌ رصيد غير كافٍ"];
    }
    
    const toAccount = await this.findAccount(toCode);
    if (!toAccount) {
      return [false, "❌ الحساب المستلم غير موجود"];
    }
    
    if (toAccount.status !== 'active') {
      return [false, "❌ لا يمكن التحويل لحساب محظور"];
    }
    
    try {
      // إذا كان الحساب المستلم من الأرشيف، ننشئه في قاعدة البيانات أولاً
      if (toAccount.source === 'archive') {
        const [success, response] = await this.createAccount(null, toAccount.username, '123456', toCode);
        if (!success) {
          return [false, "❌ فشل في تفعيل الحساب المستلم من الأرشيف"];
        }
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
    
    const account = await this.findAccount(code);
    if (!account) {
      return [false, "❌ الحساب غير موجود"];
    }
    
    try {
      // إذا كان الحساب من الأرشيف، ننشئه في قاعدة البيانات أولاً
      if (account.source === 'archive') {
        const [success, response] = await this.createAccount(null, account.username, '123456', code);
        if (!success) {
          return [false, "❌ فشل في تفعيل الحساب من الأرشيف للحظر"];
        }
      }
      
      await this.db.updateAccountStatus(account.user_id, 'banned');
      config.blacklistedAccounts.push(code);
      
      return [true, `✅ تم حظر الحساب ${code}`];
    } catch (error) {
      return [false, "❌ فشل في حظر الحساب"];
    }
  }

  async unbanAccount(adminId, code) {
    if (!this.isAdmin(adminId)) {
      return [false, "غير مصرح لك"];
    }
    
    const account = await this.findAccount(code);
    if (!account) {
      return [false, "❌ الحساب غير موجود"];
    }
    
    try {
      await this.db.updateAccountStatus(account.user_id, 'active');
      // إزالة الحساب من القائمة السوداء
      const index = config.blacklistedAccounts.indexOf(code);
      if (index > -1) {
        config.blacklistedAccounts.splice(index, 1);
      }
      
      return [true, `✅ تم فك حظر الحساب ${code}`];
    } catch (error) {
      return [false, "❌ فشل في فك حظر الحساب"];
    }
  }

  async adminDeductBalance(adminId, code, amount) {
    if (!this.isAdmin(adminId)) {
      return [false, "غير مصرح لك"];
    }
    
    const account = await this.findAccount(code);
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
      // إذا كان الحساب من الأرشيف، ننشئه في قاعدة البيانات أولاً
      if (account.source === 'archive') {
        const [success, response] = await this.createAccount(null, account.username, '123456', code);
        if (!success) {
          return [false, "❌ فشل في تفعيل الحساب من الأرشيف للخصم"];
        }
      }
      
      await this.db.updateBalance(account.user_id, newBalance);
      await this.db.logOperation('deduct', amount, null, code, 'خصم مباشر', adminId);
      
      return [true, `✅ تم الخصم بنجاح!\nالحساب: ${code}\nالمبلغ: ${amount} ${config.currency}\nالرصيد الجديد: ${newBalance} ${config.currency}`];
    } catch (error) {
      return [false, "❌ فشل في الخصم"];
    }
  }

  // دالة إضافة الرصيد في النظام
  async adminAddBalance(adminId, code, amount) {
    if (!this.isAdmin(adminId)) {
      return [false, "غير مصرح لك"];
    }
    
    const account = await this.findAccount(code);
    if (!account) {
      return [false, "❌ الحساب غير موجود"];
    }
    
    if (config.blacklistedAccounts.includes(code)) {
      return [false, "❌ لا يمكن تعديل حساب محظور"];
    }
    
    const currentBalance = account.balance;
    const newBalance = currentBalance + amount;
    
    try {
      // إذا كان الحساب من الأرشيف، ننشئه في قاعدة البيانات أولاً
      if (account.source === 'archive') {
        const [success, response] = await this.createAccount(null, account.username, '123456', code);
        if (!success) {
          return [false, "❌ فشل في تفعيل الحساب من الأرشيف للإضافة"];
        }
      }
      
      await this.db.updateBalance(account.user_id, newBalance);
      await this.db.logOperation('add', amount, null, code, 'إضافة مباشرة', adminId);
      
      return [true, `✅ تم الإضافة بنجاح!\nالحساب: ${code}\nالمبلغ: +${amount} ${config.currency}\nالرصيد الجديد: ${newBalance} ${config.currency}`];
    } catch (error) {
      return [false, "❌ فشل في الإضافة"];
    }
  }

  // ربط حساب بمستخدم وكلمة سر
  async linkAccount(code, targetUserId, password) {
    const account = await this.findAccount(code);
    if (!account) {
      return [false, "❌ الحساب غير موجود"];
    }
    
    if (password.length < 4) {
      return [false, "❌ كلمة السر يجب أن تكون 4 أحرف على الأقل"];
    }
    
    const passwordHash = hashPassword(password);
    
    try {
      // إذا كان الحساب من الأرشيف، ننشئه في قاعدة البيانات أولاً
      if (account.source === 'archive') {
        const [success, response] = await this.createAccount(targetUserId, account.username, password, code);
        if (!success) {
          return [false, "❌ فشل في تفعيل الحساب من الأرشيف للربط"];
        }
        return [true, `✅ تم ربط الحساب بنجاح!\nالكود: ${code}\nالمعرف: ${targetUserId}`];
      }
      
      // البحث عن المستخدم الحالي المرتبط بهذا الكود وإلغاء ربطه
      const currentAccount = await this.db.getAccountByCode(code);
      if (currentAccount && currentAccount.user_id) {
        // إلغاء تسجيل الدخول للمستخدم القديم
        this.loginSessions.delete(currentAccount.user_id);
      }
      
      // ربط الحساب بالمستخدم الجديد
      await this.db.updateUserId(account.user_id, targetUserId);
      await this.db.updateAccountPassword(targetUserId, passwordHash);
      
      return [true, `✅ تم ربط الحساب بنجاح!\nالكود: ${code}\nالمعرف: ${targetUserId}\n\n⚠️ تم إلغاء الربط السابق لهذا الكود`];
    } catch (error) {
      return [false, `❌ فشل في ربط الحساب: ${error.message}`];
    }
  }

  // تعديل الرصيد مباشرة
  async modifyBalance(code, newBalance) {
    const account = await this.findAccount(code);
    if (!account) {
      return [false, "❌ الحساب غير موجود"];
    }
    
    if (config.blacklistedAccounts.includes(code)) {
      return [false, "❌ لا يمكن تعديل حساب محظور"];
    }
    
    if (newBalance < 0) {
      return [false, "❌ الرصيد لا يمكن أن يكون سالباً"];
    }
    
    try {
      // إذا كان الحساب من الأرشيف، ننشئه في قاعدة البيانات أولاً
      if (account.source === 'archive') {
        const [success, response] = await this.createAccount(null, account.username, '123456', code);
        if (!success) {
          return [false, "❌ فشل في تفعيل الحساب من الأرشيف للتعديل"];
        }
      }
      
      await this.db.updateBalance(account.user_id, newBalance);
      await this.db.logOperation('modify', newBalance - account.balance, null, code, 'تعديل مباشر', config.adminUserId);
      
      return [true, `✅ تم التعديل بنجاح!\nالحساب: ${code}\nالرصيد الجديد: ${newBalance} ${config.currency}\nالرصيد السابق: ${account.balance} ${config.currency}`];
    } catch (error) {
      return [false, "❌ فشل في التعديل"];
    }
  }
}

module.exports = BankSystem;
