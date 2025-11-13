const mongoose = require('mongoose');
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
          useUnifiedTopology: true
        });
        this.isConnected = true;
        console.log('✅ تم الاتصال بقاعدة البيانات MongoDB');
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
    try {
      const existingAccount = await Account.findOne({ code });
      if (existingAccount) {
        await Account.findOneAndUpdate(
          { code },
          {
            user_id: userId,
            username,
            password,
            balance,
            status: 'active',
            source: 'database',
            archive_ref: 'activated'
          }
        );
      } else {
        const account = new Account({
          code,
          username,
          balance,
          status: 'active',
          source: 'database',
          archive_ref: 'direct',
          user_id: userId,
          password
        });
        await account.save();
      }
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
      return null;
    }
  }

  async getAccountInfo(userId) {
    try {
      const account = await Account.findOne({ user_id: userId, status: 'active' });
      return account ? account.toObject() : null;
    } catch (error) {
      console.error('❌ خطأ في الحصول على معلومات الحساب:', error);
      return null;
    }
  }

  async getAllAccounts() {
    try {
      const accounts = await Account.find({});
      return accounts.map(acc => acc.toObject());
    } catch (error) {
      console.error('❌ خطأ في الحصول على جميع الحسابات:', error);
      return [];
    }
  }

  async transferMoney(fromUser, toUser, toCode, amount) {
    try {
      const fromAccount = await Account.findOne({ user_id: fromUser });
      const toAccount = await Account.findOne({ user_id: toUser });

      if (!fromAccount || !toAccount) {
        throw new Error('الحساب غير موجود');
      }

      if (fromAccount.balance < amount) {
        throw new Error('رصيد غير كافٍ');
      }

      fromAccount.balance -= amount;
      await fromAccount.save();

      toAccount.balance += amount;
      await toAccount.save();

      return true;
    } catch (error) {
      console.error('❌ خطأ في التحويل:', error);
      throw error;
    }
  }

  async updateBalance(userId, newBalance) {
    try {
      await Account.findOneAndUpdate(
        { user_id: userId },
        { balance: newBalance }
      );
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
      return true;
    } catch (error) {
      console.error('❌ خطأ في تحديث حالة الحساب:', error);
      throw error;
    }
  }

  async updateAccountPassword(userId, passwordHash) {
    try {
      await Account.findOneAndUpdate(
        { user_id: userId },
        { password: passwordHash }
      );
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
      return false;
    }
  }

  async logOperation(type, amount, fromUser, toCode, reason, adminId) {
    console.log(`📝 Operation logged: ${type}, ${amount}, ${fromUser}, ${toCode}`);
    return true;
  }

  async logSystemOperation(type, target, action, adminId) {
    console.log(`⚙️ System operation: ${type}, ${target}, ${action}`);
    return true;
  }
}

module.exports = MongoDBDatabase;
