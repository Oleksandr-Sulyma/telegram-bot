// Завантаження необхідних бібліотек
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Ініціалізація бота
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const MONOBANK_TOKEN = process.env.MONOBANK_TOKEN;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME; // Наприклад: your_admin_username без "@"

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
  const userId = query.from.id;
  const username = query.from.username || userId;

  const service = services[query.data];
  if (!service) return;

  try {
    const invoiceResponse = await axios.post(
      'https://api.monobank.ua/api/merchant/invoice/create',
      {
        amount: service.amount,
        ccy: 980,
        merchantPaymInfo: {
          reference: `order_${Date.now()}`,
          destination: 'Оплата за послуги з надання консультацій'
        },
        redirectUrl: `https://t.me/${process.env.BOT_USERNAME}?start=paid_${username}`
      },
      {
        headers: {
          'X-Token': MONOBANK_TOKEN
        }
      }
    );

    const paymentUrl = invoiceResponse.data.pageUrl;
    await bot.sendMessage(chatId, `Для завершення, сплатіть послугу за посиланням:\n${paymentUrl}`);
  } catch (error) {
    console.error(error);
    await bot.sendMessage(chatId, 'Помилка при створенні рахунку. Спробуйте пізніше.');
  }

  bot.answerCallbackQuery(query.id);
});

// Перевірка чи користувач повернувся після оплати
bot.onText(/\/start paid_(.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const username = match[1];

  bot.sendMessage(chatId, `Залиште ваш контакт, найближчим часом я з вами зв'яжусь.`, {
    reply_markup: {
      keyboard: [
        [{ text: 'Поділитися контактом', request_contact: true }]
      ],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });

  // Інформування адміністратора
  if (ADMIN_USERNAME) {
    bot.sendMessage(`@${ADMIN_USERNAME}`, `Користувач @${username} повернувся після оплати та готовий залишити контакт.`);
  }
});

// Обробка контакту користувача
bot.on('contact', (msg) => {
  const contact = msg.contact;
  const username = msg.from.username || msg.from.id;

  if (ADMIN_USERNAME) {
    bot.sendMessage(`@${ADMIN_USERNAME}`, `Користувач @${username} надіслав контакт: ${contact.phone_number}`);
  }

  bot.sendMessage(msg.chat.id, `Дякую! Я зв'яжусь з вами найближчим часом.`);
});