const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const config = require('./config');
const BankSystem = require('./bankSystem');

const app = express();
app.use(bodyParser.json());

const bankSystem = new BankSystem();

// تحقق من التوكن عند إعداد الويب هوك
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === config.verifyToken) {
      console.log('تم التحقق من الويب هوك بنجاح');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// معالجة الرسائل الواردة من Messenger
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    for (const entry of body.entry) {
      const webhookEvent = entry.messaging[0];
      const senderId = webhookEvent.sender.id;
      const message = webhookEvent.message.text;

      console.log(`Received message from ${senderId}: ${message}`);

      await handleMessage(senderId, message);
    }

    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

async function handleMessage(senderId, message) {
  message = message.trim();

  if (message.startsWith("انشاء")) {
    try {
      const parts = message.split(' ').slice(1);
      if (parts.length >= 1) {
        const username = parts.join(' ').trim();
        const [success, response] = await bankSystem.createAccount(senderId, username);
        await sendMessage(senderId, response);
      } else {
        await sendMessage(senderId, "استخدم: انشاء [الاسم الكامل]\nمثال: انشاء كيم شيريونغ");
      }
    } catch (error) {
      await sendMessage(senderId, "خطأ في إنشاء الحساب");
    }
  } else if (message === "رصيد") {
    const balance = await bankSystem.getBalance(senderId);
    const accountInfo = await bankSystem.getAccountInfo(senderId);
    if (accountInfo) {
      let response = "💳 معلومات الحساب:\n";
      response += `الكود: ${accountInfo.code}\n`;
      response += `الاسم: ${accountInfo.username}\n`;
      response += `الرصيد: ${balance} ${config.currency}`;
      await sendMessage(senderId, response);
    } else {
      await sendMessage(senderId, "ليس لديك حساب. استخدم 'انشاء [الاسم]' لإنشاء حساب.");
    }
  } else if (message.startsWith("تحويل")) {
    const parts = message.split(' ');
    if (parts.length === 3) {
      const toCode = parts[1].toUpperCase();
      const amount = parseFloat(parts[2]);
      if (isNaN(amount)) {
        await sendMessage(senderId, "المبلغ يجب أن يكون رقماً");
      } else {
        const [success, response] = await bankSystem.transferMoney(senderId, toCode, amount);
        await sendMessage(senderId, response);
      }
    } else {
      await sendMessage(senderId, "استخدم: تحويل [كود المستلم] [المبلغ]\nمثال: تحويل B700B 5");
    }
  } else if (message === "حسابي") {
    const accountInfo = await bankSystem.getAccountInfo(senderId);
    if (accountInfo) {
      let response = "📋 معلومات الحساب:\n";
      response += `الكود: ${accountInfo.code}\n`;
      response += `الاسم: ${accountInfo.username}\n`;
      response += `الرصيد: ${accountInfo.balance} ${config.currency}\n`;
      response += `الحالة: ${accountInfo.status}`;
      await sendMessage(senderId, response);
    } else {
      await sendMessage(senderId, "ليس لديك حساب. استخدم 'انشاء [الاسم]' لإنشاء حساب.");
    }
  } else if (message.startsWith("أرشيف")) {
    const parts = message.split(' ');
    if (parts.length === 2) {
      const archiveNum = parseInt(parts[1]);
      if (isNaN(archiveNum)) {
        await sendMessage(senderId, "رقم الأرشيف يجب أن يكون رقماً");
      } else {
        const archiveText = await bankSystem.getArchive(archiveNum);
        await sendMessage(senderId, archiveText);
      }
    } else {
      await sendMessage(senderId, "استخدم: أرشيف [رقم الأرشيف]\nمثال: أرشيف 1");
    }
  } else if (message === "مساعدة") {
    const helpText = `
🎯 أوامر البنك:

• انشاء [الاسم] - إنشاء حساب جديد
• رصيد - عرض رصيدك
• حسابي - معلومات حسابك
• تحويل [كود المستلم] [مبلغ] - تحويل أموال
• أرشيف [رقم] - عرض الأرشيف
• مساعدة - عرض هذه الرسالة

📋 الميزات:
- الأكواد تبدأ من B772B
- كل 100 حساب في أرشيف
- الرصيد الابتدائي: 15 ${config.currency}
    `;
    await sendMessage(senderId, helpText);
  } else if (senderId === config.adminUserId) {
    if (message.startsWith("!انشاء")) {
      const parts = message.split(' ').slice(1);
      if (parts.length >= 1) {
        const username = parts[0];
        const customCode = parts.length > 1 ? parts[1] : null;
        const [success, response] = await bankSystem.adminCreateAccount(senderId, username, customCode);
        await sendMessage(senderId, response);
      } else {
        await sendMessage(senderId, "استخدم: !انشاء [الاسم] [الكود]");
      }
    } else if (message.startsWith("!تحويل")) {
      const parts = message.split(' ');
      if (parts.length === 4) {
        const fromCode = parts[1].toUpperCase();
        const toCode = parts[2].toUpperCase();
        const amount = parseFloat(parts[3]);
        if (isNaN(amount)) {
          await sendMessage(senderId, "المبلغ يجب أن يكون رقماً");
        } else {
          const [success, response] = await bankSystem.adminTransfer(senderId, fromCode, toCode, amount);
          await sendMessage(senderId, response);
        }
      } else {
        await sendMessage(senderId, "استخدم: !تحويل [من] [إلى] [مبلغ]");
      }
    } else if (message.startsWith("!خصم")) {
      const parts = message.split(' ');
      if (parts.length === 3) {
        const code = parts[1].toUpperCase();
        const amount = parseFloat(parts[2]);
        if (isNaN(amount)) {
          await sendMessage(senderId, "المبلغ يجب أن يكون رقماً");
        } else {
          const [success, response] = await bankSystem.adminDeductBalance(senderId, code, amount);
          await sendMessage(senderId, response);
        }
      } else {
        await sendMessage(senderId, "استخدم: !خصم [الكود] [المبلغ]");
      }
    } else if (message.startsWith("!اضافة")) {
      const parts = message.split(' ');
      if (parts.length === 3) {
        const code = parts[1].toUpperCase();
        const amount = parseFloat(parts[2]);
        if (isNaN(amount)) {
          await sendMessage(senderId, "المبلغ يجب أن يكون رقماً");
        } else {
          const [success, response] = await bankSystem.adminAddBalance(senderId, code, amount);
          await sendMessage(senderId, response);
        }
      } else {
        await sendMessage(senderId, "استخدم: !اضافة [الكود] [المبلغ]");
      }
    } else if (message.startsWith("!حظر")) {
      const parts = message.split(' ');
      if (parts.length === 2) {
        const code = parts[1].toUpperCase();
        const [success, response] = await bankSystem.adminBanAccount(senderId, code);
        await sendMessage(senderId, response);
      } else {
        await sendMessage(senderId, "استخدم: !حظر [الكود]");
      }
    } else if (message.startsWith("!الغاءحظر")) {
      const parts = message.split(' ');
      if (parts.length === 2) {
        const code = parts[1].toUpperCase();
        const [success, response] = await bankSystem.adminUnbanAccount(senderId, code);
        await sendMessage(senderId, response);
      } else {
        await sendMessage(senderId, "استخدم: !الغاءحظر [الكود]");
      }
    } else if (message === "!مساعدة") {
      const helpText = `
🎯 أوامر المشرف:

• !انشاء [الاسم] [الكود] - إنشاء حساب (الكود اختياري)
• !تحويل [من] [إلى] [مبلغ] - تحويل إداري
• !خصم [الكود] [المبلغ] - خصم من رصيد
• !اضافة [الكود] [المبلغ] - إضافة رصيد
• !حظر [الكود] - حظر حساب
• !الغاءحظر [الكود] - إلغاء حظر
• أرشيف [رقم] - عرض الأرشيف

📊 معلومات النظام:
- الحرف الحالي: ${bankSystem.currentLetter}
- آخر كود: ${bankSystem.currentLetter}${bankSystem.currentNumber.toString().padStart(3, '0')}${bankSystem.currentLetter}
- الرموز التالية: ${bankSystem.getNextCode()} ثم ${bankSystem.getNextCode()} ...
      `;
      await sendMessage(senderId, helpText);
    }
  }
}

async function sendMessage(senderId, message) {
  const url = `https://graph.facebook.com/v13.0/me/messages?access_token=${config.pageAccessToken}`;
  const data = {
    recipient: { id: senderId },
    message: { text: message }
  };

  try {
    await axios.post(url, data);
  } catch (error) {
    console.error('Error sending message:', error.response.data);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`الخادم يعمل على المنفذ ${PORT}`);
});
