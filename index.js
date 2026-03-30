require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const sharp = require('sharp');
const path = require('path');
const fetch = require('node-fetch');
const http = require('http'); //forhealthserver

//health server
http.createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok');
}).listen(9304, () => {
  console.log('Healthcheck listening on port 10000'); //10000 or 9304
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

client.once('ready', () => {
  console.log('========================');
  console.log(`✅ Logged in as: ${client.user.tag}`);
  console.log(`📊 Servers: ${client.guilds.cache.size}`);
  console.log('========================');
});

client.on('guildMemberAdd', async (member) => {
  try {
    const WIDTH = 309;
    const HEIGHT = 136;

    const OFFSET_X = 40;
    const OFFSET_Y = 160;

    const avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 512 });
    const avatarBuffer = await (await fetch(avatarURL)).buffer();

    const username = member.user.username;

    // another stretch
    const avatar = await sharp(avatarBuffer)
      .resize(WIDTH, HEIGHT, { fit: 'fill' })
      .toBuffer();

    // set text size 
    let fontSize = 220;
    let fits = false;

    while (!fits && fontSize > 20) {
      const svgTest = Buffer.from(`
        <svg width="2000" height="400">
          <style>
            text {
              font-family: Impact, Arial Black, sans-serif;
              font-size: ${fontSize}px;
              font-weight: 900;
            }
          </style>
          <text x="0" y="${fontSize}">${username}</text>
        </svg>
      `);

      const metadata = await sharp(svgTest).metadata();

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
        >
          ${username}
        </text>

        <text 
          x="1000" 
          y="200"
          fill="white"
          transform="translate(${OFFSET_X}, ${OFFSET_Y})"
        >
          ${username}
        </text>
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

    const attachment = new AttachmentBuilder(finalImage, {
      name: 'welcome.png'
    });

    const channel = member.guild.channels.cache.get(process.env.CHANNEL_ID);

    if (channel) {
      channel.send({ files: [attachment] });
    }

  } catch (err) {
    console.error('❌ Error:', err);
  }
});

client.login(process.env.TOKEN);
