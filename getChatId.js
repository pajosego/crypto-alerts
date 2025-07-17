const { Telegraf } = require('telegraf');
const bot = new Telegraf('7818490459:AAG-p7pp4FGVqRcFcT9QoTF8o9vVsKl_VpM');

bot.on('message', (ctx) => {
  console.log('Chat ID:', ctx.chat.id);
  ctx.reply(`Seu chat ID é: ${ctx.chat.id}`);
});

bot.launch();
