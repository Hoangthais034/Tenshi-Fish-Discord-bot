FROM ghcr.io/lavalink-devs/lavalink:4

USER root
COPY download-plugins.sh /download-plugins.sh
RUN chmod +x /download-plugins.sh && /download-plugins.sh

USER lavalink
COPY application.yml /opt/Lavalink/application.yml
