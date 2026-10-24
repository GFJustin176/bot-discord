# Bot de Música Pessoal para Discord (Low-Jitter & 25.000 Músicas)

Bot de música para Discord projetado para uso pessoal, com suporte a **YouTube**, **YouTube Music** e **Spotify** (faixas, álbuns e playlists de até **25.000 músicas**).

## Diferenciais de Arquitetura

1. **Pré-Buffer 100% em Memória RAM ($N$ e $N+1$) — Zero Escrita em Disco:**
   - Carrega a música atual ($N$) e pré-carrega a próxima ($N+1$) diretamente em `Buffer` na memória RAM, descartando a faixa anterior assim que termina.
   - Evita *throttling* de rede HTTP ao vivo (que causa variação de velocidade e cortes no buffer WebRTC do Discord) e não gera desgaste em SSD/HD.
2. **Demux Direto de WebM/Opus (Zero `ffmpeg` em 99% das faixas):**
   - Como o formato `251` do YouTube / YouTube Music já entrega pacotes **Opus 48kHz estéreo** em container WebM, o bot repassa os pacotes diretamente da RAM (`StreamType.WebmOpus`) para o Discord sem abrir o processo `ffmpeg` e sem recodificar áudio.
3. **Fila Circular $O(1)$ para 25.000 Músicas + Ingestão em Stream:**
   - Ao adicionar uma playlist gigante, a 1ª música começa a tocar em segundos enquanto o restante entra na fila em segundo plano.
   - Avanço de música em tempo constante $O(1)$ e embaralhamento (*shuffle*) Fisher-Yates de 25.000 músicas em `< 10 ms`.
4. **Spotify Híbrido + *Lazy Resolution*:**
   - Aceita `SPOTIFY_CLIENT_ID` e `SPOTIFY_CLIENT_SECRET` gratuitos para paginar playlists gigantes pela API oficial, com fallback automático via *embed* público quando as chaves não estão preenchidas.
5. **Comandos Duplos (Slash + Prefixo) e Auto-Leave Estrito:**
   - Suporta `/play`, `/skip`, `/stop`, `/pause`, `/resume`, `/queue`, `/shuffle`, `/loop`, `/np`, `/clear` e também comandos por prefixo no chat (`!play`, `!p`, `!skip`, `!s`, `!fila`, etc.).
   - Sai do canal de voz automaticamente **somente** quando não restar nenhum usuário humano na chamada.

---

## Como Configurar e Rodar

1. Copie o arquivo `.env.example` para `.env`:
   ```powershell
   Copy-Item .env.example .env
   ```
2. Preencha no arquivo `.env`:
   - `DISCORD_TOKEN`: Token do seu bot no [Discord Developer Portal](https://discord.com/developers/applications) (ative a opção **Message Content Intent** na aba *Bot* do painel do Discord para que os comandos por prefixo `!play` funcionem).
   - `DISCORD_CLIENT_ID`: Application ID do seu bot.
   - `DISCORD_GUILD_ID` *(opcional)*: ID do seu servidor pessoal para que os Slash Commands (`/play`) apareçam instantaneamente.
   - `SPOTIFY_CLIENT_ID` e `SPOTIFY_CLIENT_SECRET` *(opcional)*: Credenciais gratuitas criadas em [developer.spotify.com](https://developer.spotify.com/dashboard) para carregar playlists do Spotify acima de 100 músicas.
3. Inicie o bot:
   ```powershell
   # Modo desenvolvimento
   npm run dev

   # Ou compilado para produção
   npm run build
   npm start
   ```

