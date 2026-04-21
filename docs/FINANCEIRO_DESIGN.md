# AppFut — Design do Sistema Financeiro

> Rascunho para revisão — 2026-04-14  
> Decisões tomadas com base na arquitetura atual. Revisar antes de implementar.

---

## Premissas adotadas

1. **Sem integração de pagamento automático** (Pix API, etc.) — muito complexo para MVP. Admin confirma manualmente quem pagou.
2. **Cobrança por partida**, não por mês — mais justo para quem falta.
3. **Quem paga:** somente quem confirmou presença (status "confirmado") + avulsos.
4. **Quem não paga:** ausentes e jogadores que não responderam (dúvida).
5. **Valor configurável por partida** — admin define ao criar. Padrão herdado do grupo.
6. **Avulsos pagam o mesmo valor** por padrão.
7. **Caixa do grupo** — saldo acumulado para o admin acompanhar.
8. **Notificação de cobrança** — disparada automaticamente quando a partida fecha.

---

## Banco de Dados — Novas Tabelas

### Alterações em tabelas existentes

```sql
-- grupos: adicionar valor padrão e chave pix
ALTER TABLE grupos
  ADD COLUMN valor_padrao DECIMAL(6,2) DEFAULT 15.00,
  ADD COLUMN pix_chave VARCHAR(100) NULL,
  ADD COLUMN pix_tipo ENUM('cpf','cnpj','email','telefone','aleatoria') NULL,
  ADD COLUMN pix_nome VARCHAR(100) NULL;

-- partidas: adicionar valor da partida específica
ALTER TABLE partidas
  ADD COLUMN valor_jogo DECIMAL(6,2) NULL;
  -- NULL = herda valor_padrao do grupo

-- avulsos: valor específico (pode cobrar diferente de avulso)
ALTER TABLE avulsos
  ADD COLUMN valor DECIMAL(6,2) NULL;
  -- NULL = herda valor_jogo da partida
```

### Nova tabela: pagamentos

```sql
CREATE TABLE IF NOT EXISTS pagamentos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  partida_id INT NOT NULL,
  jogador_id INT NULL,          -- NULL = avulso
  avulso_id INT NULL,           -- NULL = jogador cadastrado
  valor DECIMAL(6,2) NOT NULL,
  status ENUM('pendente', 'pago', 'dispensado') DEFAULT 'pendente',
  pago_em TIMESTAMP NULL,
  registrado_por VARCHAR(50) NULL,   -- whatsapp_id do admin que marcou
  observacao VARCHAR(200) NULL,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_pag_jogador (partida_id, jogador_id),
  UNIQUE KEY unique_pag_avulso (partida_id, avulso_id),
  FOREIGN KEY (partida_id) REFERENCES partidas(id),
  FOREIGN KEY (jogador_id) REFERENCES jogadores(id),
  FOREIGN KEY (avulso_id) REFERENCES avulsos(id)
);
```

### Nova tabela: caixa_grupo

```sql
CREATE TABLE IF NOT EXISTS caixa_grupo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  grupo_id INT NOT NULL,
  partida_id INT NULL,             -- NULL = movimentação manual
  tipo ENUM('entrada', 'saida') NOT NULL,
  valor DECIMAL(8,2) NOT NULL,
  descricao VARCHAR(200) NULL,
  registrado_por VARCHAR(50) NULL,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (grupo_id) REFERENCES grupos(id),
  FOREIGN KEY (partida_id) REFERENCES partidas(id)
);
```

---

## Diagrama de Relacionamento

```
partidas (1)─────────────(N) pagamentos (N)─────────(1) jogadores
    │                              │
    │                              └──────────────────(1) avulsos
    │
    └──── quando fecha ────► gera pagamentos automaticamente
                             para todos os confirmados + avulsos
```

---

## Fluxos

### Fluxo 1 — Admin cria partida com valor

```
admin criar 19/04 20 15.00
       │
       ├── Atual: INSERT partidas (grupo_id, data_partida, max_jogadores)
       └── Novo:  INSERT partidas (..., valor_jogo = 15.00)
                  Se não informar valor → herda grupos.valor_padrao
```

### Fluxo 2 — Partida fecha → cobrança gerada automaticamente

```
auto-close OU admin fechar
       │
       ├── [JÁ EXISTE] UPDATE partidas SET status = 'fechada'
       │
       └── [NOVO] gerarCobrancas(partida)
                       │
                       ├── SELECT confirmados (presencas status='confirmado')
                       ├── SELECT avulsos da partida
                       │
                       ├── Para cada confirmado:
                       │       INSERT pagamentos (partida_id, jogador_id, valor, status='pendente')
                       │
                       ├── Para cada avulso:
                       │       INSERT pagamentos (partida_id, avulso_id, valor, status='pendente')
                       │
                       ├── INSERT caixa_grupo (tipo='entrada', valor=total_esperado, descricao='Partida DD/MM')
                       │
                       └── Notifica grupo:
                               "🔒 Partida encerrada! N jogadores
                                💰 Valor por pessoa: R$ 15,00
                                📲 Para ver quem pagou: !financeiro"
```

### Fluxo 3 — Admin marca pagamento (privado)

```
admin pagar N
       │
       ├── buscarGrupoDoAdmin(sender) → grupo do admin
       │
       ├── adminFinanceiro._ultimaLista existe?
       │       └── NÃO → "Primeiro use: admin financeiro"
       │
       ├── jogador = ultimaLista[N-1]
       │
       ├── UPDATE pagamentos SET status='pago', pago_em=NOW(), registrado_por=sender
       │       WHERE partida_id = ? AND jogador_id = ?
       │
       └── Responde: "✅ Pagamento de João registrado — R$ 15,00"
```

### Fluxo 4 — Admin consulta financeiro

```
admin financeiro
       │
       ├── buscarGrupoDoAdmin(sender)
       │
       ├── SELECT partida aberta (ou última fechada)
       │
       ├── SELECT pagamentos JOIN jogadores WHERE partida_id
       │
       ├── Monta lista:
       │       💰 Financeiro — Grupo X — DD/MM
       │
       │       ✅ Pagos (N):
       │       1. João — R$ 15,00
       │       2. Pedro — R$ 15,00
       │
       │       ⏳ Pendentes (N):
       │       3. Carlos — R$ 15,00
       │       4. Ana — R$ 15,00
       │
       │       🔸 Avulsos (N):
       │       5. Marcos — R$ 15,00
       │
       │       📊 Total arrecadado: R$ 30,00 / R$ 75,00
       │       💼 Caixa do grupo: R$ 120,00
       │
       └── Salva cache em adminFinanceiro._ultimaLista (para admin pagar N)
```

### Fluxo 5 — Admin dispensa pagamento

```
admin dispensar N
       └── UPDATE pagamentos SET status='dispensado'
           Útil para casos especiais (aniversário, acordo, etc.)
```

### Fluxo 6 — Admin registra saída do caixa

```
admin saida 50.00 "Aluguel da quadra"
       └── INSERT caixa_grupo (tipo='saida', valor=50.00, descricao='Aluguel da quadra')
           Responde: "✅ Saída registrada — R$ 50,00"
```

### Fluxo 7 — Admin consulta caixa

```
admin caixa
       │
       ├── SELECT SUM(valor) entradas FROM caixa_grupo WHERE grupo_id
       ├── SELECT SUM(valor) saidas FROM caixa_grupo WHERE grupo_id
       │
       └── Responde:
               💼 Caixa — Grupo X

               📥 Total entradas: R$ 300,00
               📤 Total saídas:   R$ 150,00
               ─────────────────────────────
               💰 Saldo atual:    R$ 150,00
```

### Fluxo 8 — Jogador consulta próprio débito (privado)

```
texto: "financeiro" ou "quanto devo" ou "meu saldo"
       │
       ├── SELECT pagamentos WHERE jogador_id = ? AND status = 'pendente'
       │         JOIN partidas (status = 'fechada')
       │
       └── Responde:
               📋 Seus pagamentos pendentes:

               • Jogo 12/04 — R$ 15,00
               • Jogo 05/04 — R$ 15,00

               Total: R$ 30,00

               💳 Pague via Pix:
               Chave: 11987654321
               Nome: Admin Grupo

               ⚠️ Após pagar, avise o admin!
```

### Fluxo 9 — Notificação automática de devedores (scheduler)

```
Novo cron: 1x por dia, às 10h (PRODUÇÃO)
       │
       ├── SELECT jogadores com pagamentos pendentes de partidas fechadas
       │         há mais de 2 dias
       │
       └── Para cada devedor:
               sendText: "⏳ Lembrete de pagamento — Grupo X
                          Jogo de DD/MM: R$ 15,00 pendente
                          💳 Pix: CHAVE
                          Qualquer dúvida, fale com o admin!"
```

---

## Novos Comandos Admin

| Comando | Ação |
|---|---|
| `admin financeiro` | Lista pagos/pendentes da partida atual |
| `admin pagar N` | Marca jogador N como pago (usa cache do financeiro) |
| `admin dispensar N` | Dispensa pagamento do jogador N |
| `admin caixa` | Saldo do grupo |
| `admin saida VALOR "DESC"` | Registra saída do caixa |
| `admin valor VALOR` | Altera valor padrão do grupo |
| `admin pix CHAVE TIPO NOME` | Configura chave Pix do grupo |

## Novo Comando Jogador

| Comando | Ação |
|---|---|
| `financeiro` | Ver pagamentos pendentes + chave Pix |

## Novo Comando Grupo

| Comando | Ação |
|---|---|
| `!financeiro` | Resumo público: arrecadado vs. esperado |

---

## Decisões a Revisar

### D1 — Geração automática de cobranças
**Decidido:** Gera ao fechar a partida.  
**Alternativa:** Gera ao confirmar presença (mais cedo, mas partida ainda pode ser cancelada).  
**Recomendação:** Manter ao fechar — mais definitivo.

### D2 — Avulso paga mesmo valor?
**Decidido:** Sim, herda valor da partida.  
**Alternativa:** Admin define valor diferente por avulso.  
**Recomendação:** Para MVP, mesmo valor. Adicionar personalização depois.

### D3 — Notificação de devedor
**Decidido:** Scheduler diário após 2 dias.  
**Alternativa:** Notificar só quando admin pedir (`admin cobrar`).  
**Recomendação:** Scheduler é melhor UX, mas tem risco de irritar. Considerar limite de 2 lembretes max.

### D4 — Visibilidade no grupo
**Decidido:** `!financeiro` mostra resumo (arrecadado/esperado, sem expor quem deve).  
**Alternativa:** Mostrar lista de devedores publicamente.  
**Recomendação:** Manter privado — expor devedores publicamente pode gerar conflito.

### D5 — Caixa unificado ou por partida?
**Decidido:** Unificado por grupo, com referência à partida em cada entrada.  
**Alternativa:** Saldo separado por partida.  
**Recomendação:** Unificado é mais natural para um grupo que usa o caixa para despesas recorrentes (aluguel de quadra, etc.).

### D6 — Integração Pix automática
**Decidido:** Fora do MVP.  
**Alternativa:** Gerar QR Code via API Pix do banco.  
**Recomendação:** Avaliar para v2. Requer conta bancária com API, CNPJ em alguns casos.

---

## Arquivos Novos Necessários

```
src/
  bot/
    commands/
      adminFinanceiro.js   ← comandos admin financeiro/pagar/dispensar/caixa
      financeiro.js        ← comando jogador "financeiro"
  database/
    migration_financeiro.sql  ← ALTER TABLEs + CREATE TABLEs
```

## Impacto em Arquivos Existentes

| Arquivo | O que muda |
|---|---|
| `src/bot/commands/admin.js` | Adiciona cases: financeiro, pagar, dispensar, caixa, saida, valor, pix |
| `src/bot/index_meta.js` | Adiciona case "financeiro" no switch do jogador |
| `src/bot/commands/grupo.js` | Adiciona `!financeiro` |
| `src/bot/scheduler.js` | Adiciona cron de cobrança diária |
| `src/database/init.sql` | Adiciona novas tabelas (para novos ambientes) |
| `auto-close (scheduler.js)` | Chama `gerarCobrancas()` ao fechar |

---

## Ordem de implementação sugerida

```
1. migration_financeiro.sql   ← banco primeiro
2. adminFinanceiro.js         ← comandos admin (financeiro + pagar + caixa)
3. Integrar ao auto-close     ← gerarCobrancas() automático
4. financeiro.js (jogador)    ← ver débito + pix
5. scheduler cobrança         ← lembretes automáticos (último, mais arriscado)
6. !financeiro no grupo       ← resumo público
```
