# ── Build stage ──────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1

COPY DiscordBot.csproj .
RUN --mount=type=cache,target=/root/.nuget/packages \
    dotnet restore

COPY . .
RUN --mount=type=cache,target=/root/.nuget/packages \
    dotnet publish -c Release -o /app --no-restore

# ── Runtime stage ────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

RUN groupadd -r bot && useradd -r -g bot -d /app -s /sbin/nologin bot \
    && mkdir -p /data && chown bot:bot /data

COPY --from=build --chown=bot:bot /app .
COPY --chown=bot:bot --chmod=755 entrypoint.sh /entrypoint.sh

USER bot
ENTRYPOINT ["/entrypoint.sh"]
