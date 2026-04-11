require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder, SlashCommandBuilder } = require('discord.js');
const sharp = require('sharp');
const path = require('path');
const fetch = require('node-fetch');
const http = require('http');
const fs = require('fs/promises');
const { execFileSync } = require('child_process');

// ── Startup banner ────────────────────────────────────────────────────────────
console.log('========================================');
console.log('  sharkinpark bot starting up');
console.log(`  ${new Date().toISOString()}`);
console.log(`  Node ${process.version}  PID ${process.pid}`);
console.log('========================================');

// ── Env var check ─────────────────────────────────────────────────────────────
console.log('[env] TOKEN     :', process.env.TOKEN     ? '✅ set' : '❌ MISSING');
console.log('[env] CHANNEL_ID:', process.env.CHANNEL_ID ? '✅ set' : '❌ MISSING');
assertArialBlackAvailableOnLinux();

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
    GatewayIntentBits.GuildMembers
  ]
});
console.log('[discord] client created, logging in...');

const welCommand = new SlashCommandBuilder()
  .setName('wel')
  .setDescription('Generate a welcome image for a user')
  .addUserOption((option) =>
    option
      .setName('user')
      .setDescription('User to generate a welcome image for')
      .setRequired(true)
  );

async function registerWelCommand() {
  await client.application.commands.set([welCommand.toJSON()]);
  console.log('[discord] synced global slash commands');
}

const templatePath = path.join(__dirname, 'template.png');
let templateBufferPromise;
let templateReadError;
let templateReadBlockedUntil = 0;

function getTemplateBuffer() {
  if (templateReadBlockedUntil > Date.now()) {
    return Promise.reject(templateReadError);
  }

  if (!templateBufferPromise) {
    templateBufferPromise = fs.readFile(templatePath)
      .then((buffer) => {
        templateReadError = undefined;
        templateReadBlockedUntil = 0;
        return buffer;
      })
      .catch((err) => {
        templateBufferPromise = undefined;
        templateReadError = err;
        templateReadBlockedUntil = Date.now() + 30000;
        throw err;
      });
  }

  return templateBufferPromise;
}

function escapeSvgText(text) {
  if (!text) return '';

  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function assertArialBlackAvailableOnLinux() {
  if (process.platform !== 'linux') return;

  let fontFamilies;
  try {
    fontFamilies = execFileSync('fc-list', [':', 'family'], {
      encoding: 'utf8'
    });
  } catch (err) {
    throw new Error(
      `Failed to check system fonts with fc-list: ${err.message}. Ensure fontconfig is installed because it provides the fc-list command.`
    );
  }

  const hasArialBlack = fontFamilies
    .split('\n')
    .some((line) =>
      line
        .split(',')
        .map((name) => name.trim().toLowerCase())
        .includes('arial black')
    );

  if (!hasArialBlack) {
    throw new Error(
      'Required font "Arial Black" is not installed on this Linux host. Install it with your distro package manager (Ubuntu/Debian example: sudo apt install ttf-mscorefonts-installer) and restart the bot.'
    );
  }
}

async function buildTextImage(username, width, height, offsetX, offsetY) {
  let fontSize = 220;
  while (fontSize > 20 && username.length * fontSize * 0.6 >= 1800) {
    fontSize -= 10;
  }

  const safeUsername = escapeSvgText(username);
  const textSVG = Buffer.from(`
    <svg width="2000" height="400">
      <style>
        text {
          font-family: "Arial Black";
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
        transform="translate(${offsetX}, ${offsetY})"
      >${safeUsername}</text>
      <text
        x="1000"
        y="200"
        fill="white"
        transform="translate(${offsetX}, ${offsetY})"
      >${safeUsername}</text>
    </svg>
  `);

  return sharp(textSVG)
    .resize(width, height, { fit: 'fill' })
    .png()
    .toBuffer();
}

async function generateWelcomeImage(user) {
  const WIDTH = 309;
  const HEIGHT = 136;

  const OFFSET_X = 40;
  const OFFSET_Y = 160;

  const avatarURL = user.displayAvatarURL({ extension: 'png', size: 512 });
  const avatarRes = await fetch(avatarURL);
  if (!avatarRes.ok) {
    throw new Error(`Failed to fetch avatar: ${avatarRes.status} ${avatarRes.statusText}`);
  }
  const avatarBuffer = Buffer.from(await avatarRes.arrayBuffer());

  const username = user.username;
  const avatarPromise = sharp(avatarBuffer)
    .resize(WIDTH, HEIGHT, { fit: 'fill' })
    .toBuffer();
  const textImagePromise = buildTextImage(username, WIDTH, HEIGHT, OFFSET_X, OFFSET_Y);
  const [avatar, textImage, templateBuffer] = await Promise.all([
    avatarPromise,
    textImagePromise,
    getTemplateBuffer()
  ]);

  const finalBox = await sharp(avatar)
    .composite([{ input: textImage }])
    .png()
    .toBuffer();

  const finalImage = await sharp(templateBuffer)
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

client.once('ready', async () => {
  console.log('========================================');
  console.log(`[discord] ✅ logged in as: ${client.user.tag}`);
  console.log(`[discord] 📊 servers: ${client.guilds.cache.size}`);
  console.log('[discord] bot is ONLINE and ready');
  console.log('========================================');

  try {
    await registerWelCommand();
  } catch (err) {
    console.error('[discord] failed to register /wel command:', err);
  }
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

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'wel') return;

  const targetUser = interaction.options.getUser('user', true);
  console.log(`[/wel] requested by ${interaction.user.tag}, target userId: ${targetUser.id}`);

  try {
    await interaction.deferReply();
    console.log(`[/wel] generating image for ${targetUser.tag}`);
    const finalImage = await generateWelcomeImage(targetUser);
    const attachment = new AttachmentBuilder(finalImage, { name: 'welcome.png' });
    await interaction.editReply({ files: [attachment] });
    console.log(`[/wel] image sent for ${targetUser.tag}`);
  } catch (err) {
    console.error('❌ Error in /wel command:', err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('Failed, please try again.');
    } else {
      await interaction.reply({ content: 'Failed, please try again.', ephemeral: true });
    }
  }
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

client.login(process.env.TOKEN).catch((err) => {
  console.error('Failed to login:', err);
  process.exit(1);
});
