import nacl from 'tweetnacl';

const DISCORD_API_BASE = 'https://discord.com/api/v10';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/') {
      return textResponse('sharkinpark cloudflare runner is alive');
    }

    if (request.method === 'POST' && url.pathname === '/discord/interactions') {
      return handleDiscordInteraction(request, env, ctx);
    }

    if (request.method === 'POST' && (url.pathname === '/events/join' || url.pathname === '/events/leave')) {
      return handleEventRelay(request, env, url.pathname.endsWith('/join') ? 'wel' : 'bye');
    }

    if (request.method === 'POST' && url.pathname === '/admin/register-commands') {
      return registerCommands(request, env);
    }

    return new Response('Not found', { status: 404 });
  }
};

async function handleDiscordInteraction(request, env, ctx) {
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  const body = await request.text();

  if (!signature || !timestamp || !env.DISCORD_PUBLIC_KEY) {
    return new Response('Missing signature headers or public key', { status: 401 });
  }

  const isValid = verifyDiscordSignature(env.DISCORD_PUBLIC_KEY, signature, timestamp, body);
  if (!isValid) {
    return new Response('Invalid request signature', { status: 401 });
  }

  let interaction;
  try {
    interaction = JSON.parse(body);
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  if (interaction.type === 1) {
    return jsonResponse({ type: 1 });
  }

  if (interaction.type !== 2) {
    return jsonResponse({
      type: 4,
      data: {
        content: 'Unsupported interaction type.',
        flags: 64
      }
    });
  }

  const commandName = interaction.data?.name;
  if (commandName !== 'wel' && commandName !== 'bye') {
    return jsonResponse({
      type: 4,
      data: {
        content: `Unknown command: ${commandName ?? 'undefined'}`,
        flags: 64
      }
    });
  }

  const targetUser = getCommandTargetUser(interaction);
  if (!targetUser) {
    return jsonResponse({
      type: 4,
      data: {
        content: 'No target user provided.',
        flags: 64
      }
    });
  }

  ctx.waitUntil(sendInteractionImage(interaction, targetUser, commandName, env));
  return jsonResponse({ type: 5 });
}

function getCommandTargetUser(interaction) {
  const options = interaction.data?.options ?? [];
  const userOption = options.find((option) => option.name === 'user' && option.value);
  const userId = userOption?.value;
  if (!userId) return null;

  const resolved = interaction.data?.resolved?.users ?? {};
  const raw = resolved[userId];
  if (!raw) return null;

  return {
    id: raw.id,
    username: raw.username,
    avatar: raw.avatar,
    discriminator: raw.discriminator
  };
}

async function sendInteractionImage(interaction, user, mode, env) {
  const endpoint = `${DISCORD_API_BASE}/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`;

  try {
    const imageResult = await createImageFile(user, mode);
    const formData = createMultipartFormData([
      {
        name: 'payload_json',
        contentType: 'application/json',
        value: JSON.stringify({
          content: '',
          attachments: [{ id: 0, filename: imageResult.filename }]
        })
      },
      {
        name: 'files[0]',
        contentType: 'image/svg+xml',
        filename: imageResult.filename,
        value: imageResult.bytes
      }
    ]);

    await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        'content-type': `multipart/form-data; boundary=${formData.boundary}`
      },
      body: formData.body
    });
  } catch (err) {
    const fallbackData = {
      content: `Failed to generate ${mode === 'bye' ? 'goodbye' : 'welcome'} image: ${String(err?.message ?? err)}`
    };

    await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fallbackData)
    });
  }
}

async function handleEventRelay(request, env, mode) {
  const requestSecret = request.headers.get('x-runner-secret');
  if (!env.EVENT_WEBHOOK_SECRET || requestSecret !== env.EVENT_WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const channelId = payload.channelId ?? env.CHANNEL_ID;
  const user = payload.user;
  if (!channelId || !user?.id || !user?.username) {
    return new Response('Missing channelId or user payload', { status: 400 });
  }

  if (!env.DISCORD_BOT_TOKEN) {
    return new Response('DISCORD_BOT_TOKEN not configured', { status: 500 });
  }

  const imageResult = await createImageFile(user, mode);
  const endpoint = `${DISCORD_API_BASE}/channels/${channelId}/messages`;

  const formData = createMultipartFormData([
    {
      name: 'payload_json',
      contentType: 'application/json',
      value: JSON.stringify({
        attachments: [{ id: 0, filename: imageResult.filename }]
      })
    },
    {
      name: 'files[0]',
      filename: imageResult.filename,
      contentType: 'image/svg+xml',
      value: imageResult.bytes
    }
  ]);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      'content-type': `multipart/form-data; boundary=${formData.boundary}`
    },
    body: formData.body
  });

  if (!response.ok) {
    const reason = await response.text();
    return new Response(`Discord API error: ${response.status} ${reason}`, { status: 502 });
  }

  return jsonResponse({ ok: true });
}

async function registerCommands(request, env) {
  const requestSecret = request.headers.get('x-runner-secret');
  if (!env.REGISTER_COMMANDS_SECRET || requestSecret !== env.REGISTER_COMMANDS_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_APP_ID) {
    return new Response('DISCORD_BOT_TOKEN or DISCORD_APP_ID not configured', { status: 500 });
  }

  const commands = [
    {
      name: 'wel',
      description: 'Generate a welcome image for a user',
      type: 1,
      options: [
        {
          type: 6,
          name: 'user',
          description: 'User to generate a welcome image for',
          required: true
        }
      ]
    },
    {
      name: 'bye',
      description: 'Generate a goodbye image for a user',
      type: 1,
      options: [
        {
          type: 6,
          name: 'user',
          description: 'User to generate a goodbye image for',
          required: true
        }
      ]
    }
  ];

  const response = await fetch(`${DISCORD_API_BASE}/applications/${env.DISCORD_APP_ID}/commands`, {
    method: 'PUT',
    headers: {
      authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(commands)
  });

  const text = await response.text();
  if (!response.ok) {
    return new Response(`Failed to register commands: ${response.status} ${text}`, { status: 502 });
  }

  return new Response(text, {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

async function createImageFile(user, mode) {
  const avatarUrl = buildAvatarUrl(user);
  const avatarResponse = await fetch(avatarUrl);
  if (!avatarResponse.ok) {
    throw new Error(`Avatar fetch failed (${avatarResponse.status})`);
  }

  const avatarBytes = new Uint8Array(await avatarResponse.arrayBuffer());
  const avatarBase64 = bytesToBase64(avatarBytes);
  const avatarMime = avatarResponse.headers.get('content-type') || 'image/png';

  const kind = mode === 'bye' ? 'GOODBYE' : 'WELCOME';
  const stroke = mode === 'bye' ? '#d62828' : '#1d3557';
  const accent = mode === 'bye' ? '#f77f00' : '#2a9d8f';
  const safeUsername = escapeXml(user.username);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1020" />
      <stop offset="100%" stop-color="#141f3d" />
    </linearGradient>
    <clipPath id="avatarClip">
      <circle cx="230" cy="300" r="140" />
    </clipPath>
  </defs>

  <rect width="1200" height="600" fill="url(#bg)" />
  <circle cx="230" cy="300" r="146" fill="none" stroke="${stroke}" stroke-width="12" />
  <image href="data:${avatarMime};base64,${avatarBase64}" x="90" y="160" width="280" height="280" clip-path="url(#avatarClip)" preserveAspectRatio="xMidYMid slice" />

  <text x="460" y="250" font-family="Arial, Helvetica, sans-serif" font-size="96" font-weight="900" fill="white">${kind}</text>
  <text x="460" y="345" font-family="Arial, Helvetica, sans-serif" font-size="64" font-weight="700" fill="${accent}">@${safeUsername}</text>
</svg>`;

  const filename = mode === 'bye' ? 'bye.svg' : 'welcome.svg';
  return {
    filename,
    bytes: new TextEncoder().encode(svg)
  };
}

function buildAvatarUrl(user) {
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`;
  }

  const fallbackIndex = Number(BigInt(user.id) >> 22n) % 6;
  return `https://cdn.discordapp.com/embed/avatars/${fallbackIndex}.png`;
}

function createMultipartFormData(parts) {
  const boundary = `----cf-runner-${crypto.randomUUID()}`;
  const textEncoder = new TextEncoder();
  const chunks = [];

  for (const part of parts) {
    const headerLines = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="${part.name}"${part.filename ? `; filename="${part.filename}"` : ''}`,
      `Content-Type: ${part.contentType}`,
      ''
    ];

    chunks.push(textEncoder.encode(`${headerLines.join('\r\n')}\r\n`));

    if (typeof part.value === 'string') {
      chunks.push(textEncoder.encode(part.value));
    } else {
      chunks.push(part.value);
    }

    chunks.push(textEncoder.encode('\r\n'));
  }

  chunks.push(textEncoder.encode(`--${boundary}--\r\n`));

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }

  return { boundary, body };
}

function verifyDiscordSignature(publicKeyHex, signatureHex, timestamp, rawBody) {
  const publicKey = hexToUint8Array(publicKeyHex);
  const signature = hexToUint8Array(signatureHex);
  const message = new TextEncoder().encode(timestamp + rawBody);
  return nacl.sign.detached.verify(message, signature, publicKey);
}

function hexToUint8Array(hexString) {
  if (!hexString || hexString.length % 2 !== 0) {
    throw new Error('Invalid hex string');
  }

  const bytes = new Uint8Array(hexString.length / 2);
  for (let i = 0; i < hexString.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hexString.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function textResponse(value, status = 200) {
  return new Response(value, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' }
  });
}
