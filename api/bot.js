const { Telegraf } = require('telegraf');
const fs = require('fs');
const axios = require('axios');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '7058049478:AAGfCnagRO1vv6zItxtJkkiMbh2rax6kzQ4');
const API_URL = process.env.PROXY_CHECK_API || 'https://cekstupid.vercel.app/api/v1';

// Store processing status by chat ID
const processingStatus = {};

bot.start((ctx) => {
  ctx.reply('🤖 Welcome to Proxy Scanner Bot!\n\nSend me a text file containing proxies (max 500) in format:\n- proxy:port\n- proxy,port,countrycode,isp\n\nI will check them and send back active and dead lists.');
});

bot.on('document', async (ctx) => {
  const chatId = ctx.message.chat.id;
  
  if (processingStatus[chatId]) {
    return ctx.reply('Please wait, your previous request is still processing.');
  }
  
  processingStatus[chatId] = true;
  
  try {
    const file = await ctx.telegram.getFile(ctx.message.document.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    
    // Download the file
    const response = await axios.get(fileUrl, { responseType: 'text' });
    const content = response.data;
    
    // Parse proxies
    const proxies = parseProxies(content);
    
    if (proxies.length === 0) {
      processingStatus[chatId] = false;
      return ctx.reply('No valid proxies found in the file. Please check the format.');
    }
    
    if (proxies.length > 500) {
      processingStatus[chatId] = false;
      return ctx.reply(`Too many proxies (${proxies.length}). Maximum allowed is 500.`);
    }
    
    ctx.reply(`🔍 Found ${proxies.length} proxies. Checking them now...`);
    
    // Check proxies
    const results = await checkProxies(proxies);
    
    // Create files
    const activeContent = results.active.map(p => `${p.ip},${p.port},${p.countryCode || ''},${p.isp || ''}`).join('\n');
    const deadContent = results.dead.map(p => `${p.ip},${p.port}`).join('\n');
    
    // Send files
    await ctx.replyWithDocument({
      source: Buffer.from(activeContent),
      filename: 'active.txt'
    });
    
    await ctx.replyWithDocument({
      source: Buffer.from(deadContent),
      filename: 'dead.txt'
    });
    
    await ctx.reply(`✅ Done!\nActive: ${results.active.length}\nDead: ${results.dead.length}`);
    
  } catch (error) {
    console.error('Error:', error);
    ctx.reply('❌ An error occurred while processing your file.');
  } finally {
    processingStatus[chatId] = false;
  }
});

function parseProxies(content) {
  const lines = content.split('\n').filter(line => line.trim());
  const proxies = [];
  
  for (const line of lines) {
    try {
      if (line.includes(',')) {
        // Format: proxy,port,countrycode,isp
        const [ip, port, countryCode, isp] = line.split(',');
        if (ip && port) {
          proxies.push({ ip: ip.trim(), port: parseInt(port.trim()), countryCode, isp });
        }
      } else if (line.includes(':')) {
        // Format: proxy:port
        const [ip, port] = line.split(':');
        if (ip && port) {
          proxies.push({ ip: ip.trim(), port: parseInt(port.trim()) });
        }
      }
    } catch (e) {
      console.log(`Skipping invalid line: ${line}`);
    }
  }
  
  return proxies;
}

async function checkProxies(proxies) {
  const active = [];
  const dead = [];
  
  for (const proxy of proxies) {
    try {
      const response = await axios.get(`${API_URL}?ip=${proxy.ip}&port=${proxy.port}`);
      
      if (response.data.proxyip) {
        active.push({
          ip: proxy.ip,
          port: proxy.port,
          countryCode: response.data.countryCode || '',
          isp: response.data.asOrganization || ''
        });
      } else {
        dead.push({
          ip: proxy.ip,
          port: proxy.port
        });
      }
    } catch (error) {
      dead.push({
        ip: proxy.ip,
        port: proxy.port
      });
    }
    
    // Small delay between checks
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  return { active, dead };
}

// Start bot
module.exports = async (req, res) => {
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body);
      res.status(200).send('OK');
    } catch (error) {
      console.error('Error handling update:', error);
      res.status(500).send('Error');
    }
  } else {
    res.status(200).send('Proxy Scanner Bot is running');
  }
};
