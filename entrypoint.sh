#!/bin/sh
chown -R bot:bot /data
exec su -s /bin/sh bot -c "cd /app && exec dotnet DiscordBot.dll"
