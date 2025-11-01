const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const config = require('./config');
const BankSystem = require('./bankSystem');

const app = express();
app.use(bodyParser.json());

const bankSystem = new BankSystem();

// ويب هوك فيسبوك
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

app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    for (const entry of body.entry) {
      const webhookEvent = entry.messaging[0];
      const senderId = webhookEvent.sender.id;
      const message = webhookEvent.message.text;

      console.log(`رسالة من ${senderId}: ${message}`);

      await handleMessage(senderId, message);
    }

    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

async function handleMessage(senderId, message) {
  try {
    message = message.trim();

    // إذا كان المشرف
    if (senderId === config.adminUserId) {
      if (message.startsWith('خصم') || message.startsWith('اضافة') || 
          message.startsWith('انشاء') || message.startsWith('ارشيف') || 
          message.startsWith('بحث')) {
        
        const response = await bankSystem.processAdminCommand(senderId, message);
        await sendMessage(senderId, response);
        return;
      }
    }

    // أوامر المساعدة للجميع
    if (message === 'مساعدة' || message === 'help') {
      const helpText = `🏦 **أوامر بنك GOLD:**

📊 للمشرفين فقط:
• خصم [مبلغ]G للكود [الكود] السبب [السبب]
• اضافة [مبلغ]G للكود [الكود] السبب [السبب]  
• انشاء [الاسم]
• ارشيف [رقم]
• ارشيف [السلسلة] [رقم]
• بحث [اسم أو كود]

📈 إحصائيات:
• إجمالي الحسابات: 1,771 حساب
• السلسلة A: 1,000 حساب
• السلسلة B: 771 حساب
• التالي: B772B`;

      await sendMessage(senderId, helpText);
    }

  } catch (error) {
    console.error('Error handling message:', error);
    await sendMessage(senderId, '❌ حدث خطأ في معالجة طلبك');
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
    console.error('Error sending message:', error.response?.data || error.message);
  }
}

// سكريبت الاستيراد
app.get('/import-data', async (req, res) => {
  const DataImporter = require('./dataImporter');
  const importer = new DataImporter();
  
  try {
    await importer.importAllData();
    res.send('✅ تم استيراد جميع البيانات بنجاح!');
  } catch (error) {
    res.status(500).send('❌ خطأ في الاستيراد: ' + error.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 الخادم يعمل على المنفذ ${PORT}`);
  console.log(`📊 جاهز لاستيراد 1,771 حساب`);
});
