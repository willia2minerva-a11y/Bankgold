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

    const createTransactionsTable = `
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_user TEXT,
        to_user TEXT,
        from_code TEXT,
        to_code TEXT,
        amount REAL,
        type TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    this.db.run(createTransactionsTable);
    this.db.run(createOperationsTable);
  }

  createAccount(userId, code, username, balance) {
    return new Promise((resolve, reject) => {
      const sql = `INSERT INTO accounts (user_id, code, username, balance) VALUES (?, ?, ?, ?)`;
      this.db.run(sql, [userId, code, username, balance], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(true);
        }
      });
    });
  }

  accountExists(userId) {
    return new Promise((resolve, reject) => {
      const sql = `SELECT 1 FROM accounts WHERE user_id = ? AND status = 'active'`;
      this.db.get(sql, [userId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(!!row);
        }
      });
    });
  }

  accountExistsByCode(code) {
    return new Promise((resolve, reject) => {
      const sql = `SELECT 1 FROM accounts WHERE code = ?`;
      this.db.get(sql, [code], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(!!row);
        }
      });
    });
  }

  getBalance(userId) {
    return new Promise((resolve, reject) => {
      const sql = `SELECT balance FROM accounts WHERE user_id = ? AND status = 'active'`;
      this.db.get(sql, [userId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row ? row.balance : 0);
        }
      });
    });
  }

  getAccountInfo(userId) {
    return new Promise((resolve, reject) => {
      const sql = `SELECT user_id, code, username, balance, status FROM accounts WHERE user_id = ?`;
      this.db.get(sql, [userId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row ? {
            user_id: row.user_id,
            code: row.code,
            username: row.username,
            balance: row.balance,
            status: row.status
          } : null);
        }
      });
    });
  }

  getAccountByCode(code) {
    return new Promise((resolve, reject) => {
      const sql = `SELECT user_id, code, username, balance, status FROM accounts WHERE code = ?`;
      this.db.get(sql, [code], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row ? {
            user_id: row.user_id,
            code: row.code,
            username: row.username,
            balance: row.balance,
            status: row.status
          } : null);
        }
      });
    });
  }

  transferMoney(fromUser, toUser, toCode, amount) {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run('BEGIN TRANSACTION');

        this.db.run(`UPDATE accounts SET balance = balance - ? WHERE user_id = ?`, [amount, fromUser], function(err) {
          if (err) {
            this.db.run('ROLLBACK');
            reject(err);
            return;
          }

          this.db.run(`UPDATE accounts SET balance = balance + ? WHERE user_id = ?`, [amount, toUser], function(err) {
            if (err) {
              this.db.run('ROLLBACK');
              reject(err);
              return;
            }

            this.db.run(`INSERT INTO transactions (from_user, to_user, to_code, amount, type) VALUES (?, ?, ?, ?, 'transfer')`,
              [fromUser, toUser, toCode, amount], function(err) {
              if (err) {
                this.db.run('ROLLBACK');
                reject(err);
                return;
              }

              this.db.run('COMMIT');
              resolve(true);
            });
          });
        });
      });
    });
  }

  updateBalance(userId, newBalance) {
    return new Promise((resolve, reject) => {
      const sql = `UPDATE accounts SET balance = ? WHERE user_id = ?`;
      this.db.run(sql, [newBalance, userId], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(true);
        }
      });
    });
  }

  updateAccountStatus(userId, status) {
    return new Promise((resolve, reject) => {
      const sql = `UPDATE accounts SET status = ? WHERE user_id = ?`;
      this.db.run(sql, [status, userId], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(true);
        }
      });
    });
  }

  getAllAccounts() {
    return new Promise((resolve, reject) => {
      const sql = `SELECT code, username, balance, status FROM accounts WHERE status = 'active' ORDER BY code`;
      this.db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const accounts = rows.map(row => ({
            code: row.code,
            username: row.username,
            balance: row.balance,
            status: row.status
          }));
          resolve(accounts);
        }
      });
    });
  }

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
}

module.exports = Database;
