				
	const { Telegraf } = require('telegraf');				
	const bot = new Telegraf('7818490459:AAG-p7pp4FGVqRcFcT9QoTF8o9vVsKl_VpM');				
					
	const chatId = 1741928134;  // Seu chat ID				
					
	bot.telegram.sendMessage(chatId, '🚀 Teste do bot funcionando!').then(() => {				
	  console.log('Mensagem enviada com sucesso!');				
	  process.exit(0); // Encerra o script				
	}).catch(err => {				
	  console.error('Erro ao enviar mensagem:', err);				
	  process.exit(1);				
	});				
					
