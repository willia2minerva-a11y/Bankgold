const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  username: { type: String, required: true },
  balance: { type: Number, required: true, default: 15 },
  status: { type: String, enum: ['active', 'banned'], default: 'active' },
  source: { type: String, enum: ['archive', 'new'], default: 'archive' },
  user_id: { type: String, default: null },
  password: { type: String, default: null },
  created_at: { type: Date, default: Date.now },
  last_login: { type: Date, default: Date.now }
});

const archiveSchema = new mongoose.Schema({
  name: { type: String, required: true },
  series: { type: String, enum: ['A', 'B'], required: true },
  number: { type: Number, required: true },
  start: { type: String, required: true },
  end: { type: String, required: true },
  accounts: [accountSchema],
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

// فهارس للبحث السريع
archiveSchema.index({ series: 1, number: 1 });
archiveSchema.index({ 'accounts.code': 1 });

module.exports = mongoose.model('Archive', archiveSchema);
