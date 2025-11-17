const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  username: {
    type: String,
    required: true,
    trim: true
  },
  balance: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  password: {
    type: String,
    required: true
  },
  user_id: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['active', 'banned', 'suspended'],
    default: 'active'
  },
  source: {
    type: String,
    enum: ['archive', 'database', 'direct'],
    default: 'database'
  },
  archive_ref: {
    type: String,
    default: null
  },
  last_login: {
    type: Date,
    default: null
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
});

// تحديث updated_at قبل الحفظ
accountSchema.pre('save', function(next) {
  this.updated_at = Date.now();
  next();
});

module.exports = mongoose.model('Account', accountSchema);
