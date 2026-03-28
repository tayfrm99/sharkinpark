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

client.on('guildMemberAdd', async (member) => {
  try {
    const avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 512 });

    const response = await fetch(avatarURL);
    const avatarBuffer = await response.buffer();

    const resizedAvatar = await sharp(avatarBuffer)
      .resize(309, 136)
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

    const attachment = new AttachmentBuilder(finalImage, { name: 'welcome.png' });

    const channel = member.guild.channels.cache.get(process.env.CHANNEL_ID);

    if (channel) {
      channel.send({
        content: `Welcome ${member}!`,
        files: [attachment]
      });
    }

  } catch (err) {
    console.error(err);
  }
});

client.login(process.env.TOKEN);
