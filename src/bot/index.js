const wppconnect = require('@wppconnect-team/wppconnect');
const db = require('../database/connection');
const { processarComandoGrupo } = require('./commands/grupo');
const { processarComandoAdmin } = require('./commands/admin');
const { ajudaPrivado } = require('./commands/ajuda');
const { confirmar } = require('./commands/confirmar');
const { cancelar } = require('./commands/cancelar');
const { lista } = require('./commands/lista');

async function start() {
  const client = await wppconnect.create({
    session: 'appfut-bot',
    headless: true,
    useChrome: false,
    puppeteerOptions: {
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  });

  console.log('Bot iniciado com sucesso!');

  // Listener de mensagens
  client.onMessage(async (message) => {
    try {
      if (!message.sender) return;

      const isGroup = message.isGroupMsg;
      const text = (message.body || '').trim().toLowerCase();
      const sender = message.sender.id;
      const senderName = message.sender.pushname || 'Jogador';

      if (isGroup) {
        await processarComandoGrupo(client, message);
        return;
      }

      // Comandos admin (prefixo "admin")
      if (text.startsWith('admin ') || text === 'admin') {
        var cmdTexto = text === 'admin' ? 'admin ajuda' : text;
        await processarComandoAdmin(client, message, sender, cmdTexto);
        return;
      }

      // Comandos do jogador no privado
      switch (text) {
        case 'ajuda':
          await ajudaPrivado(client, message, sender);
          break;
        case 'confirmar':
          await confirmar(client, message, sender, senderName);
          break;
        case 'cancelar':
          await cancelar(client, message, sender);
          break;
        case 'lista':
          await lista(client, message, sender);
          break;
        default:
          break;
      }
    } catch (error) {
      console.error('Erro ao processar mensagem:', error);
    }
  });

  // Listener de participantes entrando/saindo do grupo
  client.onParticipantsChanged(async (event) => {
    try {
      var grupoId = event.groupId || event.chat;
      var participantId = event.who;

      // Verifica se o grupo esta vinculado
      var [grupos] = await db.execute(
        'SELECT id FROM grupos WHERE whatsapp_id = ?', [grupoId]
      );
      if (grupos.length === 0) return;

      var dbGrupoId = grupos[0].id;

      if (event.action === 'add') {
        // Novo membro entrou — cadastra jogador + vincula ao grupo
        console.log('Novo membro no grupo:', participantId);
        await db.execute(
          'INSERT IGNORE INTO jogadores (whatsapp_id, nome) VALUES (?, ?)',
          [participantId, 'Jogador']
        );
        var [jog] = await db.execute(
          'SELECT id FROM jogadores WHERE whatsapp_id = ?', [participantId]
        );
        if (jog.length > 0) {
          await db.execute(
            'INSERT IGNORE INTO grupo_jogadores (grupo_id, jogador_id) VALUES (?, ?)',
            [dbGrupoId, jog[0].id]
          );
        }
      } else if (event.action === 'remove') {
        // Membro saiu — desativa neste grupo (nao afeta outros grupos)
        console.log('Membro saiu do grupo:', participantId);
        var [jog] = await db.execute(
          'SELECT id FROM jogadores WHERE whatsapp_id = ?', [participantId]
        );
        if (jog.length > 0) {
          await db.execute(
            'UPDATE grupo_jogadores SET ativo = FALSE WHERE grupo_id = ? AND jogador_id = ?',
            [dbGrupoId, jog[0].id]
          );
        }
      }
    } catch (error) {
      console.error('Erro em onParticipantsChanged:', error);
    }
  });
}

start().catch(console.error);
