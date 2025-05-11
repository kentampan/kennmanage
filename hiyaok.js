// ============= index.js =============
// Bot manajemen grup dengan fitur lengkap
// - Manajemen grup melalui private chat
// - Blacklist, Kick, Warn, dll
// - Pesan sambutan dan perpisahan kustom dengan media
// - Pengaturan grup dan keamanan

const { Telegraf, Markup, session } = require('telegraf');
const mongoose = require('mongoose');
const { setupGlobalErrorHandling, launchBotSafely } = require('./errorHandler');

// ============= KONFIGURASI =============
// Config harus berada di file terpisah: config.js
// module.exports = {
//   BOT_TOKEN: process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN',
//   MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/telegram_bot',
//   ADMIN_IDS: (process.env.ADMIN_IDS || '').split(',').map(id => Number(id)),
// };
const config = require('./config');

// ============= MODELS =============
// User Model
const UserSchema = new mongoose.Schema({
  userId: {
    type: Number,
    required: true,
    unique: true,
  },
  username: String,
  firstName: String,
  lastName: String,
  isApproved: {
    type: Boolean,
    default: false,
  },
  isAdmin: {
    type: Boolean,
    default: false,
  },
  approvedBy: Number,
  approvedAt: Date,
  requestedAt: Date,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const User = mongoose.model('User', UserSchema);

// Group Model
const GroupSchema = new mongoose.Schema({
  groupId: {
    type: Number,
    required: true,
    unique: true,
  },
  title: String,
  addedBy: Number,
  isApproved: {
    type: Boolean,
    default: false,
  },
  approvedBy: Number,
  approvedAt: Date,
  blacklistedUsers: [{
    userId: Number,
    addedBy: Number,
    addedAt: {
      type: Date,
      default: Date.now,
    },
    reason: String,
  }],
  warnings: [{
    userId: Number,
    addedBy: Number,
    addedAt: {
      type: Date,
      default: Date.now,
    },
    reason: String,
    count: {
      type: Number,
      default: 1,
    },
  }],
  settings: {
    welcomeEnabled: {
      type: Boolean,
      default: false
    },
    goodbyeEnabled: {
      type: Boolean,
      default: false
    },
    antiSpam: {
      type: Boolean,
      default: false
    },
    antiLink: {
      type: Boolean,
      default: false
    },
    antiForward: {
      type: Boolean,
      default: false
    },
    restrictNewMembers: {
      type: Boolean,
      default: false
    },
    autoDeleteCommands: {
      type: Boolean,
      default: false
    },
    adminOnlyCommands: {
      type: Boolean,
      default: false
    }
  },
  admins: [{
    userId: Number,
    addedBy: Number,
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const Group = mongoose.model('Group', GroupSchema);

// Welcome Model
const WelcomeSchema = new mongoose.Schema({
  groupId: {
    type: Number,
    required: true,
    unique: true,
  },
  text: {
    type: String,
    default: 'Welcome to the group!',
  },
  mediaType: {
    type: String,
    enum: ['none', 'photo', 'video', 'animation', 'sticker'],
    default: 'none',
  },
  mediaFileId: String,
  hasCaption: {
    type: Boolean,
    default: true,
  },
  buttons: [{
    text: String,
    url: String,
  }],
  showButtons: {
    type: Boolean,
    default: false,
  },
  showTags: {
    type: Boolean,
    default: true,
  },
  enabled: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

const Welcome = mongoose.model('Welcome', WelcomeSchema);

// Goodbye Model
const GoodbyeSchema = new mongoose.Schema({
  groupId: {
    type: Number,
    required: true,
    unique: true,
  },
  text: {
    type: String,
    default: 'Goodbye, we\'ll miss you!',
  },
  mediaType: {
    type: String,
    enum: ['none', 'photo', 'video', 'animation', 'sticker'],
    default: 'none',
  },
  mediaFileId: String,
  hasCaption: {
    type: Boolean,
    default: true,
  },
  buttons: [{
    text: String,
    url: String,
  }],
  showButtons: {
    type: Boolean,
    default: false,
  },
  showTags: {
    type: Boolean,
    default: true,
  },
  enabled: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

const Goodbye = mongoose.model('Goodbye', GoodbyeSchema);

// ============= MIDDLEWARE =============
// Authentication Middleware
async function checkUserApproval(ctx, next) {
  const userId = ctx.from.id;
  
  // Check if user is a bot admin
  if (ctx.config.ADMIN_IDS.includes(userId)) {
    ctx.isAdmin = true;
    return next();
  }
  
  // Check if user is approved
  const user = await User.findOne({ userId });
  if (user && (user.isApproved || user.isAdmin)) {
    ctx.isApproved = true;
    ctx.isAdmin = user.isAdmin;
    return next();
  }
  
  // User is not approved
  const keyboard = Markup.inlineKeyboard([
    Markup.button.callback('Request Approval', `request_approval:${userId}`),
  ]);
  
  await ctx.reply('Anda belum disetujui untuk menggunakan bot ini. Silakan minta persetujuan dari admin bot.', keyboard);
  return;
}

async function checkGroupApproval(ctx) {
  const groupId = ctx.chat.id;
  const addedBy = ctx.from.id;
  
  // Check if the group is already approved
  const group = await Group.findOne({ groupId });
  if (group && group.isApproved) {
    return true;
  }
  
  // Check if the user who added the bot is an admin or approved
  if (ctx.config.ADMIN_IDS.includes(addedBy)) {
    // Auto-approve group if added by admin
    await new Group({
      groupId,
      title: ctx.chat.title,
      addedBy,
      isApproved: true,
      approvedBy: addedBy,
      approvedAt: new Date(),
    }).save();
    
    await ctx.reply('Grup ini otomatis disetujui karena ditambahkan oleh admin bot.');
    return true;
  }
  
  const user = await User.findOne({ userId: addedBy });
  if (user && (user.isApproved || user.isAdmin)) {
    // Auto-approve group if added by approved user
    await new Group({
      groupId,
      title: ctx.chat.title,
      addedBy,
      isApproved: true,
      approvedBy: addedBy,
      approvedAt: new Date(),
    }).save();
    
    await ctx.reply('Grup ini otomatis disetujui karena ditambahkan oleh pengguna yang disetujui.');
    return true;
  }
  
  // Group is not approved and was added by unapproved user
  return false;
}

// ============= WELCOME HANDLER =============
const welcomeHandler = {
  // Command to set welcome message
  setWelcome: async (ctx) => {
    if (ctx.chat.type !== 'private') {
      return ctx.reply('Perintah ini hanya dapat digunakan dalam chat pribadi dengan bot.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    // Show list of groups to set welcome message for
    const groups = await Group.find({ 
      isApproved: true,
      $or: [
        { addedBy: ctx.from.id },
        { 'admins.userId': ctx.from.id }
      ]
    });
    
    if (groups.length === 0) {
      return ctx.reply('Anda tidak memiliki grup yang dapat dikelola. Tambahkan bot ke grup terlebih dahulu.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    const keyboard = Markup.inlineKeyboard(
      groups.map(group => [
        Markup.button.callback(group.title, `set_welcome_for:${group.groupId}`)
      ])
    );
    
    await ctx.reply('Pilih grup untuk mengatur pesan sambutan:', keyboard);
  },
  
  // Command to set goodbye message
  setGoodbye: async (ctx) => {
    if (ctx.chat.type !== 'private') {
      return ctx.reply('Perintah ini hanya dapat digunakan dalam chat pribadi dengan bot.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    // Show list of groups to set goodbye message for
    const groups = await Group.find({ 
      isApproved: true,
      $or: [
        { addedBy: ctx.from.id },
        { 'admins.userId': ctx.from.id }
      ]
    });
    
    if (groups.length === 0) {
      return ctx.reply('Anda tidak memiliki grup yang dapat dikelola. Tambahkan bot ke grup terlebih dahulu.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    const keyboard = Markup.inlineKeyboard(
      groups.map(group => [
        Markup.button.callback(group.title, `set_goodbye_for:${group.groupId}`)
      ])
    );
    
    await ctx.reply('Pilih grup untuk mengatur pesan perpisahan:', keyboard);
  },
  
  // Process welcome settings selection
  handleWelcomeSettings: async (ctx, groupId) => {
    // Find or create welcome settings for this group
    let welcome = await Welcome.findOne({ groupId });
    
    if (!welcome) {
      welcome = new Welcome({ groupId });
      await welcome.save();
    }
    
    const group = await Group.findOne({ groupId });
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✏️ Edit Teks', `welcome_edit_text:${groupId}`)],
      [Markup.button.callback('🖼️ Set Media', `welcome_set_media:${groupId}`)],
      [Markup.button.callback('🔘 Inline Buttons', `welcome_buttons:${groupId}`)],
      [Markup.button.callback(welcome.showTags ? '✅ User Tag' : '❌ User Tag', `welcome_toggle_tags:${groupId}`)],
      [Markup.button.callback(welcome.enabled ? '✅ Aktif' : '❌ Nonaktif', `welcome_toggle:${groupId}`)],
      [Markup.button.callback('👁️ Preview', `welcome_preview:${groupId}`)],
      [Markup.button.callback('⬅️ Kembali', `group_manage:${groupId}`)],
    ]);
    
    await ctx.editMessageText(`Pengaturan Pesan Sambutan untuk grup: ${group.title}
    
Status: ${welcome.enabled ? '✅ Aktif' : '❌ Nonaktif'}
Teks: ${welcome.text}
Media: ${welcome.mediaType !== 'none' ? welcome.mediaType : 'Tidak ada'}
Tag User: ${welcome.showTags ? 'Ya' : 'Tidak'}
Inline Buttons: ${welcome.showButtons ? 'Ya' : 'Tidak'}

Silakan pilih opsi yang ingin diubah:`, keyboard);
  },
  
  // Process goodbye settings selection
  handleGoodbyeSettings: async (ctx, groupId) => {
    // Find or create goodbye settings for this group
    let goodbye = await Goodbye.findOne({ groupId });
    
    if (!goodbye) {
      goodbye = new Goodbye({ groupId });
      await goodbye.save();
    }
    
    const group = await Group.findOne({ groupId });
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✏️ Edit Teks', `goodbye_edit_text:${groupId}`)],
      [Markup.button.callback('🖼️ Set Media', `goodbye_set_media:${groupId}`)],
      [Markup.button.callback('🔘 Inline Buttons', `goodbye_buttons:${groupId}`)],
      [Markup.button.callback(goodbye.showTags ? '✅ User Tag' : '❌ User Tag', `goodbye_toggle_tags:${groupId}`)],
      [Markup.button.callback(goodbye.enabled ? '✅ Aktif' : '❌ Nonaktif', `goodbye_toggle:${groupId}`)],
      [Markup.button.callback('👁️ Preview', `goodbye_preview:${groupId}`)],
      [Markup.button.callback('⬅️ Kembali', `group_manage:${groupId}`)],
    ]);
    
    await ctx.editMessageText(`Pengaturan Pesan Perpisahan untuk grup: ${group.title}
    
Status: ${goodbye.enabled ? '✅ Aktif' : '❌ Nonaktif'}
Teks: ${goodbye.text}
Media: ${goodbye.mediaType !== 'none' ? goodbye.mediaType : 'Tidak ada'}
Tag User: ${goodbye.showTags ? 'Ya' : 'Tidak'}
Inline Buttons: ${goodbye.showButtons ? 'Ya' : 'Tidak'}

Silakan pilih opsi yang ingin diubah:`, keyboard);
  },
  
  // Handle welcome message
  handleNewMember: async (ctx) => {
    if (!ctx.message || !ctx.message.new_chat_members) {
      return;
    }
    
    // Skip if it's the bot itself joining
    if (ctx.message.new_chat_members.some(member => member.id === ctx.botInfo.id)) {
      return;
    }
    
    const groupId = ctx.chat.id;
    const welcome = await Welcome.findOne({ groupId, enabled: true });
    
    if (!welcome) {
      return;
    }
    
    // Process each new member
    for (const member of ctx.message.new_chat_members) {
      // Skip bots if configured to do so
      if (member.is_bot) {
        continue;
      }
      
      let welcomeText = welcome.text;
      
      // Replace variables in the text
      if (welcome.showTags) {
        welcomeText = welcomeText
          .replace(/{user}/g, `[${member.first_name}](tg://user?id=${member.id})`)
          .replace(/{userid}/g, member.id)
          .replace(/{username}/g, member.username ? `@${member.username}` : 'No username')
          .replace(/{name}/g, member.first_name)
          .replace(/{fullname}/g, [member.first_name, member.last_name].filter(Boolean).join(' '))
          .replace(/{group}/g, ctx.chat.title)
          .replace(/{membercount}/g, await ctx.getChatMembersCount());
      }
      
      // Prepare buttons if needed
      let keyboard;
      if (welcome.showButtons && welcome.buttons && welcome.buttons.length > 0) {
        keyboard = Markup.inlineKeyboard(
          welcome.buttons.map(button => [
            Markup.button.url(button.text, button.url)
          ])
        );
      }
      
      // Send the welcome message based on media type
      try {
        if (welcome.mediaType === 'none') {
          await ctx.replyWithMarkdown(welcomeText, keyboard ? keyboard : {});
        } else if (welcome.mediaType === 'photo') {
          await ctx.replyWithPhoto(welcome.mediaFileId, {
            caption: welcome.hasCaption ? welcomeText : null,
            parse_mode: 'Markdown',
            ...keyboard
          });
        } else if (welcome.mediaType === 'video') {
          await ctx.replyWithVideo(welcome.mediaFileId, {
            caption: welcome.hasCaption ? welcomeText : null,
            parse_mode: 'Markdown',
            ...keyboard
          });
        } else if (welcome.mediaType === 'animation') {
          await ctx.replyWithAnimation(welcome.mediaFileId, {
            caption: welcome.hasCaption ? welcomeText : null,
            parse_mode: 'Markdown',
            ...keyboard
          });
        } else if (welcome.mediaType === 'sticker') {
          // Send sticker first (no caption for stickers)
          await ctx.replyWithSticker(welcome.mediaFileId);
          
          // Then send text message if needed
          if (welcome.hasCaption) {
            await ctx.replyWithMarkdown(welcomeText, keyboard ? keyboard : {});
          }
        }
      } catch (error) {
        console.error('Error sending welcome message:', error);
      }
    }
  },
  
  // Handle goodbye message
  handleMemberLeft: async (ctx) => {
    if (!ctx.message || !ctx.message.left_chat_member) {
      return;
    }
    
    // Skip if it's the bot itself leaving
    if (ctx.message.left_chat_member.id === ctx.botInfo.id) {
      return;
    }
    
    const groupId = ctx.chat.id;
    const goodbye = await Goodbye.findOne({ groupId, enabled: true });
    
    if (!goodbye) {
      return;
    }
    
    const member = ctx.message.left_chat_member;
    
    // Skip bots if configured to do so
    if (member.is_bot) {
      return;
    }
    
    let goodbyeText = goodbye.text;
    
    // Replace variables in the text
    if (goodbye.showTags) {
      goodbyeText = goodbyeText
        .replace(/{user}/g, `[${member.first_name}](tg://user?id=${member.id})`)
        .replace(/{userid}/g, member.id)
        .replace(/{username}/g, member.username ? `@${member.username}` : 'No username')
        .replace(/{name}/g, member.first_name)
        .replace(/{fullname}/g, [member.first_name, member.last_name].filter(Boolean).join(' '))
        .replace(/{group}/g, ctx.chat.title)
        .replace(/{membercount}/g, await ctx.getChatMembersCount());
    }
    
    // Prepare buttons if needed
    let keyboard;
    if (goodbye.showButtons && goodbye.buttons && goodbye.buttons.length > 0) {
      keyboard = Markup.inlineKeyboard(
        goodbye.buttons.map(button => [
          Markup.button.url(button.text, button.url)
        ])
      );
    }
    
    // Send the goodbye message based on media type
    try {
      if (goodbye.mediaType === 'none') {
        await ctx.replyWithMarkdown(goodbyeText, keyboard ? keyboard : {});
      } else if (goodbye.mediaType === 'photo') {
        await ctx.replyWithPhoto(goodbye.mediaFileId, {
          caption: goodbye.hasCaption ? goodbyeText : null,
          parse_mode: 'Markdown',
          ...keyboard
        });
      } else if (goodbye.mediaType === 'video') {
        await ctx.replyWithVideo(goodbye.mediaFileId, {
          caption: goodbye.hasCaption ? goodbyeText : null,
          parse_mode: 'Markdown',
          ...keyboard
        });
      } else if (goodbye.mediaType === 'animation') {
        await ctx.replyWithAnimation(goodbye.mediaFileId, {
          caption: goodbye.hasCaption ? goodbyeText : null,
          parse_mode: 'Markdown',
          ...keyboard
        });
      } else if (goodbye.mediaType === 'sticker') {
        // Send sticker first (no caption for stickers)
        await ctx.replyWithSticker(goodbye.mediaFileId);
        
        // Then send text message if needed
        if (goodbye.hasCaption) {
          await ctx.replyWithMarkdown(goodbyeText, keyboard ? keyboard : {});
        }
      }
    } catch (error) {
      console.error('Error sending goodbye message:', error);
    }
  },
  
  // Handle edit welcome/goodbye text
  startWelcomeTextEdit: async (ctx, groupId) => {
    ctx.session = ctx.session || {};
    ctx.session.waitingForWelcomeText = groupId;
    
    await ctx.editMessageText(`Silakan kirim teks pesan sambutan baru. 

Anda dapat menggunakan variabel berikut:
{user} - Tag pengguna dengan nama mereka
{userid} - ID pengguna
{username} - Username pengguna
{name} - Nama depan pengguna
{fullname} - Nama lengkap pengguna
{group} - Nama grup
{membercount} - Jumlah anggota grup

Kirim /cancel untuk membatalkan.`);
  },
  
  startGoodbyeTextEdit: async (ctx, groupId) => {
    ctx.session = ctx.session || {};
    ctx.session.waitingForGoodbyeText = groupId;
    
    await ctx.editMessageText(`Silakan kirim teks pesan perpisahan baru. 

Anda dapat menggunakan variabel berikut:
{user} - Tag pengguna dengan nama mereka
{userid} - ID pengguna
{username} - Username pengguna
{name} - Nama depan pengguna
{fullname} - Nama lengkap pengguna
{group} - Nama grup
{membercount} - Jumlah anggota grup

Kirim /cancel untuk membatalkan.`);
  },
  
  // Handle preview welcome message
  previewWelcome: async (ctx, groupId) => {
    const welcome = await Welcome.findOne({ groupId });
    
    if (!welcome) {
      return ctx.answerCbQuery('Pesan sambutan belum diatur untuk grup ini.');
    }
    
    let welcomeText = welcome.text;
    
    // Replace variables in the text
    if (welcome.showTags) {
      welcomeText = welcomeText
        .replace(/{user}/g, `[${ctx.from.first_name}](tg://user?id=${ctx.from.id})`)
        .replace(/{userid}/g, ctx.from.id)
        .replace(/{username}/g, ctx.from.username ? `@${ctx.from.username}` : 'No username')
        .replace(/{name}/g, ctx.from.first_name)
        .replace(/{fullname}/g, [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '))
        .replace(/{group}/g, 'Example Group')
        .replace(/{membercount}/g, '123');
    }
    
    // Prepare buttons if needed
    let keyboard;
    if (welcome.showButtons && welcome.buttons && welcome.buttons.length > 0) {
      keyboard = Markup.inlineKeyboard(
        welcome.buttons.map(button => [
          Markup.button.url(button.text, button.url)
        ])
      );
    }
    
    // Send the preview message
    await ctx.answerCbQuery('Menampilkan preview pesan sambutan');
    
    try {
      if (welcome.mediaType === 'none') {
        await ctx.reply('PREVIEW PESAN SAMBUTAN:');
        await ctx.replyWithMarkdown(welcomeText, keyboard ? keyboard : {});
      } else if (welcome.mediaType === 'photo') {
        await ctx.reply('PREVIEW PESAN SAMBUTAN:');
        await ctx.replyWithPhoto(welcome.mediaFileId, {
          caption: welcome.hasCaption ? welcomeText : null,
          parse_mode: 'Markdown',
          ...keyboard
        });
      } else if (welcome.mediaType === 'video') {
        await ctx.reply('PREVIEW PESAN SAMBUTAN:');
        await ctx.replyWithVideo(welcome.mediaFileId, {
          caption: welcome.hasCaption ? welcomeText : null,
          parse_mode: 'Markdown',
          ...keyboard
        });
      } else if (welcome.mediaType === 'animation') {
        await ctx.reply('PREVIEW PESAN SAMBUTAN:');
        await ctx.replyWithAnimation(welcome.mediaFileId, {
          caption: welcome.hasCaption ? welcomeText : null,
          parse_mode: 'Markdown',
          ...keyboard
        });
      } else if (welcome.mediaType === 'sticker') {
        await ctx.reply('PREVIEW PESAN SAMBUTAN:');
        // Send sticker first (no caption for stickers)
        await ctx.replyWithSticker(welcome.mediaFileId);
        
        // Then send text message if needed
        if (welcome.hasCaption) {
          await ctx.replyWithMarkdown(welcomeText, keyboard ? keyboard : {});
        }
      }
    } catch (error) {
      console.error('Error sending welcome preview:', error);
      await ctx.reply('Gagal menampilkan preview. Mungkin media tidak tersedia lagi.');
    }
    
    // Return to welcome settings
    setTimeout(() => {
      welcomeHandler.handleWelcomeSettings(ctx, groupId);
    }, 2000);
  },
  
  // Handle preview goodbye message
  previewGoodbye: async (ctx, groupId) => {
    const goodbye = await Goodbye.findOne({ groupId });
    
    if (!goodbye) {
      return ctx.answerCbQuery('Pesan perpisahan belum diatur untuk grup ini.');
    }
    
    let goodbyeText = goodbye.text;
    
    // Replace variables in the text
    if (goodbye.showTags) {
      goodbyeText = goodbyeText
        .replace(/{user}/g, `[${ctx.from.first_name}](tg://user?id=${ctx.from.id})`)
        .replace(/{userid}/g, ctx.from.id)
        .replace(/{username}/g, ctx.from.username ? `@${ctx.from.username}` : 'No username')
        .replace(/{name}/g, ctx.from.first_name)
        .replace(/{fullname}/g, [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '))
        .replace(/{group}/g, 'Example Group')
        .replace(/{membercount}/g, '122');
    }
    
    // Prepare buttons if needed
    let keyboard;
    if (goodbye.showButtons && goodbye.buttons && goodbye.buttons.length > 0) {
      keyboard = Markup.inlineKeyboard(
        goodbye.buttons.map(button => [
          Markup.button.url(button.text, button.url)
        ])
      );
    }
    
    // Send the preview message
    await ctx.answerCbQuery('Menampilkan preview pesan perpisahan');
    
    try {
      if (goodbye.mediaType === 'none') {
        await ctx.reply('PREVIEW PESAN PERPISAHAN:');
        await ctx.replyWithMarkdown(goodbyeText, keyboard ? keyboard : {});
      } else if (goodbye.mediaType === 'photo') {
        await ctx.reply('PREVIEW PESAN PERPISAHAN:');
        await ctx.replyWithPhoto(goodbye.mediaFileId, {
          caption: goodbye.hasCaption ? goodbyeText : null,
          parse_mode: 'Markdown',
          ...keyboard
        });
      } else if (goodbye.mediaType === 'video') {
        await ctx.reply('PREVIEW PESAN PERPISAHAN:');
        await ctx.replyWithVideo(goodbye.mediaFileId, {
          caption: goodbye.hasCaption ? goodbyeText : null,
          parse_mode: 'Markdown',
          ...keyboard
        });
      } else if (goodbye.mediaType === 'animation') {
        await ctx.reply('PREVIEW PESAN PERPISAHAN:');
        await ctx.replyWithAnimation(goodbye.mediaFileId, {
          caption: goodbye.hasCaption ? goodbyeText : null,
          parse_mode: 'Markdown',
          ...keyboard
        });
      } else if (goodbye.mediaType === 'sticker') {
        await ctx.reply('PREVIEW PESAN PERPISAHAN:');
        // Send sticker first (no caption for stickers)
        await ctx.replyWithSticker(goodbye.mediaFileId);
        
        // Then send text message if needed
        if (goodbye.hasCaption) {
          await ctx.replyWithMarkdown(goodbyeText, keyboard ? keyboard : {});
        }
      }
    } catch (error) {
      console.error('Error sending goodbye preview:', error);
      await ctx.reply('Gagal menampilkan preview. Mungkin media tidak tersedia lagi.');
    }
    
    // Return to goodbye settings
    setTimeout(() => {
      welcomeHandler.handleGoodbyeSettings(ctx, groupId);
    }, 2000);
  },
  
  // Handle media upload for welcome/goodbye
  startWelcomeMediaUpload: async (ctx, groupId) => {
    ctx.session = ctx.session || {};
    ctx.session.waitingForWelcomeMedia = groupId;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('❌ Hapus Media', `welcome_remove_media:${groupId}`)],
      [Markup.button.callback('⬅️ Kembali', `welcome_settings:${groupId}`)],
    ]);
    
    await ctx.editMessageText(`Silakan kirim media yang ingin digunakan untuk pesan sambutan. Anda dapat mengirim:

1. Foto
2. Video
3. GIF
4. Sticker

Kirim /cancel untuk membatalkan.`, keyboard);
  },
  
  startGoodbyeMediaUpload: async (ctx, groupId) => {
    ctx.session = ctx.session || {};
    ctx.session.waitingForGoodbyeMedia = groupId;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('❌ Hapus Media', `goodbye_remove_media:${groupId}`)],
      [Markup.button.callback('⬅️ Kembali', `goodbye_settings:${groupId}`)],
    ]);
    
    await ctx.editMessageText(`Silakan kirim media yang ingin digunakan untuk pesan perpisahan. Anda dapat mengirim:

1. Foto
2. Video
3. GIF
4. Sticker

Kirim /cancel untuk membatalkan.`, keyboard);
  },
  
  // Handle button setup for welcome/goodbye
  startWelcomeButtonSetup: async (ctx, groupId) => {
    const welcome = await Welcome.findOne({ groupId });
    
    if (!welcome) {
      return ctx.answerCbQuery('Pesan sambutan belum diatur untuk grup ini.');
    }
    
    const buttons = welcome.buttons || [];
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('➕ Tambah Button', `welcome_add_button:${groupId}`)],
      ...(buttons.map((button, index) => [
        Markup.button.callback(`🗑️ ${button.text}`, `welcome_del_button:${groupId}:${index}`)
      ])),
      [Markup.button.callback(welcome.showButtons ? '✅ Tampilkan Buttons' : '❌ Sembunyikan Buttons', `welcome_toggle_buttons:${groupId}`)],
      [Markup.button.callback('⬅️ Kembali', `welcome_settings:${groupId}`)],
    ]);
    
    await ctx.editMessageText(`Pengaturan Button Pesan Sambutan:

${buttons.length > 0 
  ? buttons.map((b, i) => `${i+1}. "${b.text}" -> ${b.url}`).join('\n')
  : 'Belum ada button. Klik "Tambah Button" untuk menambahkan.'}

Status: ${welcome.showButtons ? 'Ditampilkan' : 'Disembunyikan'}`, keyboard);
  },
  
  startGoodbyeButtonSetup: async (ctx, groupId) => {
    const goodbye = await Goodbye.findOne({ groupId });
    
    if (!goodbye) {
      return ctx.answerCbQuery('Pesan perpisahan belum diatur untuk grup ini.');
    }
    
    const buttons = goodbye.buttons || [];
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('➕ Tambah Button', `goodbye_add_button:${groupId}`)],
      ...(buttons.map((button, index) => [
        Markup.button.callback(`🗑️ ${button.text}`, `goodbye_del_button:${groupId}:${index}`)
      ])),
      [Markup.button.callback(goodbye.showButtons ? '✅ Tampilkan Buttons' : '❌ Sembunyikan Buttons', `goodbye_toggle_buttons:${groupId}`)],
      [Markup.button.callback('⬅️ Kembali', `goodbye_settings:${groupId}`)],
    ]);
    
    await ctx.editMessageText(`Pengaturan Button Pesan Perpisahan:

${buttons.length > 0 
  ? buttons.map((b, i) => `${i+1}. "${b.text}" -> ${b.url}`).join('\n')
  : 'Belum ada button. Klik "Tambah Button" untuk menambahkan.'}

Status: ${goodbye.showButtons ? 'Ditampilkan' : 'Disembunyikan'}`, keyboard);
  },
  
  // Start adding a new button
  startAddWelcomeButton: async (ctx, groupId) => {
    ctx.session = ctx.session || {};
    ctx.session.waitingForWelcomeButtonText = groupId;
    
    await ctx.editMessageText(`Langkah 1/2: Silakan kirim teks yang akan ditampilkan pada button.

Contoh: "Join Channel" atau "Website"

Kirim /cancel untuk membatalkan.`);
  },
  
  startAddGoodbyeButton: async (ctx, groupId) => {
    ctx.session = ctx.session || {};
    ctx.session.waitingForGoodbyeButtonText = groupId;
    
    await ctx.editMessageText(`Langkah 1/2: Silakan kirim teks yang akan ditampilkan pada button.

Contoh: "Join Channel" atau "Website"

Kirim /cancel untuk membatalkan.`);
  },
  
  // Toggle settings
  toggleWelcomeTags: async (ctx, groupId) => {
    const welcome = await Welcome.findOne({ groupId });
    
    if (!welcome) {
      return ctx.answerCbQuery('Pesan sambutan belum diatur untuk grup ini.');
    }
    
    welcome.showTags = !welcome.showTags;
    welcome.updatedAt = new Date();
    await welcome.save();
    
    await ctx.answerCbQuery(`Tag user ${welcome.showTags ? 'diaktifkan' : 'dinonaktifkan'}`);
    await welcomeHandler.handleWelcomeSettings(ctx, groupId);
  },
  
  toggleGoodbyeTags: async (ctx, groupId) => {
    const goodbye = await Goodbye.findOne({ groupId });
    
    if (!goodbye) {
      return ctx.answerCbQuery('Pesan perpisahan belum diatur untuk grup ini.');
    }
    
    goodbye.showTags = !goodbye.showTags;
    goodbye.updatedAt = new Date();
    await goodbye.save();
    
    await ctx.answerCbQuery(`Tag user ${goodbye.showTags ? 'diaktifkan' : 'dinonaktifkan'}`);
    await welcomeHandler.handleGoodbyeSettings(ctx, groupId);
  },
  
  toggleWelcomeButtons: async (ctx, groupId) => {
    const welcome = await Welcome.findOne({ groupId });
    
    if (!welcome) {
      return ctx.answerCbQuery('Pesan sambutan belum diatur untuk grup ini.');
    }
    
    welcome.showButtons = !welcome.showButtons;
    welcome.updatedAt = new Date();
    await welcome.save();
    
    await ctx.answerCbQuery(`Button ${welcome.showButtons ? 'diaktifkan' : 'dinonaktifkan'}`);
    await welcomeHandler.startWelcomeButtonSetup(ctx, groupId);
  },
  
  toggleGoodbyeButtons: async (ctx, groupId) => {
    const goodbye = await Goodbye.findOne({ groupId });
    
    if (!goodbye) {
      return ctx.answerCbQuery('Pesan perpisahan belum diatur untuk grup ini.');
    }
    
    goodbye.showButtons = !goodbye.showButtons;
    goodbye.updatedAt = new Date();
    await goodbye.save();
    
    await ctx.answerCbQuery(`Button ${goodbye.showButtons ? 'diaktifkan' : 'dinonaktifkan'}`);
    await welcomeHandler.startGoodbyeButtonSetup(ctx, groupId);
  },
  
  toggleWelcome: async (ctx, groupId) => {
    const welcome = await Welcome.findOne({ groupId });
    
    if (!welcome) {
      return ctx.answerCbQuery('Pesan sambutan belum diatur untuk grup ini.');
    }
    
    welcome.enabled = !welcome.enabled;
    welcome.updatedAt = new Date();
    await welcome.save();
    
    await ctx.answerCbQuery(`Pesan sambutan ${welcome.enabled ? 'diaktifkan' : 'dinonaktifkan'}`);
    await welcomeHandler.handleWelcomeSettings(ctx, groupId);
  },
  
  toggleGoodbye: async (ctx, groupId) => {
    const goodbye = await Goodbye.findOne({ groupId });
    
    if (!goodbye) {
      return ctx.answerCbQuery('Pesan perpisahan belum diatur untuk grup ini.');
    }
    
    goodbye.enabled = !goodbye.enabled;
    goodbye.updatedAt = new Date();
    await goodbye.save();
    
    await ctx.answerCbQuery(`Pesan perpisahan ${goodbye.enabled ? 'diaktifkan' : 'dinonaktifkan'}`);
    await welcomeHandler.handleGoodbyeSettings(ctx, groupId);
  },
  
  removeWelcomeMedia: async (ctx, groupId) => {
    const welcome = await Welcome.findOne({ groupId });
    
    if (!welcome) {
      return ctx.answerCbQuery('Pesan sambutan belum diatur untuk grup ini.');
    }
    
    welcome.mediaType = 'none';
    welcome.mediaFileId = null;
    welcome.updatedAt = new Date();
    await welcome.save();
    
    await ctx.answerCbQuery('Media dihapus dari pesan sambutan');
    await welcomeHandler.handleWelcomeSettings(ctx, groupId);
  },
  
  removeGoodbyeMedia: async (ctx, groupId) => {
    const goodbye = await Goodbye.findOne({ groupId });
    
    if (!goodbye) {
      return ctx.answerCbQuery('Pesan perpisahan belum diatur untuk grup ini.');
    }
    
    goodbye.mediaType = 'none';
    goodbye.mediaFileId = null;
    goodbye.updatedAt = new Date();
    await goodbye.save();
    
    await ctx.answerCbQuery('Media dihapus dari pesan perpisahan');
    await welcomeHandler.handleGoodbyeSettings(ctx, groupId);
  },
  
  // Delete a button
  deleteWelcomeButton: async (ctx, groupId, buttonIndex) => {
    const welcome = await Welcome.findOne({ groupId });
    
    if (!welcome || !welcome.buttons) {
      return ctx.answerCbQuery('Button tidak ditemukan');
    }
    
    welcome.buttons.splice(buttonIndex, 1);
    welcome.updatedAt = new Date();
    await welcome.save();
    
    await ctx.answerCbQuery('Button dihapus');
    await welcomeHandler.startWelcomeButtonSetup(ctx, groupId);
  },
  
  deleteGoodbyeButton: async (ctx, groupId, buttonIndex) => {
    const goodbye = await Goodbye.findOne({ groupId });
    
    if (!goodbye || !goodbye.buttons) {
      return ctx.answerCbQuery('Button tidak ditemukan');
    }
    
    goodbye.buttons.splice(buttonIndex, 1);
    goodbye.updatedAt = new Date();
    await goodbye.save();
    
    await ctx.answerCbQuery('Button dihapus');
    await welcomeHandler.startGoodbyeButtonSetup(ctx, groupId);
  },
};

// ============= GROUP HANDLER =============
const groupHandler = {
  // List and manage groups from private chat
  manageGroups: async (ctx) => {
    if (ctx.chat.type !== 'private') {
      return ctx.reply('Perintah ini hanya bisa digunakan di private chat.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    // Find groups where the user is an admin
    const groups = await Group.find({ 
      isApproved: true,
      $or: [
        { addedBy: ctx.from.id },
        { 'admins.userId': ctx.from.id }
      ]
    });
    
    if (groups.length === 0) {
      return ctx.reply('Anda tidak memiliki grup yang dapat dikelola. Tambahkan bot ke grup terlebih dahulu.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    const keyboard = Markup.inlineKeyboard(
      groups.map(group => [
        Markup.button.callback(group.title, `group_manage:${group.groupId}`)
      ])
    );
    
    await ctx.reply('Pilih grup yang ingin Anda kelola:', keyboard);
  },
  
  // Show group management options
  handleGroupManage: async (ctx, groupId) => {
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      return ctx.answerCbQuery('Grup tidak ditemukan.');
    }
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('👥 Anggota', `group_members:${groupId}`)],
      [Markup.button.callback('⚫️ Blacklist', `group_blacklist:${groupId}`)],
      [Markup.button.callback('⚠️ Peringatan', `group_warnings:${groupId}`)],
      [Markup.button.callback('⚙️ Pengaturan', `group_settings:${groupId}`)],
      [Markup.button.callback('🔔 Pesan Sambutan', `welcome_settings:${groupId}`)],
      [Markup.button.callback('👋 Pesan Perpisahan', `goodbye_settings:${groupId}`)],
      [Markup.button.callback('🔙 Kembali', 'groups_list')],
    ]);
    
    await ctx.editMessageText(`Mengelola Grup: ${group.title}\n\nSilakan pilih opsi:`, keyboard);
  },
  
  // List group members with management options
  handleGroupMembers: async (ctx, groupId) => {
    try {
      const group = await Group.findOne({ groupId });
      
      if (!group) {
        return ctx.answerCbQuery('Grup tidak ditemukan.');
      }
      
      // Get group administrators
      const admins = await ctx.telegram.getChatAdministrators(groupId);
      const adminIds = admins.map(admin => admin.user.id);
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('❌ Kick Member', `group_kick_member:${groupId}`)],
        [Markup.button.callback('⚫️ Blacklist Member', `group_bl_member:${groupId}`)],
        [Markup.button.callback('⚠️ Warn Member', `group_warn_member:${groupId}`)],
        [Markup.button.callback('🔄 Lihat Semua Anggota', `group_view_all:${groupId}`)],
        [Markup.button.callback('⬅️ Kembali', `group_manage:${groupId}`)],
      ]);
      
      await ctx.editMessageText(`Manajemen Anggota Grup: ${group.title}

Jumlah Admin: ${adminIds.length}
Bot adalah admin: ${adminIds.includes(ctx.botInfo.id) ? '✅' : '❌'}

Silakan pilih tindakan:`, keyboard);
    } catch (error) {
      console.error('Error handling group members:', error);
      await ctx.answerCbQuery('Gagal mengambil data anggota grup.');
      await ctx.editMessageText('Gagal mengambil data anggota grup. Pastikan bot memiliki akses yang cukup.');
    }
  },
  
  // Handle blacklist management
  handleGroupBlacklist: async (ctx, groupId) => {
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      return ctx.answerCbQuery('Grup tidak ditemukan.');
    }
    
    if (!group.blacklistedUsers || group.blacklistedUsers.length === 0) {
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('➕ Tambah ke Blacklist', `group_add_blacklist:${groupId}`)],
        [Markup.button.callback('⬅️ Kembali', `group_manage:${groupId}`)],
      ]);
      
      return ctx.editMessageText(`Blacklist untuk grup ${group.title} kosong. Belum ada pengguna yang di-blacklist.`, keyboard);
    }
    
    // Generate buttons for each blacklisted user
    const buttons = group.blacklistedUsers.map((user, index) => [
      Markup.button.callback(`🔄 Info ${user.userId}`, `group_bl_info:${groupId}:${user.userId}`),
      Markup.button.callback(`❌ Hapus ${user.userId}`, `group_unbl_user:${groupId}:${user.userId}`)
    ]);
    
    // Add back and add buttons
    buttons.push([Markup.button.callback('➕ Tambah ke Blacklist', `group_add_blacklist:${groupId}`)]);
    buttons.push([Markup.button.callback('⬅️ Kembali', `group_manage:${groupId}`)]);
    
    const keyboard = Markup.inlineKeyboard(buttons);
    
    await ctx.editMessageText(`Blacklist untuk grup ${group.title}:

${group.blacklistedUsers.map((user, i) => `${i+1}. ID: ${user.userId}, Ditambahkan: ${new Date(user.addedAt).toLocaleString()}`).join('\n')}

Pilih pengguna untuk melihat info atau menghapus dari blacklist:`, keyboard);
  },
  
  // Handle warnings management
  handleGroupWarnings: async (ctx, groupId) => {
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      return ctx.answerCbQuery('Grup tidak ditemukan.');
    }
    
    if (!group.warnings || group.warnings.length === 0) {
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('➕ Beri Peringatan', `group_add_warning:${groupId}`)],
        [Markup.button.callback('⬅️ Kembali', `group_manage:${groupId}`)],
      ]);
      
      return ctx.editMessageText(`Peringatan untuk grup ${group.title} kosong. Belum ada pengguna yang diberi peringatan.`, keyboard);
    }
    
    // Generate buttons for each warned user
    const buttons = group.warnings.map((warning, index) => [
      Markup.button.callback(`🔄 Info ${warning.userId}`, `group_warn_info:${groupId}:${warning.userId}`),
      Markup.button.callback(`❌ Hapus ${warning.userId}`, `group_unwarn_user:${groupId}:${warning.userId}`)
    ]);
    
    // Add back and add buttons
    buttons.push([Markup.button.callback('➕ Beri Peringatan', `group_add_warning:${groupId}`)]);
    buttons.push([Markup.button.callback('⬅️ Kembali', `group_manage:${groupId}`)]);
    
    const keyboard = Markup.inlineKeyboard(buttons);
    
    await ctx.editMessageText(`Peringatan untuk grup ${group.title}:

${group.warnings.map((warning, i) => `${i+1}. ID: ${warning.userId}, Peringatan: ${warning.count}, Terakhir: ${new Date(warning.addedAt).toLocaleString()}`).join('\n')}

Pilih pengguna untuk melihat info atau menghapus peringatan:`, keyboard);
  },
  
  // Handle group settings
  handleGroupSettings: async (ctx, groupId) => {
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      return ctx.answerCbQuery('Grup tidak ditemukan.');
    }
    
    const settings = group.settings || {};
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(settings.antiSpam ? '✅ Anti Spam' : '❌ Anti Spam', `group_toggle_setting:${groupId}:antiSpam`)],
      [Markup.button.callback(settings.antiLink ? '✅ Anti Link' : '❌ Anti Link', `group_toggle_setting:${groupId}:antiLink`)],
      [Markup.button.callback(settings.antiForward ? '✅ Anti Forward' : '❌ Anti Forward', `group_toggle_setting:${groupId}:antiForward`)],
      [Markup.button.callback(settings.restrictNewMembers ? '✅ Batasi Member Baru' : '❌ Batasi Member Baru', `group_toggle_setting:${groupId}:restrictNewMembers`)],
      [Markup.button.callback(settings.autoDeleteCommands ? '✅ Hapus Otomatis Perintah' : '❌ Hapus Otomatis Perintah', `group_toggle_setting:${groupId}:autoDeleteCommands`)],
      [Markup.button.callback(settings.adminOnlyCommands ? '✅ Perintah Hanya Admin' : '❌ Perintah Hanya Admin', `group_toggle_setting:${groupId}:adminOnlyCommands`)],
      [Markup.button.callback('⬅️ Kembali', `group_manage:${groupId}`)],
    ]);
    
    await ctx.editMessageText(`Pengaturan untuk grup ${group.title}:

Anti Spam: ${settings.antiSpam ? '✅' : '❌'}
Anti Link: ${settings.antiLink ? '✅' : '❌'}
Anti Forward: ${settings.antiForward ? '✅' : '❌'}
Batasi Member Baru: ${settings.restrictNewMembers ? '✅' : '❌'}
Hapus Otomatis Perintah: ${settings.autoDeleteCommands ? '✅' : '❌'}
Perintah Hanya Admin: ${settings.adminOnlyCommands ? '✅' : '❌'}

Klik opsi untuk mengaktifkan/menonaktifkan:`, keyboard);
  },
  
  // Toggle group settings
  toggleGroupSetting: async (ctx, groupId, setting) => {
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      return ctx.answerCbQuery('Grup tidak ditemukan.');
    }
    
    // Initialize settings if not exists
    group.settings = group.settings || {};
    
    // Toggle the setting
    group.settings[setting] = !group.settings[setting];
    
    await group.save();
    
    await ctx.answerCbQuery(`${setting} ${group.settings[setting] ? 'diaktifkan' : 'dinonaktifkan'}`);
    
    // Return to settings page
    return groupHandler.handleGroupSettings(ctx, groupId);
  },
  
  // Start adding a user to blacklist
  startAddBlacklist: async (ctx, groupId) => {
    ctx.session = ctx.session || {};
    ctx.session.waitingForBlacklistUserId = groupId;
    
    await ctx.editMessageText(`Silakan kirim ID pengguna atau username (@username) yang ingin di-blacklist.

Anda juga dapat mengirim pesan yang di-forward dari pengguna tersebut.

Kirim /cancel untuk membatalkan.`);
  },
  
  // Start adding a warning to a user
  startAddWarning: async (ctx, groupId) => {
    ctx.session = ctx.session || {};
    ctx.session.waitingForWarnUserId = groupId;
    
    await ctx.editMessageText(`Silakan kirim ID pengguna atau username (@username) yang ingin diberi peringatan.

Anda juga dapat mengirim pesan yang di-forward dari pengguna tersebut.

Kirim /cancel untuk membatalkan.`);
  },
  
  // Process blacklist user request
  handleBlacklistUser: async (ctx, groupId, userId, reason = 'Tidak ada alasan') => {
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      return ctx.reply('Grup tidak ditemukan.', { reply_to_message_id: ctx.message.message_id });
    }
    
    // Check if user is already blacklisted
    const isBlacklisted = group.blacklistedUsers.some(u => u.userId === userId);
    
    if (isBlacklisted) {
      return ctx.reply('Pengguna ini sudah berada dalam blacklist.', { reply_to_message_id: ctx.message.message_id });
    }
    
    // Add user to blacklist
    group.blacklistedUsers.push({
      userId,
      addedBy: ctx.from.id,
      addedAt: new Date(),
      reason,
    });
    
    await group.save();
    
    await ctx.reply(`Pengguna dengan ID ${userId} telah ditambahkan ke blacklist grup ${group.title}.

Alasan: ${reason}`, { reply_to_message_id: ctx.message.message_id });
    
    // Try to notify the group
    try {
      await ctx.telegram.sendMessage(groupId, `Pengguna dengan ID ${userId} telah ditambahkan ke blacklist.

Alasan: ${reason}
Ditambahkan oleh: ${ctx.from.username ? `@${ctx.from.username}` : ctx.from.id}`);
    } catch (error) {
      console.error('Error notifying group about blacklist:', error);
    }
  },
  
  // Process warning user request
  handleWarnUser: async (ctx, groupId, userId, reason = 'Tidak ada alasan') => {
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      return ctx.reply('Grup tidak ditemukan.', { reply_to_message_id: ctx.message.message_id });
    }
    
    // Check if user already has warnings
    const warnIndex = group.warnings.findIndex(w => w.userId === userId);
    
    if (warnIndex === -1) {
      // First warning
      group.warnings.push({
        userId,
        addedBy: ctx.from.id,
        addedAt: new Date(),
        reason,
        count: 1,
      });
    } else {
      // Increment warning
      group.warnings[warnIndex].count += 1;
      group.warnings[warnIndex].addedBy = ctx.from.id;
      group.warnings[warnIndex].addedAt = new Date();
      group.warnings[warnIndex].reason = reason;
    }
    
    await group.save();
    
    const warningCount = warnIndex === -1 ? 1 : group.warnings[warnIndex].count;
    
    await ctx.reply(`Peringatan diberikan kepada pengguna dengan ID ${userId} di grup ${group.title}.

Peringatan ke-${warningCount}
Alasan: ${reason}`, { reply_to_message_id: ctx.message.message_id });
    
    // Try to notify the group
    try {
      await ctx.telegram.sendMessage(groupId, `⚠️ Peringatan untuk pengguna dengan ID ${userId}

Peringatan ke-${warningCount}
Alasan: ${reason}
Diberikan oleh: ${ctx.from.username ? `@${ctx.from.username}` : ctx.from.id}

${warningCount >= 3 ? '‼️ Pengguna ini telah mencapai 3 peringatan dan dapat dikeluarkan dari grup.' : ''}`);
      
      // If warnings reaches 3, kick the user if bot has permission
      if (warningCount >= 3) {
        try {
          // Check if bot is admin
          const botMember = await ctx.telegram.getChatMember(groupId, ctx.botInfo.id);
          
          if (botMember.can_restrict_members) {
            await ctx.telegram.kickChatMember(groupId, userId);
            await ctx.telegram.unbanChatMember(groupId, userId); // Unban so they can rejoin
            await ctx.telegram.sendMessage(groupId, `Pengguna dengan ID ${userId} telah dikeluarkan dari grup karena menerima 3 peringatan.`);
            
            // Reset warnings
            group.warnings = group.warnings.filter(w => w.userId !== userId);
            await group.save();
          }
        } catch (kickError) {
          console.error('Error kicking warned user:', kickError);
          await ctx.telegram.sendMessage(groupId, 'Tidak dapat mengeluarkan pengguna karena bot tidak memiliki izin yang cukup.');
        }
      }
    } catch (error) {
      console.error('Error notifying group about warning:', error);
    }
  },
  
  // Show blacklist user info
  showBlacklistInfo: async (ctx, groupId, userId) => {
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      return ctx.answerCbQuery('Grup tidak ditemukan.');
    }
    
    const blacklistedUser = group.blacklistedUsers.find(u => u.userId == userId);
    
    if (!blacklistedUser) {
      return ctx.answerCbQuery('Pengguna tidak ditemukan dalam blacklist.');
    }
    
    // Try to get user information
    let userInfo = 'Tidak dapat mengambil info pengguna';
    try {
      const chatMember = await ctx.telegram.getChatMember(groupId, userId);
      if (chatMember) {
        const user = chatMember.user;
        userInfo = `Nama: ${user.first_name} ${user.last_name || ''}
Username: ${user.username ? `@${user.username}` : 'Tidak ada'}
ID: ${user.id}
Bot: ${user.is_bot ? 'Ya' : 'Tidak'}`;
      }
    } catch (error) {
      console.error('Error getting blacklisted user info:', error);
      userInfo = 'Pengguna mungkin telah meninggalkan grup';
    }
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('❌ Hapus dari Blacklist', `group_unbl_user:${groupId}:${userId}`)],
      [Markup.button.callback('⬅️ Kembali', `group_blacklist:${groupId}`)],
    ]);
    
    await ctx.editMessageText(`Info Pengguna Blacklist:

${userInfo}

Alasan: ${blacklistedUser.reason || 'Tidak ada alasan'}
Ditambahkan oleh: ${blacklistedUser.addedBy}
Tanggal: ${new Date(blacklistedUser.addedAt).toLocaleString()}`, keyboard);
  },
  
  // Show warning user info
  showWarningInfo: async (ctx, groupId, userId) => {
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      return ctx.answerCbQuery('Grup tidak ditemukan.');
    }
    
    const warnedUser = group.warnings.find(w => w.userId == userId);
    
    if (!warnedUser) {
      return ctx.answerCbQuery('Pengguna tidak ditemukan dalam daftar peringatan.');
    }
    
    // Try to get user information
    let userInfo = 'Tidak dapat mengambil info pengguna';
    try {
      const chatMember = await ctx.telegram.getChatMember(groupId, userId);
      if (chatMember) {
        const user = chatMember.user;
        userInfo = `Nama: ${user.first_name} ${user.last_name || ''}
Username: ${user.username ? `@${user.username}` : 'Tidak ada'}
ID: ${user.id}
Bot: ${user.is_bot ? 'Ya' : 'Tidak'}`;
      }
    } catch (error) {
      console.error('Error getting warned user info:', error);
      userInfo = 'Pengguna mungkin telah meninggalkan grup';
    }
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('❌ Hapus Peringatan', `group_unwarn_user:${groupId}:${userId}`)],
      [Markup.button.callback('⚫️ Blacklist Pengguna', `group_bl_from_warn:${groupId}:${userId}`)],
      [Markup.button.callback('⬅️ Kembali', `group_warnings:${groupId}`)],
    ]);
    
    await ctx.editMessageText(`Info Peringatan Pengguna:

${userInfo}

Peringatan: ${warnedUser.count}
Alasan: ${warnedUser.reason || 'Tidak ada alasan'}
Terakhir oleh: ${warnedUser.addedBy}
Tanggal: ${new Date(warnedUser.addedAt).toLocaleString()}`, keyboard);
  },
  
  // Remove user from blacklist
  removeFromBlacklist: async (ctx, groupId, userId) => {
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      return ctx.answerCbQuery('Grup tidak ditemukan.');
    }
    
    // Find and remove user from blacklist
    const index = group.blacklistedUsers.findIndex(u => u.userId == userId);
    
    if (index === -1) {
      return ctx.answerCbQuery('Pengguna tidak ditemukan dalam blacklist.');
    }
    
    group.blacklistedUsers.splice(index, 1);
    await group.save();
    
    await ctx.answerCbQuery('Pengguna dihapus dari blacklist.');
    await groupHandler.handleGroupBlacklist(ctx, groupId);
    
    // Try to notify the group
    try {
      await ctx.telegram.sendMessage(groupId, `Pengguna dengan ID ${userId} telah dihapus dari blacklist oleh ${ctx.from.username ? `@${ctx.from.username}` : ctx.from.id}.`);
    } catch (error) {
      console.error('Error notifying group about unblacklist:', error);
    }
  },
  
  // Remove warning from user
  removeWarning: async (ctx, groupId, userId) => {
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      return ctx.answerCbQuery('Grup tidak ditemukan.');
    }
    
    // Find warned user
    const index = group.warnings.findIndex(w => w.userId == userId);
    
    if (index === -1) {
      return ctx.answerCbQuery('Pengguna tidak ditemukan dalam daftar peringatan.');
    }
    
    // Decrement or remove warning
    if (group.warnings[index].count <= 1) {
      group.warnings.splice(index, 1);
    } else {
      group.warnings[index].count -= 1;
    }
    
    await group.save();
    
    await ctx.answerCbQuery('Peringatan telah dikurangi.');
    await groupHandler.handleGroupWarnings(ctx, groupId);
    
    // Try to notify the group
    try {
      await ctx.telegram.sendMessage(groupId, `Satu peringatan telah dihapus dari pengguna dengan ID ${userId} oleh ${ctx.from.username ? `@${ctx.from.username}` : ctx.from.id}.`);
    } catch (error) {
      console.error('Error notifying group about unwarn:', error);
    }
  },
  
  // Add a blacklist from warnings page
  blacklistFromWarning: async (ctx, groupId, userId) => {
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      return ctx.answerCbQuery('Grup tidak ditemukan.');
    }
    
    // Check if user is already blacklisted
    const isBlacklisted = group.blacklistedUsers.some(u => u.userId == userId);
    
    if (isBlacklisted) {
      return ctx.answerCbQuery('Pengguna sudah berada dalam blacklist.');
    }
    
    // Find warned user to get reason
    const warnedUser = group.warnings.find(w => w.userId == userId);
    const reason = warnedUser ? warnedUser.reason : 'Dari daftar peringatan';
    
    // Add to blacklist
    group.blacklistedUsers.push({
      userId: Number(userId),
      addedBy: ctx.from.id,
      addedAt: new Date(),
      reason,
    });
    
    // Remove from warnings
    group.warnings = group.warnings.filter(w => w.userId != userId);
    
    await group.save();
    
    await ctx.answerCbQuery('Pengguna ditambahkan ke blacklist dan dihapus dari daftar peringatan.');
    await groupHandler.handleGroupBlacklist(ctx, groupId);
    
    // Try to notify the group
    try {
      await ctx.telegram.sendMessage(groupId, `Pengguna dengan ID ${userId} telah ditambahkan ke blacklist oleh ${ctx.from.username ? `@${ctx.from.username}` : ctx.from.id}.

Alasan: ${reason}`);
    } catch (error) {
      console.error('Error notifying group about blacklist from warning:', error);
    }
  },
  
  // Handle kick member initiation
  startKickMember: async (ctx, groupId) => {
    ctx.session = ctx.session || {};
    ctx.session.waitingForKickUserId = groupId;
    
    await ctx.editMessageText(`Silakan kirim ID pengguna atau username (@username) yang ingin dikeluarkan dari grup.

Anda juga dapat mengirim pesan yang di-forward dari pengguna tersebut.

Kirim /cancel untuk membatalkan.`);
  },
  
  // Process kick user request
  handleKickUser: async (ctx, groupId, userId, reason = 'Tidak ada alasan') => {
    try {
      // Check if bot is admin and can kick
      const botMember = await ctx.telegram.getChatMember(groupId, ctx.botInfo.id);
      
      if (!botMember.can_restrict_members) {
        return ctx.reply('Bot tidak memiliki izin untuk mengeluarkan pengguna dari grup. Pastikan bot adalah admin dengan izin yang tepat.', { reply_to_message_id: ctx.message.message_id });
      }
      
      // Check if user is admin
      const member = await ctx.telegram.getChatMember(groupId, userId);
      
      if (member.status === 'creator' || member.status === 'administrator') {
        return ctx.reply('Tidak dapat mengeluarkan admin grup.', { reply_to_message_id: ctx.message.message_id });
      }
      
      // Kick the user
      await ctx.telegram.kickChatMember(groupId, userId);
      
      // Unban so they can rejoin if invited
      await ctx.telegram.unbanChatMember(groupId, userId);
      
      await ctx.reply(`Pengguna dengan ID ${userId} telah dikeluarkan dari grup.

Alasan: ${reason}`, { reply_to_message_id: ctx.message.message_id });
      
      // Try to notify the group
      try {
        await ctx.telegram.sendMessage(groupId, `Pengguna dengan ID ${userId} telah dikeluarkan dari grup oleh ${ctx.from.username ? `@${ctx.from.username}` : ctx.from.id}.

Alasan: ${reason}`);
      } catch (error) {
        console.error('Error notifying group about kick:', error);
      }
    } catch (error) {
      console.error('Error kicking user:', error);
      return ctx.reply('Gagal mengeluarkan pengguna. Pastikan ID pengguna valid dan bot memiliki izin yang tepat.', { reply_to_message_id: ctx.message.message_id });
    }
  },
  
  // Show all members of a group
  viewAllMembers: async (ctx, groupId) => {
    try {
      const group = await Group.findOne({ groupId });
      
      if (!group) {
        return ctx.answerCbQuery('Grup tidak ditemukan.');
      }
      
      await ctx.answerCbQuery('Mendapatkan daftar anggota. Ini mungkin memerlukan waktu...');
      
      // Get group administrators
      const admins = await ctx.telegram.getChatAdministrators(groupId);
      const adminIds = admins.map(admin => admin.user.id);
      
      // Get chat members count
      const memberCount = await ctx.telegram.getChatMembersCount(groupId);
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Kembali', `group_members:${groupId}`)],
      ]);
      
      await ctx.editMessageText(`Informasi Anggota Grup: ${group.title}

Total Anggota: ${memberCount}
Total Admin: ${admins.length}

Admin Grup:
${admins.map(admin => `- ${admin.user.first_name} ${admin.user.last_name || ''} ${admin.user.username ? `(@${admin.user.username})` : ''} [ID: ${admin.user.id}]`).join('\n')}

Untuk melihat lebih banyak anggota, gunakan perintah di dalam grup.`, keyboard);
    } catch (error) {
      console.error('Error viewing all members:', error);
      await ctx.answerCbQuery('Gagal mengambil daftar anggota grup.');
      await ctx.editMessageText('Gagal mengambil daftar anggota grup. Pastikan bot memiliki akses yang cukup.');
    }
  }
};

// ============= COMMAND HANDLER =============
const commandHandler = {
  start: async (ctx) => {
    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback('Request Approval', `request_approval:${ctx.from.id}`),
    ]);
    
    await ctx.reply('Selamat datang di Bot Manajemen Grup! Bot ini membantu mengelola grup dengan fitur: tambah/kelola grup, kick, blacklist, warn, dll. Anda perlu disetujui oleh admin bot untuk menggunakan fitur.', {
      reply_to_message_id: ctx.message.message_id,
      ...keyboard
    });
  },
  
  help: async (ctx) => {
    await ctx.reply(`Perintah yang tersedia:
/start - Mulai bot
/help - Tampilkan bantuan
/addgroup - Tambahkan grup
/approve - Setujui pengguna
/groups - Daftar grup
/kick - Keluarkan pengguna dari grup
/add - Tambahkan pengguna ke grup
/bl - Blacklist pengguna
/unbl - Hapus pengguna dari blacklist
/warn - Peringatkan pengguna
/unwarn - Hapus peringatan pengguna
/adminlist - Daftar admin bot
/requests - Daftar permintaan persetujuan
/setwelcome - Atur pesan sambutan
/setgoodbye - Atur pesan perpisahan
/settings - Pengaturan grup

Note: Anda perlu disetujui oleh admin bot untuk menggunakan sebagian besar fitur.`, {
      reply_to_message_id: ctx.message.message_id
    });
  },
  
  addGroup: async (ctx) => {
    if (ctx.chat.type !== 'private') {
      return ctx.reply('Perintah ini hanya dapat digunakan dalam chat pribadi dengan bot.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    await ctx.reply('Silakan teruskan pesan dari grup yang ingin Anda tambahkan, atau kirim ID grup.', {
      reply_to_message_id: ctx.message.message_id
    });
  },
  
  approve: async (ctx) => {
    if (!ctx.isAdmin) {
      return ctx.reply('Hanya admin bot yang dapat menyetujui pengguna.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply('Berikan ID pengguna untuk disetujui.\nPenggunaan: /approve <user_id>', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    const userId = Number(args[1]);
    if (isNaN(userId)) {
      return ctx.reply('ID pengguna tidak valid. Berikan ID numerik yang valid.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    const user = await User.findOne({ userId });
    if (!user) {
      return ctx.reply('Pengguna tidak ditemukan. Mereka perlu memulai bot terlebih dahulu.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    if (user.isApproved) {
      return ctx.reply('Pengguna ini sudah disetujui.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    user.isApproved = true;
    user.approvedBy = ctx.from.id;
    user.approvedAt = new Date();
    await user.save();
    
    await ctx.reply(`Pengguna ${userId} telah disetujui.`, {
      reply_to_message_id: ctx.message.message_id
    });
    
    // Notify the user
    try {
      await ctx.telegram.sendMessage(userId, 'Permintaan persetujuan Anda telah diterima! Anda sekarang dapat menggunakan fitur bot.');
    } catch (error) {
      console.error('Error notifying user:', error);
    }
  },
  
  reject: async (ctx) => {
    if (!ctx.isAdmin) {
      return ctx.reply('Hanya admin bot yang dapat menolak pengguna.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply('Berikan ID pengguna untuk ditolak.\nPenggunaan: /reject <user_id>', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    const userId = Number(args[1]);
    if (isNaN(userId)) {
      return ctx.reply('ID pengguna tidak valid. Berikan ID numerik yang valid.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    const user = await User.findOne({ userId });
    if (!user) {
      return ctx.reply('Pengguna tidak ditemukan.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    if (user.isApproved) {
      return ctx.reply('Pengguna ini sudah disetujui sebelumnya.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    user.requestedAt = null;
    await user.save();
    
    await ctx.reply(`Permintaan pengguna ${userId} telah ditolak.`, {
      reply_to_message_id: ctx.message.message_id
    });
    
    // Notify the user
    try {
      await ctx.telegram.sendMessage(userId, 'Permintaan persetujuan Anda telah ditolak oleh admin bot.');
    } catch (error) {
      console.error('Error notifying user:', error);
    }
  },
  
  listGroups: async (ctx) => {
    if (ctx.chat.type !== 'private') {
      return ctx.reply('Perintah ini hanya dapat digunakan dalam chat pribadi dengan bot.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    const groups = await Group.find({ isApproved: true });
    
    if (groups.length === 0) {
      return ctx.reply('Belum ada grup yang dikelola oleh bot ini.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    const groupList = groups.map((group, index) => `${index + 1}. ${group.title} (ID: ${group.groupId})`).join('\n');
    
    await ctx.reply(`Grup yang Dikelola:\n${groupList}`, {
      reply_to_message_id: ctx.message.message_id
    });
  },
  
  kickUser: async (ctx) => {
    if (ctx.chat.type === 'private') {
      return ctx.reply('Perintah ini hanya dapat digunakan dalam grup.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2 && !ctx.message.reply_to_message) {
      return ctx.reply('Mention pengguna, berikan ID mereka, atau reply pesan mereka.\nPenggunaan: /kick @username atau /kick user_id [alasan]', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    let userId;
    let reason = args.slice(2).join(' ') || 'Tidak ada alasan';
    
    // Check if the message has a reply
    if (ctx.message.reply_to_message) {
      userId = ctx.message.reply_to_message.from.id;
    } else {
      // Try to get user from mention or ID
      const userMention = args[1];
      
      if (userMention.startsWith('@')) {
        // Handle username
        const username = userMention.substring(1);
        try {
          const chatMember = await ctx.getChatMember(username);
          userId = chatMember.user.id;
        } catch (error) {
          return ctx.reply('Pengguna tidak ditemukan dalam grup ini.', {
            reply_to_message_id: ctx.message.message_id
          });
        }
      } else {
        // Handle user ID
        userId = Number(userMention);
        if (isNaN(userId)) {
          return ctx.reply('ID pengguna tidak valid. Berikan ID numerik yang valid atau mention pengguna.', {
            reply_to_message_id: ctx.message.message_id
          });
        }
      }
    }
    
    try {
      // Check if the bot has permission to kick users
      const botMember = await ctx.getChatMember(ctx.botInfo.id);
      if (!botMember.can_restrict_members) {
        return ctx.reply('Bot tidak memiliki izin untuk mengeluarkan pengguna dari grup ini.', {
          reply_to_message_id: ctx.message.message_id
        });
      }
      
      // Check if the user to kick is an admin
      const memberToBan = await ctx.getChatMember(userId);
      if (memberToBan.status === 'creator' || memberToBan.status === 'administrator') {
        return ctx.reply('Bot tidak dapat mengeluarkan admin.', {
          reply_to_message_id: ctx.message.message_id
        });
      }
      
      // Kick the user
      await ctx.kickChatMember(userId);
      
      // Unban the user so they can join again
      await ctx.unbanChatMember(userId);
      
      await ctx.reply(`Pengguna ${memberToBan.user.username ? `@${memberToBan.user.username}` : memberToBan.user.first_name} telah dikeluarkan dari grup.\nAlasan: ${reason}`, {
        reply_to_message_id: ctx.message.message_id
      });
    } catch (error) {
      console.error('Error kicking user:', error);
      await ctx.reply('Gagal mengeluarkan pengguna. Pastikan bot memiliki hak admin dan pengguna ada dalam grup ini.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
  },
  
  addUser: async (ctx) => {
    if (ctx.chat.type === 'private') {
      return ctx.reply('Perintah ini hanya dapat digunakan dalam grup.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply('Berikan username untuk ditambahkan.\nPenggunaan: /add @username', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    const username = args[1];
    if (!username.startsWith('@')) {
      return ctx.reply('Berikan username yang valid dimulai dengan @.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    try {
      // Generate an invite link
      const inviteLink = await ctx.exportChatInviteLink();
      
      await ctx.reply(`Link undangan untuk ${username}: ${inviteLink}`, {
        reply_to_message_id: ctx.message.message_id
      });
    } catch (error) {
      console.error('Error generating invite link:', error);
      await ctx.reply('Gagal membuat link undangan. Pastikan bot memiliki hak admin dengan izin membuat link undangan.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
  },
  
  blacklistUser: async (ctx) => {
    if (ctx.chat.type === 'private') {
      return ctx.reply('Perintah ini hanya dapat digunakan dalam grup.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2 && !ctx.message.reply_to_message) {
      return ctx.reply('Mention pengguna, berikan ID mereka, atau reply pesan mereka.\nPenggunaan: /bl @username atau /bl user_id [alasan]', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    let userId;
    let reason = args.slice(2).join(' ') || 'Tidak ada alasan';
    
    // Check if the message has a reply
    if (ctx.message.reply_to_message) {
      userId = ctx.message.reply_to_message.from.id;
    } else {
      // Try to get user from mention or ID
      const userMention = args[1];
      
      if (userMention.startsWith('@')) {
        // Handle username
        const username = userMention.substring(1);
        try {
          const chatMember = await ctx.getChatMember(username);
          userId = chatMember.user.id;
        } catch (error) {
          return ctx.reply('Pengguna tidak ditemukan dalam grup ini.', {
            reply_to_message_id: ctx.message.message_id
          });
        }
      } else {
        // Handle user ID
        userId = Number(userMention);
        if (isNaN(userId)) {
          return ctx.reply('ID pengguna tidak valid. Berikan ID numerik yang valid atau mention pengguna.', {
            reply_to_message_id: ctx.message.message_id
          });
        }
      }
    }
    
    try {
      // Check if the user to blacklist is an admin
      const memberToBlacklist = await ctx.getChatMember(userId);
      if (memberToBlacklist.status === 'creator' || memberToBlacklist.status === 'administrator') {
        return ctx.reply('Bot tidak dapat blacklist admin.', {
          reply_to_message_id: ctx.message.message_id
        });
      }
      
      // Add user to blacklist
      const group = await Group.findOne({ groupId: ctx.chat.id });
      if (!group) {
        return ctx.reply('Grup ini belum dikelola oleh bot.', {
          reply_to_message_id: ctx.message.message_id
        });
      }
      
      // Check if user is already blacklisted
      const isBlacklisted = group.blacklistedUsers.some(user => user.userId === userId);
      if (isBlacklisted) {
        return ctx.reply('Pengguna ini sudah di-blacklist dalam grup ini.', {
          reply_to_message_id: ctx.message.message_id
        });
      }
      
      group.blacklistedUsers.push({
        userId,
        addedBy: ctx.from.id,
        reason,
      });
      
      await group.save();
      
      await ctx.reply(`Pengguna ${memberToBlacklist.user.username ? `@${memberToBlacklist.user.username}` : memberToBlacklist.user.first_name} telah ditambahkan ke blacklist untuk grup ini.\nAlasan: ${reason}`, {
        reply_to_message_id: ctx.message.message_id
      });
    } catch (error) {
      console.error('Error blacklisting user:', error);
      await ctx.reply('Gagal blacklist pengguna. Pastikan pengguna ada dalam grup ini.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
  },
  
  unblacklistUser: async (ctx) => {
    if (ctx.chat.type === 'private') {
      return ctx.reply('Perintah ini hanya dapat digunakan dalam grup.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2 && !ctx.message.reply_to_message) {
      return ctx.reply('Mention pengguna, berikan ID mereka, atau reply pesan mereka.\nPenggunaan: /unbl @username atau /unbl user_id', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    let userId;
    
    // Check if the message has a reply
    if (ctx.message.reply_to_message) {
      userId = ctx.message.reply_to_message.from.id;
    } else {
      // Try to get user from mention or ID
      const userMention = args[1];
      
      if (userMention.startsWith('@')) {
        // Handle username
        const username = userMention.substring(1);
        try {
          const chatMember = await ctx.getChatMember(username);
          userId = chatMember.user.id;
        } catch (error) {
          return ctx.reply('Pengguna tidak ditemukan dalam grup ini.', {
            reply_to_message_id: ctx.message.message_id
          });
        }
      } else {
        // Handle user ID
        userId = Number(userMention);
        if (isNaN(userId)) {
          return ctx.reply('ID pengguna tidak valid. Berikan ID numerik yang valid atau mention pengguna.', {
            reply_to_message_id: ctx.message.message_id
          });
        }
      }
    }
    
    try {
      // Remove user from blacklist
      const group = await Group.findOne({ groupId: ctx.chat.id });
      if (!group) {
        return ctx.reply('Grup ini belum dikelola oleh bot.', {
          reply_to_message_id: ctx.message.message_id
        });
      }
      
      // Check if user is blacklisted
      const blacklistedUserIndex = group.blacklistedUsers.findIndex(user => user.userId === userId);
      if (blacklistedUserIndex === -1) {
        return ctx.reply('Pengguna ini tidak di-blacklist dalam grup ini.', {
          reply_to_message_id: ctx.message.message_id
        });
      }
      
      group.blacklistedUsers.splice(blacklistedUserIndex, 1);
      await group.save();
      
      // Try to get the user info
      let userInfo = `ID: ${userId}`;
      try {
        const userMember = await ctx.getChatMember(userId);
        userInfo = userMember.user.username ? `@${userMember.user.username}` : userMember.user.first_name;
      } catch (error) {
        console.error('Error getting user info:', error);
      }
      
      await ctx.reply(`Pengguna ${userInfo} telah dihapus dari blacklist untuk grup ini.`, {
        reply_to_message_id: ctx.message.message_id
      });
    } catch (error) {
      console.error('Error unblacklisting user:', error);
      await ctx.reply('Gagal menghapus pengguna dari blacklist.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
  },
  
  warnUser: async (ctx) => {
    if (ctx.chat.type === 'private') {
      return ctx.reply('Perintah ini hanya dapat digunakan dalam grup.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2 && !ctx.message.reply_to_message) {
      return ctx.reply('Mention pengguna, berikan ID mereka, atau reply pesan mereka.\nPenggunaan: /warn @username atau /warn user_id [alasan]', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    let userId;
    let reason = args.slice(2).join(' ') || 'Tidak ada alasan';
    
    // Check if the message has a reply
    if (ctx.message.reply_to_message) {
      userId = ctx.message.reply_to_message.from.id;
    } else {
      // Try to get user from mention or ID
      const userMention = args[1];
      
      if (userMention.startsWith('@')) {
        // Handle username
        const username = userMention.substring(1);
        try {
          const chatMember = await ctx.getChatMember(username);
          userId = chatMember.user.id;
        } catch (error) {
          return ctx.reply('Pengguna tidak ditemukan dalam grup ini.', {
            reply_to_message_id: ctx.message.message_id
          });
        }
      } else {
        // Handle user ID
        userId = Number(userMention);
        if (isNaN(userId)) {
          return ctx.reply('ID pengguna tidak valid. Berikan ID numerik yang valid atau mention pengguna.', {
            reply_to_message_id: ctx.message.message_id
          });
        }
      }
    }
    
    try {
      // Check if the user to warn is an admin
      const memberToWarn = await ctx.getChatMember(userId);
      if (memberToWarn.status === 'creator' || memberToWarn.status === 'administrator') {
        return ctx.reply('Bot tidak dapat memperingatkan admin.', {
          reply_to_message_id: ctx.message.message_id
        });
      }
      
      // Add warning to user
      const group = await Group.findOne({ groupId: ctx.chat.id });
      if (!group) {
        return ctx.reply('Grup ini belum dikelola oleh bot.', {
          reply_to_message_id: ctx.message.message_id
        });
      }
      
      // Check if user already has warnings
      const warningIndex = group.warnings.findIndex(warning => warning.userId === userId);
      
      if (warningIndex === -1) {
        // First warning
        group.warnings.push({
          userId,
          addedBy: ctx.from.id,
          reason,
          count: 1,
        });
      } else {
        // Increment warning count
        group.warnings[warningIndex].count += 1;
        group.warnings[warningIndex].reason = reason;
        group.warnings[warningIndex].addedAt = new Date();
        group.warnings[warningIndex].addedBy = ctx.from.id;
      }
      
      await group.save();
      
      const warningCount = warningIndex === -1 ? 1 : group.warnings[warningIndex].count;
      
      await ctx.reply(`Pengguna ${memberToWarn.user.username ? `@${memberToWarn.user.username}` : memberToWarn.user.first_name} telah diperingatkan (Peringatan #${warningCount}).\nAlasan: ${reason}`, {
        reply_to_message_id: ctx.message.message_id
      });
      
      // Check if user has reached warning limit (3 warnings)
      if (warningCount >= 3) {
        try {
          // Ban the user
          await ctx.kickChatMember(userId);
          // Unban so they can join again if invited
          await ctx.unbanChatMember(userId);
          await ctx.reply(`Pengguna ${memberToWarn.user.username ? `@${memberToWarn.user.username}` : memberToWarn.user.first_name} telah menerima 3 peringatan dan telah dikeluarkan dari grup.`, {
            reply_to_message_id: ctx.message.message_id
          });
          
          // Reset warnings after kick
          group.warnings = group.warnings.filter(warning => warning.userId !== userId);
          await group.save();
        } catch (kickError) {
          console.error('Error kicking user:', kickError);
          await ctx.reply('Gagal mengeluarkan pengguna setelah 3 peringatan. Pastikan bot memiliki hak admin.', {
            reply_to_message_id: ctx.message.message_id
          });
        }
      }
    } catch (error) {
      console.error('Error warning user:', error);
      await ctx.reply('Gagal memperingatkan pengguna. Pastikan pengguna ada dalam grup ini.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
  },
  
  unwarnUser: async (ctx) => {
    if (ctx.chat.type === 'private') {
      return ctx.reply('Perintah ini hanya dapat digunakan dalam grup.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2 && !ctx.message.reply_to_message) {
      return ctx.reply('Mention pengguna, berikan ID mereka, atau reply pesan mereka.\nPenggunaan: /unwarn @username atau /unwarn user_id', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    let userId;
    
    // Check if the message has a reply
    if (ctx.message.reply_to_message) {
      userId = ctx.message.reply_to_message.from.id;
    } else {
      // Try to get user from mention or ID
      const userMention = args[1];
      
      if (userMention.startsWith('@')) {
        // Handle username
        const username = userMention.substring(1);
        try {
          const chatMember = await ctx.getChatMember(username);
          userId = chatMember.user.id;
        } catch (error) {
          return ctx.reply('Pengguna tidak ditemukan dalam grup ini.', {
            reply_to_message_id: ctx.message.message_id
          });
        }
      } else {
        // Handle user ID
        userId = Number(userMention);
        if (isNaN(userId)) {
          return ctx.reply('ID pengguna tidak valid. Berikan ID numerik yang valid atau mention pengguna.', {
            reply_to_message_id: ctx.message.message_id
          });
        }
      }
    }
    
    try {
      // Remove warning from user
      const group = await Group.findOne({ groupId: ctx.chat.id });
      if (!group) {
        return ctx.reply('Grup ini belum dikelola oleh bot.', {
          reply_to_message_id: ctx.message.message_id
        });
      }
      
      // Check if user has warnings
      const warningIndex = group.warnings.findIndex(warning => warning.userId === userId);
      
      if (warningIndex === -1) {
        return ctx.reply('Pengguna ini tidak memiliki peringatan dalam grup ini.', {
          reply_to_message_id: ctx.message.message_id
        });
      }
      
      // Decrement warning count or remove if only 1 warning
      if (group.warnings[warningIndex].count <= 1) {
        group.warnings.splice(warningIndex, 1);
      } else {
        group.warnings[warningIndex].count -= 1;
      }
      
      await group.save();
      
      // Try to get the user info
      let userInfo = `ID: ${userId}`;
      try {
        const userMember = await ctx.getChatMember(userId);
        userInfo = userMember.user.username ? `@${userMember.user.username}` : userMember.user.first_name;
      } catch (error) {
        console.error('Error getting user info:', error);
      }
      
      await ctx.reply(`Satu peringatan telah dihapus dari pengguna ${userInfo}.`, {
        reply_to_message_id: ctx.message.message_id
      });
    } catch (error) {
      console.error('Error unwarning user:', error);
      await ctx.reply('Gagal menghapus peringatan dari pengguna.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
  },
  
  listAdmins: async (ctx) => {
    const adminIds = ctx.config.ADMIN_IDS;
    const approvedAdmins = await User.find({ isAdmin: true });
    
    const configAdminList = adminIds.map(id => `- ${id} (Config Admin)`);
    const dbAdminList = approvedAdmins.map(admin => {
      const username = admin.username ? `@${admin.username}` : 'Tidak ada username';
      return `- ${admin.userId} (${username})`;
    });
    
    const adminList = [...configAdminList, ...dbAdminList].join('\n');
    
    await ctx.reply(`Admin Bot:\n${adminList}`, {
      reply_to_message_id: ctx.message.message_id
    });
  },
  
  listRequests: async (ctx) => {
    if (!ctx.isAdmin) {
      return ctx.reply('Hanya admin bot yang dapat melihat permintaan persetujuan.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    if (ctx.chat.type !== 'private') {
      return ctx.reply('Perintah ini hanya dapat digunakan dalam chat pribadi dengan bot.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    const pendingUsers = await User.find({
      isApproved: false,
      isAdmin: false,
      requestedAt: { $exists: true },
    });
    
    if (pendingUsers.length === 0) {
      return ctx.reply('Tidak ada permintaan persetujuan yang tertunda.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    const requestList = pendingUsers.map((user, index) => {
      const username = user.username ? `@${user.username}` : 'Tidak ada username';
      const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
      const requestDate = user.requestedAt ? new Date(user.requestedAt).toLocaleString() : 'Tidak diketahui';
      
      return `${index + 1}. ${name} (${username})\nID: ${user.userId}\nRequested: ${requestDate}`;
    }).join('\n\n');
    
    // Create inline keyboard with approve/deny buttons for each user
    const keyboard = Markup.inlineKeyboard(
      pendingUsers.flatMap(user => [
        Markup.button.callback(`✅ Approve ${user.userId}`, `approve:${user.userId}`),
        Markup.button.callback(`❌ Deny ${user.userId}`, `deny:${user.userId}`),
      ]),
      { columns: 2 }
    );
    
    await ctx.reply(`Permintaan Persetujuan:\n\n${requestList}`, keyboard);
  },
  
  settings: async (ctx) => {
    // Just invoke the manageGroups function
    await groupHandler.manageGroups(ctx);
  },
  
  setWelcome: async (ctx) => {
    // Invoke the welcomeHandler function
    await welcomeHandler.setWelcome(ctx);
  },
  
  setGoodbye: async (ctx) => {
    // Invoke the welcomeHandler function
    await welcomeHandler.setGoodbye(ctx);
  }
};

// ============= CALLBACK HANDLER =============
const callbackHandler = async (ctx) => {
  const callbackData = ctx.callbackQuery.data;
  
  // Extract action and parameters from callback data
  const parts = callbackData.split(':');
  const action = parts[0];
  const params = parts.slice(1);
  
  switch (action) {
    // User approval actions
    case 'request_approval':
      await handleRequestApproval(ctx, params[0]);
      break;
    case 'approve':
      await handleApproveUser(ctx, params[0]);
      break;
    case 'deny':
      await handleDenyUser(ctx, params[0]);
      break;
      
    // Group management actions
    case 'groups_list':
      await groupHandler.manageGroups(ctx);
      break;
    case 'group_manage':
      await groupHandler.handleGroupManage(ctx, Number(params[0]));
      break;
    case 'group_members':
      await groupHandler.handleGroupMembers(ctx, Number(params[0]));
      break;
    case 'group_blacklist':
      await groupHandler.handleGroupBlacklist(ctx, Number(params[0]));
      break;
    case 'group_warnings':
      await groupHandler.handleGroupWarnings(ctx, Number(params[0]));
      break;
    case 'group_settings':
      await groupHandler.handleGroupSettings(ctx, Number(params[0]));
      break;
    case 'group_toggle_setting':
      await groupHandler.toggleGroupSetting(ctx, Number(params[0]), params[1]);
      break;
    case 'group_add_blacklist':
      await groupHandler.startAddBlacklist(ctx, Number(params[0]));
      break;
    case 'group_add_warning':
      await groupHandler.startAddWarning(ctx, Number(params[0]));
      break;
    case 'group_bl_info':
      await groupHandler.showBlacklistInfo(ctx, Number(params[0]), Number(params[1]));
      break;
    case 'group_warn_info':
      await groupHandler.showWarningInfo(ctx, Number(params[0]), Number(params[1]));
      break;
    case 'group_unbl_user':
      await groupHandler.removeFromBlacklist(ctx, Number(params[0]), Number(params[1]));
      break;
    case 'group_unwarn_user':
      await groupHandler.removeWarning(ctx, Number(params[0]), Number(params[1]));
      break;
    case 'group_bl_from_warn':
      await groupHandler.blacklistFromWarning(ctx, Number(params[0]), Number(params[1]));
      break;
    case 'group_kick_member':
      await groupHandler.startKickMember(ctx, Number(params[0]));
      break;
    case 'group_view_all':
      await groupHandler.viewAllMembers(ctx, Number(params[0]));
      break;
    
    // Welcome/Goodbye message actions
    case 'set_welcome_for':
      await welcomeHandler.handleWelcomeSettings(ctx, Number(params[0]));
      break;
    case 'set_goodbye_for':
      await welcomeHandler.handleGoodbyeSettings(ctx, Number(params[0]));
      break;
    case 'welcome_settings':
      await welcomeHandler.handleWelcomeSettings(ctx, Number(params[0]));
      break;
    case 'goodbye_settings':
      await welcomeHandler.handleGoodbyeSettings(ctx, Number(params[0]));
      break;
    case 'welcome_edit_text':
      await welcomeHandler.startWelcomeTextEdit(ctx, Number(params[0]));
      break;
    case 'goodbye_edit_text':
      await welcomeHandler.startGoodbyeTextEdit(ctx, Number(params[0]));
      break;
    case 'welcome_set_media':
      await welcomeHandler.startWelcomeMediaUpload(ctx, Number(params[0]));
      break;
    case 'goodbye_set_media':
      await welcomeHandler.startGoodbyeMediaUpload(ctx, Number(params[0]));
      break;
    case 'welcome_buttons':
      await welcomeHandler.startWelcomeButtonSetup(ctx, Number(params[0]));
      break;
    case 'goodbye_buttons':
      await welcomeHandler.startGoodbyeButtonSetup(ctx, Number(params[0]));
      break;
    case 'welcome_toggle_tags':
      await welcomeHandler.toggleWelcomeTags(ctx, Number(params[0]));
      break;
    case 'goodbye_toggle_tags':
      await welcomeHandler.toggleGoodbyeTags(ctx, Number(params[0]));
      break;
    case 'welcome_toggle_buttons':
      await welcomeHandler.toggleWelcomeButtons(ctx, Number(params[0]));
      break;
    case 'goodbye_toggle_buttons':
      await welcomeHandler.toggleGoodbyeButtons(ctx, Number(params[0]));
      break;
    case 'welcome_toggle':
      await welcomeHandler.toggleWelcome(ctx, Number(params[0]));
      break;
    case 'goodbye_toggle':
      await welcomeHandler.toggleGoodbye(ctx, Number(params[0]));
      break;
    case 'welcome_remove_media':
      await welcomeHandler.removeWelcomeMedia(ctx, Number(params[0]));
      break;
    case 'goodbye_remove_media':
      await welcomeHandler.removeGoodbyeMedia(ctx, Number(params[0]));
      break;
    case 'welcome_add_button':
      await welcomeHandler.startAddWelcomeButton(ctx, Number(params[0]));
      break;
    case 'goodbye_add_button':
      await welcomeHandler.startAddGoodbyeButton(ctx, Number(params[0]));
      break;
    case 'welcome_del_button':
      await welcomeHandler.deleteWelcomeButton(ctx, Number(params[0]), Number(params[1]));
      break;
    case 'goodbye_del_button':
      await welcomeHandler.deleteGoodbyeButton(ctx, Number(params[0]), Number(params[1]));
      break;
    case 'welcome_preview':
      await welcomeHandler.previewWelcome(ctx, Number(params[0]));
      break;
    case 'goodbye_preview':
      await welcomeHandler.previewGoodbye(ctx, Number(params[0]));
      break;
      
    default:
      await ctx.answerCbQuery('Tindakan tidak dikenal');
  }
};

// Helper functions for approval process
async function handleRequestApproval(ctx, userId) {
  userId = Number(userId);
  
  // Check if the requesting user is the same as the callback user
  if (userId !== ctx.from.id) {
    return ctx.answerCbQuery('Anda hanya dapat meminta persetujuan untuk diri sendiri.');
  }
  
  // Check if user is already approved
  const user = await User.findOne({ userId });
  
  if (user && (user.isApproved || user.isAdmin)) {
    return ctx.answerCbQuery('Anda sudah disetujui.');
  }
  
  // Update user record
  await User.updateOne(
    { userId },
    { 
      $set: { requestedAt: new Date() },
      $setOnInsert: {
        userId,
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
      }
    },
    { upsert: true }
  );
  
  await ctx.answerCbQuery('Permintaan persetujuan dikirim ke admin bot.');
  await ctx.editMessageText('Permintaan persetujuan Anda telah dikirim ke admin bot. Anda akan diberitahu ketika mereka menyetujui atau menolak permintaan Anda.');
  
  // Notify all admins
  const adminUsers = await User.find({ isAdmin: true });
  const adminIds = [...ctx.config.ADMIN_IDS, ...adminUsers.map(admin => admin.userId)];
  
  const uniqueAdminIds = [...new Set(adminIds)];
  
  for (const adminId of uniqueAdminIds) {
    try {
      const keyboard = Markup.inlineKeyboard([
        Markup.button.callback('✅ Approve', `approve:${userId}`),
        Markup.button.callback('❌ Deny', `deny:${userId}`),
      ]);
      
      const username = ctx.from.username ? `@${ctx.from.username}` : 'Tidak ada username';
      const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ');
      
      await ctx.telegram.sendMessage(adminId, `Permintaan persetujuan baru dari:
      
Nama: ${name}
Username: ${username}
User ID: ${userId}`, keyboard);
    } catch (error) {
      console.error(`Error notifying admin ${adminId}:`, error);
    }
  }
}

async function handleApproveUser(ctx, userId) {
  userId = Number(userId);
  
  // Check if the approving user is an admin
  if (!ctx.config.ADMIN_IDS.includes(ctx.from.id)) {
    const user = await User.findOne({ userId: ctx.from.id });
    if (!user || !user.isAdmin) {
      return ctx.answerCbQuery('Hanya admin bot yang dapat menyetujui pengguna.');
    }
  }
  
  // Approve the user
  const targetUser = await User.findOne({ userId });
  
  if (!targetUser) {
    return ctx.answerCbQuery('Pengguna tidak ditemukan.');
  }
  
  if (targetUser.isApproved) {
    return ctx.answerCbQuery('Pengguna ini sudah disetujui.');
  }
  
  targetUser.isApproved = true;
  targetUser.approvedBy = ctx.from.id;
  targetUser.approvedAt = new Date();
  await targetUser.save();
  
  await ctx.answerCbQuery('Pengguna telah disetujui.');
  await ctx.editMessageText(`Pengguna ${userId} telah disetujui.`);
  
  // Notify the user
  try {
    await ctx.telegram.sendMessage(userId, 'Permintaan persetujuan Anda telah diterima! Anda sekarang dapat menggunakan fitur bot.');
  } catch (error) {
    console.error('Error notifying user:', error);
  }
}

async function handleDenyUser(ctx, userId) {
  userId = Number(userId);
  
  // Check if the denying user is an admin
  if (!ctx.config.ADMIN_IDS.includes(ctx.from.id)) {
    const user = await User.findOne({ userId: ctx.from.id });
    if (!user || !user.isAdmin) {
      return ctx.answerCbQuery('Hanya admin bot yang dapat menolak permintaan pengguna.');
    }
  }
  
  // Reset the user's request
  const targetUser = await User.findOne({ userId });
  
  if (!targetUser) {
    return ctx.answerCbQuery('Pengguna tidak ditemukan.');
  }
  
  if (targetUser.isApproved) {
    return ctx.answerCbQuery('Pengguna ini sudah disetujui.');
  }
  
  targetUser.requestedAt = null;
  await targetUser.save();
  
  await ctx.answerCbQuery('Permintaan pengguna telah ditolak.');
  await ctx.editMessageText(`Permintaan pengguna ${userId} telah ditolak.`);
  
  // Notify the user
  try {
    await ctx.telegram.sendMessage(userId, 'Permintaan persetujuan Anda telah ditolak oleh admin bot.');
  } catch (error) {
    console.error('Error notifying user:', error);
  }
}

// ============= MESSAGE HANDLER =============
const messageHandler = async (ctx) => {
  // Always reply to the message if it's a command
  const isCommand = ctx.message && ctx.message.text && ctx.message.text.startsWith('/');
  
  // Save user to database if not exists
  const userId = ctx.from.id;
  const user = await User.findOne({ userId });
  
  if (!user) {
    const newUser = new User({
      userId,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
      isApproved: ctx.config.ADMIN_IDS.includes(userId),
      isAdmin: ctx.config.ADMIN_IDS.includes(userId),
    });
    
    await newUser.save();
  }
  
  // Handle message editing or deleting if user is in a session
  if (ctx.session) {
    // Handle welcome text editing
    if (ctx.session.waitingForWelcomeText && ctx.message && ctx.message.text && !ctx.message.text.startsWith('/')) {
      const groupId = ctx.session.waitingForWelcomeText;
      const welcome = await Welcome.findOne({ groupId }) || new Welcome({ groupId });
      
      welcome.text = ctx.message.text;
      welcome.updatedAt = new Date();
      await welcome.save();
      
      delete ctx.session.waitingForWelcomeText;
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Kembali ke Pengaturan', `welcome_settings:${groupId}`)],
      ]);
      
      await ctx.reply('Teks pesan sambutan telah diperbarui:', keyboard);
      return;
    }
    
    // Handle goodbye text editing
    if (ctx.session.waitingForGoodbyeText && ctx.message && ctx.message.text && !ctx.message.text.startsWith('/')) {
      const groupId = ctx.session.waitingForGoodbyeText;
      const goodbye = await Goodbye.findOne({ groupId }) || new Goodbye({ groupId });
      
      goodbye.text = ctx.message.text;
      goodbye.updatedAt = new Date();
      await goodbye.save();
      
      delete ctx.session.waitingForGoodbyeText;
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Kembali ke Pengaturan', `goodbye_settings:${groupId}`)],
      ]);
      
      await ctx.reply('Teks pesan perpisahan telah diperbarui:', keyboard);
      return;
    }
    
    // Handle welcome media upload
    if (ctx.session.waitingForWelcomeMedia) {
      const groupId = ctx.session.waitingForWelcomeMedia;
      
      if (ctx.message && (ctx.message.photo || ctx.message.video || ctx.message.animation || ctx.message.sticker)) {
        const welcome = await Welcome.findOne({ groupId }) || new Welcome({ groupId });
        
        if (ctx.message.photo) {
          const photoSizes = ctx.message.photo;
          const fileId = photoSizes[photoSizes.length - 1].file_id; // Get largest photo
          welcome.mediaType = 'photo';
          welcome.mediaFileId = fileId;
        } else if (ctx.message.video) {
          welcome.mediaType = 'video';
          welcome.mediaFileId = ctx.message.video.file_id;
        } else if (ctx.message.animation) {
          welcome.mediaType = 'animation';
          welcome.mediaFileId = ctx.message.animation.file_id;
        } else if (ctx.message.sticker) {
          welcome.mediaType = 'sticker';
          welcome.mediaFileId = ctx.message.sticker.file_id;
        }
        
        welcome.updatedAt = new Date();
        await welcome.save();
        
        delete ctx.session.waitingForWelcomeMedia;
        
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Kembali ke Pengaturan', `welcome_settings:${groupId}`)],
        ]);
        
        await ctx.reply(`Media untuk pesan sambutan telah diatur ke: ${welcome.mediaType}`, keyboard);
        return;
      }
    }
    
    // Handle goodbye media upload
    if (ctx.session.waitingForGoodbyeMedia) {
      const groupId = ctx.session.waitingForGoodbyeMedia;
      
      if (ctx.message && (ctx.message.photo || ctx.message.video || ctx.message.animation || ctx.message.sticker)) {
        const goodbye = await Goodbye.findOne({ groupId }) || new Goodbye({ groupId });
        
        if (ctx.message.photo) {
          const photoSizes = ctx.message.photo;
          const fileId = photoSizes[photoSizes.length - 1].file_id; // Get largest photo
          goodbye.mediaType = 'photo';
          goodbye.mediaFileId = fileId;
        } else if (ctx.message.video) {
          goodbye.mediaType = 'video';
          goodbye.mediaFileId = ctx.message.video.file_id;
        } else if (ctx.message.animation) {
          goodbye.mediaType = 'animation';
          goodbye.mediaFileId = ctx.message.animation.file_id;
        } else if (ctx.message.sticker) {
          goodbye.mediaType = 'sticker';
          goodbye.mediaFileId = ctx.message.sticker.file_id;
        }
        
        goodbye.updatedAt = new Date();
        await goodbye.save();
        
        delete ctx.session.waitingForGoodbyeMedia;
        
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Kembali ke Pengaturan', `goodbye_settings:${groupId}`)],
        ]);
        
        await ctx.reply(`Media untuk pesan perpisahan telah diatur ke: ${goodbye.mediaType}`, keyboard);
        return;
      }
    }
    
    // Handle welcome button text input
    if (ctx.session.waitingForWelcomeButtonText) {
      const groupId = ctx.session.waitingForWelcomeButtonText;
      
      if (ctx.message && ctx.message.text && !ctx.message.text.startsWith('/')) {
        // Save the button text and wait for URL
        ctx.session.welcomeButtonText = ctx.message.text;
        delete ctx.session.waitingForWelcomeButtonText;
        ctx.session.waitingForWelcomeButtonUrl = groupId;
        
        await ctx.reply(`Langkah 2/2: Silakan kirim URL untuk button "${ctx.message.text}".

Contoh: https://t.me/yourchannel atau https://yourwebsite.com

Kirim /cancel untuk membatalkan.`);
        return;
      }
    }
    
    // Handle welcome button URL input
    if (ctx.session.waitingForWelcomeButtonUrl) {
      const groupId = ctx.session.waitingForWelcomeButtonUrl;
      
      if (ctx.message && ctx.message.text && !ctx.message.text.startsWith('/')) {
        const url = ctx.message.text;
        // Validate URL
        if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('tg://')) {
          await ctx.reply('URL tidak valid. Harus dimulai dengan http://, https://, atau tg://.');
          return;
        }
        
        const welcome = await Welcome.findOne({ groupId }) || new Welcome({ groupId });
        
        if (!welcome.buttons) {
          welcome.buttons = [];
        }
        
        welcome.buttons.push({
          text: ctx.session.welcomeButtonText,
          url: url
        });
        
        welcome.updatedAt = new Date();
        await welcome.save();
        
        delete ctx.session.waitingForWelcomeButtonUrl;
        delete ctx.session.welcomeButtonText;
        
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Kembali ke Pengaturan Button', `welcome_buttons:${groupId}`)],
        ]);
        
        await ctx.reply(`Button telah ditambahkan ke pesan sambutan:
        
Teks: ${welcome.buttons[welcome.buttons.length - 1].text}
URL: ${welcome.buttons[welcome.buttons.length - 1].url}`, keyboard);
        return;
      }
    }
    
    // Handle goodbye button text input
    if (ctx.session.waitingForGoodbyeButtonText) {
      const groupId = ctx.session.waitingForGoodbyeButtonText;
      
      if (ctx.message && ctx.message.text && !ctx.message.text.startsWith('/')) {
        // Save the button text and wait for URL
        ctx.session.goodbyeButtonText = ctx.message.text;
        delete ctx.session.waitingForGoodbyeButtonText;
        ctx.session.waitingForGoodbyeButtonUrl = groupId;
        
        await ctx.reply(`Langkah 2/2: Silakan kirim URL untuk button "${ctx.message.text}".

Contoh: https://t.me/yourchannel atau https://yourwebsite.com

Kirim /cancel untuk membatalkan.`);
        return;
      }
    }
    
    // Handle goodbye button URL input
    if (ctx.session.waitingForGoodbyeButtonUrl) {
      const groupId = ctx.session.waitingForGoodbyeButtonUrl;
      
      if (ctx.message && ctx.message.text && !ctx.message.text.startsWith('/')) {
        const url = ctx.message.text;
        // Validate URL
        if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('tg://')) {
          await ctx.reply('URL tidak valid. Harus dimulai dengan http://, https://, atau tg://.');
          return;
        }
        
        const goodbye = await Goodbye.findOne({ groupId }) || new Goodbye({ groupId });
        
        if (!goodbye.buttons) {
          goodbye.buttons = [];
        }
        
        goodbye.buttons.push({
          text: ctx.session.goodbyeButtonText,
          url: url
        });
        
        goodbye.updatedAt = new Date();
        await goodbye.save();
        
        delete ctx.session.waitingForGoodbyeButtonUrl;
        delete ctx.session.goodbyeButtonText;
        
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Kembali ke Pengaturan Button', `goodbye_buttons:${groupId}`)],
        ]);
        
        await ctx.reply(`Button telah ditambahkan ke pesan perpisahan:
        
Teks: ${goodbye.buttons[goodbye.buttons.length - 1].text}
URL: ${goodbye.buttons[goodbye.buttons.length - 1].url}`, keyboard);
        return;
      }
    }
    
    // Handle blacklist user ID input
    if (ctx.session.waitingForBlacklistUserId) {
      const groupId = ctx.session.waitingForBlacklistUserId;
      
      // Get user ID from text, forward, or reply
      let userId = null;
      let reason = 'Ditambahkan melalui private chat';
      
      if (ctx.message.text && !ctx.message.text.startsWith('/')) {
        // Try to parse user ID or username
        const text = ctx.message.text;
        if (text.startsWith('@')) {
          // Username provided
          try {
            const username = text.substring(1);
            const chatMember = await ctx.telegram.getChatMember(groupId, username);
            userId = chatMember.user.id;
          } catch (error) {
            await ctx.reply('Pengguna tidak ditemukan dalam grup. Pastikan username benar dan pengguna adalah anggota grup.');
            return;
          }
        } else {
          // User ID provided
          userId = Number(text);
          if (isNaN(userId)) {
            await ctx.reply('ID pengguna tidak valid. Harap berikan ID numerik yang valid atau username yang dimulai dengan @.');
            return;
          }
        }
      } else if (ctx.message.forward_from) {
        // Forwarded message
        userId = ctx.message.forward_from.id;
        reason = 'Dari pesan yang diforward';
      } else if (ctx.message.reply_to_message) {
        // Reply to message
        userId = ctx.message.reply_to_message.from.id;
        reason = 'Dari balasan pesan';
      }
      
      if (!userId) {
        await ctx.reply('Tidak dapat menentukan ID pengguna. Coba kirim ID numerik, username (@username), atau forward pesan dari pengguna.');
        return;
      }
      
      // Check if user is a bot admin
      if (ctx.config.ADMIN_IDS.includes(userId)) {
        await ctx.reply('Tidak dapat blacklist admin bot.');
        return;
      }
      
      // Check if user is a group admin
      try {
        const member = await ctx.telegram.getChatMember(groupId, userId);
        if (member.status === 'creator' || member.status === 'administrator') {
          await ctx.reply('Tidak dapat blacklist admin grup.');
          return;
        }
      } catch (error) {
        console.error('Error checking user status:', error);
        await ctx.reply('Gagal memeriksa status pengguna. Pengguna mungkin tidak berada dalam grup.');
        return;
      }
      
      // Get reason
      ctx.session.waitingForBlacklistReason = { groupId, userId };
      delete ctx.session.waitingForBlacklistUserId;
      
      await ctx.reply(`Pengguna dengan ID ${userId} akan di-blacklist. Silakan kirim alasan untuk blacklist ini atau ketik "skip" untuk melanjutkan tanpa alasan.`);
      return;
    }
    
    // Handle blacklist reason input
    if (ctx.session.waitingForBlacklistReason && ctx.message && ctx.message.text) {
      const { groupId, userId } = ctx.session.waitingForBlacklistReason;
      let reason = ctx.message.text;
      
      if (reason.toLowerCase() === 'skip') {
        reason = 'Tidak ada alasan';
      }
      
      // Add to blacklist
      const group = await Group.findOne({ groupId });
      
      if (!group) {
        await ctx.reply('Grup tidak ditemukan. Mungkin telah dihapus dari database.');
        delete ctx.session.waitingForBlacklistReason;
        return;
      }
      
      // Check if already blacklisted
      const isBlacklisted = group.blacklistedUsers.some(u => u.userId === userId);
      
      if (isBlacklisted) {
        await ctx.reply('Pengguna ini sudah berada dalam blacklist.');
        delete ctx.session.waitingForBlacklistReason;
        return;
      }
      
      // Add to blacklist
      group.blacklistedUsers.push({
        userId,
        addedBy: ctx.from.id,
        addedAt: new Date(),
        reason,
      });
      
      await group.save();
      
      delete ctx.session.waitingForBlacklistReason;
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Kembali ke Blacklist', `group_blacklist:${groupId}`)],
      ]);
      
      await ctx.reply(`Pengguna dengan ID ${userId} telah ditambahkan ke blacklist.

Alasan: ${reason}`, keyboard);
      
      // Notify the group
      try {
        await ctx.telegram.sendMessage(groupId, `Pengguna dengan ID ${userId} telah ditambahkan ke blacklist oleh admin.

Alasan: ${reason}`);
      } catch (error) {
        console.error('Error notifying group about blacklist:', error);
      }
      
      return;
    }
    
    // Handle warning user ID input
    if (ctx.session.waitingForWarnUserId) {
      const groupId = ctx.session.waitingForWarnUserId;
      
      // Get user ID from text, forward, or reply
      let userId = null;
      
      if (ctx.message.text && !ctx.message.text.startsWith('/')) {
        // Try to parse user ID or username
        const text = ctx.message.text;
        if (text.startsWith('@')) {
          // Username provided
          try {
            const username = text.substring(1);
            const chatMember = await ctx.telegram.getChatMember(groupId, username);
            userId = chatMember.user.id;
          } catch (error) {
            await ctx.reply('Pengguna tidak ditemukan dalam grup. Pastikan username benar dan pengguna adalah anggota grup.');
            return;
          }
        } else {
          // User ID provided
          userId = Number(text);
          if (isNaN(userId)) {
            await ctx.reply('ID pengguna tidak valid. Harap berikan ID numerik yang valid atau username yang dimulai dengan @.');
            return;
          }
        }
      } else if (ctx.message.forward_from) {
        // Forwarded message
        userId = ctx.message.forward_from.id;
      } else if (ctx.message.reply_to_message) {
        // Reply to message
        userId = ctx.message.reply_to_message.from.id;
      }
      
      if (!userId) {
        await ctx.reply('Tidak dapat menentukan ID pengguna. Coba kirim ID numerik, username (@username), atau forward pesan dari pengguna.');
        return;
      }
      
      // Check if user is a bot admin
      if (ctx.config.ADMIN_IDS.includes(userId)) {
        await ctx.reply('Tidak dapat memperingatkan admin bot.');
        return;
      }
      
      // Check if user is a group admin
      try {
        const member = await ctx.telegram.getChatMember(groupId, userId);
        if (member.status === 'creator' || member.status === 'administrator') {
          await ctx.reply('Tidak dapat memperingatkan admin grup.');
          return;
        }
      } catch (error) {
        console.error('Error checking user status:', error);
        await ctx.reply('Gagal memeriksa status pengguna. Pengguna mungkin tidak berada dalam grup.');
        return;
      }
      
      // Get reason
      ctx.session.waitingForWarnReason = { groupId, userId };
      delete ctx.session.waitingForWarnUserId;
      
      await ctx.reply(`Pengguna dengan ID ${userId} akan diberi peringatan. Silakan kirim alasan untuk peringatan ini atau ketik "skip" untuk melanjutkan tanpa alasan.`);
      return;
    }
    
    // Handle warning reason input
    if (ctx.session.waitingForWarnReason && ctx.message && ctx.message.text) {
      const { groupId, userId } = ctx.session.waitingForWarnReason;
      let reason = ctx.message.text;
      
      if (reason.toLowerCase() === 'skip') {
        reason = 'Tidak ada alasan';
      }
      
      // Add warning
      const group = await Group.findOne({ groupId });
      
      if (!group) {
        await ctx.reply('Grup tidak ditemukan. Mungkin telah dihapus dari database.');
        delete ctx.session.waitingForWarnReason;
        return;
      }
      
      // Check if user already has warnings
      const warnIndex = group.warnings.findIndex(w => w.userId === userId);
      
      if (warnIndex === -1) {
        // First warning
        group.warnings.push({
          userId,
          addedBy: ctx.from.id,
          addedAt: new Date(),
          reason,
          count: 1,
        });
      } else {
        // Increment warning
        group.warnings[warnIndex].count += 1;
        group.warnings[warnIndex].addedBy = ctx.from.id;
        group.warnings[warnIndex].addedAt = new Date();
        group.warnings[warnIndex].reason = reason;
      }
      
      await group.save();
      
      delete ctx.session.waitingForWarnReason;
      
      const warningCount = warnIndex === -1 ? 1 : group.warnings[warnIndex].count;
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Kembali ke Peringatan', `group_warnings:${groupId}`)],
      ]);
      
      await ctx.reply(`Peringatan telah diberikan kepada pengguna dengan ID ${userId}.

Peringatan ke-${warningCount}
Alasan: ${reason}`, keyboard);
      
      // Notify the group
      try {
        await ctx.telegram.sendMessage(groupId, `⚠️ Peringatan untuk pengguna dengan ID ${userId}

Peringatan ke-${warningCount}
Alasan: ${reason}
Diberikan oleh: admin melalui pesan pribadi

${warningCount >= 3 ? '‼️ Pengguna ini telah mencapai 3 peringatan dan dapat dikeluarkan dari grup.' : ''}`);
        
        // If warnings reaches 3, kick the user if bot has permission
        if (warningCount >= 3) {
          try {
            // Check if bot is admin
            const botMember = await ctx.telegram.getChatMember(groupId, ctx.botInfo.id);
            
            if (botMember.can_restrict_members) {
              await ctx.telegram.kickChatMember(groupId, userId);
              await ctx.telegram.unbanChatMember(groupId, userId); // Unban so they can rejoin
              await ctx.telegram.sendMessage(groupId, `Pengguna dengan ID ${userId} telah dikeluarkan dari grup karena menerima 3 peringatan.`);
              
              // Reset warnings
              group.warnings = group.warnings.filter(w => w.userId !== userId);
              await group.save();
            }
          } catch (kickError) {
            console.error('Error kicking warned user:', kickError);
            await ctx.telegram.sendMessage(groupId, 'Tidak dapat mengeluarkan pengguna karena bot tidak memiliki izin yang cukup.');
          }
        }
      } catch (error) {
        console.error('Error notifying group about warning:', error);
      }
      
      return;
    }
    
    // Handle kick user ID input
    if (ctx.session.waitingForKickUserId) {
      const groupId = ctx.session.waitingForKickUserId;
      
      // Get user ID from text, forward, or reply
      let userId = null;
      
      if (ctx.message.text && !ctx.message.text.startsWith('/')) {
        // Try to parse user ID or username
        const text = ctx.message.text;
        if (text.startsWith('@')) {
          // Username provided
          try {
            const username = text.substring(1);
            const chatMember = await ctx.telegram.getChatMember(groupId, username);
            userId = chatMember.user.id;
          } catch (error) {
            await ctx.reply('Pengguna tidak ditemukan dalam grup. Pastikan username benar dan pengguna adalah anggota grup.');
            return;
          }
        } else {
          // User ID provided
          userId = Number(text);
          if (isNaN(userId)) {
            await ctx.reply('ID pengguna tidak valid. Harap berikan ID numerik yang valid atau username yang dimulai dengan @.');
            return;
          }
        }
      } else if (ctx.message.forward_from) {
        // Forwarded message
        userId = ctx.message.forward_from.id;
      } else if (ctx.message.reply_to_message) {
        // Reply to message
        userId = ctx.message.reply_to_message.from.id;
      }
      
      if (!userId) {
        await ctx.reply('Tidak dapat menentukan ID pengguna. Coba kirim ID numerik, username (@username), atau forward pesan dari pengguna.');
        return;
      }
      
      // Check if user is a bot admin
      if (ctx.config.ADMIN_IDS.includes(userId)) {
        await ctx.reply('Tidak dapat mengeluarkan admin bot.');
        return;
      }
      
      // Check if user is a group admin
      try {
        const member = await ctx.telegram.getChatMember(groupId, userId);
        if (member.status === 'creator' || member.status === 'administrator') {
          await ctx.reply('Tidak dapat mengeluarkan admin grup.');
          return;
        }
      } catch (error) {
        console.error('Error checking user status:', error);
        await ctx.reply('Gagal memeriksa status pengguna. Pengguna mungkin tidak berada dalam grup.');
        return;
      }
      
      // Get reason
      ctx.session.waitingForKickReason = { groupId, userId };
      delete ctx.session.waitingForKickUserId;
      
      await ctx.reply(`Pengguna dengan ID ${userId} akan dikeluarkan dari grup. Silakan kirim alasan atau ketik "skip" untuk melanjutkan tanpa alasan.`);
      return;
    }
    
    // Handle kick reason input
    if (ctx.session.waitingForKickReason && ctx.message && ctx.message.text) {
      const { groupId, userId } = ctx.session.waitingForKickReason;
      let reason = ctx.message.text;
      
      if (reason.toLowerCase() === 'skip') {
        reason = 'Tidak ada alasan';
      }
      
      try {
        // Check if bot is admin and can kick
        const botMember = await ctx.telegram.getChatMember(groupId, ctx.botInfo.id);
        
        if (!botMember.can_restrict_members) {
          await ctx.reply('Bot tidak memiliki izin untuk mengeluarkan pengguna dari grup. Pastikan bot adalah admin dengan izin yang tepat.');
          delete ctx.session.waitingForKickReason;
          return;
        }
        
        // Kick the user
        await ctx.telegram.kickChatMember(groupId, userId);
        
        // Unban so they can rejoin if invited
        await ctx.telegram.unbanChatMember(groupId, userId);
        
        delete ctx.session.waitingForKickReason;
        
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Kembali ke Manajemen Anggota', `group_members:${groupId}`)],
        ]);
        
        await ctx.reply(`Pengguna dengan ID ${userId} telah dikeluarkan dari grup.

Alasan: ${reason}`, keyboard);
        
        // Notify the group
        try {
          await ctx.telegram.sendMessage(groupId, `Pengguna dengan ID ${userId} telah dikeluarkan dari grup oleh admin melalui pesan pribadi.

Alasan: ${reason}`);
        } catch (error) {
          console.error('Error notifying group about kick:', error);
        }
      } catch (error) {
        console.error('Error kicking user:', error);
        await ctx.reply('Gagal mengeluarkan pengguna. Pastikan ID pengguna valid, pengguna berada dalam grup, dan bot memiliki izin yang tepat.');
        delete ctx.session.waitingForKickReason;
      }
      
      return;
    }
    
    // Handle cancel command for any session
    if (ctx.message && ctx.message.text === '/cancel') {
      const hadSession = Object.keys(ctx.session).length > 0;
      ctx.session = {};
      
      if (hadSession) {
        await ctx.reply('Operasi dibatalkan.');
      }
      return;
    }
  }
  
  // Handle group messages
  if (ctx.chat && ctx.chat.type !== 'private') {
    // Check if message is from a blacklisted user
    const group = await Group.findOne({ groupId: ctx.chat.id });
    
    if (group) {
      const isBlacklisted = group.blacklistedUsers.some(user => user.userId === userId);
      
      if (isBlacklisted) {
        // Delete message from blacklisted user
        try {
          await ctx.deleteMessage();
        } catch (error) {
          console.error('Error deleting message:', error);
        }
        return;
      }
      
      // Handle group settings
      if (group.settings) {
        // Anti-link
        if (group.settings.antiLink && ctx.message && ctx.message.text) {
          const hasLink = ctx.message.text.match(/https?:\/\/[^\s]+/g) || ctx.message.text.match(/t\.me\/[^\s]+/g);
          if (hasLink) {
            try {
              // Check if user is admin
              const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
              if (member.status !== 'creator' && member.status !== 'administrator') {
                await ctx.deleteMessage();
                await ctx.reply(`@${ctx.from.username || ctx.from.id} Pesan yang berisi link telah dihapus.`, { reply_to_message_id: ctx.message.message_id });
                return;
              }
            } catch (error) {
              console.error('Error checking anti-link user status:', error);
            }
          }
        }
        
        // Anti-forward
        if (group.settings.antiForward && ctx.message && ctx.message.forward_from) {
          try {
            // Check if user is admin
            const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
            if (member.status !== 'creator' && member.status !== 'administrator') {
              await ctx.deleteMessage();
              await ctx.reply(`@${ctx.from.username || ctx.from.id} Pesan yang diforward telah dihapus.`, { reply_to_message_id: ctx.message.message_id });
              return;
            }
          } catch (error) {
            console.error('Error checking anti-forward user status:', error);
          }
        }
        
        // Anti-spam (check for multiple consecutive messages or large amounts of text)
        if (group.settings.antiSpam && ctx.message) {
          // This is just a basic implementation - a more robust one would track message frequency
          if (ctx.message.text && ctx.message.text.length > 1000) {
            try {
              // Check if user is admin
              const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
              if (member.status !== 'creator' && member.status !== 'administrator') {
                await ctx.deleteMessage();
                await ctx.reply(`@${ctx.from.username || ctx.from.id} Pesan terlalu panjang dan dianggap spam.`, { reply_to_message_id: ctx.message.message_id });
                return;
              }
            } catch (error) {
              console.error('Error checking anti-spam user status:', error);
            }
          }
        }
        
        // Auto-delete commands
        if (group.settings.autoDeleteCommands && ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) {
          try {
            setTimeout(async () => {
              try {
                await ctx.deleteMessage();
              } catch (error) {
                console.error('Error auto-deleting command:', error);
              }
            }, 5000); // Delete after 5 seconds
          } catch (error) {
            console.error('Error setting up auto-delete:', error);
          }
        }
        
        // Admin-only commands
        if (group.settings.adminOnlyCommands && ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) {
          try {
            // Check if user is admin
            const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
            if (member.status !== 'creator' && member.status !== 'administrator') {
              await ctx.deleteMessage();
              await ctx.reply(`@${ctx.from.username || ctx.from.id} Hanya admin yang dapat menggunakan perintah dalam grup ini.`, { reply_to_message_id: ctx.message.message_id });
              return;
            }
          } catch (error) {
            console.error('Error checking admin-only command user status:', error);
          }
        }
      }
      
      // Handle new members welcome message
      if (ctx.message && ctx.message.new_chat_members) {
        // Don't process if it's the bot itself joining
        if (!ctx.message.new_chat_members.some(member => member.id === ctx.botInfo.id)) {
          await welcomeHandler.handleNewMember(ctx);
        }
      }
      
      // Handle members leaving message
      if (ctx.message && ctx.message.left_chat_member) {
        // Don't process if it's the bot itself leaving
        if (ctx.message.left_chat_member.id !== ctx.botInfo.id) {
          await welcomeHandler.handleMemberLeft(ctx);
        }
      }
    }
    
    // Handle blacklisting via reply to a message
    if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/bl') && ctx.message.reply_to_message) {
      const targetUser = ctx.message.reply_to_message.from;
      
      // Check if user is a bot admin or group admin
      let canBlacklist = false;
      
      if (ctx.config.ADMIN_IDS.includes(ctx.from.id)) {
        canBlacklist = true;
      } else {
        try {
          const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
          canBlacklist = member.status === 'creator' || member.status === 'administrator';
        } catch (error) {
          console.error('Error checking blacklist permission:', error);
        }
      }
      
      if (!canBlacklist) {
        await ctx.reply('Hanya admin yang dapat menggunakan perintah ini.', { reply_to_message_id: ctx.message.message_id });
        return;
      }
      
      // Check if target is an admin
      try {
        const targetMember = await ctx.telegram.getChatMember(ctx.chat.id, targetUser.id);
        if (targetMember.status === 'creator' || targetMember.status === 'administrator') {
          await ctx.reply('Tidak dapat blacklist admin grup.', { reply_to_message_id: ctx.message.message_id });
          return;
        }
      } catch (error) {
        console.error('Error checking target user status:', error);
      }
      
      // Get reason (if provided)
      const parts = ctx.message.text.split(' ');
      let reason = parts.slice(1).join(' ') || 'Tidak ada alasan';
      
      // Add user to blacklist
      if (!group) {
        await ctx.reply('Grup ini belum dikelola oleh bot.', { reply_to_message_id: ctx.message.message_id });
        return;
      }
      
      // Check if already blacklisted
      const isBlacklisted = group.blacklistedUsers.some(u => u.userId === targetUser.id);
      
      if (isBlacklisted) {
        await ctx.reply('Pengguna ini sudah di-blacklist dalam grup ini.', { reply_to_message_id: ctx.message.message_id });
        return;
      }
      
      // Add to blacklist
      group.blacklistedUsers.push({
        userId: targetUser.id,
        addedBy: ctx.from.id,
        addedAt: new Date(),
        reason,
      });
      
      await group.save();
      
      await ctx.reply(`Pengguna ${targetUser.username ? `@${targetUser.username}` : targetUser.first_name} telah ditambahkan ke blacklist.

Alasan: ${reason}`, { reply_to_message_id: ctx.message.message_id });
      
      // Try to delete all messages from the blacklisted user (last 24 hours)
      try {
        // Note: This is not ideal since Telegram doesn't have a built-in way to delete all messages from a user
        // This would need a more sophisticated message tracking system
        await ctx.reply('Untuk menghapus semua pesan dari pengguna ini, gunakan fitur "Delete all messages" dari menu admin Telegram.', { reply_to_message_id: ctx.message.message_id });
      } catch (error) {
        console.error('Error suggesting message deletion:', error);
      }
      
      return;
    }
    
    // Handle group joining through forwarded message (for /addgroup command)
    if (ctx.message.new_chat_members && ctx.message.new_chat_members.some(member => member.id === ctx.botInfo.id)) {
      // Bot was added to a group
      // This is handled by the middleware/auth.js checkGroupApproval function
    }
  } else if (ctx.chat && ctx.chat.type === 'private') {
    // Handle forwarded messages for adding groups
    if (ctx.message.forward_from_chat && ctx.message.forward_from_chat.type !== 'private') {
      // Get group details from forwarded message
      const groupId = ctx.message.forward_from_chat.id;
      const groupTitle = ctx.message.forward_from_chat.title;
      
      // Check if group already exists
      const existingGroup = await Group.findOne({ groupId });
      
      if (existingGroup) {
        return ctx.reply(`Grup ini sudah dikelola oleh bot. Grup: ${groupTitle} (ID: ${groupId})`, { reply_to_message_id: ctx.message.message_id });
      }
      
      // Add new group
      const newGroup = new Group({
        groupId,
        title: groupTitle,
        addedBy: ctx.from.id,
        isApproved: ctx.config.ADMIN_IDS.includes(ctx.from.id), // Auto-approve if added by admin
        approvedBy: ctx.config.ADMIN_IDS.includes(ctx.from.id) ? ctx.from.id : null,
        approvedAt: ctx.config.ADMIN_IDS.includes(ctx.from.id) ? new Date() : null,
      });
      
      await newGroup.save();
      
      const keyboard = Markup.inlineKeyboard([
        Markup.button.url('Tambahkan Bot ke Grup', `https://t.me/${ctx.botInfo.username}?startgroup=${groupId}`),
      ]);
      
      await ctx.reply(`Grup telah ${newGroup.isApproved ? 'ditambahkan dan disetujui' : 'ditambahkan tapi perlu persetujuan'}.

Grup: ${groupTitle}
ID: ${groupId}

${newGroup.isApproved ? 'Anda sekarang dapat menambahkan bot ke grup ini:' : 'Setelah disetujui, Anda dapat menambahkan bot ke grup ini:'}`, { reply_markup: keyboard, reply_to_message_id: ctx.message.message_id });
    }
  }
};

// ============= MAIN BOT CODE =============
// Connect to MongoDB
mongoose.connect(config.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// Initialize bot
const bot = new Telegraf(config.BOT_TOKEN);

// Add session middleware
bot.use(session());

// Set bot commands
bot.telegram.setMyCommands([
  { command: 'start', description: 'Start the bot' },
  { command: 'help', description: 'Show help message' },
  { command: 'addgroup', description: 'Add a group to manage' },
  { command: 'approve', description: 'Approve a user' },
  { command: 'groups', description: 'List managed groups' },
  { command: 'setwelcome', description: 'Set welcome message for a group' },
  { command: 'setgoodbye', description: 'Set goodbye message for a group' },
  { command: 'settings', description: 'Configure group settings' },
  { command: 'adminlist', description: 'List admin users' },
  { command: 'requests', description: 'View approval requests' },
]);

// Middleware
bot.use(async (ctx, next) => {
  // Add context properties
  ctx.config = config;
  
  // Check if the message is from a group and handle group approval
  if (ctx.chat && ctx.chat.type !== 'private') {
    const isApproved = await checkGroupApproval(ctx);
    if (!isApproved) {
      await ctx.reply('Group tidak disetujui. Bot akan keluar.');
      await ctx.leaveChat();
      return;
    }
  }
  
  await next();
});

// Command handlers
bot.start(commandHandler.start);
bot.help(commandHandler.help);
bot.command('addgroup', checkUserApproval, commandHandler.addGroup);
bot.command('approve', checkUserApproval, commandHandler.approve);
bot.command('reject', checkUserApproval, commandHandler.reject);
bot.command('groups', checkUserApproval, commandHandler.listGroups);
bot.command('kick', checkUserApproval, commandHandler.kickUser);
bot.command('add', checkUserApproval, commandHandler.addUser);
bot.command('bl', checkUserApproval, commandHandler.blacklistUser);
bot.command('unbl', checkUserApproval, commandHandler.unblacklistUser);
bot.command('warn', checkUserApproval, commandHandler.warnUser);
bot.command('unwarn', checkUserApproval, commandHandler.unwarnUser);
bot.command('adminlist', commandHandler.listAdmins);
bot.command('requests', checkUserApproval, commandHandler.listRequests);
bot.command('setwelcome', checkUserApproval, welcomeHandler.setWelcome);
bot.command('setgoodbye', checkUserApproval, welcomeHandler.setGoodbye);
bot.command('settings', checkUserApproval, commandHandler.settings);

// Handle callback queries (for inline buttons)
bot.on('callback_query', callbackHandler);

// Handle all messages
bot.on('message', messageHandler);

// Enable welcome/goodbye group actions
bot.on('new_chat_members', welcomeHandler.handleNewMember);
bot.on('left_chat_member', welcomeHandler.handleMemberLeft);
console.log('Handlers berhasil dipasang');

// Setup error handling global
setupGlobalErrorHandling(bot);

// Launch bot dengan fitur restart otomatis
launchBotSafely(bot)
  .then(() => console.log('Bot berhasil dimulai dengan error handling'))
  .catch(err => console.error('Error fatal saat memulai bot:', err));

// Tetap pertahankan penanganan SIGINT dan SIGTERM
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// ============= package.json =============
// Contoh package.json
/*
{
  "name": "telegram-group-management-bot",
  "version": "1.0.0",
  "description": "Telegram bot for group management with admin approval system",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "dev": "nodemon index.js"
  },
  "dependencies": {
    "mongoose": "^6.9.0",
    "telegraf": "^4.12.2"
  },
  "devDependencies": {
    "nodemon": "^2.0.20"
  }
}
*/
