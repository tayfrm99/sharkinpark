require('dotenv').config();
const { Client, GatewayIntentBits, Partials, AttachmentBuilder, SlashCommandBuilder } = require('discord.js');
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
  ],
  partials: [
    Partials.GuildMember,
    Partials.User
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

const byeCommand = new SlashCommandBuilder()
  .setName('bye')
  .setDescription('Generate a goodbye image for a user')
  .addUserOption((option) =>
    option
      .setName('user')
      .setDescription('User to generate a goodbye image for')
      .setRequired(true)
  );

async function registerCommands() {
  await client.application.commands.set([welCommand.toJSON(), byeCommand.toJSON()]);
  console.log('[discord] synced global slash commands');
}

const templatePath = path.join(__dirname, 'template.png');
const byeTemplatePath = path.join(__dirname, 'bye-template.png');
const templateCache = {
  bufferPromise: undefined,
  readError: undefined,
  readBlockedUntil: 0
};
const byeTemplateCache = {
  bufferPromise: undefined,
  readError: undefined,
  readBlockedUntil: 0
};
let byeTemplateFallbackWarned = false;

function getTemplateBufferForPath(cache, filePath) {
  if (cache.readBlockedUntil > Date.now()) {
    return Promise.reject(cache.readError);
  }

  if (!cache.bufferPromise) {
    cache.bufferPromise = fs.readFile(filePath)
      .then((buffer) => {
        cache.readError = undefined;
        cache.readBlockedUntil = 0;
        return buffer;
      })
      .catch((err) => {
        cache.bufferPromise = undefined;
        cache.readError = err;
        cache.readBlockedUntil = Date.now() + 30000;
        throw err;
      });
  }

  return cache.bufferPromise;
}

function getTemplateBuffer() {
  return getTemplateBufferForPath(templateCache, templatePath);
}

async function getByeTemplateBuffer() {
  try {
    return await getTemplateBufferForPath(byeTemplateCache, byeTemplatePath);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      if (!byeTemplateFallbackWarned) {
        console.warn(`[template] ${byeTemplatePath} not found, using welcome template for bye images`);
        byeTemplateFallbackWarned = true;
      }
      return getTemplateBuffer();
    }
    throw err;
  }
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

async function generateMemberImage(user, templateBufferFactory) {
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
    templateBufferFactory()
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

function generateWelcomeImage(user) {
  return generateMemberImage(user, getTemplateBuffer);
}

function generateByeImage(user) {
  return generateMemberImage(user, getByeTemplateBuffer);
}

client.once('ready', async () => {
  console.log('========================================');
  console.log(`[discord] ✅ logged in as: ${client.user.tag}`);
  console.log(`[discord] 📊 servers: ${client.guilds.cache.size}`);
  console.log('[discord] bot is ONLINE and ready');
  console.log('========================================');

  try {
    await registerCommands();
  } catch (err) {
    console.error('[discord] failed to register slash commands:', err);
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

client.on('guildMemberRemove', async (member) => {
  let user = member.user;
  if (!user) {
    try {
      user = await client.users.fetch(member.id);
    } catch (err) {
      console.error(`[leave] failed to fetch leaving user ${member.id}:`, err);
      return;
    }
  }

  console.log(`[leave] ${user.tag} left ${member.guild.name}`);
  try {
    const finalImage = await generateByeImage(user);
    const attachment = new AttachmentBuilder(finalImage, { name: 'bye.png' });
    const channelId = process.env.CHANNEL_ID;
    if (!channelId) {
      console.warn('[leave] CHANNEL_ID is not set, skipping bye');
      return;
    }

    let channel = member.guild.channels.cache.get(channelId);
    if (!channel) {
      channel = await member.guild.channels.fetch(channelId).catch((err) => {
        console.error(`[leave] failed to fetch channel ${channelId}:`, err);
        return null;
      });
    }

    if (channel) {
      await channel.send({ files: [attachment] });
      console.log(`[leave] bye image sent for ${user.tag}`);
    } else {
      console.warn(`[leave] channel ${channelId} not found, skipping bye`);
    }
  } catch (err) {
    console.error('[leave] error generating bye image:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'wel' && interaction.commandName !== 'bye') return;

  const isBye = interaction.commandName === 'bye';
  const targetUser = interaction.options.getUser('user', true);
  const commandLabel = `/${interaction.commandName}`;
  console.log(`[${commandLabel}] requested by ${interaction.user.tag}, target userId: ${targetUser.id}`);

  try {
    await interaction.deferReply();
    console.log(`[${commandLabel}] generating image for ${targetUser.tag}`);
    const finalImage = isBye ? await generateByeImage(targetUser) : await generateWelcomeImage(targetUser);
    const attachment = new AttachmentBuilder(finalImage, { name: isBye ? 'bye.png' : 'welcome.png' });
    await interaction.editReply({ files: [attachment] });
    console.log(`[${commandLabel}] image sent for ${targetUser.tag}`);
  } catch (err) {
    console.error(`❌ Error in ${commandLabel} command:`, err);
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
