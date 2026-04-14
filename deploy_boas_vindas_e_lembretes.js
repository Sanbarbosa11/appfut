/**
 * deploy_boas_vindas_e_lembretes.js
 *
 * 1. scheduler.js — remove lembrete de 2_dias, mantém 1_dia + 1_hora
 *    - MODO_TESTE: cicla apenas 1_dia → 1_hora
 *    - PRODUCAO: filtra só partidas de amanha (1 dia antes)
 *
 * 2. index_meta.js — adiciona:
 *    - Boas-vindas no primeiro contato (jogador nunca visto antes)
 *    - 'oi'/'ola'/'oi!' → mostra menu de opcoes
 */

var fs = require('fs');
var BASE = '/home/appfutadmin/appfut';

// ============================================================
// 1. scheduler.js — remove 2_dias
// ============================================================

var schPath = BASE + '/src/bot/scheduler.js';
var sch = fs.readFileSync(schPath, 'utf8');

// MODO_TESTE: remove '2_dias' da sequencia, deixa 1_dia e 1_hora
sch = sch.replace(
  [
    "      if (tiposEnviados.indexOf('2_dias') === -1) {",
    "        tipo = '2_dias';",
    "      } else if (tiposEnviados.indexOf('1_dia') === -1) {",
    "        tipo = '1_dia';",
    "      } else if (tiposEnviados.indexOf('1_hora') === -1) {",
    "        tipo = '1_hora';",
    "      } else {",
    "        continue;",
    "      }"
  ].join('\n'),
  [
    "      if (tiposEnviados.indexOf('1_dia') === -1) {",
    "        tipo = '1_dia';",
    "      } else if (tiposEnviados.indexOf('1_hora') === -1) {",
    "        tipo = '1_hora';",
    "      } else {",
    "        continue;",
    "      }"
  ].join('\n')
);

// PRODUCAO: remove filtro de 2 dias, deixa só 1 dia
sch = sch.replace(
  "         AND (p.data_partida = DATE_ADD(CURDATE(), INTERVAL 2 DAY)\n              OR p.data_partida = DATE_ADD(CURDATE(), INTERVAL 1 DAY))",
  "         AND p.data_partida = DATE_ADD(CURDATE(), INTERVAL 1 DAY)"
);

// Remove caso '2_dias' do enviarLembreteTipo
sch = sch.replace(
  /if \(tipo === '2_dias'\) \{[\s\S]*?msg \+= '[^']*confirmados';\s*\} else if \(tipo === '1_dia'\)/,
  "if (tipo === '1_dia')"
);

fs.writeFileSync(schPath, sch);
console.log('[OK] scheduler.js - lembrete 2_dias removido');

// ============================================================
// 2. index_meta.js — boas-vindas + oi/ola
// ============================================================

var indexPath = BASE + '/src/bot/index_meta.js';
var idx = fs.readFileSync(indexPath, 'utf8');

// Adiciona boas-vindas e oi/ola no switch de comandos
var oldSwitch = [
  "    // Comandos jogador privado",
  "    switch (text) {",
  "      case 'ajuda':    await ajudaPrivado(client, message, sender); break;",
  "      case 'confirmar': await confirmar(client, message, sender, senderName); break;",
  "      case 'cancelar':  await cancelar(client, message, sender); break;",
  "      case 'lista':     await lista(client, message, sender); break;",
  "      default:",
  "        if (text.startsWith('avulso ')) { await adicionarAvulso(client, message, sender, text); }",
  "        else if (text.startsWith('remover avulso ')) { await removerAvulso(client, message, sender, text); }",
  "        break;",
  "    }"
].join('\n');

var newSwitch = [
  "    // Primeiro contato: boas-vindas",
  "    var [jogExiste] = await db.execute('SELECT id FROM jogadores WHERE whatsapp_id = ?', [sender]);",
  "    if (jogExiste.length === 0) {",
  "      await autoRegistrarJogador(sender, senderName);",
  "      await client.sendText(message.from,",
  "        'Ol\u00e1, ' + senderName + '! \ud83d\udc4b Bem-vindo ao *AppFut*!\\n\\n' +",
  "        '\u26bd Sou o bot de gest\u00e3o do seu rachao.\\n\\n' +",
  "        'Quando houver uma partida marcada, voc\u00ea receber\u00e1 um lembrete aqui com op\u00e7\u00f5es para confirmar ou cancelar presen\u00e7a.\\n\\n' +",
  "        'Voc\u00ea tamb\u00e9m pode interagir a qualquer momento:\\n' +",
  "        '\u2022 *confirmar* \u2014 Confirmar presen\u00e7a\\n' +",
  "        '\u2022 *cancelar* \u2014 Cancelar presen\u00e7a\\n' +",
  "        '\u2022 *lista* \u2014 Ver quem confirmou\\n' +",
  "        '\u2022 *ajuda* \u2014 Ver todos os comandos'",
  "      );",
  "      return;",
  "    }",
  "",
  "    // Comandos jogador privado",
  "    switch (text) {",
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
  "        break;",
  "      case 'ajuda':    await ajudaPrivado(client, message, sender); break;",
  "      case 'confirmar': await confirmar(client, message, sender, senderName); break;",
  "      case 'cancelar':  await cancelar(client, message, sender); break;",
  "      case 'lista':     await lista(client, message, sender); break;",
  "      default:",
  "        if (text.startsWith('avulso ')) { await adicionarAvulso(client, message, sender, text); }",
  "        else if (text.startsWith('remover avulso ')) { await removerAvulso(client, message, sender, text); }",
  "        break;",
  "    }"
].join('\n');

if (idx.includes(oldSwitch)) {
  idx = idx.replace(oldSwitch, newSwitch);
  console.log('[OK] index_meta.js - boas-vindas + oi/ola adicionados');
} else {
  console.log('[ERRO] index_meta.js - padrao nao encontrado, aplicando patch alternativo');
  // Fallback: adiciona antes do switch existente
  idx = idx.replace(
    "    // Comandos jogador privado\n    switch (text) {",
    [
      "    // Primeiro contato: boas-vindas",
      "    var [jogExiste] = await db.execute('SELECT id FROM jogadores WHERE whatsapp_id = ?', [sender]);",
      "    if (jogExiste.length === 0) {",
      "      await autoRegistrarJogador(sender, senderName);",
      "      await client.sendText(message.from,",
      "        'Ol\u00e1, ' + senderName + '! \ud83d\udc4b Bem-vindo ao *AppFut*!\\n\\n' +",
      "        '\u26bd Sou o bot de gest\u00e3o do seu rachao.\\n\\n' +",
      "        'Quando houver uma partida marcada, voc\u00ea receber\u00e1 um lembrete aqui com op\u00e7\u00f5es para confirmar ou cancelar presen\u00e7a.\\n\\n' +",
      "        'Voc\u00ea tamb\u00e9m pode interagir a qualquer momento:\\n' +",
      "        '\u2022 *confirmar* \u2014 Confirmar presen\u00e7a\\n' +",
      "        '\u2022 *cancelar* \u2014 Cancelar presen\u00e7a\\n' +",
      "        '\u2022 *lista* \u2014 Ver quem confirmou\\n' +",
      "        '\u2022 *ajuda* \u2014 Ver todos os comandos'",
      "      );",
      "      return;",
      "    }",
      "",
      "    // Comandos jogador privado",
      "    switch (text) {"
    ].join('\n')
  );
  // Adiciona oi/ola no switch
  idx = idx.replace(
    "      case 'ajuda':    await ajudaPrivado(client, message, sender); break;",
    [
      "      case 'oi':",
      "      case 'ol\u00e1':",
      "      case 'ola':",
      "      case 'oi!':",
      "        await client.sendButtons(message.from,",
      "          'Ol\u00e1, ' + senderName + '! \ud83d\udc4b O que voc\u00ea quer fazer?',",
      "          [",
      "            { id: 'menu_confirmar', title: 'Confirmar presen\u00e7a' },",
      "            { id: 'menu_cancelar',  title: 'Cancelar presen\u00e7a'  },",
      "            { id: 'menu_lista',     title: 'Ver lista'            }",
      "          ]",
      "        );",
      "        break;",
      "      case 'ajuda':    await ajudaPrivado(client, message, sender); break;"
    ].join('\n')
  );
  console.log('[OK] index_meta.js - patch alternativo aplicado');
}

// Adiciona handler dos botoes do menu (menu_confirmar, menu_cancelar, menu_lista)
// no onPollResponse, antes do bloco adminPoll
var oldAdminPoll = [
  "    // AdminPoll",
  "    var { processarAdminPoll } = require('./commands/adminPoll');"
].join('\n');

var newMenuHandler = [
  "    // Botoes do menu (oi/ola)",
  "    if (btnId === 'menu_confirmar') {",
  "      var [jMenu] = await db.execute('SELECT id, nome FROM jogadores WHERE whatsapp_id = ?', [sender]);",
  "      if (jMenu.length > 0) await confirmar(client, { from: sender, sender: { id: sender, pushname: jMenu[0].nome } }, sender, jMenu[0].nome);",
  "      return;",
  "    }",
  "    if (btnId === 'menu_cancelar') {",
  "      await cancelar(client, { from: sender, sender: { id: sender } }, sender);",
  "      return;",
  "    }",
  "    if (btnId === 'menu_lista') {",
  "      await lista(client, { from: sender, sender: { id: sender } }, sender);",
  "      return;",
  "    }",
  "",
  "    // AdminPoll",
  "    var { processarAdminPoll } = require('./commands/adminPoll');"
].join('\n');

if (idx.includes(oldAdminPoll)) {
  idx = idx.replace(oldAdminPoll, newMenuHandler);
  console.log('[OK] index_meta.js - handlers menu_confirmar/cancelar/lista adicionados');
} else {
  console.log('[SKIP] index_meta.js - handler menu ja existe ou padrao nao encontrado');
}

fs.writeFileSync(indexPath, idx);
console.log('[OK] index_meta.js salvo');
console.log('\nReinicie: pm2 restart appfut-meta --update-env');
