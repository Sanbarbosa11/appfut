/**
 * deploy_fix_menu_oi.js
 *
 * Melhora o menu de oi/ola:
 * - Busca a partida aberta do grupo do jogador
 * - Exibe data e nome do grupo no corpo da mensagem
 * - Ex: "Confirme sua presença para o futebol de sábado - teste bot grupo"
 */

var fs = require('fs');
var BASE = '/home/appfutadmin/appfut';
var indexPath = BASE + '/src/bot/index_meta.js';
var idx = fs.readFileSync(indexPath, 'utf8');

var oldOi = [
  "      case 'oi':",
  "      case 'ol\u00e1':",
  "      case 'ola':",
  "      case 'oi!':",
  "      case 'ol\u00e1!':",
  "        await client.sendButtons(message.from,",
  "          'Ol\u00e1, ' + senderName + '! \ud83d\udc4b O que voc\u00ea quer fazer?',",
  "          [",
  "            { id: 'menu_confirmar', title: 'Confirmar presen\u00e7a' },",
  "            { id: 'menu_cancelar',  title: 'Cancelar presen\u00e7a'  },",
  "            { id: 'menu_lista',     title: 'Ver lista'            }",
  "          ]",
  "        );",
  "        break;"
].join('\n');

var newOi = [
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

if (idx.includes(oldOi)) {
  idx = idx.replace(oldOi, newOi);
  fs.writeFileSync(indexPath, idx);
  console.log('[OK] index_meta.js - menu oi/ola atualizado com partida');
} else {
  console.log('[ERRO] padrao nao encontrado');
}

console.log('\nReinicie: pm2 restart appfut-meta --update-env');
