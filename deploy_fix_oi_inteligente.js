/**
 * deploy_fix_oi_inteligente.js
 *
 * Melhora o comportamento do oi/ola no privado:
 *
 * 1. Se jogador JA CONFIRMADO → "Você já está confirmado ✅" (sem botões)
 * 2. Se jogador JA AUSENTE → "Sua ausência está registrada ❌" (sem botões)
 * 3. Se em DUVIDA (sem resposta ainda):
 *    - Verifica se já mostrou menu hoje (tabela menu_exibido ou flag em sessão)
 *    - Se já mostrou E não clicou em nada → "Aguardando sua resposta..." (sem botões)
 *    - Se não mostrou ainda hoje → mostra menu com botões
 * 4. Após clicar em qualquer botão → menu bloqueado até próximo dia
 *
 * Usa coluna oi_exibido_em na tabela jogadores para rastrear último menu exibido.
 * Se coluna não existir, cria automaticamente.
 */

var fs = require('fs');
var BASE = '/home/appfutadmin/appfut';
var indexPath = BASE + '/src/bot/index_meta.js';
var idx = fs.readFileSync(indexPath, 'utf8');

// ---- Substitui o bloco case 'oi' / 'ola' completo ----

var oldOi = [
  "      case 'oi':",
  "      case 'ol\u00e1':",
  "      case 'ola':",
  "      case 'oi!':",
  "      case 'ol\u00e1!':",
  "        {",
  "          // Busca partida aberta do grupo do jogador",
  "          var [jogOi] = await db.execute('SELECT id FROM jogadores WHERE whatsapp_id = ?', [sender]);",
  "          var menuBody = 'Ol\u00e1, ' + senderName + '! \ud83d\udc4b O que voc\u00ea quer fazer?';",
  "          if (jogOi.length > 0) {",
  "            var [partidasOi] = await db.execute(",
  "              'SELECT p.id, p.data_partida, g.nome as grupo_nome ' +",
  "              'FROM partidas p JOIN grupos g ON p.grupo_id = g.id ' +",
  "              'JOIN grupo_jogadores gj ON gj.grupo_id = g.id AND gj.jogador_id = ? AND gj.ativo = TRUE ' +",
  "              \"WHERE p.status = 'aberta' ORDER BY p.data_partida ASC LIMIT 1\",",
  "              [jogOi[0].id]",
  "            );",
  "            if (partidasOi.length > 0) {",
  "              var pOi = partidasOi[0];",
  "              var dOi = new Date(pOi.data_partida);",
  "              var dOiStr = dOi.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });",
  "              menuBody = 'Ol\u00e1, ' + senderName + '! \ud83d\udc4b\\n\\n' +",
  "                'Confirme sua presen\u00e7a para o futebol de ' + dOiStr + '\\n' +",
  "                '\u26bd *' + pOi.grupo_nome + '*';",
  "            }",
  "          }",
  "          await client.sendButtons(message.from, menuBody,",
  "            [",
  "              { id: 'menu_confirmar', title: 'Confirmar presen\u00e7a' },",
  "              { id: 'menu_cancelar',  title: 'Cancelar presen\u00e7a'  },",
  "              { id: 'menu_lista',     title: 'Ver lista'            }",
  "            ]",
  "          );",
  "        }",
  "        break;"
].join('\n');

var newOi = [
  "      case 'oi':",
  "      case 'ol\u00e1':",
  "      case 'ola':",
  "      case 'oi!':",
  "      case 'ol\u00e1!':",
  "        await tratarOi(client, message, sender, senderName);",
  "        break;"
].join('\n');

if (idx.includes(oldOi)) {
  idx = idx.replace(oldOi, newOi);
  console.log('[OK] case oi/ola substituido');
} else {
  console.log('[ERRO] padrao oi/ola nao encontrado');
  process.exit(1);
}

// ---- Adiciona funcao tratarOi antes do start() ----

var oldStart = "function start() {";

var funcaoTratarOi = [
  "// -------- tratarOi --------",
  "async function tratarOi(client, message, sender, senderName) {",
  "  // Garante coluna oi_exibido_em",
  "  try {",
  "    await db.execute('ALTER TABLE jogadores ADD COLUMN IF NOT EXISTS oi_exibido_em DATETIME NULL');",
  "  } catch(e) {}",
  "",
  "  var [jogOi] = await db.execute(",
  "    'SELECT id, oi_exibido_em FROM jogadores WHERE whatsapp_id = ?', [sender]",
  "  );",
  "  if (jogOi.length === 0) return;",
  "  var jog = jogOi[0];",
  "",
  "  // Busca partida aberta do grupo do jogador",
  "  var [partidasOi] = await db.execute(",
  "    'SELECT p.id, p.data_partida, g.nome as grupo_nome ' +",
  "    'FROM partidas p JOIN grupos g ON p.grupo_id = g.id ' +",
  "    'JOIN grupo_jogadores gj ON gj.grupo_id = g.id AND gj.jogador_id = ? AND gj.ativo = TRUE ' +",
  "    \"WHERE p.status = 'aberta' ORDER BY p.data_partida ASC LIMIT 1\",",
  "    [jog.id]",
  "  );",
  "",
  "  if (partidasOi.length === 0) {",
  "    await client.sendText(message.from, 'Ol\u00e1, ' + senderName + '! \ud83d\udc4b\\n\\nN\u00e3o h\u00e1 partida aberta no momento. Te aviso quando houver! \u26bd');",
  "    return;",
  "  }",
  "",
  "  var pOi = partidasOi[0];",
  "  var dOi = new Date(pOi.data_partida);",
  "  var dOiStr = dOi.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });",
  "",
  "  // Verifica status do jogador na partida",
  "  var [presOi] = await db.execute(",
  "    \"SELECT status FROM presencas WHERE partida_id = ? AND jogador_id = ?\",",
  "    [pOi.id, jog.id]",
  "  );",
  "",
  "  if (presOi.length > 0 && presOi[0].status === 'confirmado') {",
  "    await client.sendText(message.from,",
  "      'Voc\u00ea j\u00e1 est\u00e1 confirmado para *' + pOi.grupo_nome + '* em ' + dOiStr + '! \u2705\\n\\n' +",
  "      'Caso precise cancelar, digite *cancelar*.'",
  "    );",
  "    return;",
  "  }",
  "",
  "  if (presOi.length > 0 && presOi[0].status === 'ausente') {",
  "    await client.sendText(message.from,",
  "      'Sua aus\u00eancia est\u00e1 registrada para *' + pOi.grupo_nome + '* em ' + dOiStr + '. \u274c\\n\\n' +",
  "      'Se mudar de ideia, digite *confirmar*.'",
  "    );",
  "    return;",
  "  }",
  "",
  "  // Jogador em duvida — verifica se ja exibiu menu hoje",
  "  var hoje = new Date();",
  "  hoje.setHours(0, 0, 0, 0);",
  "  var jaExibiu = false;",
  "  if (jog.oi_exibido_em) {",
  "    var exibidoEm = new Date(jog.oi_exibido_em);",
  "    exibidoEm.setHours(0, 0, 0, 0);",
  "    jaExibiu = exibidoEm.getTime() === hoje.getTime();",
  "  }",
  "",
  "  if (jaExibiu) {",
  "    await client.sendText(message.from,",
  "      'J\u00e1 te enviei as op\u00e7\u00f5es hoje! \ud83d\ude0a\\n\\n' +",
  "      'Clique nos bot\u00f5es da mensagem anterior ou digite:\\n' +",
  "      '\u2022 *confirmar* \u2014 Confirmar presen\u00e7a\\n' +",
  "      '\u2022 *cancelar* \u2014 Cancelar presen\u00e7a\\n' +",
  "      '\u2022 *lista* \u2014 Ver lista'",
  "    );",
  "    return;",
  "  }",
  "",
  "  // Exibe menu e registra horario",
  "  await db.execute('UPDATE jogadores SET oi_exibido_em = NOW() WHERE id = ?', [jog.id]);",
  "  await client.sendButtons(message.from,",
  "    'Ol\u00e1, ' + senderName + '! \ud83d\udc4b\\n\\n' +",
  "    'Confirme sua presen\u00e7a para o futebol de ' + dOiStr + '\\n' +",
  "    '\u26bd *' + pOi.grupo_nome + '*',",
  "    [",
  "      { id: 'menu_confirmar', title: 'Confirmar presen\u00e7a' },",
  "      { id: 'menu_cancelar',  title: 'Cancelar presen\u00e7a'  },",
  "      { id: 'menu_lista',     title: 'Ver lista'            }",
  "    ]",
  "  );",
  "}",
  "",
  "function start() {"
].join('\n');

idx = idx.replace(oldStart, funcaoTratarOi);
console.log('[OK] funcao tratarOi adicionada');

fs.writeFileSync(indexPath, idx);
console.log('[OK] index_meta.js salvo');
console.log('\nReinicie: pm2 restart appfut-meta --update-env');
