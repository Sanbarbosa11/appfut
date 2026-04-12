/**
 * deploy_meta_fixes.js
 *
 * Correcoes para funcionar 100% com Meta API (sem WPPConnect):
 *
 * 1. admin.js
 *    - adminGrupos: usa DB ao inves de listChats()
 *    - adminVincular: aceita "admin vincular ID_WPP NOME" sem listChats/getGroupMembers
 *    - verificarAdminGrupo: verifica apenas no DB
 *
 * 2. index_meta.js
 *    - Auto-registro de jogadores ao receberem primeira mensagem
 *    - Auto-update de nome quando ja cadastrado
 *    - Tenta migrar registros LID para numero real (match por nome)
 */

var fs = require('fs');
var path = require('path');
var BASE = '/home/appfutadmin/appfut';

// ============================================================
// PATCH 1: admin.js
// ============================================================

var adminPath = path.join(BASE, 'src/bot/commands/admin.js');
var adminContent = fs.readFileSync(adminPath, 'utf8');

// --- adminGrupos ---
var oldGrupos = /async function adminGrupos\(client, message, sender\)[\s\S]*?await client\.sendText\(message\.from, texto\);\s*\n\}/;
var newGrupos = [
  "async function adminGrupos(client, message, sender) {",
  "  await delay();",
  "  var [grupos] = await db.execute('SELECT id, nome, whatsapp_id, tipo FROM grupos ORDER BY id');",
  "  if (grupos.length === 0) {",
  "    await client.sendText(message.from, 'Nenhum grupo cadastrado. \\u26a0\\ufe0f\\n\\nUse: *admin vincular ID_WHATSAPP NOME*');",
  "    return;",
  "  }",
  "  var texto = '\\ud83d\\udccb *Grupos cadastrados:*\\n\\n';",
  "  grupos.forEach(function(g, i) {",
  "    texto += (i + 1) + '. ' + g.nome + ' (' + g.tipo + ')\\n';",
  "    texto += '   ID DB: ' + g.id + '\\n\\n';",
  "  });",
  "  texto += '\\ud83d\\udca1 Para vincular novo grupo:\\n*admin vincular ID_WHATSAPP NOME*\\n';",
  "  texto += '_Exemplo: admin vincular 5511999999999-1234@g.us Rachao Sabado_';",
  "  await client.sendText(message.from, texto);",
  "}"
].join('\n');

if (adminContent.match(oldGrupos)) {
  adminContent = adminContent.replace(oldGrupos, newGrupos);
  console.log('[OK] adminGrupos corrigida');
} else {
  console.log('[SKIP] adminGrupos - padrao nao encontrado (pode ja estar corrigida)');
}

// --- adminVincular ---
var oldVincular = /async function adminVincular\(client, message, sender, args\)[\s\S]*?(?=\/\/ ={5,}[\s\S]*?admin participantes)/;
var newVincular = [
  "async function adminVincular(client, message, sender, args) {",
  "  await delay();",
  "  // args[1] = whatsapp_id do grupo, args[2..] = nome do grupo",
  "  var wppId = args[1];",
  "  var nomeGrupo = args.slice(2).join(' ');",
  "  if (!wppId || !nomeGrupo) {",
  "    await client.sendText(message.from,",
  "      'Use: *admin vincular ID_WHATSAPP NOME*\\n' +",
  "      '_Exemplo: admin vincular 5511999999999-1234@g.us Rachao Sabado_\\n\\n' +",
  "      'O ID do grupo voce encontra no WhatsApp: Dados do grupo > Codigo convite ou nas informacoes do grupo.'",
  "    );",
  "    return;",
  "  }",
  "  var [existente] = await db.execute('SELECT id FROM grupos WHERE whatsapp_id = ?', [wppId]);",
  "  if (existente.length > 0) {",
  "    await client.sendText(message.from, 'Este grupo ja esta vinculado! \\u2705');",
  "    return;",
  "  }",
  "  var [resultGrupo] = await db.execute(",
  "    'INSERT INTO grupos (whatsapp_id, nome, tipo) VALUES (?, ?, \"variavel\")',",
  "    [wppId, nomeGrupo]",
  "  );",
  "  var dbGrupoId = resultGrupo.insertId;",
  "  await db.execute('INSERT IGNORE INTO admins (grupo_id, whatsapp_id) VALUES (?, ?)', [dbGrupoId, sender]);",
  "  await client.sendText(message.from,",
  "    '\\u2705 *Grupo vinculado com sucesso!*\\n\\n' +",
  "    '\\ud83d\\udccb Grupo: ' + nomeGrupo + '\\n' +",
  "    '\\ud83c\\udd94 ID DB: ' + dbGrupoId + '\\n\\n' +",
  "    'Proximos passos:\\n' +",
  "    '1\\ufe0f\\u20e3 *admin criar DATA VAGAS* - Crie a primeira partida\\n' +",
  "    '2\\ufe0f\\u20e3 Jogadores se cadastram automaticamente ao mandar mensagem para o bot'",
  "  );",
  "}",
  "",
  ""
].join('\n');

if (adminContent.match(oldVincular)) {
  adminContent = adminContent.replace(oldVincular, newVincular);
  console.log('[OK] adminVincular corrigida');
} else {
  console.log('[SKIP] adminVincular - padrao nao encontrado');
}

// --- verificarAdminGrupo: simplifica para apenas checar DB ---
var oldVerificar = /async function verificarAdminGrupo\(client, grupoId, senderId\)[\s\S]*?\n\}/;
var newVerificar = [
  "async function verificarAdminGrupo(client, grupoId, senderId) {",
  "  try {",
  "    var [rows] = await db.execute(",
  "      'SELECT id FROM admins WHERE whatsapp_id = ?', [senderId]",
  "    );",
  "    return rows.length > 0;",
  "  } catch(e) {",
  "    return false;",
  "  }",
  "}"
].join('\n');

if (adminContent.match(oldVerificar)) {
  adminContent = adminContent.replace(oldVerificar, newVerificar);
  console.log('[OK] verificarAdminGrupo corrigida');
} else {
  console.log('[SKIP] verificarAdminGrupo - padrao nao encontrado');
}

fs.writeFileSync(adminPath, adminContent);
console.log('[OK] admin.js salvo');

// ============================================================
// PATCH 2: index_meta.js — auto-registro de jogadores
// ============================================================

var indexPath = path.join(BASE, 'src/bot/index_meta.js');
var indexContent = fs.readFileSync(indexPath, 'utf8');

// Substitui a funcao onMessage para incluir auto-registro
var oldOnMessage = /async function onMessage\(message\)[\s\S]*?(?=async function onPollResponse)/;

var newOnMessage = [
  "async function onMessage(message) {",
  "  try {",
  "    if (!message.sender || !dedup(message.id)) return;",
  "    var text     = (message.body || '').trim().toLowerCase();",
  "    var sender   = message.sender.id;",
  "    var senderName = message.sender.pushname || 'Jogador';",
  "",
  "    if (message.isGroupMsg) {",
  "      await processarComandoGrupo(client, message);",
  "      return;",
  "    }",
  "",
  "    // Auto-registro/atualizacao do jogador",
  "    await autoRegistrarJogador(sender, senderName);",
  "",
  "    // Admin via texto",
  "    if (text.startsWith('admin ') || text === 'admin') {",
  "      var cmdTexto = text === 'admin' ? 'admin ajuda' : text;",
  "      await processarComandoAdmin(client, message, sender, cmdTexto);",
  "      return;",
  "    }",
  "",
  "    // Comandos jogador privado",
  "    switch (text) {",
  "      case 'ajuda':    await ajudaPrivado(client, message, sender); break;",
  "      case 'confirmar': await confirmar(client, message, sender, senderName); break;",
  "      case 'cancelar':  await cancelar(client, message, sender); break;",
  "      case 'lista':     await lista(client, message, sender); break;",
  "      default: break;",
  "    }",
  "  } catch(e) { console.error('[onMessage] Erro:', e); }",
  "}",
  "",
  "// Auto-registro: quando jogador manda mensagem pela primeira vez",
  "// 1. Se ja existe com @c.us: atualiza nome se necessario",
  "// 2. Se existe com @lid (mesmo nome): migra para numero real",
  "// 3. Se nao existe: cadastra e vincula ao grupo mais ativo",
  "async function autoRegistrarJogador(sender, senderName) {",
  "  try {",
  "    // Ja existe com numero real?",
  "    var [existente] = await db.execute('SELECT id, nome FROM jogadores WHERE whatsapp_id = ?', [sender]);",
  "    if (existente.length > 0) {",
  "      // Atualiza nome se mudou e nome nao e padrao",
  "      if (senderName && senderName !== 'Jogador' && existente[0].nome !== senderName) {",
  "        await db.execute('UPDATE jogadores SET nome = ? WHERE id = ?', [senderName, existente[0].id]);",
  "      }",
  "      return;",
  "    }",
  "",
  "    // Tenta migrar registro LID pelo nome exato",
  "    if (senderName && senderName !== 'Jogador') {",
  "      var [lidRows] = await db.execute(",
  "        'SELECT id FROM jogadores WHERE nome = ? AND whatsapp_id LIKE \"%@lid\"',",
  "        [senderName]",
  "      );",
  "      if (lidRows.length === 1) {",
  "        await db.execute('UPDATE jogadores SET whatsapp_id = ? WHERE id = ?', [sender, lidRows[0].id]);",
  "        console.log('[AutoReg] Migrado LID -> real:', senderName, sender);",
  "        return;",
  "      }",
  "    }",
  "",
  "    // Cadastra novo jogador",
  "    var [result] = await db.execute(",
  "      'INSERT IGNORE INTO jogadores (whatsapp_id, nome) VALUES (?, ?)',",
  "      [sender, senderName]",
  "    );",
  "",
  "    if (result.insertId) {",
  "      // Vincula ao grupo mais ativo (maior numero de jogadores ativos)",
  "      var [grupos] = await db.execute(",
  "        'SELECT grupo_id, COUNT(*) as total FROM grupo_jogadores WHERE ativo = TRUE GROUP BY grupo_id ORDER BY total DESC LIMIT 1'",
  "      );",
  "      if (grupos.length > 0) {",
  "        await db.execute(",
  "          'INSERT IGNORE INTO grupo_jogadores (grupo_id, jogador_id) VALUES (?, ?)',",
  "          [grupos[0].grupo_id, result.insertId]",
  "        );",
  "        console.log('[AutoReg] Novo jogador:', senderName, sender, '-> grupo', grupos[0].grupo_id);",
  "      }",
  "    }",
  "  } catch(e) {",
  "    console.error('[AutoReg] Erro:', e);",
  "  }",
  "}",
  "",
  ""
].join('\n');

if (indexContent.match(oldOnMessage)) {
  indexContent = indexContent.replace(oldOnMessage, newOnMessage);
  console.log('[OK] index_meta.js - auto-registro adicionado');
} else {
  console.log('[SKIP] index_meta.js - padrao onMessage nao encontrado');
}

fs.writeFileSync(indexPath, indexContent);
console.log('[OK] index_meta.js salvo');

// ============================================================
// PATCH 3: scheduler.js — torna mensagens de grupo opcionais
// ============================================================

var schedulerPath = path.join(BASE, 'src/bot/scheduler.js');
var schedulerContent = fs.readFileSync(schedulerPath, 'utf8');

// Garante MODO_TESTE = false
if (schedulerContent.includes('MODO_TESTE = true')) {
  schedulerContent = schedulerContent.replace('MODO_TESTE = true', 'MODO_TESTE = false');
  console.log('[OK] scheduler.js - MODO_TESTE = false');
} else {
  console.log('[SKIP] scheduler.js - MODO_TESTE ja era false');
}

// Envolve mensagens de grupo (whatsapp_id@g.us) em try/catch silencioso
// Para nao quebrar quando WPPConnect nao esta disponivel
var oldGroupMsg = /if \(clientRef\) \{\s*try \{\s*await clientRef\.sendText\(p\.whatsapp_id,/g;
// Ja tem try/catch — verifica se MODO_TESTE foi corrigido
fs.writeFileSync(schedulerPath, schedulerContent);
console.log('[OK] scheduler.js salvo');

// ============================================================
// RESUMO
// ============================================================

console.log('\n============================================');
console.log('Deploy concluido! Reinicie o bot:');
console.log('pm2 restart appfut-meta --update-env');
console.log('============================================');
console.log('\nO que foi corrigido:');
console.log('1. admin grupos    -> lista grupos do banco (sem listChats)');
console.log('2. admin vincular  -> aceita ID e nome direto (sem getGroupMembers)');
console.log('3. verificarAdmin  -> verifica apenas no banco de dados');
console.log('4. auto-registro   -> jogadores se cadastram ao mandar mensagem');
console.log('   - Migra registros LID para numero real (match por nome exato)');
console.log('   - Vincula ao grupo mais ativo automaticamente');
console.log('5. scheduler       -> MODO_TESTE = false garantido');
