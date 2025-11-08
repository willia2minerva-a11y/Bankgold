const mongoose = require('mongoose');

const archiveAccountSchema = new mongoose.Schema({
  code: { type: String, required: true },
  username: { type: String, required: true },
  balance: { type: Number, required: true, default: 15 },
  status: { type: String, enum: ['active', 'banned'], default: 'active' },
  source: { type: String, enum: ['archive', 'new'], default: 'archive' }
}, { _id: false });

const archiveSchema = new mongoose.Schema({
  name: { type: String, required: true },
  series: { type: String, enum: ['A', 'B'], required: true },
  number: { type: Number, required: true },
  start: { type: String, required: true },
  end: { type: String, required: true },
  accounts: [archiveAccountSchema],
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

// فهارس للبحث السريع
archiveSchema.index({ series: 1, number: 1 });
archiveSchema.index({ 'accounts.code': 1 });

module.exports = mongoose.model('Archive', archiveSchema);
