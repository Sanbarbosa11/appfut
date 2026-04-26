require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.evolution') });

var db          = require('../database/connection');
var { delay }   = require('../utils/rateLimit');
var createClient = require('../client/evolutionClient');

var instanceName = process.env.PILOT_INSTANCE_NAME || 'appfut-piloto';
var adminSessoes = {}; // { remoteJid: { grupoId, grupoNome, at } }
var SESSAO_TTL   = 4 * 60 * 60 * 1000;
var _ultimaLista = {}; // { remoteJid: { lista, grupoId } }

async function processarComandoAdmin(remoteJid, texto) {
  var args    = (texto || '').substring(6).trim().split(/\s+/);
  var comando = (args[0] || '').toLowerCase();
  var client  = createClient();

  switch (comando) {
    case 'ajuda':         return adminAjuda(client, remoteJid);
    case 'grupos':        return adminGrupos(client, remoteJid);
    case 'grupo':         return adminGrupoAtivar(client, remoteJid, args);
    case 'participantes': return adminParticipantes(client, remoteJid);
    case 'ativar':        return adminToggleJogador(client, remoteJid, args, true);
    case 'desativar':     return adminToggleJogador(client, remoteJid, args, false);
    case 'criar':         return adminCriarPartida(client, remoteJid, args);
    case 'fechar':        return adminFecharPartida(client, remoteJid);
    case 'status':        return adminStatus(client, remoteJid);
    default:
      await delay();
      await client.message.sendText(instanceName, remoteJid,
        'Comando admin não reconhecido. Digite *admin ajuda* para ver os comandos.'
      );
  }
}

async function buscarGrupoAtivo(sender) {
  var sessao = adminSessoes[sender];
  if (sessao && (Date.now() - sessao.at) < SESSAO_TTL) {
    var [rows] = await db.execute('SELECT * FROM grupos WHERE id = ?', [sessao.grupoId]);
    if (rows.length > 0) return { grupo: rows[0], multiplos: false, grupos: null };
    delete adminSessoes[sender];
  }
  var [grupos] = await db.execute(
    'SELECT g.* FROM grupos g JOIN admins a ON g.id = a.grupo_id WHERE a.whatsapp_id = ? ORDER BY g.nome ASC',
    [sender]
  );
  if (grupos.length === 0) return { grupo: null, multiplos: false, grupos: null };
  if (grupos.length === 1) {
    adminSessoes[sender] = { grupoId: grupos[0].id, grupoNome: grupos[0].nome, at: Date.now() };
    return { grupo: grupos[0], multiplos: false, grupos: null };
  }
  return { grupo: null, multiplos: true, grupos: grupos };
}

function getGrupoAtivoId(sender) {
  var sessao = adminSessoes[sender];
  if (sessao && (Date.now() - sessao.at) < SESSAO_TTL) return sessao.grupoId;
  return null;
}

async function mostrarSelecaoGrupo(client, remoteJid, grupos) {
  var sessao = adminSessoes[remoteJid];
  var texto  = '📌 *Você gerencia ' + grupos.length + ' grupos. Selecione um:*\n\n';
  for (var i = 0; i < grupos.length; i++) {
    var marcador = sessao && sessao.grupoId === grupos[i].id ? ' ← *ativo*' : '';
    texto += 'ID *' + grupos[i].id + '* — ' + grupos[i].nome + marcador + '\n';
  }
  texto += '\nDigite: *admin grupo ativar ID*\n_Seleção fica ativa por 4 horas._';
  await client.message.sendText(instanceName, remoteJid, texto);
}

async function adminAjuda(client, remoteJid) {
  await delay();
  var sessao     = adminSessoes[remoteJid];
  var grupoAtivo = sessao ? '\n📌 *Grupo ativo:* ' + sessao.grupoNome + '\n' : '';
  await client.message.sendText(instanceName, remoteJid,
    '🔧 *Comandos Admin*\n' + grupoAtivo + '\n' +
    '📋 *Gestão de grupo:*\n' +
    '• *admin grupos* — Lista seus grupos com IDs\n' +
    '• *admin grupo ativar ID* — Ativa um grupo\n\n' +
    '👥 *Gestão de jogadores:*\n' +
    '• *admin participantes* — Lista membros\n' +
    '• *admin ativar N* — Ativa jogador\n' +
    '• *admin desativar N* — Desativa jogador\n\n' +
    '⚽ *Gestão de partidas:*\n' +
    '• *admin criar DD/MM HH:MM - HH:MM vagas*\n' +
    '• *admin fechar* — Fecha partida atual\n' +
    '• *admin status* — Visão geral\n\n' +
    '💡 _Exemplo: admin criar 26/04 20:00 - 22:00 14_'
  );
}

async function adminGrupos(client, remoteJid) {
  await delay();
  var [grupos] = await db.execute(
    'SELECT g.* FROM grupos g JOIN admins a ON g.id = a.grupo_id WHERE a.whatsapp_id = ? ORDER BY g.nome ASC',
    [remoteJid]
  );
  if (grupos.length === 0) {
    await client.message.sendText(instanceName, remoteJid, 'Você não é admin de nenhum grupo vinculado. ⚠️');
    return;
  }
  var sessao = adminSessoes[remoteJid];
  var texto  = '📋 *Seus grupos (' + grupos.length + '):*\n\n';
  for (var i = 0; i < grupos.length; i++) {
    var marcador = sessao && sessao.grupoId === grupos[i].id ? ' ← *ativo*' : '';
    texto += 'ID *' + grupos[i].id + '* — ' + grupos[i].nome + marcador + '\n';
  }
  if (grupos.length > 1) texto += '\nPara ativar: *admin grupo ativar ID*';
  await client.message.sendText(instanceName, remoteJid, texto);
}

async function adminGrupoAtivar(client, remoteJid, args) {
  await delay();
  if (args[1] !== 'ativar' || !args[2]) {
    await client.message.sendText(instanceName, remoteJid,
      'Use: *admin grupo ativar ID*\nDigite *admin grupos* para ver os IDs disponíveis.'
    );
    return;
  }
  var grupoId = parseInt(args[2]);
  if (!grupoId) {
    await client.message.sendText(instanceName, remoteJid, 'ID inválido. Digite *admin grupos* para ver os IDs.');
    return;
  }
  var [rows] = await db.execute(
    'SELECT g.* FROM grupos g JOIN admins a ON g.id = a.grupo_id WHERE a.whatsapp_id = ? AND g.id = ?',
    [remoteJid, grupoId]
  );
  if (rows.length === 0) {
    await client.message.sendText(instanceName, remoteJid,
      'Grupo ID *' + grupoId + '* não encontrado ou você não é admin dele. ⚠️\n\nDigite *admin grupos* para ver seus grupos.'
    );
    return;
  }
  adminSessoes[remoteJid] = { grupoId: rows[0].id, grupoNome: rows[0].nome, at: Date.now() };
  await client.message.sendText(instanceName, remoteJid,
    '✅ *Grupo ativado: ' + rows[0].nome + '*\n\nTodos os comandos admin operarão neste grupo pelos próximos 4 horas.'
  );
}

async function adminParticipantes(client, remoteJid) {
  await delay();
  var resultado = await buscarGrupoAtivo(remoteJid);
  if (resultado.multiplos) { await mostrarSelecaoGrupo(client, remoteJid, resultado.grupos); return; }
  if (!resultado.grupo)    { await client.message.sendText(instanceName, remoteJid, 'Você não é admin de nenhum grupo vinculado. ⚠️'); return; }
  var grupo = resultado.grupo;

  var [jogadores] = await db.execute(
    'SELECT j.id, j.nome, gj.ativo FROM grupo_jogadores gj JOIN jogadores j ON gj.jogador_id = j.id WHERE gj.grupo_id = ? ORDER BY j.nome ASC',
    [grupo.id]
  );
  if (jogadores.length === 0) {
    await client.message.sendText(instanceName, remoteJid, 'Nenhum jogador cadastrado neste grupo. ⚠️');
    return;
  }
  var texto = '👥 *Participantes — ' + grupo.nome + '*\n\n';
  for (var i = 0; i < jogadores.length; i++) {
    texto += (i + 1) + '. ' + jogadores[i].nome + ' ' + (jogadores[i].ativo ? '✅' : '❌') + '\n';
  }
  texto += '\n💡 *admin ativar N* ou *admin desativar N*';
  _ultimaLista[remoteJid] = { lista: jogadores, grupoId: grupo.id };
  await client.message.sendText(instanceName, remoteJid, texto);
}

async function adminToggleJogador(client, remoteJid, args, ativo) {
  await delay();
  var resultado = await buscarGrupoAtivo(remoteJid);
  if (resultado.multiplos) { await mostrarSelecaoGrupo(client, remoteJid, resultado.grupos); return; }
  if (!resultado.grupo)    { await client.message.sendText(instanceName, remoteJid, 'Você não é admin de nenhum grupo vinculado. ⚠️'); return; }

  var numero = parseInt(args[1]);
  var cache  = _ultimaLista[remoteJid];
  if (!cache || !numero || numero < 1 || numero > cache.lista.length) {
    await client.message.sendText(instanceName, remoteJid, 'Número inválido. Digite *admin participantes* primeiro.');
    return;
  }
  var jogador = cache.lista[numero - 1];
  await db.execute(
    'UPDATE grupo_jogadores SET ativo = ? WHERE grupo_id = ? AND jogador_id = ?',
    [ativo, cache.grupoId, jogador.id]
  );
  await client.message.sendText(instanceName, remoteJid,
    '👤 *' + jogador.nome + '* foi ' + (ativo ? 'ativado ✅' : 'desativado ❌')
  );
}

async function adminCriarPartida(client, remoteJid, args) {
  await delay();
  var resultado = await buscarGrupoAtivo(remoteJid);
  if (resultado.multiplos) { await mostrarSelecaoGrupo(client, remoteJid, resultado.grupos); return; }
  if (!resultado.grupo)    { await client.message.sendText(instanceName, remoteJid, 'Você não é admin de nenhum grupo vinculado. ⚠️'); return; }
  var grupo = resultado.grupo;

  if (args.length < 2) {
    await client.message.sendText(instanceName, remoteJid,
      'Use: *admin criar DD/MM HH:MM - HH:MM vagas*\n_Exemplo: admin criar 26/04 20:00 - 22:00 14_'
    );
    return;
  }

  var dataParts = (args[1] || '').split('/');
  if (dataParts.length < 2) {
    await client.message.sendText(instanceName, remoteJid, 'Formato de data inválido. Use DD/MM');
    return;
  }

  var dia  = parseInt(dataParts[0]);
  var mes  = parseInt(dataParts[1]) - 1;
  var ano  = new Date().getFullYear();
  var dataPartida = new Date(ano, mes, dia);
  var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  if (dataPartida < hoje) dataPartida = new Date(ano + 1, mes, dia);

  var horarioInicio = null, horarioFim = null, vagas;
  if (args[2] && /^\d{1,2}:\d{2}$/.test(args[2])) {
    horarioInicio = args[2] + ':00';
    if (args[3] === '-' && args[4] && /^\d{1,2}:\d{2}$/.test(args[4])) {
      horarioFim = args[4] + ':00';
      vagas = parseInt(args[5]) || grupo.max_jogadores;
    } else {
      vagas = parseInt(args[3]) || grupo.max_jogadores;
    }
  } else {
    vagas = parseInt(args[2]) || grupo.max_jogadores;
  }

  await db.execute('UPDATE partidas SET status = "fechada" WHERE grupo_id = ? AND status = "aberta"', [grupo.id]);

  var dataMySQL = dataPartida.getFullYear() + '-' +
    String(dataPartida.getMonth() + 1).padStart(2, '0') + '-' +
    String(dataPartida.getDate()).padStart(2, '0');

  await db.execute(
    'INSERT INTO partidas (grupo_id, data_partida, max_jogadores) VALUES (?, ?, ?)',
    [grupo.id, dataMySQL, vagas || 14]
  );

  if (horarioInicio) {
    await db.execute(
      'UPDATE grupos SET horario_inicio = ?, horario_fim = ? WHERE id = ?',
      [horarioInicio, horarioFim || null, grupo.id]
    );
  }

  var dataFormatada = dataPartida.toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric'
  });
  var horarioTexto = horarioInicio
    ? '⏰ ' + args[2] + (horarioFim ? ' - ' + args[4] : '') + '\n'
    : '';

  await client.message.sendText(instanceName, remoteJid,
    '✅ *Partida criada!*\n\n' +
    '📋 Grupo: ' + grupo.nome + '\n' +
    '📅 ' + dataFormatada + '\n' +
    horarioTexto +
    '👥 ' + (vagas || 14) + ' vagas'
  );
}

async function adminFecharPartida(client, remoteJid) {
  await delay();
  var resultado = await buscarGrupoAtivo(remoteJid);
  if (resultado.multiplos) { await mostrarSelecaoGrupo(client, remoteJid, resultado.grupos); return; }
  if (!resultado.grupo)    { await client.message.sendText(instanceName, remoteJid, 'Você não é admin de nenhum grupo vinculado. ⚠️'); return; }
  var grupo = resultado.grupo;

  var [partidas] = await db.execute(
    'SELECT id FROM partidas WHERE grupo_id = ? AND status = "aberta"', [grupo.id]
  );
  if (partidas.length === 0) {
    await client.message.sendText(instanceName, remoteJid, 'Não há partida aberta em *' + grupo.nome + '*. ⚠️');
    return;
  }
  var [contagem] = await db.execute(
    'SELECT COUNT(*) as total FROM presencas WHERE partida_id = ?', [partidas[0].id]
  );
  await db.execute('UPDATE partidas SET status = "fechada" WHERE id = ?', [partidas[0].id]);
  await client.message.sendText(instanceName, remoteJid,
    '✅ *Partida fechada!*\n📋 Grupo: ' + grupo.nome + '\n👥 ' + contagem[0].total + ' confirmados'
  );
}

async function adminStatus(client, remoteJid) {
  await delay();
  var resultado = await buscarGrupoAtivo(remoteJid);
  if (resultado.multiplos) { await mostrarSelecaoGrupo(client, remoteJid, resultado.grupos); return; }
  if (!resultado.grupo)    { await client.message.sendText(instanceName, remoteJid, 'Você não é admin de nenhum grupo vinculado. ⚠️'); return; }
  var grupo = resultado.grupo;

  var [partidas] = await db.execute(
    'SELECT id, data_partida, max_jogadores FROM partidas WHERE grupo_id = ? AND status = "aberta"', [grupo.id]
  );
  var [jogadores] = await db.execute(
    'SELECT COUNT(*) as total FROM grupo_jogadores WHERE grupo_id = ? AND ativo = TRUE', [grupo.id]
  );

  var texto = '📊 *Status — ' + grupo.nome + '*\n\n';
  texto += '👥 Jogadores ativos: ' + jogadores[0].total + '\n';

  if (partidas.length > 0) {
    var data = new Date(partidas[0].data_partida);
    data = new Date(data.getTime() + data.getTimezoneOffset() * 60000);
    var dataFormatada = data.toLocaleDateString('pt-BR', {
      weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric'
    });
    var [contagem] = await db.execute(
      'SELECT COUNT(*) as total FROM presencas WHERE partida_id = ?', [partidas[0].id]
    );
    texto += '\n⚽ *Partida aberta:*\n📅 ' + dataFormatada + '\n📋 ' + contagem[0].total + '/' + partidas[0].max_jogadores + ' confirmados';
  } else {
    texto += '\n⚠️ Nenhuma partida aberta';
  }

  await client.message.sendText(instanceName, remoteJid, texto);
}

module.exports = { processarComandoAdmin, getGrupoAtivoId };
