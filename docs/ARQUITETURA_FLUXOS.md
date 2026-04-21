# Arquitetura atual — fluxos Confirmar / Cancelar / Lista

## Dois processos independentes, um banco compartilhado

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│ appfut-meta (Meta API)      │     │ appfut-grupo (WPPConnect)   │
│ → PRIVADO + botões          │     │ → GRUPO: !lista, lembretes, │
│ → Confirmar / Cancelar      │     │   auto-setup de membros     │
└──────────────┬──────────────┘     └──────────────┬──────────────┘
               │                                    │
               └──────────────┬─────────────────────┘
                              ▼
                    MySQL (tabelas compartilhadas)
```

---

## Fluxo 1 — Clicar **Confirmar** (privado)

```
[Usuário manda "oi" no privado]
   │
   ▼
Meta envia webhook → appfut-meta
   │
   ▼
1. src/bot/whatsapp/webhook.js              → parseia webhook da Meta
   │
   ▼
2. src/bot/index_meta.js::onMessage (L96)   → cai no default (L141)
   │   └─ autoRegistrar (L53) garante jogador + vínculo ao grupo
   ▼
3. src/bot/commands/menu.js::enviarMenuJogador (L37)
   │   └─ monta lista via montarListaCompleta(..., false)
   │   └─ envia botões [Confirmar] [Cancelar] via metaClient.sendButtons
   ▼
[Usuário clica "Confirmar"]
   │
   ▼
Meta envia interactive button_reply → webhook
   │
   ▼
4. src/bot/index_meta.js::onPollResponse (L148)
   │   └─ selectedId === 'confirmar' (L157) → chama confirmar()
   ▼
5. src/bot/commands/confirmar.js
   │   ├─ INSERT jogador (se novo)
   │   ├─ Busca partida aberta (ORDER BY data_partida ASC LIMIT 1)
   │   ├─ Valida max_jogadores
   │   ├─ DELETE FROM ausentes / duvidas
   │   ├─ INSERT INTO presencas
   │   └─ sendText "✅ Presença confirmada, vaga X/Y"
```

---

## Fluxo 2 — Clicar **Cancelar** (privado)

```
[Usuário clica "Cancelar" no menu já aberto]
   │
   ▼
Meta envia interactive button_reply → webhook
   │
   ▼
1. src/bot/index_meta.js::onPollResponse (L160)
   │   └─ selectedId === 'cancelar' → chama cancelar()
   ▼
2. src/bot/commands/cancelar.js
   │   ├─ Busca jogador + partida aberta (JOIN grupo_jogadores + grupos)
   │   ├─ DELETE FROM presencas
   │   ├─ DELETE FROM duvidas
   │   ├─ INSERT IGNORE INTO ausentes
   │   ├─ montarListaCompleta(..., false)  ← lista sem footer
   │   └─ sendText "Presença cancelada. Até a próxima! 👋\n\n{lista}"
```

---

## Fluxo 3 — `!lista` no grupo

```
[Usuário digita "!lista" no grupo]
   │
   ▼
1. src/bot/index_wpp.js::onMessage (L153)
   │   ├─ normaliza texto (trim/lower/strip acentos)
   │   └─ match "!lista" → processarListaGrupo (L168)
   ▼
2. src/bot/index_wpp.js::processarListaGrupo (L321)
   │   ├─ Busca partida aberta do grupo (g.whatsapp_id = message.from)
   │   ├─ montarListaCompleta(..., true)  ← COM footer (link wa.me)
   │   └─ client.sendText (WPPConnect)
```

---

## Coração compartilhado — `montarListaCompleta`

`src/bot/utils/listaHelper.js` é **a única fonte de verdade** da lista. Os 4 touchpoints (menu oi, confirmar, cancelar, lista privado, !lista grupo, lembrete) todos passam por aqui.

Queries que ela faz:

| Seção       | Fonte                                                                                            |
|-------------|--------------------------------------------------------------------------------------------------|
| Confirmados | `SELECT FROM presencas`                                                                         |
| Ausentes    | `SELECT FROM ausentes` *(explícito, novo)*                                                      |
| Dúvida      | `grupo_jogadores.ativo=TRUE NOT IN presencas NOT IN ausentes` *(derivado — default)*           |
| Avulsos     | `SELECT FROM avulsos`                                                                           |

Parâmetro `incluirFooter` (bool) controla o rodapé `📲 Para confirmar, WhatsApp ou clique: wa.me/...` — `true` em contextos de grupo, `false` em privado.

---

## Tabelas do domínio (semântica atual)

| Tabela            | Significado                                                  |
|-------------------|--------------------------------------------------------------|
| `grupos`          | Grupos WhatsApp cadastrados                                  |
| `jogadores`       | Todos os jogadores                                           |
| `grupo_jogadores` | Vínculo N:N com flag `ativo` (status POR GRUPO)              |
| `partidas`        | Partidas abertas/fechadas por grupo                          |
| `presencas`       | Jogadores **Confirmados** numa partida                       |
| `ausentes`        | Jogadores que **Cancelaram** explicitamente *(criada 2026-04-19)* |
| `duvidas`         | **Legada** — não é mais populada. Limpa em confirmar/cancelar |
| `avulsos`         | Convidados adicionados pelos jogadores                       |
| `admins`          | Admins de grupo                                              |
| `lembretes_enviados` | Dedupe de lembretes já mandados                            |

**Estado derivado Dúvida:** se o jogador está em `grupo_jogadores.ativo=TRUE` **mas não está em `presencas` nem em `ausentes`**, aparece na seção Dúvida.

---

## Fluxo 4 — Lembrete automático (bônus)

```
scheduler.js (node-cron, roda em appfut-grupo)
   │
   ├─ verificarLembretes (2 dias, 1 dia)
   ├─ verificarLembrete1hAntes
   └─ verificarAutoClose (fecha partida 1h após horario_fim)
        │
        ▼
   enviarLembreteGrupo (L225)
        │
        ├─ INSERT IGNORE em lembretes_enviados (dedupe)
        ├─ montarListaCompleta(..., true)
        └─ clientRef.sendText (grupo via WPPConnect)
```

---

## Arquivos por responsabilidade

| Camada          | Arquivos                                                                        |
|-----------------|---------------------------------------------------------------------------------|
| Entry points    | `src/bot/index_meta.js`, `src/bot/index_wpp.js`                                 |
| Transporte Meta | `src/bot/whatsapp/webhook.js`, `src/bot/whatsapp/metaClient.js`                 |
| Comandos        | `src/bot/commands/confirmar.js`, `src/bot/commands/cancelar.js`, `src/bot/commands/lista.js`, `src/bot/commands/menu.js`, `src/bot/commands/admin.js`, `src/bot/commands/grupo.js` |
| Domínio (lista) | `src/bot/utils/listaHelper.js`                                                  |
| Utilitários     | `src/bot/utils/rateLimit.js`, `src/bot/utils/verificarJogador.js`               |
| Agendamento     | `src/bot/scheduler.js`                                                          |
| Schema          | `src/database/init.sql`                                                         |
| DB pool         | `src/database/connection.js`                                                    |

---

## Pontos de atenção / dívidas

1. **`commands/grupo.js` existe mas é morto.** O `!lista` real está em `index_wpp.js::processarListaGrupo` (L321). `grupo.js` é chamado apenas pelo `index_meta.js` em `processarComandoGrupo`, mas `index_meta` só roda no privado — nunca bate lá.
2. **`commands/duvida.js` é órfão.** Não é importado em lugar nenhum depois da mudança do modelo.
3. **`duvidas` (tabela)** virou legada. Pode ser removida numa migration quando tiver certeza que nada mais escreve nela.
4. **Lookup de partida em confirmar/cancelar** usa `ORDER BY data_partida ASC LIMIT 1` — ambíguo se o jogador está em mais de um grupo com partida aberta.
5. **Log de debug em `index_wpp.js`** (adicionado para investigar o `!lista`) continua lá — pode remover depois de entender o que estava acontecendo.
