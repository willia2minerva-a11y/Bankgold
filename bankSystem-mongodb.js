const mongoose = require('mongoose');
const Account = require('./models/Account');
const { hashPassword } = require('./utils/security');

class MongoDBDatabase {
  constructor() {
    this.isConnected = false;
    this.connectionPromise = null;
    this.connect();
  }

  async connect() {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = new Promise(async (resolve, reject) => {
      try {
        if (mongoose.connection.readyState === 1) {
          this.isConnected = true;
          console.log('✅ استخدام اتصال MongoDB الحالي');
          resolve(true);
          return;
        }

        // إغلاق أي اتصالات سابقة
        if (mongoose.connection.readyState !== 0) {
          await mongoose.connection.close();
        }

        const options = {
          useNewUrlParser: true,
          useUnifiedTopology: true,
          serverSelectionTimeoutMS: 15000,
          socketTimeoutMS: 45000,
          bufferCommands: false,
          maxPoolSize: 10,
          minPoolSize: 1,
          maxIdleTimeMS: 30000,
          family: 4
        };

        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/bankgold', options);
        
        this.isConnected = true;
        console.log('✅ تم الاتصال بقاعدة البيانات MongoDB');
        resolve(true);
      } catch (error) {
        console.error('❌ خطأ في الاتصال بقاعدة البيانات:', error);
        this.isConnected = false;
        this.connectionPromise = null;
        reject(error);
      }
    });

    return this.connectionPromise;
  }

  async ensureConnection() {
    if (this.isConnected && mongoose.connection.readyState === 1) {
      return true;
    }
    
    try {
      await this.connect();
      return this.isConnected;
    } catch (error) {
      console.error('❌ فشل في تأمين الاتصال:', error);
      return false;
    }
  }

  async withConnection(operation) {
    try {
      const connected = await this.ensureConnection();
      if (!connected) {
        throw new Error('الاتصال بقاعدة البيانات غير متاح');
      }
      return await operation();
    } catch (error) {
      console.error('❌ خطأ في العملية:', error);
      throw error;
    }
  }

  async createAccount(userId, code, username, password, balance) {
    return this.withConnection(async () => {
      try {
        // إذا لم يتم تقديم كلمة مرور، استخدم كلمة مرور افتراضية
        const finalPassword = password || hashPassword('default123');
        
        const existingAccount = await Account.findOne({ code }).maxTimeMS(10000);
        if (existingAccount) {
          console.log(`🔄 تحديث الحساب الموجود: ${code}`);
          await Account.findOneAndUpdate(
            { code },
            {
              user_id: userId,
              username,
              password: finalPassword,
              balance,
              status: 'active',
              source: 'database',
              archive_ref: 'activated',
              updated_at: new Date()
            }
          ).maxTimeMS(10000);
        } else {
          console.log(`🆕 إنشاء حساب جديد: ${code}`);
          const account = new Account({
            code,
            username,
            balance,
            status: 'active',
            source: 'database',
            archive_ref: 'direct',
            user_id: userId,
            password: finalPassword,
            created_at: new Date(),
            updated_at: new Date()
          });
          await account.save();
        }
        return true;
      } catch (error) {
        console.error('❌ خطأ في إنشاء الحساب:', error);
        throw error;
      }
    });
  }

  async getAccountByCode(code) {
    return this.withConnection(async () => {
      try {
        const account = await Account.findOne({ code }).maxTimeMS(10000);
        return account ? account.toObject() : null;
      } catch (error) {
        console.error('❌ خطأ في البحث عن الحساب:', error);
        return null;
      }
    });
  }

  async getAccountInfo(userId) {
    return this.withConnection(async () => {
      try {
        const account = await Account.findOne({ user_id: userId, status: 'active' }).maxTimeMS(10000);
        return account ? account.toObject() : null;
      } catch (error) {
        console.error('❌ خطأ في الحصول على معلومات الحساب:', error);
        return null;
      }
    });
  }

  async getAllAccounts() {
    return this.withConnection(async () => {
      try {
        const accounts = await Account.find({}).maxTimeMS(10000);
        return accounts.map(acc => acc.toObject());
      } catch (error) {
        console.error('❌ خطأ في الحصول على جميع الحسابات:', error);
        return [];
      }
    });
  }

  async transferMoney(fromUser, toUser, toCode, amount) {
    return this.withConnection(async () => {
      try {
        const fromAccount = await Account.findOne({ user_id: fromUser }).maxTimeMS(10000);
        const toAccount = await Account.findOne({ user_id: toUser }).maxTimeMS(10000);

        if (!fromAccount || !toAccount) {
          throw new Error('الحساب غير موجود');
        }

        if (fromAccount.balance < amount) {
          throw new Error('رصيد غير كافٍ');
        }

        fromAccount.balance -= amount;
        fromAccount.updated_at = new Date();
        await fromAccount.save();

        toAccount.balance += amount;
        toAccount.updated_at = new Date();
        await toAccount.save();

        return true;
      } catch (error) {
        console.error('❌ خطأ في التحويل:', error);
        throw error;
      }
    });
  }

  async updateBalance(userId, newBalance) {
    return this.withConnection(async () => {
      try {
        await Account.findOneAndUpdate(
          { user_id: userId },
          { 
            balance: newBalance,
            updated_at: new Date()
          }
        ).maxTimeMS(10000);
        console.log(`✅ تم تحديث الرصيد للمستخدم ${userId} إلى ${newBalance}`);
        return true;
      } catch (error) {
        console.error('❌ خطأ في تحديث الرصيد:', error);
        throw error;
      }
    });
  }

  async updateAccountStatus(userId, status) {
    return this.withConnection(async () => {
      try {
        await Account.findOneAndUpdate(
          { user_id: userId },
          { 
            status: status,
            updated_at: new Date()
          }
        ).maxTimeMS(10000);
        console.log(`✅ تم تحديث حالة الحساب للمستخدم ${userId} إلى ${status}`);
        return true;
      } catch (error) {
        console.error('❌ خطأ في تحديث حالة الحساب:', error);
        throw error;
      }
    });
  }

  async updateAccountPassword(userId, passwordHash) {
    return this.withConnection(async () => {
      try {
        await Account.findOneAndUpdate(
          { user_id: userId },
          { 
            password: passwordHash,
            updated_at: new Date()
          }
        ).maxTimeMS(10000);
        console.log(`✅ تم تحديث كلمة السر للمستخدم ${userId}`);
        return true;
      } catch (error) {
        console.error('❌ خطأ في تحديث كلمة السر:', error);
        throw error;
      }
    });
  }

  async updateLastLogin(userId) {
    return this.withConnection(async () => {
      try {
        await Account.findOneAndUpdate(
          { user_id: userId },
          { 
            last_login: new Date(),
            updated_at: new Date()
          }
        ).maxTimeMS(10000);
        return true;
      } catch (error) {
        console.error('❌ خطأ في تحديث آخر تسجيل دخول:', error);
        return false;
      }
    });
  }

  async findAccountByUserId(userId) {
    return this.withConnection(async () => {
      try {
        const account = await Account.findOne({ user_id: userId }).maxTimeMS(10000);
        return account ? account.toObject() : null;
      } catch (error) {
        console.error('❌ خطأ في البحث عن الحساب بالمعرف:', error);
        return null;
      }
    });
  }
}

module.exports = MongoDBDatabase;
