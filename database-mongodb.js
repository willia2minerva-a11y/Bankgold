const Archive = require('./models/Archive');
const Account = require('./models/Account');

class MongoDBDatabase {
  constructor() {
    // لا حاجة للتهيئة، mongoose يتولى ذلك
  }

  async createAccount(userId, code, username, password, balance) {
    try {
      // البحث عن الأرشيف المناسب بناءً على الكود
      const series = code[0];
      const number = parseInt(code.slice(1, 4));
      const archiveNum = Math.floor(number / 100) + 1;
      const archiveKey = series + archiveNum;

      // إنشاء الحساب في مجموعة الحسابات المنفردة
      const account = new Account({
        code,
        username,
        balance,
        status: 'active',
        source: 'new',
        archive_ref: archiveKey,
        user_id: userId,
        password
      });

      await account.save();

      // إضافة الحساب إلى الأرشيف
      await Archive.findOneAndUpdate(
        { series, number: archiveNum },
        { 
          $push: { 
            accounts: {
              code,
              username,
              balance,
              status: 'active',
              source: 'new',
              user_id: userId,
              password
            }
          },
          $set: { updated_at: new Date() }
        }
      );

      return true;
    } catch (error) {
      throw error;
    }
  }

  async getAccountByCode(code) {
    try {
      const account = await Account.findOne({ code });
      return account ? account.toObject() : null;
    } catch (error) {
      throw error;
    }
  }

  async getAccountInfo(userId) {
    try {
      const account = await Account.findOne({ user_id: userId, status: 'active' });
      return account ? account.toObject() : null;
    } catch (error) {
      throw error;
    }
  }

  async getAllAccounts() {
    try {
      const accounts = await Account.find({});
      return accounts.map(acc => acc.toObject());
    } catch (error) {
      throw error;
    }
  }

  async transferMoney(fromUser, toUser, toCode, amount) {
    const session = await Account.startSession();
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
      return true;
    } catch (error) {
      await session.abortTransaction();
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
      return true;
    } catch (error) {
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
      throw error;
    }
  }

  async updateUserId(oldUserId, newUserId) {
    try {
      await Account.findOneAndUpdate(
        { user_id: oldUserId },
        { user_id: newUserId, last_login: new Date() }
      );
      return true;
    } catch (error) {
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
      throw error;
    }
  }

  async logOperation(type, amount, fromUser, toCode, reason, adminId, cardData = null) {
    // يمكن إنشاء نموذج للسجلات إذا لزم الأمر
    console.log(`Operation logged: ${type}, ${amount}, ${fromUser}, ${toCode}, ${reason}, ${adminId}`);
    return true;
  }

  async logSystemOperation(type, target, action, adminId, details = '') {
    console.log(`System operation logged: ${type}, ${target}, ${action}, ${adminId}, ${details}`);
    return true;
  }
}

module.exports = MongoDBDatabase;
