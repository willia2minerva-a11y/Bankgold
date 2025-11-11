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
    
    // إذا وصلنا إلى B999، ننتقل إلى C001
    if (currentLetter === 'B' && currentNumber > 999) {
        currentLetter = 'C';
        currentNumber = 1;
    }
    // إذا وصلنا إلى C999، ننتقل إلى D001 وهكذا...
    else if (currentLetter === 'C' && currentNumber > 999) {
        currentLetter = 'D';
        currentNumber = 1;
    }
    else if (currentLetter > 'B' && currentNumber > 999) {
        currentLetter = String.fromCharCode(currentLetter.charCodeAt(0) + 1);
        currentNumber = 1;
    }
    // إذا تجاوزنا Z، نعود إلى A (نظرياً)
    else if (currentLetter > 'Z') {
        currentLetter = 'A';
        currentNumber = 1;
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
