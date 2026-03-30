const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

const AUTH_FOLDER = 'auth_info_baileys';

function formatGroupLine(index, metadata) {
    const subject = metadata.subject ?? '<sem assunto>';
    const participants = metadata.size ?? metadata.participants?.length ?? 'desconhecido';
    return `${String(index + 1).padStart(2, '0')}. ${subject} - ${metadata.id} (${participants} participantes)`;
}

async function listGroups() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    const { version, isLatest } = await fetchLatestBaileysVersion();

    console.log(`Usando WhatsApp v${version.join('.')}, versao mais recente: ${isLatest}`);

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
        auth: state,
        browser: ['WPP-Bot', 'Chrome', '1.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('Escaneie o QR Code com seu WhatsApp para continuar:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            console.log('Conexao aberta. Buscando grupos participantes...');
            try {
                const groups = await sock.groupFetchAllParticipating();
                const groupList = Object.values(groups);

                if (groupList.length === 0) {
                    console.log('Nenhum grupo encontrado com essa conta.');
                    return;
                }

                groupList.sort((a, b) => (a.subject ?? '').localeCompare(b.subject ?? ''));
                console.log(`Foram encontrados ${groupList.length} grupos:`);
                groupList.forEach((metadata, index) => {
                    console.log(formatGroupLine(index, metadata));
                });
            } catch (error) {
                console.error('Nao foi possivel buscar grupos:', error);
            }
        } else if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error instanceof Boom
                ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
                : true;
            console.log('Conexao encerrada', lastDisconnect?.error, 'Reabrir?', shouldReconnect);
            if (shouldReconnect) {
                listGroups().catch((error) => {
                    console.error('Erro ao reconectar:', error);
                });
            }
        }
    });
}

listGroups().catch((error) => {
    console.error('Erro ao iniciar o script de listagem:', error);
});
