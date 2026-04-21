# Controle de Grupos e Segurança

## Estrutura de isolamento entre grupos

Cada grupo WhatsApp é identificado pelo seu `whatsapp_id` único (ex: `120363xxxxxxxx@g.us`).
Toda a hierarquia de dados desce a partir desse ID, garantindo isolamento total entre grupos.

```
grupos (whatsapp_id UNIQUE)
  └── grupo_jogadores (grupo_id + jogador_id — UNIQUE por par)
  └── admins (grupo_id + whatsapp_id)
  └── partidas (grupo_id)
        └── presencas (partida_id)
        └── ausentes (partida_id)
        └── avulsos (partida_id)
        └── lembretes_enviados (partida_id)
```

---

## Membros em múltiplos grupos — como funciona

A tabela `jogadores` armazena o jogador UMA vez (por `whatsapp_id`).
O vínculo com cada grupo fica em `grupo_jogadores`, com `ativo` independente por grupo.

```
jogadores
  id=5, whatsapp_id="5511999...", nome="Sandro"

grupo_jogadores
  grupo_id=1, jogador_id=5, ativo=TRUE   ← Grupo A
  grupo_id=2, jogador_id=5, ativo=FALSE  ← Grupo B (inativo neste grupo)
```

**Não há conflito de cadastro** — o mesmo número pode estar em N grupos com status diferentes.

---

## Admins em múltiplos grupos

A tabela `admins` registra `(grupo_id, whatsapp_id)` por grupo — um admin pode ser admin em vários grupos simultaneamente.

```
admins
  grupo_id=1, whatsapp_id="5511999..."  ← admin do Grupo A
  grupo_id=2, whatsapp_id="5511999..."  ← admin do Grupo B
```

**⚠️ Ponto de atenção:** `buscarGrupoDoAdmin` resolve qual grupo o admin está gerenciando com:
```sql
SELECT g.* FROM grupos g JOIN admins a ON g.id = a.grupo_id
WHERE a.whatsapp_id = ? ORDER BY g.id DESC LIMIT 1
```
Isso pega o **grupo cadastrado mais recentemente**. Se o admin for de dois grupos, os comandos `admin criar`, `admin fechar`, `admin status` sempre operam no grupo mais novo. Não há escolha interativa — **gap conhecido**.

---

## Confirmar / Cancelar com múltiplos grupos abertos

Quando um jogador clica Confirmar ou Cancelar no privado, o bot busca a partida com:

```sql
SELECT ... FROM partidas p
JOIN grupo_jogadores gj ON gj.grupo_id = p.grupo_id
WHERE gj.jogador_id = ? AND gj.ativo = TRUE AND p.status = "aberta"
ORDER BY p.data_partida ASC LIMIT 1
```

Regra: **sempre opera na partida aberta com data mais próxima**, de qualquer grupo.

```
Grupo A — partida 26/04 (sábado)
Grupo B — partida 28/04 (segunda)

→ Confirmar opera no Grupo A (data mais próxima)
```

Enquanto cada grupo tiver partidas em datas diferentes, funciona corretamente.
**⚠️ Conflito real:** se dois grupos tiverem partidas na mesma data, o bot pega a de menor `partida.id` (ordem de inserção). Não há desambiguação — **gap conhecido**.

---

## !lista no grupo — sem conflito

O `!lista` no grupo resolve corretamente sempre:
```sql
WHERE g.whatsapp_id = ? AND p.status = "aberta"
```
Usa o `whatsapp_id` do grupo onde a mensagem foi enviada — completamente isolado.

---

## Lembretes — sem conflito

O scheduler itera todas as partidas abertas e envia via `g.whatsapp_id` de cada uma — cada grupo recebe o lembrete do próprio jogo.

---

## Fluxo de segurança atual

### 1. Verificação de admin

Dois níveis:

| Nível | Como funciona |
|-------|---------------|
| **WhatsApp real** | `verificarAdminGrupo` chama `client.getGroupMembers()` e confere `isAdmin` ou `isSuperAdmin` diretamente na API do WhatsApp |
| **Banco de dados** | `buscarGrupoDoAdmin` consulta tabela `admins` para saber qual grupo o admin gerencia |

O nível WhatsApp é a fonte de verdade — não adianta estar na tabela `admins` se não for admin real do grupo.

### 2. Rate limit

| Parâmetro | Valor |
|-----------|-------|
| Limite | 3 execuções por comando |
| Janela | 1 hora por sender |
| Armazenamento | Memória RAM (reseta ao reiniciar o bot) |
| Silêncio | Na 4ª tentativa, retorna sem resposta |

### 3. Deduplicação

| Contexto | Janela | Alvo |
|----------|--------|------|
| Mensagens Meta (privado) | 30 minutos | `message.id` |
| `!lista` no grupo | 10 segundos | `grupo_id + comando` — evita spam quando vários clicam ao mesmo tempo |

### 4. Auto-registro (surface de segurança)

`autoRegistrar` em `index_meta.js` cadastra **qualquer pessoa** que envie mensagem pro número privado — não há convite ou aprovação. O jogador é vinculado ao grupo com partida aberta mais próxima automaticamente.

**Risco:** alguém de fora pode se registrar e aparecer na lista de Dúvida do grupo sem nunca ter sido convidado. Hoje isso é visível (aparece como Dúvida) mas não causa dano funcional.

### 5. Comandos abertos vs. restritos

| Comando | Quem pode usar |
|---------|---------------|
| `confirmar` / `cancelar` | Qualquer jogador registrado |
| `lista` | Qualquer jogador registrado |
| `avulso Nome` | Qualquer jogador registrado ⚠️ |
| `!lista` no grupo | Qualquer membro do grupo |
| `admin *` | Admin verificado no WhatsApp |

`avulso` está aberto a todos — sem restrição de admin. Hoje é aceitável, mas escalar pode gerar abuso.

---

## Gaps conhecidos e impacto

| Gap | Impacto atual | Como resolver futuramente |
|-----|---------------|--------------------------|
| Admin em múltiplos grupos opera no mais recente | Baixo — raro ter um admin em 2 grupos | Menu interativo de seleção de grupo |
| Confirmar/cancelar ambíguo com partidas na mesma data | Baixo — raro acontecer | Identificar grupo pelo contexto da sessão |
| `autoRegistrar` sem convite | Baixo — só aparece em Dúvida | Whitelist por grupo ou aprovação manual |
| `avulso` aberto a todos | Baixo — uso restrito hoje | Flag `admin_only` por grupo |
| Tabela `admins` sem UNIQUE KEY | Mínimo — gera duplicatas, não erros | `ALTER TABLE admins ADD UNIQUE KEY (grupo_id, whatsapp_id)` |
