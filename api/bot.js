const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const API_URL = process.env.PROXY_CHECK_API || 'https://cekstupid.vercel.app/api/v1';

const processingStatus = {};
const rateLimit = {};

const progressData = {};  // Store the progress

// Rate limiting middleware
bot.use((ctx, next) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return next();
  
  const now = Date.now();
  if (rateLimit[chatId] && now - rateLimit[chatId] < 30000) {
    return ctx.reply('⚠️ Please wait 30 seconds between requests');
  }
  rateLimit[chatId] = now;
  return next();
});

bot.start((ctx) => {
  ctx.reply('🤖 Welcome to Proxy Scanner Bot!\n\nSend me a text file containing proxies (max 500) in format:\n- proxy:port\n- proxy,port,countrycode,isp\n\nI will check them and send back active and dead lists.');
});

bot.on('document', async (ctx) => {
  const chatId = ctx.message.chat.id;
  const document = ctx.message.document;

  // Validate file
  if (!document.mime_type.includes('text/plain') && !document.file_name.endsWith('.txt')) {
    return ctx.reply('❌ Please send a plain text file (.txt)');
  }
  if (document.file_size > 100 * 1024) {
    return ctx.reply('❌ File too large. Maximum size is 100KB');
  }
  if (processingStatus[chatId]) {
    return ctx.reply('Please wait, your previous request is still processing.');
  }
  
  processingStatus[chatId] = true;
  
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
    
    await ctx.reply(`🔍 Found ${proxies.length} proxies. Checking them now...`);
    const results = await checkProxies(ctx, proxies, chatId);
    
    // Send results
    await sendResults(ctx, results);
    await ctx.reply(`✅ Done!\nActive: ${results.active.length}\nDead: ${results.dead.length}`);
    
  } catch (error) {
    console.error('Error:', error);
    ctx.reply('❌ An error occurred while processing your file.');
  } finally {
    processingStatus[chatId] = false;
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

async function checkProxies(ctx, proxies, chatId) {
  const active = [];
  const dead = [];
  const total = proxies.length;
  let lastUpdate = 0;

  // Store the progress in the `progressData`
  progressData[chatId] = { checked: 0, total: total };

  for (let i = 0; i < proxies.length; i += 10) {
    const batch = proxies.slice(i, i + 10);
    await Promise.all(batch.map(async (proxy) => {
      try {
        const response = await axios.get(`${API_URL}?ip=${proxy.ip}&port=${proxy.port}`, {
          timeout: 5000
        });
        
        if (response.data.proxyip) {
          active.push({
            ip: proxy.ip,
            port: proxy.port,
            countryCode: response.data.countryCode || '',
            isp: response.data.asOrganization || ''
          });
        } else {
          dead.push(proxy);
        }
      } catch (error) {
        dead.push(proxy);
      }
    }));

    // Update progress and avoid flooding with too many updates
    progressData[chatId].checked = i + 10;

    // Only send progress every 25% or 1 minute
    const progress = Math.floor((progressData[chatId].checked / total) * 100);
    const now = Date.now();
    if (progress >= lastUpdate + 25 || now - lastUpdate > 60000) {
      lastUpdate = progress;
    }

    if (i + 10 < proxies.length) {
      await new Promise(resolve => setTimeout(resolve, 500));  // Slight delay
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

  // Save the result files locally
  const activeFile = path.join(__dirname, 'active.txt');
  const deadFile = path.join(__dirname, 'dead.txt');

  fs.writeFileSync(activeFile, activeContent);
  fs.writeFileSync(deadFile, deadContent);

  // Send the result files as a reply
  await Promise.all([
    ctx.replyWithDocument({ source: fs.createReadStream(activeFile), filename: 'active.txt' }),
    ctx.replyWithDocument({ source: fs.createReadStream(deadFile), filename: 'dead.txt' })
  ]);

  // Cleanup the files
  fs.unlinkSync(activeFile);
  fs.unlinkSync(deadFile);
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
