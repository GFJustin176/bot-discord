# Implementation Plan: Discord Personal Music Bot

## Overview

Implementação de um bot de música pessoal para Discord em Node.js 24 e TypeScript, capaz de reproduzir faixas e playlists de até 25.000 músicas do YouTube, YouTube Music e Spotify (modo híbrido com e sem chaves de API). O projeto utiliza ingestão em streaming para início imediato de reprodução, fila circular em memória com operações $O(1)$, pré-buffering local das faixas $N$ e $N+1$ em disco para eliminar oscilações de velocidade (*rubber-banding* do WebRTC), passthrough de pacotes WebM/Opus, suporte simultâneo a Slash Commands (`/play`) e comandos por prefixo (`!play`), e desconexão automática restrita exclusivamente ao cenário de canal de voz vazio.

## Architecture Decisions

- **Fila Indexada por Ponteiro (`TrackQueue`):** Em vez de `Array.prototype.shift()` (que causa realocação $O(n)$ a cada faixa em listas de 25.000 itens), utiliza um ponteiro de leitura `head` com compactação preguiçosa a cada 2.048 itens consumidos, garantindo `dequeue` em $O(1)$ e consumo `< 5 MB` de RAM para 25.000 referências [`CompactTrack`](file:///d:/!!!_projetos/ws-vsCode/bot-discord/SPEC.md#L115-L125).
- **Ingestão Assíncrona Progressiva (Time-to-First-Audio $< 3\text{s}$):** Para playlists de milhares de itens, a primeira faixa é extraída e enviada imediatamente ao player, enquanto as demais faixas (até o teto de 25.000) continuam entrando na fila em background via leitura de stream NDJSON (`yt-dlp --flat-playlist`) ou paginação assíncrona do Spotify.
- **Resolução Híbrida do Spotify + *Lazy Matching*:** Quando `SPOTIFY_CLIENT_ID` e `SPOTIFY_CLIENT_SECRET` estão presentes no `.env`, utiliza o fluxo oficial *Client Credentials* para paginar playlists em lotes de 100 itens até 25.000 faixas; na ausência das chaves, recorre automaticamente à extração via *embed/anonymous token*. A busca do áudio equivalente no YouTube Music / YouTube só ocorre quando a faixa se torna a atual ($N$) ou a próxima ($N+1$).
- **Pré-Buffering Local ($N$ e $N+1$) + Passthrough WebM/Opus:** O `yt-dlp` baixa a faixa atual ($N$) e pré-carrega a próxima ($N+1$) em `tmp/audio-cache/`. O `ffmpeg` lê a partir do arquivo local (e não de um socket HTTP sujeito a *throttling*), enviando pacotes Opus (48kHz estéreo, formato `251` com `-c:a copy` sempre que compatível) em cadência constante para o `@discordjs/voice`.
- **Adaptador Unificado de Comandos (`CommandContext`):** Centraliza a execução dos comandos para que `/play` (Slash Command) e `!play` (mensagem com prefixo) compartilhem exatamente a mesma implementação.
- **Política Estrita de Desconexão (`voiceStateUpdate`):** O término da fila mantém o bot conectado no canal de voz; o encerramento automático da sessão ocorre única e exclusivamente quando o número de membros humanos no canal de voz chega a zero.

## Dependency Graph

```text
Configuração & Ambiente (src/config/env.ts)
    │
    ├── Utilitários de Subprocesso & Logger (src/utils/process-runner.ts, logger.ts)
    │       │
    │       ├── Classificador & Resolver YouTube/YTM (src/resolvers/url-classifier.ts, youtube-resolver.ts)
    │       │       │
    │       │       └── Resolver Híbrido Spotify (src/resolvers/spotify-resolver.ts)
    │       │
    │       └── Pré-Buffer Local & Pipeline Opus (src/audio/prebuffer-cache.ts, stream-pipeline.ts, voice-manager.ts)
    │               │
    ├── Fila O(1) de 25.000 Faixas (src/queue/track.ts, ring-queue.ts)
    │               │
    └───────────────┴── Orquestrador de Sessão (src/queue/guild-session.ts)
                                │
                                └── Contexto Híbrido & Comandos (src/bot/command-context.ts, commands/*)
                                        │
                                        └── Cliente Discord, Auto-Leave & Entrypoint (src/bot/client.ts, events/*, index.ts)
```

## Parallelization Opportunities

- **Sequencial (Caminho Crítico):** `Task 1` (Configuração/ Manifesto) → `Task 2` (Fila $O(1)$ + Runner de Processos) → `Task 6` (`GuildSession`) → `Task 7` (Comandos) → `Task 8` (Cliente Discord / Entrypoint).
- **Paralelizável após a `Task 2`:**
  - `Task 3` (Classificador de URLs + Resolver YouTube/YTM)
  - `Task 4` (Resolver Híbrido do Spotify)
  - `Task 5` (Pré-Buffer Local + Pipeline de Áudio Opus)

## Task List

A lista detalhada de tarefas com critérios de aceitação, comandos de verificação, dependências e arquivos afetados encontra-se registrada em [tasks/todo.md](file:///d:/!!!_projetos/ws-vsCode/bot-discord/tasks/todo.md).

### Phase 1: Foundation & High-Capacity Queue
- [x] Task 1: Configuração Base do Projeto, Tipagem e Validação de Ambiente
- [x] Task 2: Executor Seguro de Subprocessos e Fila Circular de 25.000 Músicas

### Checkpoint: Foundation
- [x] Build TypeScript compila sem erros (`npm run build`)
- [x] Testes unitários da fila de 25.000 itens passam com `dequeue` $O(1)$ e `shuffle` $< 10\text{ ms}$

### Phase 2: Multi-Platform Resolvers (YouTube, YT Music & Hybrid Spotify)
- [x] Task 3: Classificador de URLs e Resolver YouTube / YouTube Music em Stream NDJSON
- [x] Task 4: Resolver Híbrido do Spotify (API Client Credentials + Fallback sem Chaves)

### Checkpoint: Resolvers
- [x] Testes unitários e de integração dos resolvers passam (`npm test -- --run`)
- [x] Ingestão em stream respeita o teto de 25.000 faixas e cancelamento via `AbortSignal`

### Phase 3: Anti-Jitter Audio Engine & Guild Session
- [x] Task 5: Motor de Áudio Anti-Jitter (Pré-Buffering em RAM N/N+1 e Pipeline WebM/Opus)
- [x] Task 6: Orquestrador de Sessão por Servidor (`GuildSession`)

### Checkpoint: Core Audio & Session
- [x] Testes de retenção/limpeza do cache de pré-buffering (`N` e `N+1`) e orquestração da sessão passam
- [x] Verificação de ausência de processos órfãos ao cancelar/pular faixas

### Phase 4: Dual Command Interface (Slash + Prefix) & Voice Lifecycle
- [x] Task 7: Abstração Híbrida de Comandos (Slash + Prefixo) e Handlers de Música
- [x] Task 8: Cliente Discord, Auto-Leave em Canal Vazio e Ponto de Entrada

### Checkpoint: Complete
- [x] Todos os critérios de aceitação de [SPEC.md](file:///d:/!!!_projetos/ws-vsCode/bot-discord/SPEC.md) atendidos
- [x] Suíte completa de testes, linter e build passando (`npm run build && npm test -- --run`)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Oscilação de rede (throttling HTTP do YouTube) causando variação na velocidade da música | High | Baixar a faixa atual ($N$) e pré-baixar a próxima ($N+1$) para arquivo local em `tmp/audio-cache/` com `--concurrent-fragments 4`, fazendo o `ffmpeg` ler do disco local em vez da rede. |
| Bloqueio ou lentidão ao adicionar playlists de até 25.000 músicas | High | Resolver apenas a 1ª música de imediato e ingerir o restante em background via stream NDJSON (`--flat-playlist`), mantendo na fila apenas metadados leves (`CompactTrack`). |
| Ausência de credenciais do Spotify no `.env` | Med | Modo híbrido automático: usa a API oficial (Client Credentials) se configurada, e faz fallback transparente para extração via página de embed/token anônimo caso contrário. |
| Processos `ffmpeg` / `yt-dlp` órfãos ou disco cheio após vários `/skip` | Med | Vincular todo subprocesso a um `AbortController` por faixa e manter no máximo 2 arquivos temporários por servidor (`N` e `N+1`), removendo os anteriores imediatamente. |
| Protocolo de criptografia de voz DAVE exigido pelo Discord | High | Incluir `@snazzah/davey` junto ao `@discordjs/voice` v0.18+ para suporte nativo aos novos modos de criptografia E2EE das chamadas de voz. |

## Open Questions

- Nenhuma questão pendente (todas as definições foram validadas e incorporadas em [SPEC.md](file:///d:/!!!_projetos/ws-vsCode/bot-discord/SPEC.md)).

