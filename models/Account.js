const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  username: { type: String, required: true },
  balance: { type: Number, required: true, default: 15 },
  status: { type: String, enum: ['active', 'banned'], default: 'active' },
  source: { type: String, enum: ['archive', 'new'], required: true },
  archive_ref: { type: String, required: true },
  user_id: { type: String, default: null },
  password: { type: String, default: null },
  created_at: { type: Date, default: Date.now },
  last_login: { type: Date, default: Date.now }
});

// فهارس للبحث السريع
accountSchema.index({ code: 1 });
accountSchema.index({ user_id: 1 });
accountSchema.index({ status: 1 });

module.exports = mongoose.model('Account', accountSchema);
