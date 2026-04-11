require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const sharp = require('sharp');
const path = require('path');
const fetch = require('node-fetch');
const http = require('http');

// ── Startup banner ────────────────────────────────────────────────────────────
console.log('========================================');
console.log('  sharkinpark bot starting up');
console.log(`  ${new Date().toISOString()}`);
console.log(`  Node ${process.version}  PID ${process.pid}`);
console.log('========================================');

// ── Env var check ─────────────────────────────────────────────────────────────
console.log('[env] TOKEN     :', process.env.TOKEN     ? '✅ set' : '❌ MISSING');
console.log('[env] CHANNEL_ID:', process.env.CHANNEL_ID ? '✅ set' : '❌ MISSING');

// ── Health server ─────────────────────────────────────────────────────────────
// uses PORT env var so Render.com can detect it
const PORT = process.env.PORT || 10000;
http.createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('i am alive burrp weasel.pages.dev');
}).listen(PORT, () => {
  console.log(`[http] healthcheck server listening on port ${PORT}`);
});

// ── Discord client ─────────────────────────────────────────────────────────────
console.log('[discord] creating client...');
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});
console.log('[discord] client created, logging in...');


async function generateWelcomeImage(user) {
  const WIDTH = 309;
  const HEIGHT = 136;

  const OFFSET_X = 40;
  const OFFSET_Y = 160;

  const avatarURL = user.displayAvatarURL({ extension: 'png', size: 512 });
  const avatarRes = await fetch(avatarURL);
  const avatarBuffer = Buffer.from(await avatarRes.arrayBuffer());

  const username = user.username;

  // another stretch
  const avatar = await sharp(avatarBuffer)
    .resize(WIDTH, HEIGHT, { fit: 'fill' })
    .toBuffer();

  // set text size
  let fontSize = 220;
  let fits = false;

  while (!fits && fontSize > 20) {
    // crude check based on length vs font
    if (username.length * fontSize * 0.6 < 1800) {
      fits = true;
    } else {
      fontSize -= 10;
    }
  }

  // render le text
  const textSVG = Buffer.from(`
    <svg width="2000" height="400">
      <style>
        text {
          font-family: Impact, Arial Black, sans-serif;
          font-size: ${fontSize}px;
          font-weight: 900;
          text-anchor: middle;
          dominant-baseline: middle;
        }
      </style>

      <text
        x="1000"
        y="200"
        fill="none"
        stroke="black"
        stroke-width="20"
        transform="translate(${OFFSET_X}, ${OFFSET_Y})"
      >${username}</text>

      <text
        x="1000"
        y="200"
        fill="white"
        transform="translate(${OFFSET_X}, ${OFFSET_Y})"
      >${username}</text>
    </svg>
  `);

  //strechtext
  const textImage = await sharp(textSVG)
    .resize(WIDTH, HEIGHT, { fit: 'fill' })
    .png()
    .toBuffer();

  const finalBox = await sharp(avatar)
    .composite([{ input: textImage }])
    .png()
    .toBuffer();

  const finalImage = await sharp(path.join(__dirname, 'template.png'))
    .composite([
      {
        input: finalBox,
        top: 441,
        left: 314
      }
    ])
    .png()
    .toBuffer();

  return finalImage;
}

client.once('ready', () => {
  console.log('========================================');
  console.log(`[discord] ✅ logged in as: ${client.user.tag}`);
  console.log(`[discord] 📊 servers: ${client.guilds.cache.size}`);
  console.log('[discord] bot is ONLINE and ready');
  console.log('========================================');
});

client.on('guildMemberAdd', async (member) => {
  console.log(`[join] ${member.user.tag} joined ${member.guild.name}`);
  try {
    const finalImage = await generateWelcomeImage(member.user);
    const attachment = new AttachmentBuilder(finalImage, { name: 'welcome.png' });
    const channel = member.guild.channels.cache.get(process.env.CHANNEL_ID);

    if (channel) {
      await channel.send({ files: [attachment] });
      console.log(`[join] welcome image sent for ${member.user.tag}`);
    } else {
      console.warn(`[join] channel ${process.env.CHANNEL_ID} not found, skipping welcome`);
    }
  } catch (err) {
    console.error('[join] error generating welcome image:', err);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith('!wel ')) return;

  const userId = message.content.slice(5).trim().replace(/[<@!>]/g, '');
  console.log(`[!wel] requested by ${message.author.tag}, target userId: ${userId}`);
  if (!userId) {
    return message.reply('Usage: `!wel <user_id>`');
  }

  try {
    const targetUser = await client.users.fetch(userId);
    console.log(`[!wel] generating image for ${targetUser.tag}`);
    const finalImage = await generateWelcomeImage(targetUser);
    const attachment = new AttachmentBuilder(finalImage, { name: 'welcome.png' });
    await message.channel.send({ content: `<@${targetUser.id}>`, files: [attachment] });
    console.log(`[!wel] image sent for ${targetUser.tag}`);
  } catch (err) {
    console.error('❌ Error in !wel command:', err);
    await message.reply(' Failed, Make sure the user ID is valid.');
  }
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

client.login(process.env.TOKEN).catch((err) => {
  console.error('Failed to login:', err);
  process.exit(1);
});
