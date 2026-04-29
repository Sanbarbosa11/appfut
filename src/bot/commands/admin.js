var db = require('../../database/connection');
var { delay } = require('../utils/rateLimit');

// Sessoes ativas por admin: { sender: { grupoId, grupoNome, at } }
var adminSessoes = {};
var SESSAO_TTL = 4 * 60 * 60 * 1000; // 4 horas

// ============================================================
// PONTO DE ENTRADA
// ============================================================

async function processarComandoAdmin(client, message, sender, texto) {
  var args = texto.substring(6).trim().split(/\s+/);
  var comando = args[0];

  switch (comando) {
    case 'ajuda':
      await adminAjuda(client, message, sender);
      break;
    case 'grupos':
      await adminGrupos(client, message, sender);
      break;
    case 'grupo':
      await adminGrupoAtivar(client, message, sender, args);
      break;
    case 'vincular':
      await adminVincular(client, message, sender, args);
      break;
    case 'participantes':
      await adminParticipantes(client, message, sender);
      break;
    case 'ativar':
      await adminToggleJogador(client, message, sender, args, true);
      break;
    case 'desativar':
      await adminToggleJogador(client, message, sender, args, false);
      break;
    case 'criar':
      await adminCriarPartida(client, message, sender, args);
      break;
    case 'fechar':
      await adminFecharPartida(client, message, sender);
      break;
    case 'status':
      await adminStatus(client, message, sender);
      break;
    case 'link':
      await adminLink(client, message, sender);
      break;
    case 'sortear':
      await adminSortear(client, message, sender);
      break;
    default:
      await delay();
      await client.sendText(message.from,
        'Comando admin n\u00e3o reconhecido.\nDigite *admin ajuda* para ver os comandos.'
      );
      break;
  }
}

// ============================================================
// SELECAO DE GRUPO (sessao em memoria)
// ============================================================

async function buscarGrupoAtivo(sender) {
  // Verifica sessao ativa
  var sessao = adminSessoes[sender];
  if (sessao && (Date.now() - sessao.at) < SESSAO_TTL) {
    var [rows] = await db.execute('SELECT * FROM grupos WHERE id = ? AND ativo = TRUE', [sessao.grupoId]);
    if (rows.length > 0) return { grupo: rows[0], multiplos: false, grupos: null };
    // Grupo foi desativado — limpa sessao
    delete adminSessoes[sender];
  }

  var [grupos] = await db.execute(
    'SELECT g.* FROM grupos g JOIN admins a ON g.id = a.grupo_id WHERE a.whatsapp_id = ? AND g.ativo = TRUE ORDER BY g.nome ASC',
    [sender]
  );

  if (grupos.length === 0) return { grupo: null, multiplos: false, grupos: null };

  if (grupos.length === 1) {
    adminSessoes[sender] = { grupoId: grupos[0].id, grupoNome: grupos[0].nome, at: Date.now() };
    return { grupo: grupos[0], multiplos: false, grupos: null };
  }

  // Multiplos grupos sem selecao ativa
  return { grupo: null, multiplos: true, grupos: grupos };
}

async function mostrarSelecaoGrupo(client, message, grupos, sender) {
  var sessao = adminSessoes[sender];
  var texto = '\ud83d\udccc *Voc\u00ea gerencia ' + grupos.length + ' grupos. Selecione um:*\n\n';
  for (var i = 0; i < grupos.length; i++) {
    var marcador = sessao && sessao.grupoId === grupos[i].id ? ' \u2190 *ativo*' : '';
    texto += 'ID *' + grupos[i].id + '* \u2014 ' + grupos[i].nome + marcador + '\n';
  }
  texto += '\nDigite: *admin grupo ativar ID*\n_Exemplo: admin grupo ativar ' + grupos[0].id + '_\n\n';
  texto += '_Sele\u00e7\u00e3o fica ativa por 4 horas._';
  await client.sendText(message.from, texto);
}

async function adminGrupoAtivar(client, message, sender, args) {
  await delay();

  if (args[1] !== 'ativar' || !args[2]) {
    await client.sendText(message.from,
      'Use: *admin grupo ativar ID*\n' +
      'Digite *admin grupos* para ver os IDs dispon\u00edveis.'
    );
    return;
  }

  var grupoId = parseInt(args[2]);
  if (!grupoId) {
    await client.sendText(message.from, 'ID inv\u00e1lido. Digite *admin grupos* para ver os IDs.');
    return;
  }

  var [rows] = await db.execute(
    'SELECT g.* FROM grupos g JOIN admins a ON g.id = a.grupo_id WHERE a.whatsapp_id = ? AND g.id = ? AND g.ativo = TRUE',
    [sender, grupoId]
  );

  if (rows.length === 0) {
    await client.sendText(message.from,
      'Grupo ID *' + grupoId + '* n\u00e3o encontrado ou voc\u00ea n\u00e3o \u00e9 admin dele. \u26a0\ufe0f\n\n' +
      'Digite *admin grupos* para ver seus grupos.'
    );
    return;
  }

  adminSessoes[sender] = { grupoId: rows[0].id, grupoNome: rows[0].nome, at: Date.now() };

  await client.sendText(message.from,
    '\u2705 *Grupo ativado: ' + rows[0].nome + '*\n\n' +
    'Todos os comandos admin operar\u00e3o neste grupo pelos pr\u00f3ximos 4 horas.\n\n' +
    'Para trocar: *admin grupos* e depois *admin grupo ativar ID*'
  );
}

// ============================================================
// admin ajuda
// ============================================================

async function adminAjuda(client, message, sender) {
  await delay();

  var sessao = adminSessoes[sender];
  var grupoAtivo = sessao ? '\n\ud83d\udccc *Grupo ativo:* ' + sessao.grupoNome + '\n' : '';

  await client.sendText(message.from,
    '\ud83d\udd27 *Comandos Admin*\n' + grupoAtivo + '\n' +
    '\ud83d\udccb *Gest\u00e3o de grupo:*\n' +
    '\u2022 *admin grupos* \u2014 Lista seus grupos com IDs\n' +
    '\u2022 *admin grupo ativar ID* \u2014 Ativa um grupo\n' +
    '\u2022 *admin vincular N* \u2014 Vincula grupo ao sistema\n\n' +
    '\ud83d\udc65 *Gest\u00e3o de jogadores:*\n' +
    '\u2022 *admin participantes* \u2014 Lista membros\n' +
    '\u2022 *admin ativar N* \u2014 Ativa jogador\n' +
    '\u2022 *admin desativar N* \u2014 Desativa jogador\n\n' +
    '\u26bd *Gest\u00e3o de partidas:*\n' +
    '\u2022 *admin criar DD/MM HH:MM - HH:MM vagas*\n' +
    '\u2022 *admin fechar* \u2014 Fecha partida atual\n' +
    '\u2022 *admin status* \u2014 Vis\u00e3o geral\n\n' +
    '\ud83d\udd17 *Convite:*\n' +
    '\u2022 *admin link* \u2014 Reenviar link de cadastro\n\n' +
    '\ud83c\udfb2 *Times:*\n' +
    '\u2022 *admin sortear* \u2014 Sortear dois times\n\n' +
    '\ud83d\udca1 _Exemplo: admin criar 26/04 20:00 - 22:00 14_'
  );
}

// ============================================================
// admin grupos — lista grupos do admin
// ============================================================

async function adminGrupos(client, message, sender) {
  await delay();

  var [grupos] = await db.execute(
    'SELECT g.* FROM grupos g JOIN admins a ON g.id = a.grupo_id WHERE a.whatsapp_id = ? AND g.ativo = TRUE ORDER BY g.nome ASC',
    [sender]
  );

  if (grupos.length === 0) {
    await client.sendText(message.from, 'Voc\u00ea n\u00e3o \u00e9 admin de nenhum grupo vinculado. \u26a0\ufe0f');
    return;
  }

  var sessao = adminSessoes[sender];
  var texto = '\ud83d\udccb *Seus grupos (' + grupos.length + '):*\n\n';
  for (var i = 0; i < grupos.length; i++) {
    var marcador = sessao && sessao.grupoId === grupos[i].id ? ' \u2190 *ativo*' : '';
    texto += 'ID *' + grupos[i].id + '* \u2014 ' + grupos[i].nome + marcador + '\n';
  }

  if (grupos.length > 1) {
    texto += '\nPara ativar: *admin grupo ativar ID*\n_Exemplo: admin grupo ativar ' + grupos[0].id + '_';
  }

  await client.sendText(message.from, texto);
}

// ============================================================
// admin vincular — vincula grupo ao sistema
// ============================================================

async function adminVincular(client, message, sender, args) {
  await delay();

  var numero = parseInt(args[1]);
  if (!numero) {
    await client.sendText(message.from,
      'Use: *admin vincular NUMERO*\nPrimeiro digite *admin grupos* para ver a lista.'
    );
    return;
  }

  var chats = await client.listChats();
  var grupos = chats.filter(function(c) { return c.isGroup; });

  if (numero < 1 || numero > grupos.length) {
    await client.sendText(message.from, 'N\u00famero inv\u00e1lido. Digite *admin grupos* para ver a lista.');
    return;
  }

  var grupo = grupos[numero - 1];
  var grupoId = grupo.id._serialized;

  var isAdmin = await verificarAdminGrupo(client, grupoId, sender);
  if (!isAdmin) {
    await client.sendText(message.from, 'Voc\u00ea n\u00e3o \u00e9 administrador desse grupo no WhatsApp. \u26a0\ufe0f');
    return;
  }

  var [existente] = await db.execute('SELECT id FROM grupos WHERE whatsapp_id = ?', [grupoId]);
  if (existente.length > 0) {
    await client.sendText(message.from, 'Este grupo j\u00e1 est\u00e1 vinculado! \u2705');
    return;
  }

  var [resultGrupo] = await db.execute(
    'INSERT INTO grupos (whatsapp_id, nome) VALUES (?, ?)',
    [grupoId, grupo.name]
  );
  var dbGrupoId = resultGrupo.insertId;

  await db.execute('INSERT IGNORE INTO admins (grupo_id, whatsapp_id) VALUES (?, ?)', [dbGrupoId, sender]);

  var participantes = await client.getGroupMembers(grupoId);
  var me = await client.getHostDevice();
  var cadastrados = 0;

  for (var i = 0; i < participantes.length; i++) {
    var p = participantes[i];
    var pId = p.id._serialized;
    if (pId === me.id._serialized) continue;

    await db.execute(
      'INSERT IGNORE INTO jogadores (whatsapp_id, nome) VALUES (?, ?)',
      [pId, p.pushname || p.verifiedName || 'Jogador']
    );
    var [jog] = await db.execute('SELECT id FROM jogadores WHERE whatsapp_id = ?', [pId]);
    if (jog.length > 0) {
      await db.execute(
        'INSERT IGNORE INTO grupo_jogadores (grupo_id, jogador_id) VALUES (?, ?)',
        [dbGrupoId, jog[0].id]
      );
    }
    cadastrados++;
  }

  await client.sendText(message.from,
    '\u2705 *Grupo vinculado com sucesso!*\n\n' +
    '\ud83d\udccb Grupo: ' + grupo.name + '\n' +
    '\ud83d\udc65 ' + cadastrados + ' membros cadastrados\n\n' +
    'Pr\u00f3ximos passos:\n' +
    '1\ufe0f\u20e3 *admin participantes* \u2014 Revise os jogadores\n' +
    '2\ufe0f\u20e3 *admin criar DD/MM HH:MM - HH:MM vagas* \u2014 Crie a primeira partida'
  );
}

// ============================================================
// admin participantes
// ============================================================

async function adminParticipantes(client, message, sender) {
  await delay();

  var resultado = await buscarGrupoAtivo(sender);
  if (resultado.multiplos) { await mostrarSelecaoGrupo(client, message, resultado.grupos, sender); return; }
  if (!resultado.grupo) { await client.sendText(message.from, 'Voc\u00ea n\u00e3o \u00e9 admin de nenhum grupo vinculado. \u26a0\ufe0f'); return; }
  var grupo = resultado.grupo;

  var [jogadores] = await db.execute(
    'SELECT j.id, j.whatsapp_id, j.nome, gj.ativo FROM grupo_jogadores gj JOIN jogadores j ON gj.jogador_id = j.id WHERE gj.grupo_id = ? ORDER BY j.nome ASC',
    [grupo.id]
  );

  if (jogadores.length === 0) {
    await client.sendText(message.from, 'Nenhum jogador cadastrado neste grupo. \u26a0\ufe0f');
    return;
  }

  var texto = '\ud83d\udc65 *Participantes \u2014 ' + grupo.nome + '*\n\n';
  for (var i = 0; i < jogadores.length; i++) {
    texto += (i + 1) + '. ' + jogadores[i].nome + ' ' + (jogadores[i].ativo ? '\u2705' : '\u274c') + '\n';
  }
  texto += '\n\ud83d\udca1 *admin ativar N* ou *admin desativar N*';

  adminParticipantes._ultimaLista = jogadores;
  adminParticipantes._ultimoGrupoId = grupo.id;

  await client.sendText(message.from, texto);
}

// ============================================================
// admin ativar / desativar
// ============================================================

async function adminToggleJogador(client, message, sender, args, ativo) {
  await delay();

  var resultado = await buscarGrupoAtivo(sender);
  if (resultado.multiplos) { await mostrarSelecaoGrupo(client, message, resultado.grupos, sender); return; }
  if (!resultado.grupo) { await client.sendText(message.from, 'Voc\u00ea n\u00e3o \u00e9 admin de nenhum grupo vinculado. \u26a0\ufe0f'); return; }

  var numero = parseInt(args[1]);
  if (!numero) {
    await client.sendText(message.from,
      'Use: *admin ' + (ativo ? 'ativar' : 'desativar') + ' NUMERO*\n' +
      'Primeiro digite *admin participantes* para ver a lista.'
    );
    return;
  }

  var lista = adminParticipantes._ultimaLista;
  var grupoId = adminParticipantes._ultimoGrupoId;
  if (!lista || !grupoId || numero < 1 || numero > lista.length) {
    await client.sendText(message.from, 'N\u00famero inv\u00e1lido. Digite *admin participantes* primeiro.');
    return;
  }

  var jogador = lista[numero - 1];
  await db.execute(
    'UPDATE grupo_jogadores SET ativo = ? WHERE grupo_id = ? AND jogador_id = ?',
    [ativo, grupoId, jogador.id]
  );

  await client.sendText(message.from,
    '\ud83d\udc64 *' + jogador.nome + '* foi ' + (ativo ? 'ativado \u2705' : 'desativado \u274c')
  );
}

// ============================================================
// admin criar
// ============================================================

async function adminCriarPartida(client, message, sender, args) {
  await delay();

  var resultado = await buscarGrupoAtivo(sender);
  if (resultado.multiplos) { await mostrarSelecaoGrupo(client, message, resultado.grupos, sender); return; }
  if (!resultado.grupo) { await client.sendText(message.from, 'Voc\u00ea n\u00e3o \u00e9 admin de nenhum grupo vinculado. \u26a0\ufe0f'); return; }
  var grupo = resultado.grupo;

  if (args.length < 2) {
    await client.sendText(message.from,
      'Use: *admin criar DD/MM HH:MM - HH:MM vagas*\n' +
      '_Exemplo: admin criar 26/04 20:00 - 22:00 14_'
    );
    return;
  }

  var dataParts = args[1].split('/');
  if (dataParts.length < 2) {
    await client.sendText(message.from, 'Formato de data inv\u00e1lido. Use DD/MM');
    return;
  }

  var dia = parseInt(dataParts[0]);
  var mes = parseInt(dataParts[1]) - 1;
  var ano = new Date().getFullYear();
  var dataPartida = new Date(ano, mes, dia);
  var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  if (dataPartida < hoje) dataPartida = new Date(ano + 1, mes, dia);

  var horarioInicio = null;
  var horarioFim = null;
  var vagas;

  if (args[2] && /^\d{1,2}:\d{2}$/.test(args[2])) {
    horarioInicio = args[2] + ':00';
    if (args[3] === '-' && args[4] && /^\d{1,2}:\d{2}$/.test(args[4])) {
      // formato: 20:00 - 22:00 30
      horarioFim = args[4] + ':00';
      vagas = parseInt(args[5]) || grupo.max_jogadores;
    } else if (args[3] && /^\d{1,2}:\d{2}$/.test(args[3])) {
      // formato: 20:00 22:00 30 (sem traço)
      horarioFim = args[3] + ':00';
      vagas = parseInt(args[4]) || grupo.max_jogadores;
    } else {
      vagas = parseInt(args[3]) || grupo.max_jogadores;
    }
  } else {
    vagas = parseInt(args[2]) || grupo.max_jogadores;
  }

  await db.execute(
    'UPDATE partidas SET status = "fechada" WHERE grupo_id = ? AND status = "aberta"',
    [grupo.id]
  );

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

  var inicioDisplay = horarioInicio ? horarioInicio.replace(/:00$/, '') : '';
  var fimDisplay    = horarioFim    ? horarioFim.replace(/:00$/, '')    : '';
  var horarioTexto  = inicioDisplay
    ? '\u23f0 ' + inicioDisplay + (fimDisplay ? ' - ' + fimDisplay : '') + '\n'
    : '';

  await client.sendText(message.from,
    '\u2705 *Partida criada!*\n\n' +
    '\ud83d\udccb Grupo: ' + grupo.nome + '\n' +
    '\ud83d\udcc5 ' + dataFormatada + '\n' +
    horarioTexto +
    '\ud83d\udc65 ' + (vagas || 14) + ' vagas'
  );
}

// ============================================================
// admin fechar
// ============================================================

async function adminFecharPartida(client, message, sender) {
  await delay();

  var resultado = await buscarGrupoAtivo(sender);
  if (resultado.multiplos) { await mostrarSelecaoGrupo(client, message, resultado.grupos, sender); return; }
  if (!resultado.grupo) { await client.sendText(message.from, 'Voc\u00ea n\u00e3o \u00e9 admin de nenhum grupo vinculado. \u26a0\ufe0f'); return; }
  var grupo = resultado.grupo;

  var [partidas] = await db.execute(
    'SELECT id FROM partidas WHERE grupo_id = ? AND status = "aberta"',
    [grupo.id]
  );

  if (partidas.length === 0) {
    await client.sendText(message.from, 'N\u00e3o h\u00e1 partida aberta em *' + grupo.nome + '*. \u26a0\ufe0f');
    return;
  }

  var [contagem] = await db.execute(
    'SELECT COUNT(*) as total FROM presencas WHERE partida_id = ?',
    [partidas[0].id]
  );

  await db.execute('UPDATE partidas SET status = "fechada" WHERE id = ?', [partidas[0].id]);

  await client.sendText(message.from,
    '\u2705 *Partida fechada!*\n' +
    '\ud83d\udccb Grupo: ' + grupo.nome + '\n' +
    '\ud83d\udc65 ' + contagem[0].total + ' confirmados'
  );
}

// ============================================================
// admin status
// ============================================================

async function adminStatus(client, message, sender) {
  await delay();

  var resultado = await buscarGrupoAtivo(sender);
  if (resultado.multiplos) { await mostrarSelecaoGrupo(client, message, resultado.grupos, sender); return; }
  if (!resultado.grupo) { await client.sendText(message.from, 'Voc\u00ea n\u00e3o \u00e9 admin de nenhum grupo vinculado. \u26a0\ufe0f'); return; }
  var grupo = resultado.grupo;

  var [partidas] = await db.execute(
    'SELECT id, data_partida, max_jogadores FROM partidas WHERE grupo_id = ? AND status = "aberta"',
    [grupo.id]
  );
  var [jogadores] = await db.execute(
    'SELECT COUNT(*) as total FROM grupo_jogadores WHERE grupo_id = ? AND ativo = TRUE',
    [grupo.id]
  );

  var texto = '\ud83d\udcca *Status \u2014 ' + grupo.nome + '*\n\n';
  texto += '\ud83d\udc65 Jogadores ativos: ' + jogadores[0].total + '\n';

  if (partidas.length > 0) {
    var data = new Date(partidas[0].data_partida);
    data = new Date(data.getTime() + data.getTimezoneOffset() * 60000);
    var dataFormatada = data.toLocaleDateString('pt-BR', {
      weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric'
    });
    var [contagem] = await db.execute(
      'SELECT COUNT(*) as total FROM presencas WHERE partida_id = ?', [partidas[0].id]
    );
    texto += '\n\u26bd *Partida aberta:*\n';
    texto += '\ud83d\udcc5 ' + dataFormatada + '\n';
    texto += '\ud83d\udccb ' + contagem[0].total + '/' + partidas[0].max_jogadores + ' confirmados';
  } else {
    texto += '\n\u26a0\ufe0f Nenhuma partida aberta';
  }

  await client.sendText(message.from, texto);
}

// ============================================================
// AUXILIARES
// ============================================================

async function verificarAdminGrupo(client, grupoId, senderId) {
  try {
    var participantes = await client.getGroupMembers(grupoId);
    var membro = participantes.find(function(p) { return p.id._serialized === senderId; });
    return membro && (membro.isAdmin || membro.isSuperAdmin);
  } catch (e) {
    return false;
  }
}

// ============================================================
// admin sortear — sorteia dois times com confirmados + avulsos
// ============================================================

var DIAS_SORT = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];

async function adminSortear(client, message, sender) {
  await delay();

  var resultado = await buscarGrupoAtivo(sender);
  if (resultado.multiplos) { await mostrarSelecaoGrupo(client, message, resultado.grupos, sender); return; }
  if (!resultado.grupo) { await client.sendText(message.from, 'Você não é admin de nenhum grupo vinculado. ⚠️'); return; }
  var grupo = resultado.grupo;

  var [partidas] = await db.execute(
    'SELECT id, data_partida FROM partidas WHERE grupo_id = ? AND status = "aberta" ORDER BY data_partida ASC LIMIT 1',
    [grupo.id]
  );
  if (partidas.length === 0) {
    await client.sendText(message.from, 'Não há partida aberta em *' + grupo.nome + '*. ⚠️');
    return;
  }
  var partida = partidas[0];

  var [confirmados] = await db.execute(
    'SELECT j.nome FROM presencas pr JOIN jogadores j ON pr.jogador_id = j.id WHERE pr.partida_id = ?',
    [partida.id]
  );
  var [avulsos] = await db.execute(
    'SELECT nome FROM avulsos WHERE partida_id = ?',
    [partida.id]
  );

  var jogadores = confirmados.map(function(j) { return j.nome; })
    .concat(avulsos.map(function(a) { return a.nome; }));

  if (jogadores.length < 2) {
    await client.sendText(message.from,
      'Poucos jogadores confirmados para sortear (' + jogadores.length + '). Aguarde mais confirmações. ⚠️'
    );
    return;
  }

  // Fisher-Yates shuffle
  for (var i = jogadores.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = jogadores[i]; jogadores[i] = jogadores[j]; jogadores[j] = tmp;
  }

  var meio  = Math.ceil(jogadores.length / 2);
  var timeA = jogadores.slice(0, meio);
  var timeB = jogadores.slice(meio);

  var d = new Date(partida.data_partida);
  d = new Date(d.getTime() + d.getTimezoneOffset() * 60000);
  var dataStr = DIAS_SORT[d.getDay()] + ', ' +
    String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0');

  var texto = '⚽ *Sorteio de times — ' + grupo.nome + '*\n' +
    '📅 ' + dataStr + ' · ' + jogadores.length + ' jogadores\n\n' +
    '🔵 *Time A (' + timeA.length + '):*\n';
  timeA.forEach(function(n, i) { texto += (i+1) + '. ' + n + '\n'; });
  texto += '\n🔴 *Time B (' + timeB.length + '):*\n';
  timeB.forEach(function(n, i) { texto += (i+1) + '. ' + n + '\n'; });
  texto += '\n🔄 _Para sortear novamente: *admin sortear*_';

  await client.sendText(message.from, texto);
}

// ============================================================
// admin link — reenvia link de convite do grupo
// ============================================================

async function adminLink(client, message, sender) {
  await delay();

  var resultado = await buscarGrupoAtivo(sender);
  if (resultado.multiplos) { await mostrarSelecaoGrupo(client, message, resultado.grupos, sender); return; }
  if (!resultado.grupo) { await client.sendText(message.from, 'Você não é admin de nenhum grupo vinculado. ⚠️'); return; }
  var grupo = resultado.grupo;

  var [rows] = await db.execute('SELECT invite_token FROM grupos WHERE id = ?', [grupo.id]);
  if (rows.length === 0 || !rows[0].invite_token) {
    await client.sendText(message.from, 'Link de convite não encontrado. Remova e adicione o bot ao grupo novamente.');
    return;
  }

  var metaNumero = process.env.META_BOT_NUMBER || '5511995421741';
  var link = 'https://wa.me/' + metaNumero + '?text=entrar%20' + rows[0].invite_token;

  await client.sendText(message.from,
    '🔗 *Link de convite — ' + grupo.nome + '*\n\n' +
    link + '\n\n' +
    '_Compartilhe este link com os membros do grupo._\n' +
    '_Cada membro clica uma única vez para se cadastrar._'
  );
}

function getGrupoAtivoId(sender) {
  var sessao = adminSessoes[sender];
  if (sessao && (Date.now() - sessao.at) < SESSAO_TTL) return sessao.grupoId;
  return null;
}

function setGrupoAtivo(sender, grupoId, grupoNome) {
  adminSessoes[sender] = { grupoId: grupoId, grupoNome: grupoNome || '', at: Date.now() };
}

module.exports = { processarComandoAdmin, verificarAdminGrupo, getGrupoAtivoId, setGrupoAtivo };
