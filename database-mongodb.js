const mongoose = require('mongoose');
const Archive = require('./models/Archive');
const Account = require('./models/Account');

class MongoDBDatabase {
  constructor() {
    this.isConnected = false;
    this.connect();
  }

  async connect() {
    try {
      if (mongoose.connection.readyState === 0) {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/bankgold', {
          useNewUrlParser: true,
          useUnifiedTopology: true,
          serverSelectionTimeoutMS: 30000, // زيادة وقت الانتظار إلى 30 ثانية
          socketTimeoutMS: 45000,
          bufferCommands: false, // تعطيل buffering
          bufferMaxEntries: 0
        });
        this.isConnected = true;
        console.log('✅ تم الاتصال بقاعدة البيانات MongoDB');
      } else {
        this.isConnected = true;
        console.log('✅ استخدام اتصال MongoDB الحالي');
      }
    } catch (error) {
      console.error('❌ خطأ في الاتصال بقاعدة البيانات:', error);
      this.isConnected = false;
    }
  }

  async ensureConnection() {
    if (!this.isConnected) {
      await this.connect();
    }
    return this.isConnected;
  }

  async createAccount(userId, code, username, password, balance) {
    const isConnected = await this.ensureConnection();
    if (!isConnected) {
      throw new Error('الاتصال بقاعدة البيانات غير متاح');
    }

    try {
      // استخدام try-catch منفصل للتحقق من الحساب الموجود
      let existingAccount;
      try {
        existingAccount = await Account.findOne({ code });
      } catch (error) {
        console.warn('⚠️ خطأ في البحث عن الحساب الموجود، المتابعة:', error.message);
      }

      if (existingAccount) {
        throw new Error(`الحساب ${code} موجود مسبقاً`);
      }

      // إنشاء الحساب
      const account = new Account({
        code,
        username,
        balance,
        status: 'active',
        source: 'new',
        archive_ref: 'direct',
        user_id: userId,
        password
      });

      await account.save();
      console.log(`✅ تم إنشاء الحساب: ${code}`);

      return true;
    } catch (error) {
      console.error('❌ خطأ في إنشاء الحساب:', error);
      throw error;
    }
  }

  async getAccountByCode(code) {
    const isConnected = await this.ensureConnection();
    if (!isConnected) {
      console.warn('⚠️ الاتصال غير متاح، إرجاع null');
      return null;
    }

    try {
      const account = await Account.findOne({ code });
      return account ? account.toObject() : null;
    } catch (error) {
      console.error('❌ خطأ في البحث عن الحساب:', error);
      return null;
    }
  }

  async getAccountInfo(userId) {
    const isConnected = await this.ensureConnection();
    if (!isConnected) {
      console.warn('⚠️ الاتصال غير متاح، إرجاع null');
      return null;
    }

    try {
      const account = await Account.findOne({ user_id: userId, status: 'active' });
      return account ? account.toObject() : null;
    } catch (error) {
      console.error('❌ خطأ في الحصول على معلومات الحساب:', error);
      return null;
    }
  }

  async getAllAccounts() {
    const isConnected = await this.ensureConnection();
    if (!isConnected) {
      console.warn('⚠️ الاتصال غير متاح، إرجاع مصفوفة فارغة');
      return [];
    }

    try {
      const accounts = await Account.find({});
      return accounts.map(acc => acc.toObject());
    } catch (error) {
      console.error('❌ خطأ في الحصول على جميع الحسابات:', error);
      return [];
    }
  }

  async transferMoney(fromUser, toUser, toCode, amount) {
    const isConnected = await this.ensureConnection();
    if (!isConnected) {
      throw new Error('الاتصال بقاعدة البيانات غير متاح');
    }

    try {
      const fromAccount = await Account.findOne({ user_id: fromUser });
      const toAccount = await Account.findOne({ user_id: toUser });

      if (!fromAccount || !toAccount) {
        throw new Error('الحساب غير موجود');
      }

      if (fromAccount.balance < amount) {
        throw new Error('رصيد غير كافٍ');
      }

      // استخدام المعاملات إذا أمكن
      const session = await mongoose.startSession();
      try {
        session.startTransaction();

        // خصم المبلغ من المرسل
        fromAccount.balance -= amount;
        await fromAccount.save({ session });

        // إضافة المبلغ للمستلم
        toAccount.balance += amount;
        await toAccount.save({ session });

        await session.commitTransaction();
        console.log(`✅ تم التحويل: ${amount} من ${fromAccount.code} إلى ${toAccount.code}`);
        return true;
      } catch (error) {
        await session.abortTransaction();
        throw error;
      } finally {
        session.endSession();
      }
    } catch (error) {
      console.error('❌ خطأ في التحويل:', error);
      throw error;
    }
  }

  async updateBalance(userId, newBalance) {
    const isConnected = await this.ensureConnection();
    if (!isConnected) {
      throw new Error('الاتصال بقاعدة البيانات غير متاح');
    }

    try {
      await Account.findOneAndUpdate(
        { user_id: userId },
        { balance: newBalance }
      );
      console.log(`✅ تم تحديث الرصيد للمستخدم: ${userId} إلى ${newBalance}`);
      return true;
    } catch (error) {
      console.error('❌ خطأ في تحديث الرصيد:', error);
      throw error;
    }
  }

  async updateAccountStatus(userId, status) {
    const isConnected = await this.ensureConnection();
    if (!isConnected) {
      throw new Error('الاتصال بقاعدة البيانات غير متاح');
    }

    try {
      await Account.findOneAndUpdate(
        { user_id: userId },
        { status }
      );
      console.log(`✅ تم تحديث حالة الحساب: ${userId} إلى ${status}`);
      return true;
    } catch (error) {
      console.error('❌ خطأ في تحديث حالة الحساب:', error);
      throw error;
    }
  }

  async updateUserId(oldUserId, newUserId) {
    const isConnected = await this.ensureConnection();
    if (!isConnected) {
      throw new Error('الاتصال بقاعدة البيانات غير متاح');
    }

    try {
      await Account.findOneAndUpdate(
        { user_id: oldUserId },
        { user_id: newUserId, last_login: new Date() }
      );
      console.log(`✅ تم تحديث معرف المستخدم: ${oldUserId} إلى ${newUserId}`);
      return true;
    } catch (error) {
      console.error('❌ خطأ في تحديث معرف المستخدم:', error);
      throw error;
    }
  }

  async updateAccountPassword(userId, passwordHash) {
    const isConnected = await this.ensureConnection();
    if (!isConnected) {
      throw new Error('الاتصال بقاعدة البيانات غير متاح');
    }

    try {
      await Account.findOneAndUpdate(
        { user_id: userId },
        { password: passwordHash }
      );
      console.log(`✅ تم تحديث كلمة السر للمستخدم: ${userId}`);
      return true;
    } catch (error) {
      console.error('❌ خطأ في تحديث كلمة السر:', error);
      throw error;
    }
  }

  async updateLastLogin(userId) {
    const isConnected = await this.ensureConnection();
    if (!isConnected) {
      return false;
    }

    try {
      await Account.findOneAndUpdate(
        { user_id: userId },
        { last_login: new Date() }
      );
      return true;
    } catch (error) {
      console.error('❌ خطأ في تحديث آخر تسجيل دخول:', error);
      return false;
    }
  }

  async logOperation(type, amount, fromUser, toCode, reason, adminId, cardData = null) {
    console.log(`📝 Operation logged: ${type}, ${amount}, ${fromUser}, ${toCode}, ${reason}, ${adminId}`);
    return true;
  }

  async logSystemOperation(type, target, action, adminId, details = '') {
    console.log(`⚙️ System operation logged: ${type}, ${target}, ${action}, ${adminId}, ${details}`);
    return true;
  }
}

module.exports = MongoDBDatabase;
