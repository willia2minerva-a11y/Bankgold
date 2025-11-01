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
        <meta charset="UTF-8">
        <style>
            body { 
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                margin: 0; 
                padding: 20px; 
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
            }
            .container { 
                max-width: 900px; 
                margin: 0 auto; 
                background: white; 
                padding: 40px; 
                border-radius: 15px; 
                box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            }
            h1 { 
                color: #2c3e50; 
                border-bottom: 3px solid #3498db; 
                padding-bottom: 15px; 
                text-align: center;
                margin-bottom: 30px;
            }
            .status { 
                background: #27ae60; 
                color: white; 
                padding: 15px; 
                border-radius: 8px; 
                text-align: center; 
                font-size: 18px;
                font-weight: bold;
                margin-bottom: 30px;
            }
            .commands { 
                margin-top: 30px; 
            }
            .command { 
                background: #f8f9fa; 
                margin: 12px 0; 
                padding: 18px; 
                border-radius: 8px; 
                border-left: 5px solid #3498db;
                transition: transform 0.2s;
            }
            .command:hover {
                transform: translateX(5px);
                background: #e8f4fc;
            }
            .section-title {
                color: #2c3e50;
                border-left: 4px solid #e74c3c;
                padding-left: 15px;
                margin: 25px 0 15px 0;
            }
            .stats {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 15px;
                margin: 20px 0;
            }
            .stat-card {
                background: linear-gradient(135deg, #74b9ff, #0984e3);
                color: white;
                padding: 20px;
                border-radius: 10px;
                text-align: center;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🏦 نظام بنك GOLD البنكي</h1>
            <div class="status">✅ النظام يعمل بشكل طبيعي وجاهز للاستخدام</div>
            
            <div class="stats">
                <div class="stat-card">
                    <h3>إجمالي الحسابات</h3>
                    <p style="font-size: 24px; margin: 10px 0;">1,771</p>
                </div>
                <div class="stat-card">
                    <h3>الأرشيفات</h3>
                    <p style="font-size: 24px; margin: 10px 0;">18</p>
                </div>
                <div class="stat-card">
                    <h3>السلسلة الحالية</h3>
                    <p style="font-size: 24px; margin: 10px 0;">B</p>
                </div>
            </div>

            <div class="commands">
                <h2 class="section-title">📋 الأوامر المتاحة في الماسنجر:</h2>
                
                <div class="command">
                    <strong>👤 إنشاء حساب:</strong><br>
                    <code>انشاء [الاسم الكامل]</code>
                </div>
                
                <div class="command">
                    <strong>💸 تحويل الأموال:</strong><br>
                    <code>تحويل [المبلغ] [كود المستلم]</code>
                </div>
                
                <div class="command">
                    <strong>💰 استعلام الرصيد:</strong><br>
                    <code>رصيد [كود الحساب]</code>
                </div>
                
                <div class="command">
                    <strong>📁 الأرشيفات:</strong><br>
                    <code>ارشيف A1</code> إلى <code>ارشيف A10</code><br>
                    <code>ارشيف B1</code> إلى <code>ارشيف B8</code>
                </div>
                
                <div class="command">
                    <strong>ℹ️ المساعدة:</strong><br>
                    <code>مساعدة</code> أو <code>اوامر</code>
                </div>

                <h2 class="section-title">⚡ أوامر المشرف:</h2>
                
                <div class="command">
                    <strong>🚫 حظر الحسابات:</strong><br>
                    <code>حظر [كود الحساب]</code>
                </div>
                
                <div class="command">
                    <strong>📊 الإحصائيات:</strong><br>
                    <code>مجموع</code>
                </div>
                
                <div class="command">
                    <strong>📉 خصم الأموال:</strong><br>
                    <code>خصم [المبلغ] [الكود] السبب [السبب]</code>
                </div>
            </div>

            <div style="margin-top: 30px; padding: 20px; background: #f1f2f6; border-radius: 10px; text-align: center;">
                <p>🚀 <strong>التالي:</strong> ${bankSystem.getNextCode()}</p>
                <p>💼 <strong>الحسابات الجديدة تبدأ من:</strong> B772B</p>
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
  console.log(`📁 الأرشيفات: 10 لـA و 8 لـB`);
  console.log(`💬 الأوامر متاحة عبر فيسبوك ماسنجر`);
  console.log(`🌐 الواجهة متاحة على: http://localhost:${PORT}`);
});
