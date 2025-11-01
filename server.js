const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const config = require('./config');
const BankSystem = require('./bankSystem');

const app = express();
app.use(bodyParser.json());

const bankSystem = new BankSystem();

// الصفحة الرئيسية
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>🏦 BankGold Bot</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
            .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; }
            .status { background: #27ae60; color: white; padding: 10px; border-radius: 5px; text-align: center; }
            .commands { margin-top: 20px; }
            .command { background: #ecf0f1; margin: 10px 0; padding: 15px; border-radius: 5px; border-left: 4px solid #3498db; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🏦 BankGold Bot System</h1>
            <div class="status">✅ النظام يعمل بشكل طبيعي</div>
            <div class="commands">
                <h3>📋 الأوامر المتاحة:</h3>
                <div class="command"><strong>انشاء [الاسم]</strong> - إنشاء حساب جديد</div>
                <div class="command"><strong>تحويل [المبلغ] [الكود]</strong> - تحويل غولد</div>
                <div class="command"><strong>رصيد [الكود]</strong> - استعلام عن رصيد</div>
                <div class="command"><strong>ارشيف [A1/B2]</strong> - عرض الأرشيفات</div>
                <div class="command"><strong>مساعدة</strong> - عرض جميع الأوامر</div>
            </div>
        </div>
    </body>
    </html>
  `);
});

// ويب هوك فيسبوك
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === config.verifyToken) {
      console.log('✅ تم التحقق من الويب هوك بنجاح');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// استقبال الرسائل
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    for (const entry of body.entry) {
      const webhookEvent = entry.messaging[0];
      const senderId = webhookEvent.sender.id;
      const message = webhookEvent.message.text;

      console.log(`📩 رسالة من ${senderId}: ${message}`);

      // معالجة الرسالة
      const response = await bankSystem.processCommand(senderId, message);
      
      // إرسال الرد
      await sendMessage(senderId, response);
    }

    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

// إرسال الرسائل إلى فيسبوك
async function sendMessage(senderId, message) {
  const url = `https://graph.facebook.com/v13.0/me/messages?access_token=${config.pageAccessToken}`;
  const data = {
    recipient: { id: senderId },
    message: { text: message }
  };

  try {
    await axios.post(url, data);
    console.log(`✅ تم إرسال رد إلى ${senderId}`);
  } catch (error) {
    console.error('❌ خطأ في إرسال الرسالة:', error.response?.data || error.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 البوت يعمل على المنفذ ${PORT}`);
  console.log(`🏦 نظام بنك جولد جاهز للاستخدام`);
  console.log(`📊 إجمالي الحسابات: 1,771 حساب`);
  console.log(`💬 الأوامر متاحة عبر فيسبوك ماسنجر`);
});
