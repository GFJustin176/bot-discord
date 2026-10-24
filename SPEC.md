# Spec: Discord Personal Music Bot (High-Capacity & Low-Jitter Audio Engine)

## Objective

Construir um bot de música pessoal para Discord, dimensionado para operação local (ou futura VPS gratuita) em servidores pequenos (1 a 3 usuários), capaz de reproduzir faixas avulsas, álbuns e playlists do **YouTube**, **YouTube Music** e **Spotify** com suporte a filas de até **25.000 músicas**.

O sistema prioriza duas propriedades críticas de engenharia:
1. **Estabilidade absoluta de reprodução de áudio (Zero Speed-Jitter / Zero Cutouts / Zero Disk I/O):** Eliminação de variações de velocidade (efeito *rubber-banding* do buffer WebRTC do Discord causado por oscilação de rede HTTP) e de cortes de áudio por meio de **pré-buffering em memória RAM (faixas $N$ e $N+1$)**, **demux direto de pacotes WebM/Opus em memória sem abrir o `ffmpeg` no formato `251`** e **isolamento do loop de envio de pacotes RTP/UDP**.
2. **Escalabilidade de fila com resolução tardia (*Lazy Resolution* + *Streaming Ingestion*):** Capacidade de enfileirar até 25.000 faixas consumindo menos de 15 MB de memória adicional para a fila, iniciando a reprodução da primeira faixa em segundos enquanto o restante da playlist é ingerido em segundo plano, e resolvendo o stream real de áudio apenas para a faixa atual ($N$) e a próxima faixa ($N+1$).

## Tech Stack

- **Runtime:** Node.js `v24.19.0` (LTS) com TypeScript `^5.8.0` (ESM, `strict: true`)
- **Discord Gateway & Voice:**
  - `discord.js` `^14.18.0` — Interação com Gateway e Slash Commands
  - `@discordjs/voice` `^0.18.0` — Conexão de voz UDP/RTP e controle de estado do player
  - `@snazzah/davey` `^0.1.0` — Implementação do protocolo DAVE (E2EE de voz do Discord)
  - `prism-media` `^1.3.5` + `@discordjs/opus` `^0.10.0` (ou `mediaplex`) — Demux de WebM/Ogg Opus e fallback de codificação nativa
- **Extração de Mídia e Metadados:**
  - `yt-dlp` (`2026.08.18+`, binário nativo no sistema) — Extração de streams do YouTube / YouTube Music e ingestão em streaming (`--flat-playlist --dump-json`)
  - `ffmpeg` (binário nativo no sistema) — Remux/transcodificação assíncrona com buffer local
  - API Web do Spotify (`Client Credentials Flow` via `undici` nativo + fallback de *embed/anonymous token*) — Paginação rápida de playlists e álbuns do Spotify (lotes de 100 faixas) sem necessidade de conta Spotify Premium
- **Qualidade, Testes e Ferramental:**
  - Test Runner: `vitest` `^3.0.0`
  - Linter / Formatter: `@biomejs/biome` `^1.9.0`
  - Execução em Desenvolvimento: `tsx` `^4.19.0`

## Commands

```bash
# Instalação de dependências
npm install

# Desenvolvimento (com recarregamento automático)
npm run dev

# Compilação TypeScript (verificação de tipos + build para dist/)
npm run build

# Execução em produção (após build)
npm run start

# Registro dos Slash Commands no servidor Discord de desenvolvimento
npm run deploy:commands

# Execução da suíte de testes unitários e de integração
npm test -- --run

# Execução de testes com relatório de cobertura
npm run test:coverage

# Verificação e correção de formatação/lint
npm run lint
npm run lint:fix
```

## Project Structure

```text
bot-discord/
├── src/
│   ├── index.ts                  → Ponto de entrada, inicialização do cliente Discord e encerramento gracioso
│   ├── config/
│   │   └── env.ts                → Validação estrita de variáveis de ambiente, prefixo e caminhos de binários (ffmpeg, yt-dlp)
│   ├── bot/
│   │   ├── client.ts             → Configuração do Client (Intents: Guilds, GuildVoiceStates, GuildMessages, MessageContent)
│   │   ├── command-context.ts    → Abstração unificada para responder tanto a Slash Commands quanto a mensagens com prefixo
│   │   ├── deploy-commands.ts    → Script de registro de Slash Commands na API do Discord
│   │   ├── commands/             → Handlers compartilhados (/play e !play, skip, stop, queue, shuffle, loop, np, clear)
│   │   └── events/               → Listeners (interactionCreate, messageCreate, voiceStateUpdate, clientReady)
│   ├── queue/
│   │   ├── track.ts              → Definição enxuta de CompactTrack (metadados leves de baixo consumo de RAM)
│   │   ├── ring-queue.ts         → Fila indexada O(1) para dequeue, Fisher-Yates shuffle O(n) e limite de 25.000 itens
│   │   └── guild-session.ts      → Orquestrador por servidor (conecta fila, pre-fetcher, resolver e player de voz)
│   ├── resolvers/
│   │   ├── url-classifier.ts     → Identificação de URLs/queries (YouTube, YT Music, Spotify Track/Album/Playlist, busca textual)
│   │   ├── youtube-resolver.ts   → Ingestão via yt-dlp (--flat-playlist em stream NDJSON) e resolução de URL de áudio (formato 251 WebM/Opus)
│   │   └── spotify-resolver.ts   → Paginação da API do Spotify em background e conversão lazy (Artista + Título + ISRC → YT Music/YouTube)
│   ├── audio/
│   │   ├── prebuffer-cache.ts    → Pré-buffering 100% em memória RAM para as faixas N e N+1 (zero escrita em SSD/disco)
│   │   ├── stream-pipeline.ts    → Demux WebM/Opus direto da RAM (sem abrir ffmpeg no formato 251; ffmpeg apenas como fallback)
│   │   └── voice-manager.ts      → Gerenciamento de VoiceConnection, reconexão automática e prevenção de deriva de clock
│   └── utils/
│       ├── logger.ts             → Logger estruturado de baixo overhead
│       └── process-runner.ts     → Gerenciamento seguro de subprocessos (yt-dlp / ffmpeg) com AbortSignal e limpeza de órfãos
├── tests/
│   ├── unit/
│   │   ├── ring-queue.test.ts    → Testes de capacidade (25.000 itens), complexidade O(1) e shuffle
│   │   ├── url-classifier.test.ts→ Testes de detecção de links Spotify, YouTube e YouTube Music
│   │   └── spotify-matcher.test.ts → Testes de montagem de query de correspondência (ISRC / duração / título)
│   └── integration/
│       ├── prebuffer-cache.test.ts → Testes do ciclo de vida do buffer em disco e limpeza automática
│       └── youtube-stream.test.ts  → Testes de leitura de NDJSON em stream para grandes playlists
├── tmp/
│   └── audio-cache/              → Diretório temporário para pré-buffering das faixas N e N+1 (ignorado no Git)
├── SPEC.md                       → Especificação técnica do projeto (este documento)
├── .env.example                  → Modelo de variáveis de ambiente
├── biome.json                    → Configuração de lint e formatação
├── tsconfig.json                 → Configuração do compilador TypeScript
└── package.json                  → Manifesto de pacotes e scripts
```

## Code Style

- **Idioma de Comentários e Mensagens:** Comentários técnicos e mensagens voltadas ao usuário exclusivamente em Português do Brasil (pt-BR), adotando tom impessoal, objetivo e direto.
- **Convenções de Nomenclatura:**
  - Arquivos: `kebab-case.ts`
  - Classes, Interfaces e Tipos: `PascalCase`
  - Funções, Métodos e Variáveis: `camelCase`
  - Constantes Globais: `UPPER_SNAKE_CASE`
- **Tipagem e Tratamento de Erros:** Proibido o uso de `any`. Operações externas (`yt-dlp`, `ffmpeg`, chamadas HTTP ao Spotify) devem sempre aceitar `AbortSignal` para cancelamento imediato ao pular de faixa (`/skip`) ou limpar a fila (`/stop`).

```typescript
// Representação compacta de uma faixa na fila para suportar 25.000 itens com < 5 MB de RAM.
export interface CompactTrack {
  readonly id: string;
  readonly source: 'youtube' | 'ytmusic' | 'spotify';
  readonly title: string;
  readonly artist: string;
  readonly durationMs: number;
  // Para YouTube/YTM contém o videoId; para Spotify contém a query otimizada para resolução tardia.
  readonly locator: string;
  // Preenchido apenas no instante da reprodução ou pré-carregamento (faixa N e N+1).
  resolvedFilePath?: string;
}

/**
 * Fila circular baseada em ponteiro lógico para garantir remoção O(1)
 * sem realocação de memória em listas de até 25.000 faixas.
 */
export class TrackQueue {
  private readonly maxCapacity: number;
  private items: CompactTrack[] = [];
  private head = 0;

  constructor(maxCapacity = 25_000) {
    this.maxCapacity = maxCapacity;
  }

  public get size(): number {
    return this.items.length - this.head;
  }

  public enqueueBatch(tracks: readonly CompactTrack[]): number {
    const available = this.maxCapacity - this.size;
    if (available <= 0) return 0;

    const slice = tracks.length > available ? tracks.slice(0, available) : tracks;
    this.items.push(...slice);
    return slice.length;
  }

  public dequeue(): CompactTrack | undefined {
    if (this.size === 0) return undefined;
    const track = this.items[this.head];
    this.head += 1;

    // Compacta o array subjacente apenas quando o espaço ocioso ultrapassa 2.048 posições.
    if (this.head >= 2048 && this.head * 2 >= this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    return track;
  }
}
```

## Testing Strategy

- **Framework:** `vitest` (execução rápida compatível com ESM e TypeScript nativo).
- **Localização:** `tests/unit/` para lógica pura e `tests/integration/` para pipelines de processo e sistema de arquivos.
- **Níveis de Teste e Expectativa de Cobertura:**
  - **Unitários (meta $\ge 90\%$ de cobertura nos módulos `queue/` e `resolvers/url-classifier`):**
    - Inserção, remoção $O(1)$, paginação e *shuffle* de 25.000 itens na `TrackQueue` validando tempo de execução ($< 10\text{ ms}$) e ausência de vazamento de referências.
    - Classificação de URLs (links curtos `youtu.be`, `music.youtube.com`, `open.spotify.com/track|playlist|album`, links internacionalizados `/intl-pt/`).
  - **Integração:**
    - Parser de stream NDJSON simulando saída do `yt-dlp --flat-playlist` com milhares de linhas e cancelamento via `AbortController`.
    - Gerenciador de `PrebufferCache` garantindo que apenas os arquivos das faixas $N$ e $N+1$ permaneçam em `tmp/audio-cache/` e que arquivos antigos sejam removidos imediatamente após a transição de faixa.

## Boundaries

- **Always do (Sempre fazer):**
  - Validar todas as entradas de comandos do Discord e sanitizar argumentos antes de passá-los via array de argumentos (`spawn(bin, args)`, nunca via shell interpolado `shell: true`) ao `yt-dlp` e `ffmpeg`.
  - Encerrar subprocessos (`yt-dlp` e `ffmpeg`) e limpar arquivos temporários em `tmp/audio-cache/` ao pular música, parar reprodução ou desconectar do canal de voz.
  - Utilizar resolução *lazy* (sob demanda) para faixas do Spotify e listas grandes do YouTube.
  - Executar testes e verificação de tipos (`npm run build && npm test -- --run`) antes de concluir qualquer etapa de implementação.
- **Ask first (Perguntar antes):**
  - Adicionar banco de dados persistente (ex.: SQLite/PostgreSQL) caso deseje salvar filas ou favoritos entre reinicializações do bot.
  - Adicionar novas dependências externas fora do escopo de áudio/Discord definido nesta especificação.
  - Alterar o limite máximo de 25.000 faixas ou a política de retenção de cache em disco.
- **Never do (Nunca fazer):**
  - Resolver ou baixar streams de áudio de todas as músicas da playlist simultaneamente (causa bloqueio imediato de IP e esgotamento de RAM/disco).
  - Utilizar `Array.prototype.shift()` diretamente em arrays de dezenas de milhares de itens no loop principal.
  - Versionar tokens (`.env`), cookies de autenticação ou arquivos de áudio temporários no Git.
  - Executar comandos de shell concatenando strings fornecidas pelo usuário (risco de Command Injection).

## Success Criteria

1. **Capacidade e Performance da Fila:** Enfileirar, paginar e embaralhar (*shuffle*) 25.000 faixas na `TrackQueue` deve consumir `< 15 MB` de RAM adicional na heap V8 e concluir operações de `dequeue` em $O(1)$ e `shuffle` de 25.000 itens em `< 10 ms`.
2. **Tempo até o Primeiro Áudio (Time-to-First-Audio em Playlists Grandes):** Ao adicionar uma playlist de 1.000 a 25.000 músicas, a primeira faixa deve ser extraída e iniciar a reprodução sem aguardar o término da leitura de toda a playlist (ingestão assíncrona progressiva em background).
3. **Estabilidade de Reprodução (Zero Oscilação de Velocidade / Cortes / Zero Escrita em Disco):**
   - A reprodução não deve realizar streaming HTTP direto para o encoder em tempo real sem amortecimento; o áudio da faixa atual ($N$) e da próxima ($N+1$) deve ser pré-carregado diretamente em `Buffer` na memória RAM (`PrebufferCache`, com teto de segurança configurável por faixa), eliminando escritas em SSD/disco.
   - Sempre que o stream de origem do YouTube/YouTube Music estiver no formato WebM/Opus 48kHz estéreo (formato `251`), o pipeline deve fazer o *demux* direto dos pacotes Opus a partir da RAM (`StreamType.WebmOpus`) **sem invocar o processo `ffmpeg`**, usando `ffmpeg` apenas como fallback para containers não-WebM/Opus.
4. **Suporte Multi-Plataforma e Comandos Duplos:** Os comandos devem funcionar tanto via **Slash Commands** (`/play`, `/skip`, `/stop`, `/queue`, `/shuffle`, `/loop`, `/np`, `/clear`) quanto por **prefixo de mensagem no chat** (ex.: `!play`, `!skip`), aceitando URLs de faixas, álbuns e playlists do **Spotify** (modo híbrido: API Client Credentials + fallback embed/anônimo), **YouTube** e **YouTube Music**, além de buscas por texto livre.
5. **Política Estrita de Permanência em Voz:** O bot **não** deve desconectar quando a fila terminar se ainda houver usuários no canal de voz; a desconexão automática deve ocorrer **somente** quando o canal de voz ficar vazio (sem membros humanos), ou mediante comando explícito (`stop`).
6. **Prevenção de Vazamento de Recursos:** Após 50 trocas de faixa (`skip`) ou término da fila, não deve haver processos `ffmpeg`/`yt-dlp` órfãos em execução nem acúmulo de mais de 2 arquivos temporários por servidor em `tmp/audio-cache/`.

## Open Questions (Resolvidas)

1. **Credenciais do Spotify:** **Resolvido** — Configurado suporte híbrido (`SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` via Client Credentials para paginação oficial de grandes playlists, com fallback automático via embed/token anônimo caso as chaves não estejam definidas).
2. **Interação no Discord:** **Resolvido** — Suporte simultâneo a **Slash Commands** (`/play`) e comandos por **prefixo no chat** (`!play`, configurável via `COMMAND_PREFIX`).
3. **Comportamento de Desconexão Automática:** **Resolvido** — Desconectar automaticamente **somente** quando o canal de voz ficar vazio (sem membros humanos).

