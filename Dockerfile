FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY DiscordBot.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app .
COPY entrypoint.sh /entrypoint.sh
RUN mkdir -p /data && chown -R app:app /data && chmod +x /entrypoint.sh
USER app
ENTRYPOINT ["/entrypoint.sh"]
