const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const API_URL = process.env.PROXY_CHECK_API || 'https://cekstupid.vercel.app/api/v1';

const userProcessingStatus = {}; // Ubah dari processingStatus ke userProcessingStatus
const progressMessages = {};

bot.start((ctx) => {
  ctx.reply('🤖 Welcome to Proxy Scanner Bot!\n\nSend me a text file containing proxies (max 500) in format:\n- proxy:port\n- proxy,port,countrycode,isp\n\nI will check them and send back active and dead lists.');
});

bot.on('document', async (ctx) => {
  const userId = ctx.from.id; // Gunakan user ID bukan chat ID
  const chatId = ctx.message.chat.id;
  const document = ctx.message.document;

  // Validate file
  if (!document.mime_type.includes('text/plain') && !document.file_name.endsWith('.txt')) {
    return ctx.reply('❌ Please send a plain text file (.txt)');
  }
  if (document.file_size > 100 * 1024) {
    return ctx.reply('❌ File too large. Maximum size is 100KB');
  }
  if (userProcessingStatus[userId]) {
    return ctx.reply('Please wait, your previous request is still processing.');
  }
  
  userProcessingStatus[userId] = true;
  
  try {
    const file = await ctx.telegram.getFile(document.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const response = await axios.get(fileUrl, { responseType: 'text' });
    const proxies = parseProxies(response.data);
    
    if (proxies.length === 0) {
      return ctx.reply('No valid proxies found in the file. Please check the format.');
    }
    if (proxies.length > 500) {
      return ctx.reply(`Too many proxies (${proxies.length}). Maximum allowed is 500.`);
    }
    
    const initialMessage = await ctx.reply(`🔍 Found ${proxies.length} proxies. Checking them now...\n⏳ Progress: 0% (0/${proxies.length} proxies checked)`);
    progressMessages[chatId] = initialMessage.message_id;
    
    const results = await checkProxies(ctx, chatId, proxies);
    
    try {
      await ctx.telegram.deleteMessage(chatId, progressMessages[chatId]);
      delete progressMessages[chatId];
    } catch (e) {
      console.error('Error deleting progress message:', e);
    }
    
    await sendResults(ctx, results);
    await ctx.reply(`✅ Done!\nActive: ${results.active.length}\nDead: ${results.dead.length}`);
    
  } catch (error) {
    console.error('Error:', error);
    ctx.reply('❌ An error occurred while processing your file.');
    
    if (progressMessages[chatId]) {
      try {
        await ctx.telegram.deleteMessage(chatId, progressMessages[chatId]);
        delete progressMessages[chatId];
      } catch (e) {
        console.error('Error deleting progress message:', e);
      }
    }
  } finally {
    userProcessingStatus[userId] = false;
  }
});

// Tambahkan handler untuk pesan lain
bot.on('text', (ctx) => {
  if (!userProcessingStatus[ctx.from.id]) {
    ctx.reply('Silakan kirim file teks berisi proxy untuk di-scan.');
  } else {
    ctx.reply('Permintaan Anda sebelumnya masih diproses, harap tunggu...');
  }
});

// Helper functions tetap sama...
