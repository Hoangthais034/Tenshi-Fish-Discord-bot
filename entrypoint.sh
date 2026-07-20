#!/bin/sh
chown app:app /data 2>/dev/null || true
exec dotnet DiscordBot.dll
