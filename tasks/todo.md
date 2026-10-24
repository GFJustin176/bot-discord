# Task Breakdown: Discord Personal Music Bot

## Task 1: Configuração Base do Projeto, Tipagem e Validação de Ambiente

**Description:** Inicializa a estrutura do projeto Node.js 24 + TypeScript (ESM), configura scripts de build, execução, lint (`@biomejs/biome`) e testes (`vitest`), define o modelo `.env.example` e implementa o validador de variáveis de ambiente e caminhos dos binários (`ffmpeg` e `yt-dlp`).

**Acceptance criteria:**
- [x] `package.json`, `tsconfig.json` e `biome.json` configurados com suporte a TypeScript estrito (`strict: true`, sem `any`) e módulos ESM.
- [x] `src/config/env.ts` valida variáveis obrigatórias (`DISCORD_TOKEN`, `DISCORD_CLIENT_ID`), variáveis opcionais com padrão (`COMMAND_PREFIX=!`, `MAX_QUEUE_SIZE=25000`), credenciais híbridas opcionais (`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`) e resolve automaticamente os caminhos de `ffmpeg` e `yt-dlp`.
- [x] `.gitignore` e `.env.example` criados impedindo versionamento de segredos e do diretório `tmp/audio-cache/`.

**Verification:**
- [x] Tests pass: `npm test -- --run`
- [x] Build succeeds: `npm run build`
- [x] Manual check: Verificar detecção automática dos binários `ffmpeg` e `yt-dlp` instalados na máquina.

**Dependencies:** None

**Files likely touched:**
- `package.json`
- `tsconfig.json`
- `biome.json`
- `.env.example`
- `src/config/env.ts`

**Estimated scope:** Medium: 3-5 files

---

## Task 2: Executor Seguro de Subprocessos e Fila Circular de 25.000 Músicas

**Description:** Implementa o modelo compacto de faixa (`CompactTrack`), a fila indexada `TrackQueue` com capacidade para 25.000 músicas, `dequeue` em $O(1)$ e embaralhamento Fisher-Yates em $O(n)$, além do gerenciador de subprocessos (`process-runner.ts`) com suporte a `AbortSignal` e limpeza garantida de processos filhos.

**Acceptance criteria:**
- [x] `TrackQueue` suporta até 25.000 itens, realiza `dequeue()` em tempo constante $O(1)$ via ponteiro lógico com compactação periódica, suporta modos de repetição (`off`, `track`, `queue`) e executa `shuffle()` de 25.000 itens em `< 10 ms`.
- [x] `process-runner.ts` executa binários externos usando `spawn(bin, args, { shell: false })`, suporta leitura linha a linha (NDJSON) de `stdout` e encerra imediatamente o processo ao disparar `AbortSignal`.
- [x] Testes unitários validam limite de 25.000 faixas, integridade do *shuffle*, paginação e performance.

**Verification:**
- [x] Tests pass: `npx vitest run tests/unit/ring-queue.test.ts`
- [x] Build succeeds: `npm run build`
- [x] Manual check: Confirmar tempo de execução do teste de 25.000 faixas em `< 25 ms`.

**Dependencies:** Task 1

**Files likely touched:**
- `src/utils/logger.ts`
- `src/utils/process-runner.ts`
- `src/queue/track.ts`
- `src/queue/ring-queue.ts`
- `tests/unit/ring-queue.test.ts`

**Estimated scope:** Medium: 3-5 files

---

## Checkpoint: After Tasks 1-2
- [x] All tests pass (`npm test -- --run`)
- [x] Application builds without errors (`npm run build`)
- [x] Fila de 25.000 músicas validada em memória e performance

---

## Task 3: Classificador de URLs e Resolver YouTube / YouTube Music em Stream NDJSON

**Description:** Implementa a identificação precisa de links/buscas (YouTube, YouTube Music, Spotify Track/Album/Playlist e texto livre) e o resolver do YouTube / YouTube Music via `yt-dlp`, utilizando `--flat-playlist --dump-json` em stream para liberar a primeira música imediatamente enquanto playlists de até 25.000 itens são lidas em segundo plano.

**Acceptance criteria:**
- [x] `url-classifier.ts` distingue corretamente URLs de vídeo/playlist do YouTube, faixas/playlists do YouTube Music (`music.youtube.com`), URLs do Spotify (incluindo rotas `/intl-pt/`) e queries de texto livre.
- [x] `youtube-resolver.ts` resolve a primeira faixa prioritariamente e emite lotes assíncronos (`AsyncGenerator<CompactTrack[]>`) para o restante da playlist até o limite de 25.000 músicas.
- [x] Testes cobrem todos os formatos de URL e o parser de stream NDJSON com cancelamento no meio da leitura.

**Verification:**
- [x] Tests pass: `npx vitest run tests/unit/url-classifier.test.ts tests/integration/youtube-stream.test.ts`
- [x] Build succeeds: `npm run build`
- [x] Manual check: Validar que URLs com parâmetros extras (`&list=`, `?si=`) são classificadas corretamente.

**Dependencies:** Task 2

**Files likely touched:**
- `src/resolvers/url-classifier.ts`
- `src/resolvers/youtube-resolver.ts`
- `tests/unit/url-classifier.test.ts`
- `tests/integration/youtube-stream.test.ts`

**Estimated scope:** Medium: 3-5 files

---

## Task 4: Resolver Híbrido do Spotify (API Client Credentials + Fallback sem Chaves)

**Description:** Implementa a extração de metadados de faixas, álbuns e playlists do Spotify em modo híbrido (usando a API Web oficial do Spotify com paginação de 100 itens quando `SPOTIFY_CLIENT_ID` e `SPOTIFY_CLIENT_SECRET` estão configurados, e fallback automático via *embed/anonymous token* quando ausentes), gerando itens `CompactTrack` para resolução *lazy* no YouTube Music / YouTube.

**Acceptance criteria:**
- [x] Quando as credenciais do Spotify estão configuradas, pagina playlists de até 25.000 faixas via API oficial com renovação automática de token.
- [x] Quando as credenciais não estão configuradas, extrai metadados automaticamente via endpoint público/embed do Spotify sem interromper o funcionamento.
- [x] Gera o `locator` otimizado (`"Artista - Título"` com preferência por YouTube Music) sem consultar o YouTube antecipadamente para as faixas que ainda estão na fila.

**Verification:**
- [x] Tests pass: `npx vitest run tests/unit/spotify-matcher.test.ts`
- [x] Build succeeds: `npm run build`
- [x] Manual check: Verificar montagem do `CompactTrack` e fallback quando as chaves do Spotify estão vazias.

**Dependencies:** Task 2, Task 3

**Files likely touched:**
- `src/resolvers/spotify-resolver.ts`
- `tests/unit/spotify-matcher.test.ts`

**Estimated scope:** Small: 1-2 files

---

## Checkpoint: After Tasks 3-4
- [x] All tests pass (`npm test -- --run`)
- [x] Application builds without errors (`npm run build`)
- [x] Resolvers do YouTube, YouTube Music e Spotify (híbrido) validados

---

## Task 5: Motor de Áudio Anti-Jitter (Pré-Buffering em RAM N/N+1 e Demux WebM/Opus Direto)

**Description:** Implementa o cache de pré-buffering 100% em memória RAM (`prebuffer-cache.ts`) que baixa a faixa atual ($N$) e pré-carrega a próxima ($N+1$) diretamente em `Buffer` via `stdout` do `yt-dlp` (priorizando formato `251` WebM/Opus 48kHz, zero escrita em disco), o pipeline de áudio (`stream-pipeline.ts`) que lê do `Buffer` na RAM usando `StreamType.WebmOpus` sem abrir o `ffmpeg` (acionando `ffmpeg` apenas como fallback para formatos não-WebM/Opus), e o gerenciador de conexão de voz (`voice-manager.ts`).

**Acceptance criteria:**
- [x] `PrebufferCache` carrega os bytes do áudio diretamente em memória RAM (`Buffer`), resolve queries *lazy* do Spotify just-in-time no YouTube Music/YouTube e mantém no máximo os buffers das faixas $N$ e $N+1$ por servidor, liberando a memória imediatamente após a transição de faixa.
- [x] `stream-pipeline.ts` detecta o cabeçalho WebM/EBML (`0x1A 0x45 0xDF 0xA3`) no `Buffer` e entrega `StreamType.WebmOpus` diretamente da RAM sem criar subprocesso `ffmpeg`, usando `ffmpeg` apenas como fallback caso o container não seja WebM/Opus.
- [x] `voice-manager.ts` gerencia o ciclo de vida da `VoiceConnection` com reconexão automática em quedas transitórias de UDP/WebSocket.

**Verification:**
- [x] Tests pass: `npx vitest run tests/integration/prebuffer-cache.test.ts`
- [x] Build succeeds: `npm run build`
- [x] Manual check: Confirmar limpeza automática dos buffers em RAM após transição de faixa.

**Dependencies:** Task 2, Task 3, Task 4

**Files likely touched:**
- `src/audio/prebuffer-cache.ts`
- `src/audio/stream-pipeline.ts`
- `src/audio/voice-manager.ts`
- `tests/integration/prebuffer-cache.test.ts`

**Estimated scope:** Medium: 3-5 files

---

## Task 6: Orquestrador de Sessão por Servidor (`GuildSession`)

**Description:** Implementa a classe `GuildSession` que coordena a `TrackQueue`, a ingestão em background de playlists grandes, o disparo automático do pré-carregamento da faixa $N+1$ assim que a faixa $N$ inicia a reprodução, e as transições do `AudioPlayer` sem desconectar do canal quando a fila termina.

**Acceptance criteria:**
- [x] Ao iniciar a reprodução da faixa $N$, dispara em background o pré-carregamento da faixa $N+1$ no `PrebufferCache`.
- [x] Ao executar `skip()`, `stop()` ou `clear()`, cancela imediatamente qualquer download/ingestão pendente da faixa interrompida via `AbortController`.
- [x] Quando a fila chega ao fim (`AudioPlayerStatus.Idle`), o bot permanece conectado no canal de voz aguardando novas músicas.

**Verification:**
- [x] Tests pass: `npx vitest run tests/unit/guild-session.test.ts`
- [x] Build succeeds: `npm run build`
- [x] Manual check: Verificar que o término da fila não destrói a `VoiceConnection`.

**Dependencies:** Task 2, Task 5

**Files likely touched:**
- `src/queue/guild-session.ts`
- `tests/unit/guild-session.test.ts`

**Estimated scope:** Small: 1-2 files

---

## Checkpoint: After Tasks 5-6
- [x] All tests pass (`npm test -- --run`)
- [x] Application builds without errors (`npm run build`)
- [x] Pipeline de pré-buffering em RAM e orquestrador de sessão verificados

---

## Task 7: Abstração Híbrida de Comandos (Slash + Prefixo) e Handlers de Música

**Description:** Cria o adaptador `CommandContext` para unificar respostas a interações Slash (`/play`) e mensagens com prefixo (`!play`), e implementa todos os comandos de controle (`play`, `skip`, `stop`, `pause`, `resume`, `queue`, `shuffle`, `loop`, `np`, `clear`).

**Acceptance criteria:**
- [x] `CommandContext` abstrai `deferReply`, `reply`, extração de argumentos e validação do canal de voz do usuário tanto para `ChatInputCommandInteraction` quanto para `Message`.
- [x] Todos os comandos (`play`, `skip`, `stop`, `pause`, `resume`, `queue` paginado, `shuffle`, `loop`, `np`, `clear`) funcionam identicamente por `/comando` e por `!comando`.
- [x] O comando `queue` exibe a página solicitada, o total de músicas na fila (até 25.000) e indica caso uma playlist grande ainda esteja sendo carregada em segundo plano.

**Verification:**
- [x] Tests pass: `npx vitest run tests/unit/command-parser.test.ts`
- [x] Build succeeds: `npm run build`
- [x] Manual check: Verificar parsing de argumentos com espaços e URLs em comandos por prefixo (`!play <url ou busca>`).

**Dependencies:** Task 6

**Files likely touched:**
- `src/bot/command-context.ts`
- `src/bot/commands/index.ts`
- `src/bot/commands/playback-commands.ts`
- `src/bot/commands/queue-commands.ts`
- `tests/unit/command-parser.test.ts`

**Estimated scope:** Medium: 3-5 files

---

## Task 8: Cliente Discord, Auto-Leave em Canal Vazio e Ponto de Entrada

**Description:** Configura o cliente `discord.js` com os Intents necessários (`Guilds`, `GuildVoiceStates`, `GuildMessages`, `MessageContent`), implementa o roteador de eventos para Slash e Prefixo, o script `deploy-commands.ts`, o listener de `voiceStateUpdate` que desconecta automaticamente **somente** quando o canal de voz fica vazio (sem humanos), e o ponto de entrada `src/index.ts` com limpeza no encerramento.

**Acceptance criteria:**
- [x] `voice-state-update.ts` monitora o canal de voz do bot e encerra a sessão/conexão automática **somente** quando `channel.members.filter(m => !m.user.bot).size === 0` (ou se o próprio bot for desconectado manualmente).
- [x] `deploy-commands.ts` registra as definições dos Slash Commands na API do Discord.
- [x] `src/index.ts` inicializa o bot e captura `SIGINT`/`SIGTERM` para encerrar subprocessos ativos, desconectar chamadas de voz e liberar a RAM.

**Verification:**
- [x] Tests pass: `npm test -- --run`
- [x] Build succeeds: `npm run build`
- [x] Manual check: Validar inicialização completa e verificação de tipos sem avisos.

**Dependencies:** Task 7

**Files likely touched:**
- `src/bot/client.ts`
- `src/bot/deploy-commands.ts`
- `src/bot/events/voice-state-update.ts`
- `src/bot/events/command-router.ts`
- `src/index.ts`

**Estimated scope:** Medium: 3-5 files

---

## Checkpoint: After Tasks 7-8
- [x] All tests pass (`npm test -- --run`)
- [x] Typecheck and build pass (`npm run build`)
- [x] Core user flow works end-to-end (Slash + Prefix, 25k queue, Pre-buffering N/N+1 in RAM, Auto-leave only on empty voice channel)
- [x] Review with human
