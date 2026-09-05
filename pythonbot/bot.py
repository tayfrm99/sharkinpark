import asyncio
import io
import os
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Optional

import aiohttp
import discord
import pyvips
from discord import app_commands
from dotenv import load_dotenv

load_dotenv()

DEFAULT_DYNO_BOT_ID = "155149108183695360"
DEDUPE_WINDOW_MS = 30000
DEDUPE_CACHE_SIZE = 500
DYNO_LEAVE_SUFFIX = " has left the server. Their loss."
DYNO_LEAVE_SUFFIX_LOWER = DYNO_LEAVE_SUFFIX.lower()
DISCORD_DEFAULT_AVATAR_OPTIONS = 6

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATE_PATH = BASE_DIR / "template.png"
BYE_TEMPLATE_PATH = BASE_DIR / "bye-template.png"

recent_bye_keys: dict[str, int] = {}
bye_template_fallback_warned = False
commands_synced = False


def is_env_toggle_enabled(value: Optional[str]) -> bool:
    if not value:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


IS_DYNO_FALLBACK_ENABLED = is_env_toggle_enabled(os.getenv("ENABLE_DYNO_LEAVE_FALLBACK"))


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        body = b"i am alive burrp weasel.pages.dev"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return


def start_health_server() -> None:
    port = int(os.getenv("PORT", "10000"))
    server = HTTPServer(("0.0.0.0", port), HealthHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"[http] healthcheck server listening on port {port}")


def assert_arial_black_available_on_linux() -> None:
    if sys.platform != "linux":
        return

    try:
        result = subprocess.run(
            ["fc-list", ":", "family"],
            check=True,
            text=True,
            capture_output=True,
        )
        font_families = result.stdout
    except Exception as err:
        raise RuntimeError(
            f"Failed to check system fonts with fc-list: {err}. "
            "Ensure fontconfig is installed because it provides the fc-list command."
        ) from err

    has_arial_black = False
    for line in font_families.splitlines():
        names = [name.strip().lower() for name in line.split(",")]
        if "arial black" in names:
            has_arial_black = True
            break

    if not has_arial_black:
        raise RuntimeError(
            'Required font "Arial Black" is not installed on this Linux host. '
            "Install it with your distro package manager (Ubuntu/Debian example: "
            "sudo apt install ttf-mscorefonts-installer) and restart the bot."
        )


@dataclass
class TemplateCache:
    buffer_task: Optional[asyncio.Task[bytes]] = None
    read_error: Optional[Exception] = None
    read_blocked_until: float = 0.0
    lock: asyncio.Lock = asyncio.Lock()


template_cache = TemplateCache()
bye_template_cache = TemplateCache()


async def get_template_buffer_for_path(cache: TemplateCache, file_path: Path) -> bytes:
    if cache.read_blocked_until > time.time() * 1000:
        if cache.read_error:
            raise cache.read_error
        raise RuntimeError("Template read blocked")

    async with cache.lock:
        if cache.read_blocked_until > time.time() * 1000:
            if cache.read_error:
                raise cache.read_error
            raise RuntimeError("Template read blocked")

        if cache.buffer_task is None:
            cache.buffer_task = asyncio.create_task(asyncio.to_thread(file_path.read_bytes))

    try:
        data = await cache.buffer_task
        cache.read_error = None
        cache.read_blocked_until = 0
        return data
    except Exception as err:
        cache.buffer_task = None
        cache.read_error = err
        cache.read_blocked_until = time.time() * 1000 + 30000
        raise


async def get_template_buffer() -> bytes:
    return await get_template_buffer_for_path(template_cache, TEMPLATE_PATH)


async def get_bye_template_buffer() -> bytes:
    global bye_template_fallback_warned
    try:
        return await get_template_buffer_for_path(bye_template_cache, BYE_TEMPLATE_PATH)
    except FileNotFoundError:
        if not bye_template_fallback_warned:
            print(f"[template] {BYE_TEMPLATE_PATH} not found, using welcome template for bye images")
            bye_template_fallback_warned = True
        return await get_template_buffer()


def escape_svg_text(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def ensure_rgba(image: pyvips.Image) -> pyvips.Image:
    if image.bands == 4:
        return image
    if image.bands == 3:
        return image.bandjoin(255)
    if image.bands == 1:
        return image.bandjoin(image).bandjoin(image).bandjoin(255)
    return image


def resize_fill(image: pyvips.Image, width: int, height: int) -> pyvips.Image:
    x_scale = width / image.width
    y_scale = height / image.height
    return image.resize(x_scale, vscale=y_scale)


async def build_text_image(username: str, width: int, height: int, offset_x: int, offset_y: int) -> pyvips.Image:
    font_size = 220
    while font_size > 20 and len(username) * font_size * 0.6 >= 1800:
        font_size -= 10

    safe_username = escape_svg_text(username)
    svg = f"""
    <svg width="2000" height="400">
      <style>
        text {{
          font-family: "Arial Black";
          font-size: {font_size}px;
          font-weight: 900;
          text-anchor: middle;
          dominant-baseline: middle;
        }}
      </style>
      <text
        x="1000"
        y="200"
        fill="none"
        stroke="black"
        stroke-width="20"
        transform="translate({offset_x}, {offset_y})"
      >{safe_username}</text>
      <text
        x="1000"
        y="200"
        fill="white"
        transform="translate({offset_x}, {offset_y})"
      >{safe_username}</text>
    </svg>
    """.encode("utf-8")

    text_image = pyvips.Image.new_from_buffer(svg, "", access="sequential")
    text_image = resize_fill(text_image, width, height)
    return ensure_rgba(text_image)


def get_user_username(user) -> str:
    return getattr(user, "username", None) or getattr(user, "name", "")


def get_user_tag(user) -> str:
    return getattr(user, "tag", None) or str(user)


def get_user_avatar_url(user) -> str:
    if hasattr(user, "display_avatar"):
        return user.display_avatar.replace(format="png", size=512).url
    return user.display_avatar_url()


async def generate_member_image(user, template_buffer_factory) -> bytes:
    width = 309
    height = 136
    offset_x = 40
    offset_y = 160

    avatar_url = get_user_avatar_url(user)
    async with aiohttp.ClientSession() as session:
        async with session.get(avatar_url) as response:
            if response.status != 200:
                raise RuntimeError(f"Failed to fetch avatar: {response.status} {response.reason}")
            avatar_buffer = await response.read()

    username = get_user_username(user)
    text_image_task = asyncio.create_task(build_text_image(username, width, height, offset_x, offset_y))
    template_task = asyncio.create_task(template_buffer_factory())
    avatar_image = pyvips.Image.new_from_buffer(avatar_buffer, "", access="sequential")
    avatar_image = resize_fill(avatar_image, width, height)
    avatar_image = ensure_rgba(avatar_image)
    text_image, template_buffer = await asyncio.gather(text_image_task, template_task)

    final_box = avatar_image.composite2(text_image, "over")
    template_image = pyvips.Image.new_from_buffer(template_buffer, "", access="sequential")
    template_image = ensure_rgba(template_image)
    final_image = template_image.insert(final_box, 314, 441, expand=False)
    return final_image.pngsave_buffer()


async def generate_welcome_image(user) -> bytes:
    return await generate_member_image(user, get_template_buffer)


async def generate_bye_image(user) -> bytes:
    return await generate_member_image(user, get_bye_template_buffer)


@dataclass
class FallbackUser:
    username: str

    @property
    def name(self) -> str:
        return self.username

    @property
    def global_name(self) -> str:
        return self.username

    @property
    def tag(self) -> str:
        return self.username

    def display_avatar_url(self) -> str:
        char_code_sum = sum(ord(char) for char in self.username)
        avatar_index = char_code_sum % DISCORD_DEFAULT_AVATAR_OPTIONS
        return f"https://cdn.discordapp.com/embed/avatars/{avatar_index}.png"


def build_bye_dedupe_key(guild_id: int, username: str) -> str:
    return f"{guild_id}:{username.lower().strip()}"


def should_send_bye_for_key(key: str) -> bool:
    now = int(time.time() * 1000)
    previous = recent_bye_keys.get(key)
    recent_bye_keys[key] = now

    stale_keys = [candidate for candidate, timestamp in recent_bye_keys.items() if now - timestamp > DEDUPE_WINDOW_MS]
    for candidate in stale_keys:
        recent_bye_keys.pop(candidate, None)

    while len(recent_bye_keys) > DEDUPE_CACHE_SIZE:
        oldest_key = next(iter(recent_bye_keys))
        recent_bye_keys.pop(oldest_key, None)

    return previous is None or now - previous > DEDUPE_WINDOW_MS


def parse_channel_id() -> Optional[int]:
    channel_id_raw = os.getenv("CHANNEL_ID")
    if not channel_id_raw:
        return None
    try:
        return int(channel_id_raw)
    except ValueError:
        return None


async def send_bye_image_to_configured_channel(guild: discord.Guild, user, source_label: str) -> None:
    channel_id = parse_channel_id()
    if not channel_id:
        print(f"[{source_label}] CHANNEL_ID is not set, skipping bye")
        return

    dedupe_key = build_bye_dedupe_key(guild.id, get_user_username(user))
    if not should_send_bye_for_key(dedupe_key):
        print(f"[{source_label}] duplicate bye detected for {get_user_username(user)}, skipping")
        return

    final_image = await generate_bye_image(user)
    attachment = discord.File(io.BytesIO(final_image), filename="bye.png")

    channel = guild.get_channel(channel_id)
    if channel is None:
        try:
            channel = await guild.fetch_channel(channel_id)
        except Exception as err:
            print(f"[{source_label}] failed to fetch channel {channel_id}: {err}")
            return

    if not channel or not hasattr(channel, "send"):
        print(f"[{source_label}] channel {channel_id} not found or not sendable, skipping bye")
        return

    await channel.send(file=attachment)
    print(f"[{source_label}] bye image sent for {get_user_tag(user)}")


def parse_dyno_leave_username(content: Optional[str]) -> Optional[str]:
    if not content or not isinstance(content, str):
        return None
    trimmed_content = content.strip()
    lowered = trimmed_content.lower()
    if not lowered.endswith(DYNO_LEAVE_SUFFIX_LOWER):
        return None

    username = trimmed_content[: len(trimmed_content) - len(DYNO_LEAVE_SUFFIX_LOWER)].strip()
    return username or None


def create_fallback_user_from_username(username: str) -> FallbackUser:
    return FallbackUser(username=username)


def find_matching_user_for_leave_message(username: str, users) -> object:
    normalized = username.lower()
    for user in users:
        lower_username = (getattr(user, "name", None) or "").lower()
        if lower_username == normalized:
            return user

        lower_global_name = (getattr(user, "global_name", None) or "").lower()
        if lower_global_name == normalized:
            return user

    return create_fallback_user_from_username(username)


print("========================================")
print("  sharkinpark bot starting up")
print(f"  {time.strftime('%Y-%m-%dT%H:%M:%S%z')}")
print(f"  Python {sys.version.split()[0]}  PID {os.getpid()}")
print("========================================")
print("[env] TOKEN     :", "✅ set" if os.getenv("TOKEN") else "❌ MISSING")
print("[env] CHANNEL_ID:", "✅ set" if os.getenv("CHANNEL_ID") else "❌ MISSING")
print("[env] DYNO_FALLBACK:", "✅ enabled" if IS_DYNO_FALLBACK_ENABLED else "⏸️ disabled")
if IS_DYNO_FALLBACK_ENABLED:
    dyno_bot_display = os.getenv("DYNO_BOT_ID") or f"⚠️ using default ({DEFAULT_DYNO_BOT_ID})"
    if os.getenv("DYNO_BOT_ID"):
        dyno_bot_display = "✅ set"
    print("[env] DYNO_BOT_ID:", dyno_bot_display)

assert_arial_black_available_on_linux()
start_health_server()

print("[discord] creating client...")
intents = discord.Intents.none()
intents.guilds = True
intents.members = True
if IS_DYNO_FALLBACK_ENABLED:
    intents.messages = True
    intents.message_content = True

client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)
print("[discord] client created, logging in...")


async def register_commands() -> None:
    await tree.sync()
    print("[discord] synced global slash commands")


@tree.command(name="wel", description="Generate a welcome image for a user")
@app_commands.describe(user="User to generate a welcome image for")
async def wel(interaction: discord.Interaction, user: discord.User) -> None:
    command_label = "/wel"
    print(f"[{command_label}] requested by {interaction.user}, target userId: {user.id}")
    try:
        await interaction.response.defer()
        print(f"[{command_label}] generating image for {user}")
        final_image = await generate_welcome_image(user)
        attachment = discord.File(io.BytesIO(final_image), filename="welcome.png")
        await interaction.edit_original_response(attachments=[attachment])
        print(f"[{command_label}] image sent for {user}")
    except Exception as err:
        print(f"❌ Error in {command_label} command: {err}")
        if interaction.response.is_done():
            await interaction.edit_original_response(content="Failed, please try again.")
        else:
            await interaction.response.send_message("Failed, please try again.", ephemeral=True)


@tree.command(name="bye", description="Generate a goodbye image for a user")
@app_commands.describe(user="User to generate a goodbye image for")
async def bye(interaction: discord.Interaction, user: discord.User) -> None:
    command_label = "/bye"
    print(f"[{command_label}] requested by {interaction.user}, target userId: {user.id}")
    try:
        await interaction.response.defer()
        print(f"[{command_label}] generating image for {user}")
        final_image = await generate_bye_image(user)
        attachment = discord.File(io.BytesIO(final_image), filename="bye.png")
        await interaction.edit_original_response(attachments=[attachment])
        print(f"[{command_label}] image sent for {user}")
    except Exception as err:
        print(f"❌ Error in {command_label} command: {err}")
        if interaction.response.is_done():
            await interaction.edit_original_response(content="Failed, please try again.")
        else:
            await interaction.response.send_message("Failed, please try again.", ephemeral=True)


@client.event
async def on_ready() -> None:
    global commands_synced
    print("========================================")
    print(f"[discord] ✅ logged in as: {client.user}")
    print(f"[discord] 📊 servers: {len(client.guilds)}")
    print("[discord] bot is ONLINE and ready")
    print("========================================")

    if not commands_synced:
        try:
            await register_commands()
            commands_synced = True
        except Exception as err:
            print(f"[discord] failed to register slash commands: {err}")


@client.event
async def on_member_join(member: discord.Member) -> None:
    print(f"[join] {member} joined {member.guild.name}")
    try:
        final_image = await generate_welcome_image(member)
        attachment = discord.File(io.BytesIO(final_image), filename="welcome.png")
        channel_id = parse_channel_id()
        if not channel_id:
            print(f"[join] channel {os.getenv('CHANNEL_ID')} not found, skipping welcome")
            return

        channel = member.guild.get_channel(channel_id)
        if channel:
            await channel.send(file=attachment)
            print(f"[join] welcome image sent for {member}")
        else:
            print(f"[join] channel {channel_id} not found, skipping welcome")
    except Exception as err:
        print(f"[join] error generating welcome image: {err}")


@client.event
async def on_member_remove(member: discord.Member) -> None:
    user = member
    if not getattr(user, "name", None):
        try:
            user = await client.fetch_user(member.id)
        except Exception as err:
            print(f"[leave] failed to fetch leaving user {member.id}: {err}")
            return

    print(f"[leave] {user} left {member.guild.name}")
    try:
        await send_bye_image_to_configured_channel(member.guild, user, "leave")
    except Exception as err:
        print(f"[leave] error generating bye image: {err}")


@client.event
async def on_message(message: discord.Message) -> None:
    if not IS_DYNO_FALLBACK_ENABLED:
        return
    dyno_bot_id = os.getenv("DYNO_BOT_ID") or DEFAULT_DYNO_BOT_ID
    if not message.guild or not message.author or str(message.author.id) != str(dyno_bot_id):
        return

    leaving_username = parse_dyno_leave_username(message.content)
    if not leaving_username:
        return

    user = find_matching_user_for_leave_message(leaving_username, client.users)
    print(f"[dyno-leave] detected leave message for {leaving_username}")
    try:
        await send_bye_image_to_configured_channel(message.guild, user, "dyno-leave")
    except Exception as err:
        print(f"[dyno-leave] error generating bye image: {err}")


def handle_unhandled_exception(loop, context) -> None:
    print(f"Unhandled rejection: {context}")


def main() -> None:
    loop = asyncio.get_event_loop()
    loop.set_exception_handler(handle_unhandled_exception)
    token = os.getenv("TOKEN")
    try:
        client.run(token, log_handler=None)
    except Exception as err:
        print(f"Failed to login: {err}")
        raise SystemExit(1) from err


if __name__ == "__main__":
    main()
