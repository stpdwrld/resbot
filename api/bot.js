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

// Helper functions
function parseProxies(content) {
  return content.split('\n')
    .filter(line => line.trim())
    .map(line => {
      try {
        if (line.includes(',')) {
          const [ip, port, countryCode, isp] = line.split(',');
          return ip && port ? { ip: ip.trim(), port: parseInt(port.trim()), countryCode, isp } : null;
        } else if (line.includes(':')) {
          const [ip, port] = line.split(':');
          return ip && port ? { ip: ip.trim(), port: parseInt(port.trim()) } : null;
        }
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean);
}

async function checkProxies(ctx, chatId, proxies) {
  const active = [];
  const dead = [];
  const total = proxies.length;
  let lastProgress = 0;
  let processedCount = 0;
  const BATCH_SIZE = 10;
  const DELAY_THRESHOLD = 180;
  const DELAY_DURATION = 10000;
  let lastUpdateTime = Date.now();

  for (let i = 0; i < proxies.length; i += BATCH_SIZE) {
    const batch = proxies.slice(i, i + BATCH_SIZE);
    
    // Process current batch
    const batchResults = await Promise.all(batch.map(async (proxy) => {
      try {
        const response = await axios.get(`${API_URL}?ip=${proxy.ip}&port=${proxy.port}`, {
          timeout: 5000
        });
        
        return {
          success: true,
          data: response.data,
          proxy
        };
      } catch (error) {
        return {
          success: false,
          proxy
        };
      }
    }));

    // Process results
    batchResults.forEach(result => {
      if (result.success && result.data.proxyip) {
        active.push({
          ip: result.proxy.ip,
          port: result.proxy.port,
          countryCode: result.data.countryCode || '',
          isp: result.data.asOrganization || ''
        });
      } else {
        dead.push(result.proxy);
      }
    });

    processedCount += batch.length;
    const currentProgress = Math.floor((processedCount / total) * 100);
    const now = Date.now();

    // Update progress if:
    // - Progress increased by at least 5%
    // - Or 30 seconds have passed since last update
    // - Or we're starting a pause
    if (currentProgress >= lastProgress + 5 || 
        now - lastUpdateTime > 30000 || 
        (processedCount % DELAY_THRESHOLD === 0 && processedCount < total)) {
      
      let message = `🔍 Found ${total} proxies. Checking them now...\n⏳ Progress: ${currentProgress}% (${processedCount}/${total} proxies checked)`;
      
      // Add pause notice if needed
      if (processedCount % DELAY_THRESHOLD === 0 && processedCount < total) {
        message += `\n⏸ Pausing for ${DELAY_DURATION/1000} seconds...`;
      }

      try {
        await ctx.telegram.editMessageText(
          chatId,
          progressMessages[chatId],
          null,
          message
        );
        lastProgress = currentProgress;
        lastUpdateTime = now;
      } catch (e) {
        console.error('Error updating progress message:', e);
      }

      // Handle pause if needed
      if (processedCount % DELAY_THRESHOLD === 0 && processedCount < total) {
        await new Promise(resolve => setTimeout(resolve, DELAY_DURATION));
      }
    } else if (i + BATCH_SIZE < proxies.length) {
      // Regular delay between batches
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  return { active, dead };
}

async function sendResults(ctx, results) {
  const activeContent = results.active.map(p => 
    `${p.ip},${p.port},${p.countryCode || ''},${p.isp || ''}`
  ).join('\n');
  
  const deadContent = results.dead.map(p => 
    `${p.ip},${p.port}`
  ).join('\n');

  await Promise.all([
    ctx.replyWithDocument({
      source: Buffer.from(activeContent),
      filename: 'active.txt'
    }),
    ctx.replyWithDocument({
      source: Buffer.from(deadContent),
      filename: 'dead.txt'
    })
  ]);
}

// Webhook handler
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).send('Ready to accept updates');
  }
  
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body);
      res.status(200).send('OK');
    } catch (error) {
      console.error('Error handling update:', error);
      res.status(500).send('Error');
    }
  } else {
    res.status(405).send('Method not allowed');
  }
};

// Local development
if (process.env.NODE_ENV === 'development') {
  bot.launch();
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
