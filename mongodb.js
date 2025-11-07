const mongoose = require('mongoose');
require('dotenv').config();

class MongoDB {
  constructor() {
    this.connection = null;
    this.connect();
  }

  async connect() {
    try {
      const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bankgold';
      
      this.connection = await mongoose.connect(MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      
      console.log('✅ تم الاتصال بقاعدة البيانات MongoDB بنجاح');
    } catch (error) {
      console.error('❌ خطأ في الاتصال بقاعدة البيانات:', error);
      process.exit(1);
    }
  }

  async disconnect() {
    if (this.connection) {
      await mongoose.disconnect();
      console.log('✅ تم قطع الاتصال بقاعدة البيانات');
    }
  }
}

module.exports = MongoDB;
