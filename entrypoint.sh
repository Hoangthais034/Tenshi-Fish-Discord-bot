#!/bin/sh
chown -R app:app /data
exec su -s /bin/sh app -c "cd /app && exec dotnet DiscordBot.dll"
