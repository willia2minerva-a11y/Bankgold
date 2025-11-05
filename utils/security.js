const crypto = require('crypto');
const config = require('../config');

function hashPassword(password) {
    return crypto.createHash('sha256').update(password + config.salt).digest('hex');
}

function verifyPassword(inputPassword, storedHash) {
    return hashPassword(inputPassword) === storedHash;
}

function generateUserCode() {
    let currentLetter = config.currentLetter;
    let currentNumber = config.currentNumber + 1;
    
    if (currentNumber > 999) {
        currentNumber = 1;
        currentLetter = 'C';
    }
    
    // حفظ الإعدادات الجديدة
    const newSettings = {
        currentLetter: currentLetter,
        currentNumber: currentNumber
    };
    
    // تحديث الإعدادات في الذاكرة
    config.currentLetter = currentLetter;
    config.currentNumber = currentNumber;
    
    // حفظ الإعدادات في الملف
    config.saveSettings(newSettings);
    
    return `${currentLetter}${currentNumber.toString().padStart(3, '0')}${currentLetter}`;
}

module.exports = { hashPassword, verifyPassword, generateUserCode };
