const sqlite3 = require('sqlite3').verbose();
const config = require('./config');

class Database {
  constructor() {
    this.db = new sqlite3.Database(config.dbPath);
    this.initDatabase();
  }

  initDatabase() {
    const createAccountsTable = `
      CREATE TABLE IF NOT EXISTS accounts (
        user_id TEXT,
        code TEXT UNIQUE,
        username TEXT NOT NULL,
        balance REAL,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createOperationsTable = `
      CREATE TABLE IF NOT EXISTS operations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        amount REAL,
        from_user TEXT,
        to_user TEXT,
        from_code TEXT,
        to_code TEXT,
        reason TEXT,
        admin_id TEXT,
        card_data TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    this.db.run(createAccountsTable);
    this.db.run(createOperationsTable);
  }

  // جميع الدوال السابقة تبقى كما هي مع إضافة دالة logOperation
  logOperation(type, amount, fromUser, toCode, reason, adminId, cardData = null) {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO operations (type, amount, from_user, to_code, reason, admin_id, card_data) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      
      this.db.run(sql, [type, amount, fromUser, toCode, reason, adminId, JSON.stringify(cardData)], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(true);
        }
      });
    });
  }

  // باقي الدوال (createAccount, accountExists, getBalance, etc.) تبقى كما هي
  // ... [نفس الدوال السابقة]
}

module.exports = Database;
