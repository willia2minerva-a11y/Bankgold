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
        config.currentNumber = currentNumber;
        config.currentLetter = currentLetter;
    } else {
        config.currentNumber = currentNumber;
    }
    
    return `${currentLetter}${currentNumber.toString().padStart(3, '0')}${currentLetter}`;
}

module.exports = { hashPassword, verifyPassword, generateUserCode };
