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
        console.log(`🔄 محاولة إنشاء/تحديث الحساب: ${code}`);
        
        // إذا لم يتم تقديم كلمة مرور، استخدم كلمة مرور افتراضية
        const finalPassword = password || hashPassword('default123');
        
        const existingAccount = await Account.findOne({ code }).maxTimeMS(10000);
        
        if (existingAccount) {
          console.log(`🔄 تحديث الحساب الموجود: ${code}`);
          const updateData = {
            username,
            password: finalPassword,
            balance,
            status: 'active',
            updated_at: new Date()
          };
          
          // تحديث user_id فقط إذا تم تقديمه
          if (userId) {
            updateData.user_id = userId;
          }
          
          await Account.findOneAndUpdate(
            { code },
            updateData
          ).maxTimeMS(10000);
          
          console.log(`✅ تم تحديث الحساب: ${code}`);
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
          console.log(`✅ تم إنشاء الحساب: ${code}`);
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
        if (account) {
          console.log(`✅ تم العثور على الحساب: ${code}`);
          return account.toObject();
        } else {
          console.log(`❌ الحساب غير موجود: ${code}`);
          return null;
        }
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
        if (account) {
          return account.toObject();
        }
        return null;
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
        console.log(`✅ تم جلب ${accounts.length} حساب من قاعدة البيانات`);
        return accounts.map(acc => acc.toObject());
      } catch (error) {
        console.error('❌ خطأ في الحصول على جميع الحسابات:', error);
        return [];
      }
    });
  }

  async getAccountsBySource(source) {
    return this.withConnection(async () => {
      try {
        const accounts = await Account.find({ source }).maxTimeMS(10000);
        return accounts.map(acc => acc.toObject());
      } catch (error) {
        console.error('❌ خطأ في الحصول على الحسابات حسب المصدر:', error);
        return [];
      }
    });
  }

  async transferMoney(fromUser, toUser, toCode, amount) {
    return this.withConnection(async () => {
      try {
        console.log(`🔄 بدء عملية التحويل: ${fromUser} -> ${toUser} (${amount})`);
        
        const fromAccount = await Account.findOne({ user_id: fromUser }).maxTimeMS(10000);
        const toAccount = await Account.findOne({ user_id: toUser }).maxTimeMS(10000);

        if (!fromAccount) {
          throw new Error(`الحساب المرسل غير موجود: ${fromUser}`);
        }
        
        if (!toAccount) {
          throw new Error(`الحساب المستلم غير موجود: ${toUser}`);
        }

        if (fromAccount.balance < amount) {
          throw new Error(`رصيد غير كافٍ. الرصيد الحالي: ${fromAccount.balance}`);
        }

        // بدء معاملة آمنة
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
          // خصم من المرسل
          fromAccount.balance -= amount;
          fromAccount.updated_at = new Date();
          await fromAccount.save({ session });

          // إضافة للمستلم
          toAccount.balance += amount;
          toAccount.updated_at = new Date();
          await toAccount.save({ session });

          // تأكيد المعاملة
          await session.commitTransaction();
          session.endSession();

          console.log(`✅ تم التحويل بنجاح: ${amount} من ${fromAccount.code} إلى ${toAccount.code}`);
          return true;
        } catch (transactionError) {
          // تراجع عن المعاملة في حالة الخطأ
          await session.abortTransaction();
          session.endSession();
          throw transactionError;
        }
      } catch (error) {
        console.error('❌ خطأ في التحويل:', error);
        throw error;
      }
    });
  }

  async updateBalance(userId, newBalance) {
    return this.withConnection(async () => {
      try {
        const result = await Account.findOneAndUpdate(
          { user_id: userId },
          { 
            balance: newBalance,
            updated_at: new Date()
          },
          { new: true }
        ).maxTimeMS(10000);
        
        if (result) {
          console.log(`✅ تم تحديث الرصيد للمستخدم ${userId} إلى ${newBalance}`);
          return true;
        } else {
          throw new Error(`لم يتم العثور على حساب للمستخدم: ${userId}`);
        }
      } catch (error) {
        console.error('❌ خطأ في تحديث الرصيد:', error);
        throw error;
      }
    });
  }

  async updateAccountStatus(userId, status) {
    return this.withConnection(async () => {
      try {
        const result = await Account.findOneAndUpdate(
          { user_id: userId },
          { 
            status: status,
            updated_at: new Date()
          },
          { new: true }
        ).maxTimeMS(10000);
        
        if (result) {
          console.log(`✅ تم تحديث حالة الحساب للمستخدم ${userId} إلى ${status}`);
          return true;
        } else {
          throw new Error(`لم يتم العثور على حساب للمستخدم: ${userId}`);
        }
      } catch (error) {
        console.error('❌ خطأ في تحديث حالة الحساب:', error);
        throw error;
      }
    });
  }

  async updateAccountPassword(userId, passwordHash) {
    return this.withConnection(async () => {
      try {
        const result = await Account.findOneAndUpdate(
          { user_id: userId },
          { 
            password: passwordHash,
            updated_at: new Date()
          },
          { new: true }
        ).maxTimeMS(10000);
        
        if (result) {
          console.log(`✅ تم تحديث كلمة السر للمستخدم ${userId}`);
          return true;
        } else {
          throw new Error(`لم يتم العثور على حساب للمستخدم: ${userId}`);
        }
      } catch (error) {
        console.error('❌ خطأ في تحديث كلمة السر:', error);
        throw error;
      }
    });
  }

  async updateAccountUserId(oldUserId, newUserId) {
    return this.withConnection(async () => {
      try {
        const result = await Account.findOneAndUpdate(
          { user_id: oldUserId },
          { 
            user_id: newUserId,
            updated_at: new Date()
          },
          { new: true }
        ).maxTimeMS(10000);
        
        if (result) {
          console.log(`✅ تم تحديث معرف المستخدم من ${oldUserId} إلى ${newUserId}`);
          return true;
        } else {
          throw new Error(`لم يتم العثور على حساب للمستخدم: ${oldUserId}`);
        }
      } catch (error) {
        console.error('❌ خطأ في تحديث معرف المستخدم:', error);
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

  async searchAccountsByUsername(username) {
    return this.withConnection(async () => {
      try {
        const accounts = await Account.find({
          username: { $regex: username, $options: 'i' }
        }).maxTimeMS(10000);
        return accounts.map(acc => acc.toObject());
      } catch (error) {
        console.error('❌ خطأ في البحث عن الحسابات بالاسم:', error);
        return [];
      }
    });
  }

  async getBannedAccounts() {
    return this.withConnection(async () => {
      try {
        const accounts = await Account.find({ status: 'banned' }).maxTimeMS(10000);
        return accounts.map(acc => acc.toObject());
      } catch (error) {
        console.error('❌ خطأ في الحصول على الحسابات المحظورة:', error);
        return [];
      }
    });
  }

  async getActiveAccounts() {
    return this.withConnection(async () => {
      try {
        const accounts = await Account.find({ status: 'active' }).maxTimeMS(10000);
        return accounts.map(acc => acc.toObject());
      } catch (error) {
        console.error('❌ خطأ في الحصول على الحسابات النشطة:', error);
        return [];
      }
    });
  }

  async getAccountStats() {
    return this.withConnection(async () => {
      try {
        const totalAccounts = await Account.countDocuments();
        const activeAccounts = await Account.countDocuments({ status: 'active' });
        const bannedAccounts = await Account.countDocuments({ status: 'banned' });
        const totalBalance = await Account.aggregate([
          { $group: { _id: null, total: { $sum: '$balance' } } }
        ]);
        
        return {
          totalAccounts,
          activeAccounts,
          bannedAccounts,
          totalBalance: totalBalance[0]?.total || 0
        };
      } catch (error) {
        console.error('❌ خطأ في الحصول على إحصائيات الحسابات:', error);
        return {
          totalAccounts: 0,
          activeAccounts: 0,
          bannedAccounts: 0,
          totalBalance: 0
        };
      }
    });
  }

  async deleteAccount(code) {
    return this.withConnection(async () => {
      try {
        const result = await Account.deleteOne({ code }).maxTimeMS(10000);
        if (result.deletedCount > 0) {
          console.log(`✅ تم حذف الحساب: ${code}`);
          return true;
        } else {
          console.log(`❌ الحساب غير موجود: ${code}`);
          return false;
        }
      } catch (error) {
        console.error('❌ خطأ في حذف الحساب:', error);
        throw error;
      }
    });
  }

  async backupAccounts() {
    return this.withConnection(async () => {
      try {
        const accounts = await Account.find({}).maxTimeMS(30000);
        const backupData = accounts.map(acc => acc.toObject());
        
        // إزالة الحقول الحساسة
        backupData.forEach(account => {
          delete account.password;
          delete account._id;
          delete account.__v;
        });
        
        console.log(`✅ تم إنشاء نسخة احتياطية لـ ${backupData.length} حساب`);
        return backupData;
      } catch (error) {
        console.error('❌ خطأ في إنشاء النسخة الاحتياطية:', error);
        throw error;
      }
    });
  }

  // إغلاق الاتصال
  async close() {
    try {
      if (this.isConnected) {
        await mongoose.connection.close();
        this.isConnected = false;
        this.connectionPromise = null;
        console.log('✅ تم إغلاق الاتصال بقاعدة البيانات');
      }
    } catch (error) {
      console.error('❌ خطأ في إغلاق الاتصال:', error);
    }
  }
}

module.exports = MongoDBDatabase;
