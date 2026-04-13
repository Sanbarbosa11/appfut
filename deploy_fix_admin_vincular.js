/**
 * deploy_fix_admin_vincular.js
 *
 * 1. Corrige adminVincular em admin.js
 *    Novo formato: admin vincular ID_DB
 *    Exemplo: admin vincular 3
 *    (vincula o sender como admin do grupo com esse ID no banco)
 *
 * 2. Adiciona adminParticipantes se estiver faltando
 */

var fs = require('fs');
var BASE = '/home/appfutadmin/appfut';
var adminPath = BASE + '/src/bot/commands/admin.js';
var content = fs.readFileSync(adminPath, 'utf8');

// ---- 1. Adiciona adminVincular se nao existe ----
if (!content.includes('async function adminVincular')) {
  var novaFuncao = [
    "",
    "async function adminVincular(client, message, sender, args) {",
    "  await delay();",
    "  var idDb = parseInt(args[1]);",
    "  if (!idDb) {",
    "    await client.sendText(message.from,",
    "      'Use: *admin vincular ID*\\n' +",
    "      'O ID voce ve com *admin grupos*\\n' +",
    "      '_Exemplo: admin vincular 3_'",
    "    );",
    "    return;",
    "  }",
    "  var [grupo] = await db.execute('SELECT id, nome FROM grupos WHERE id = ?', [idDb]);",
    "  if (grupo.length === 0) {",
    "    await client.sendText(message.from, 'Grupo com ID ' + idDb + ' nao encontrado. Use *admin grupos* para ver os IDs.');",
    "    return;",
    "  }",
    "  await db.execute(",
    "    'INSERT IGNORE INTO admins (grupo_id, whatsapp_id) VALUES (?, ?)',",
    "    [idDb, sender]",
    "  );",
    "  await client.sendText(message.from,",
    "    '\u2705 Voce agora e admin do grupo *' + grupo[0].nome + '*!\\n\\n' +",
    "    'Proximos passos:\\n' +",
    "    '\u2022 *admin criar DATA VAGAS* - Criar partida\\n' +",
    "    '\u2022 *admin status* - Ver situacao atual\\n' +",
    "    '\u2022 *admin participantes* - Ver membros'",
    "  );",
    "}",
    ""
  ].join('\n');

  // Insere antes do module.exports
  content = content.replace(
    'module.exports = { processarComandoAdmin, verificarAdminGrupo };',
    novaFuncao + '\nmodule.exports = { processarComandoAdmin, verificarAdminGrupo };'
  );
  console.log('[OK] adminVincular adicionada');
} else {
  // Substitui a existente para usar novo formato
  content = content.replace(
    /async function adminVincular\(client, message, sender, args\)[\s\S]*?\n\}/,
    [
      "async function adminVincular(client, message, sender, args) {",
      "  await delay();",
      "  var idDb = parseInt(args[1]);",
      "  if (!idDb) {",
      "    await client.sendText(message.from,",
      "      'Use: *admin vincular ID*\\n' +",
      "      'O ID voce ve com *admin grupos*\\n' +",
      "      '_Exemplo: admin vincular 3_'",
      "    );",
      "    return;",
      "  }",
      "  var [grupo] = await db.execute('SELECT id, nome FROM grupos WHERE id = ?', [idDb]);",
      "  if (grupo.length === 0) {",
      "    await client.sendText(message.from, 'Grupo com ID ' + idDb + ' nao encontrado. Use *admin grupos* para ver os IDs.');",
      "    return;",
      "  }",
      "  await db.execute(",
      "    'INSERT IGNORE INTO admins (grupo_id, whatsapp_id) VALUES (?, ?)',",
      "    [idDb, sender]",
      "  );",
      "  await client.sendText(message.from,",
      "    '\u2705 Voce agora e admin do grupo *' + grupo[0].nome + '*!\\n\\n' +",
      "    'Proximos passos:\\n' +",
      "    '\u2022 *admin criar DATA VAGAS* - Criar partida\\n' +",
      "    '\u2022 *admin status* - Ver situacao atual\\n' +",
      "    '\u2022 *admin participantes* - Ver membros'",
      "  );",
      "}"
    ].join('\n')
  );
  console.log('[OK] adminVincular substituida');
}

// ---- 2. Adiciona adminParticipantes se nao existe ----
if (!content.includes('async function adminParticipantes')) {
  var adminPart = [
    "",
    "async function adminParticipantes(client, message, sender) {",
    "  await delay();",
    "  const grupo = await buscarGrupoDoAdmin(sender);",
    "  if (!grupo) { await client.sendText(message.from, 'Voc\u00ea n\u00e3o \u00e9 admin de nenhum grupo vinculado. \u26a0\ufe0f'); return; }",
    "  const [jogadores] = await db.execute(",
    "    'SELECT j.id, j.nome, gj.ativo FROM grupo_jogadores gj JOIN jogadores j ON gj.jogador_id = j.id WHERE gj.grupo_id = ? ORDER BY j.nome',",
    "    [grupo.id]",
    "  );",
    "  if (jogadores.length === 0) { await client.sendText(message.from, 'Nenhum participante encontrado.'); return; }",
    "  adminParticipantes._ultimaLista = jogadores;",
    "  adminParticipantes._ultimoGrupoId = grupo.id;",
    "  var texto = '\ud83d\udc65 *Participantes - ' + grupo.nome + '*\\n\\n';",
    "  jogadores.forEach(function(j, i) {",
    "    texto += (i + 1) + '. ' + j.nome + (j.ativo ? ' \u2705' : ' \u274c') + '\\n';",
    "  });",
    "  texto += '\\n\ud83d\udca1 Para ativar/desativar: *admin ativar N* ou *admin desativar N*';",
    "  await client.sendText(message.from, texto);",
    "}",
    "adminParticipantes._ultimaLista = [];",
    "adminParticipantes._ultimoGrupoId = null;",
    ""
  ].join('\n');

  content = content.replace(
    'module.exports = { processarComandoAdmin, verificarAdminGrupo };',
    adminPart + '\nmodule.exports = { processarComandoAdmin, verificarAdminGrupo };'
  );
  console.log('[OK] adminParticipantes adicionada');
} else {
  console.log('[SKIP] adminParticipantes ja existe');
}

// ---- 3. Atualiza ajuda para mostrar novo formato do vincular ----
content = content.replace(
  "'\u2022 *admin vincular NUMERO* - Vincula um grupo\\n' +",
  "'\u2022 *admin vincular ID* - Torna-se admin de um grupo\\n' +"
);

fs.writeFileSync(adminPath, content);
console.log('[OK] admin.js salvo');
console.log('\nReinicie: pm2 restart appfut-meta --update-env');
