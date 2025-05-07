// Завантаження необхідних бібліотек
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express'); // Додаємо Express

// Ініціалізація Express-додатку
const app = express();
app.use(express.json()); // Middleware для розбору JSON-тіла запитів

// Ініціалізація бота та констант
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONOBANK_TOKEN = process.env.MONOBANK_TOKEN;
// ЗАМІНІТЬ НА ВАШ РЕАЛЬНИЙ TELEGRAM ID АДМІНІСТРАТОРА
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID; // Наприклад: 123456789
const BOT_USERNAME = process.env.BOT_USERNAME; // Username вашого бота без "@"
// URL вашого піддомену для вебхуків (переконайтесь, що є HTTPS)
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL; // Наприклад: https://bot.sulyma.pp.ua

if (!BOT_TOKEN || !MONOBANK_TOKEN || !ADMIN_TELEGRAM_ID || !BOT_USERNAME || !WEBHOOK_BASE_URL) {
  console.error("Будь ласка, перевірте змінні середовища: BOT_TOKEN, MONOBANK_TOKEN, ADMIN_TELEGRAM_ID, BOT_USERNAME, WEBHOOK_BASE_URL");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Оголошення доступних послуг
const services = {
  consultation: {
    title: 'Звичайна консультація',
    amount: 54900
  },
  urgent_consultation: {
    title: 'Термінова консультація',
    amount: 109900
  },
  deferral_support: {
    title: 'Супровід при оформленні відстрочки',
    amount: 109900
  },
  tck_support: {
    title: 'Супровід в ТЦК',
    amount: 54900
  },
  protocol_appeal: {
    title: 'Оскарження протоколу',
    amount: 109900
  }
};

// Команда старту - вибір послуг
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
   // Перевірка, чи це повернення після оплати (для уникнення повторного меню)
  if (msg.text.startsWith('/start paid_')) {
    return; // Обробка цієї логіки вже є в іншому обробнику
  }
  const keyboard = [
    [{ text: services.consultation.title, callback_data: 'consultation' }],
    [{ text: services.urgent_consultation.title, callback_data: 'urgent_consultation' }],
    [{ text: services.deferral_support.title, callback_data: 'deferral_support' }],
    [{ text: services.tck_support.title, callback_data: 'tck_support' }],
    [{ text: services.protocol_appeal.title, callback_data: 'protocol_appeal' }]
  ];

  bot.sendMessage(chatId, 'Оберіть послугу:', {
    reply_markup: { inline_keyboard: keyboard }
  });
});

// Обробка вибору послуги
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id; // Отримуємо ID користувача
  const usernameForNotification = query.from.username || userId.toString();

  const serviceKey = query.data;
  const service = services[serviceKey];
  if (!service) {
      bot.answerCallbackQuery(query.id);
      return;
  }

  let finalAmount = service.amount;
  let referenceId = `order_${userId}_${Date.now()}`;
  // Перевіряємо, чи це адміністратор (порівнюємо рядки, бо ADMIN_TELEGRAM_ID з .env буде рядком)
  const isAdminPayment = userId.toString() === ADMIN_TELEGRAM_ID;

  if (isAdminPayment) {
    finalAmount = 100; // 1 грн для тестового платежу
    referenceId = `test_${referenceId}`;
    const adminTestMessage = `❗️ Активовано тестовий режим оплати для послуги "${service.title}".\n` +
                             `Сума: ${finalAmount / 100} грн.\n` +
                             `Будь ласка, використовуйте тестові карткові дані Monobank:\n` +
                             `🔗 https://api.monobank.ua/docs/acquiring/metody/internet-ekvairynh/testovi-dani-kart.html`;
    try {
        await bot.sendMessage(chatId, adminTestMessage);
    } catch (e) {
        console.error("Error sending test mode message to admin:", e);
    }
  }

  const webHookPath = '/monobank-webhook';
  const webHookUrl = `${WEBHOOK_BASE_URL}${webHookPath}`;

  try {
    const invoicePayload = {
      amount: finalAmount,
      ccy: 980,
      merchantPaymInfo: {
        reference: referenceId,
        destination: `Оплата за послугу: ${service.title}`
      },
      redirectUrl: `https://t.me/${BOT_USERNAME}?start=paid_${usernameForNotification}`,
      webHookUrl: webHookUrl, // Додаємо URL вебхука
      validity: 3600, // Термін дії рахунку в секундах
    };

    const invoiceResponse = await axios.post(
      'https://api.monobank.ua/api/merchant/invoice/create',
      invoicePayload,
      {
        headers: {
          'X-Token': MONOBANK_TOKEN
        }
      }
    );

    const paymentUrl = invoiceResponse.data.pageUrl;
    const invoiceId = invoiceResponse.data.invoiceId;
    // Зберігаємо в якусь тимчасову змінну або базу даних зв'язок referenceId та chatId
    // для майбутнього сповіщення користувача через вебхук.
    // Наприклад: activeInvoices[referenceId] = { chatId: chatId, userId: userId, serviceTitle: service.title };
    // Для простоти, поки що цей крок пропустимо, але він важливий для реальних сповіщень.

    await bot.sendMessage(chatId, `Для завершення оплати послуги "${service.title}" (${finalAmount/100} грн), перейдіть за посиланням:\n${paymentUrl}\n\nID рахунку: ${invoiceId}`);
  } catch (error) {
    console.error('Error creating Monobank invoice:', error.response ? error.response.data : error.message);
    await bot.sendMessage(chatId, 'Помилка при створенні рахунку. Спробуйте пізніше.');
  }

  bot.answerCallbackQuery(query.id);
});

// Перевірка чи користувач повернувся після оплати
bot.onText(/\/start paid_(.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const paidUsername = match[1];

  bot.sendMessage(chatId, `Дякуємо за ваш запит! Залиште, будь ласка, ваш контактний номер телефону, і наш спеціаліст зв'яжеться з вами найближчим часом.`, {
    reply_markup: {
      keyboard: [
        [{ text: '📱 Поділитися контактом', request_contact: true }]
      ],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });

  // Інформування адміністратора (використовуємо ADMIN_TELEGRAM_ID для надсилання повідомлення)
  if (ADMIN_TELEGRAM_ID) {
    bot.sendMessage(ADMIN_TELEGRAM_ID, `Користувач @${paidUsername} (або ID: ${paidUsername}) повернувся після створення рахунку та йому запропоновано залишити контакт.`);
  }
});

// Обробка контакту користувача
bot.on('contact', (msg) => {
  const contact = msg.contact;
  const username = msg.from.username || msg.from.id;
  const chatId = msg.chat.id;

  const contactInfo = `📞 Отримано контакт від користувача ${username}:\n` +
                      `Ім'я: ${contact.first_name}${contact.last_name ? ' ' + contact.last_name : ''}\n` +
                      `Телефон: ${contact.phone_number}\n` +
                      `Telegram User ID: ${contact.user_id || 'не вказано'}`;

  if (ADMIN_TELEGRAM_ID) {
    bot.sendMessage(ADMIN_TELEGRAM_ID, contactInfo);
  }

  bot.sendMessage(chatId, `Дякую! Ваш контакт ${contact.phone_number} отримано. Ми зв'яжемося з вами найближчим часом.`);
});


// === Маршрут для вебхука від Monobank ===
// Для простоти, використовуємо той самий шлях, що й у webHookPath
app.post('/monobank-webhook', (req, res) => {
  console.log('Отримано вебхук від Monobank!');
  const paymentInfo = req.body;
  console.log('Тіло вебхука:', JSON.stringify(paymentInfo, null, 2));

  // TODO: Дуже важливо! Реалізувати перевірку підпису Monobank 'X-Sign' для безпеки.
  // const signatureFromHeader = req.headers['x-sign'];
  // Тут має бути логіка перевірки підпису з вашим публічним ключем від Monobank.

  const status = paymentInfo.status;
  const reference = paymentInfo.reference; // Ваш `referenceId`
  const invoiceId = paymentInfo.invoiceId;

  if (status === 'success') {
    console.log(`Платіж УСПІШНИЙ для reference: ${reference}, invoiceId: ${invoiceId}`);
    // Тут ви б знайшли користувача за reference (потрібно було б зберігати зв'язок chatId/userId з reference)
    // і надіслали б йому повідомлення про успішну оплату.
    // Наприклад:
    // const invoiceData = activeInvoices[reference];
    // if (invoiceData) {
    //   bot.sendMessage(invoiceData.chatId, `Оплата за послугу "${invoiceData.serviceTitle}" успішна! Дякуємо.`);
    //   delete activeInvoices[reference]; // Видалити оброблений рахунок
    // }
    if (ADMIN_TELEGRAM_ID) {
        bot.sendMessage(ADMIN_TELEGRAM_ID, `✅ Успішна оплата (вебхук):\nReference: ${reference}\nInvoice ID: ${invoiceId}\nСума: ${paymentInfo.amount / 100} ${paymentInfo.ccy === 980 ? 'UAH' : paymentInfo.ccy}`);
    }

  } else if (status === 'failure') {
    console.log(`Платіж НЕВДАЛИЙ для reference: ${reference}, invoiceId: ${invoiceId}. Причина: ${paymentInfo.failureReason}`);
     if (ADMIN_TELEGRAM_ID) {
        bot.sendMessage(ADMIN_TELEGRAM_ID, `❌ Невдала оплата (вебхук):\nReference: ${reference}\nInvoice ID: ${invoiceId}\nПричина: ${paymentInfo.failureReason}`);
    }
  } else {
    console.log(`Отримано вебхук зі статусом: ${status} для reference: ${reference}`);
     if (ADMIN_TELEGRAM_ID) {
        bot.sendMessage(ADMIN_TELEGRAM_ID, `🔔 Вебхук Monobank:\nStatus: ${status}\nReference: ${reference}\nInvoice ID: ${invoiceId}`);
    }
  }

  res.status(200).send('OK'); // Завжди відповідаємо Monobank статусом 200 OK
});

// === Запуск HTTP-сервера ===
const PORT = process.env.PORT; // CityHost надасть правильний сокет тут

if (!PORT) {
  console.error("Змінна середовища PORT не встановлена! Запуск на тестовому порті 3000.");
  // Для локального тестування можна встановити порт вручну
  app.listen(3000, () => {
    console.log(`Тестовий сервер Express запущено на http://localhost:3000`);
    console.log(`Вебхук очікується на /monobank-webhook`);
    console.log('Бот запущений локально (polling)...');
  });
} else {
  // Запуск на хостингу
  app.listen(PORT, () => {
    console.log(`Сервер Express запущено і слухає на сокеті (process.env.PORT)`);
    console.log(`Вебхук очікується на ${WEBHOOK_BASE_URL}/monobank-webhook`);
    console.log('Бот запущений на хостингу (polling)...');
  });
}

// Обробка помилок polling для бота (можна залишити, якщо використовуєте)
bot.on('polling_error', (error) => {
  console.error(`Polling error: ${error.code} - ${error.message}`);
});

console.log('Бот та веб-сервер намагаються запуститись...');