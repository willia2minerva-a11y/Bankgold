const mongoose = require('mongoose');
const Archive = require('./models/Archive');
const Account = require('./models/Account');

class MongoDBDatabase {
  constructor() {
    // لا حاجة للتهيئة، mongoose يتولى ذلك
  }

  async createAccount(userId, code, username, password, balance) {
    try {
      // إنشاء الحساب في مجموعة الحسابات المنفردة فقط
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
    try {
      const account = await Account.findOne({ code });
      return account ? account.toObject() : null;
    } catch (error) {
      console.error('❌ خطأ في البحث عن الحساب:', error);
      throw error;
    }
  }

  async getAccountInfo(userId) {
    try {
      const account = await Account.findOne({ user_id: userId, status: 'active' });
      return account ? account.toObject() : null;
    } catch (error) {
      console.error('❌ خطأ في الحصول على معلومات الحساب:', error);
      throw error;
    }
  }

  async getAllAccounts() {
    try {
      const accounts = await Account.find({});
      return accounts.map(acc => acc.toObject());
    } catch (error) {
      console.error('❌ خطأ في الحصول على جميع الحسابات:', error);
      throw error;
    }
  }

  async transferMoney(fromUser, toUser, toCode, amount) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const fromAccount = await Account.findOne({ user_id: fromUser }).session(session);
      const toAccount = await Account.findOne({ user_id: toUser }).session(session);

      if (!fromAccount || !toAccount) {
        throw new Error('الحساب غير موجود');
      }

      if (fromAccount.balance < amount) {
        throw new Error('رصيد غير كافٍ');
      }

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
      console.error('❌ خطأ في التحويل:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  async updateBalance(userId, newBalance) {
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
    try {
      await Account.findOneAndUpdate(
        { user_id: userId },
        { last_login: new Date() }
      );
      return true;
    } catch (error) {
      console.error('❌ خطأ في تحديث آخر تسجيل دخول:', error);
      throw error;
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
