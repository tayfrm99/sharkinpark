require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const sharp = require('sharp');
const path = require('path');
const fetch = require('node-fetch');
const http = require('http');

// health server - uses PORT env var so Render.com can detect it
const PORT = process.env.PORT || 10000;
http.createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('i am alive burrp weasel.pages.dev');
}).listen(PORT, () => {
  console.log(`Healthcheck listening on port ${PORT}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

const commands = [
  new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Manually send the welcome image for a user')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to welcome')
        .setRequired(true)
    )
    .toJSON()
];

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

client.once('ready', async () => {
  console.log('========================');
  console.log(`✅ Logged in as: ${client.user.tag}`);
  console.log(`📊 Servers: ${client.guilds.cache.size}`);
  console.log('========================');

  // register slash commands globally
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('✅ Slash commands registered');
  } catch (err) {
    console.error('❌ Failed to register slash commands:', err);
  }
});

client.on('guildMemberAdd', async (member) => {
  try {
    const finalImage = await generateWelcomeImage(member.user);
    const attachment = new AttachmentBuilder(finalImage, { name: 'welcome.png' });
    const channel = member.guild.channels.cache.get(process.env.CHANNEL_ID);

    if (channel) {
      await channel.send({ files: [attachment] });
    }
  } catch (err) {
    console.error('❌ Error generating welcome image:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'welcome') {
    await interaction.deferReply();
    try {
      const targetUser = interaction.options.getUser('user');
      const finalImage = await generateWelcomeImage(targetUser);
      const attachment = new AttachmentBuilder(finalImage, { name: 'welcome.png' });
      await interaction.editReply({ files: [attachment] });
    } catch (err) {
      console.error('❌ Error in /welcome command:', err);
      await interaction.editReply('❌ Failed to generate welcome image.');
    }
  }
});

client.login(process.env.TOKEN);
