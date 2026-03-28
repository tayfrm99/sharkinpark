require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const sharp = require('sharp');
const path = require('path');
const fetch = require('node-fetch');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

//thissoitsaysif its online or not in the console
client.once('ready', () => {
  console.log('========================');
  console.log(`✅ Logged in as: ${client.user.tag}`);
  console.log(`📊 Servers: ${client.guilds.cache.size}`);
  console.log('========================');
});

client.on('guildMemberAdd', async (member) => {
  try {
    const avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 512 });

    const response = await fetch(avatarURL);
    const avatarBuffer = await response.buffer();

// this thing streches stuff!!!
    const resizedAvatar = await sharp(avatarBuffer)
      .resize(309, 136, {
        fit: 'fill'
      })
      .toBuffer();

    const finalImage = await sharp(path.join(__dirname, 'template.png'))
      .composite([
        {
          input: resizedAvatar,
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
//this sends the final le image
      channel.send({
        files: [attachment]
      });
    }

  } catch (err) {
    console.error('❌ Error:', err);
  }
});

client.login(process.env.TOKEN);
