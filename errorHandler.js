// errorHandler.js
// File ini berisi pengaturan error handler global untuk bot

// Fungsi untuk mengatur global error handling
function setupGlobalErrorHandling(bot) {
  // 1. Tangkap proses node.js uncaught exceptions
  process.on("uncaughtException", (err) => {
    console.error("[FATAL ERROR] Unhandled Exception:", err);
    // Kirim notifikasi ke admin jika perlu
    try {
      const adminIds = require('./config').ADMIN_IDS;
      if (adminIds && adminIds.length > 0) {
        const errorMsg = `⚠️ BOT ERROR ⚠️\n\nUncaught Exception:\n${err.message}\n\nBot tetap berjalan.`;
        adminIds.forEach(adminId => {
          bot.telegram.sendMessage(adminId, errorMsg).catch(console.error);
        });
      }
    } catch (notifyError) {
      console.error("Error saat notifikasi admin:", notifyError);
    }
    // Tidak exit process agar bot tetap berjalan
  });

  // 2. Tangkap unhandled promise rejections
  process.on("unhandledRejection", (reason, promise) => {
    console.error("[FATAL ERROR] Unhandled Rejection at:", promise, "reason:", reason);
    // Kirim notifikasi ke admin jika perlu
    try {
      const adminIds = require('./config').ADMIN_IDS;
      if (adminIds && adminIds.length > 0) {
        const errorMsg = `⚠️ BOT ERROR ⚠️\n\nUnhandled Promise Rejection:\n${reason}\n\nBot tetap berjalan.`;
        adminIds.forEach(adminId => {
          bot.telegram.sendMessage(adminId, errorMsg).catch(console.error);
        });
      }
    } catch (notifyError) {
      console.error("Error saat notifikasi admin:", notifyError);
    }
    // Tidak exit process agar bot tetap berjalan
  });

  // 3. Tambahkan middleware error handler ke Telegraf
  bot.catch((err, ctx) => {
    console.error(`[ERROR] Update ${ctx.update.update_id} error:`, err);
    
    // Coba berikan respons ke user bahwa terjadi error
    try {
      if (ctx.chat) {
        ctx.reply("Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.")
          .catch(replyErr => console.error("Gagal mengirim pesan error:", replyErr));
      }
    } catch (replyError) {
      console.error("Error saat mengirim pesan error:", replyError);
    }
    
    // Kirim notifikasi ke admin
    try {
      const adminIds = require('./config').ADMIN_IDS;
      if (adminIds && adminIds.length > 0) {
        const errorMsg = `⚠️ BOT ERROR ⚠️\n\nTelegraf Update Error:\n${err.message}\n\nUpdate ID: ${ctx.update.update_id}`;
        adminIds.forEach(adminId => {
          bot.telegram.sendMessage(adminId, errorMsg).catch(console.error);
        });
      }
    } catch (notifyError) {
      console.error("Error saat notifikasi admin:", notifyError);
    }
  });

  // 4. Middleware untuk menangkap error dalam handler
  bot.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      console.error(`[ERROR] Handler error:`, err);
      
      // Coba berikan respons ke user bahwa terjadi error
      try {
        if (ctx.chat) {
          ctx.reply("Terjadi kesalahan pada sistem. Tim kami sedang memperbaikinya.")
            .catch(replyErr => console.error("Gagal mengirim pesan error:", replyErr));
        }
      } catch (replyError) {
        console.error("Error saat mengirim pesan error:", replyError);
      }
      
      // Laporkan error ke admin jika perlu
      try {
        const adminIds = require('./config').ADMIN_IDS;
        if (adminIds && adminIds.length > 0) {
          const chatInfo = ctx.chat ? `\nChat: ${ctx.chat.type} ${ctx.chat.id} (${ctx.chat.title || ctx.chat.username || 'Unknown'})` : '';
          const userInfo = ctx.from ? `\nUser: ${ctx.from.id} (${ctx.from.username || ctx.from.first_name || 'Unknown'})` : '';
          const messageInfo = ctx.message ? `\nMessage: ${ctx.message.text || JSON.stringify(ctx.message)}` : '';
          
          const errorMsg = `⚠️ BOT ERROR ⚠️\n\nHandler Error:\n${err.message}${chatInfo}${userInfo}${messageInfo}`;
          
          adminIds.forEach(adminId => {
            bot.telegram.sendMessage(adminId, errorMsg).catch(console.error);
          });
        }
      } catch (notifyError) {
        console.error("Error saat notifikasi admin:", notifyError);
      }
    }
  });

  // 5. Middleware untuk memastikan bahwa properti-properti penting ada dalam ctx
  bot.use((ctx, next) => {
    // Validasi properti ctx yang sering digunakan
    ctx.safeFrom = ctx.from || {}; 
    ctx.safeChat = ctx.chat || {};
    ctx.safeMessage = ctx.message || {};
    
    // Fungsi helper yang aman
    ctx.safeReply = async (text, extra = {}) => {
      try {
        return await ctx.reply(text, extra);
      } catch (err) {
        console.error("Error saat mengirim pesan:", err);
        return null;
      }
    };
    
    // Fungsi untuk operasi telegram yang aman
    ctx.safeTelegram = {
      getChatMember: async (chatId, userId) => {
        try {
          return await ctx.telegram.getChatMember(chatId, userId);
        } catch (err) {
          console.error(`Error getChatMember ${chatId}/${userId}:`, err);
          return null;
        }
      },
      kickChatMember: async (chatId, userId) => {
        try {
          return await ctx.telegram.kickChatMember(chatId, userId);
        } catch (err) {
          console.error(`Error kickChatMember ${chatId}/${userId}:`, err);
          return false;
        }
      },
      // Dan fungsi telegram lainnya yang sering digunakan
    };
    
    return next();
  });

  return bot;
}

// Fungsi untuk meluncurkan bot dengan aman
async function launchBotSafely(bot) {
  console.log('Memulai bot...');
  
  // Jumlah percobaan restart maksimal
  const MAX_RESTART_ATTEMPTS = 5;
  let restartCount = 0;
  
  async function startBot() {
    try {
      await bot.launch();
      console.log('Bot berhasil dimulai!');
      
      // Reset counter jika berhasil berjalan selama 5 menit
      setTimeout(() => {
        restartCount = 0;
      }, 5 * 60 * 1000);
      
    } catch (err) {
      console.error('Gagal memulai bot:', err);
      
      // Hitung percobaan restart
      restartCount++;
      
      if (restartCount <= MAX_RESTART_ATTEMPTS) {
        const delay = Math.min(30, Math.pow(2, restartCount)) * 1000; // Backoff delay
        console.log(`Mencoba restart dalam ${delay/1000} detik (percobaan ke-${restartCount})...`);
        
        setTimeout(startBot, delay);
      } else {
        console.error(`Menyerah setelah ${MAX_RESTART_ATTEMPTS} percobaan restart.`);
        
        // Notifikasi admin
        try {
          const adminIds = require('./config').ADMIN_IDS;
          if (adminIds && adminIds.length > 0) {
            const errorMsg = `⚠️ BOT FATAL ERROR ⚠️\n\nBot gagal dimulai setelah ${MAX_RESTART_ATTEMPTS} percobaan.\nError: ${err.message}\n\nPerlu restart manual.`;
            
            // Gunakan telegram langsung karena bot belum berjalan
            const Telegram = require('telegraf/telegram');
            const telegram = new Telegram(bot.token);
            
            adminIds.forEach(adminId => {
              telegram.sendMessage(adminId, errorMsg).catch(console.error);
            });
          }
        } catch (notifyError) {
          console.error("Error saat notifikasi admin:", notifyError);
        }
      }
    }
  }
  
  // Mulai bot
  await startBot();
  
  return bot;
}

// Helper untuk timeout promise agar operasi tidak hang
function withTimeout(promise, timeout = 10000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Operation timed out')), timeout)
    )
  ]);
}

// Export fungsi-fungsi
module.exports = {
  setupGlobalErrorHandling,
  launchBotSafely,
  withTimeout
};
