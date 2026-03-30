const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    jidDecode
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const qrcode = require('qrcode-terminal');

const GROUP_ID = '120363407127587847@g.us';

async function listParticipants() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    console.log('Connecting to WhatsApp to fetch group participants...');

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: ['JP', 'Safari', '3.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('Scan this QR code with your WhatsApp:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            console.log('Connection closed. If you haven\'t scanned the QR in the main script, please do so first.');
            process.exit(0);
        } else if (connection === 'open') {
            console.log('Connected! Fetching metadata for:', GROUP_ID);

            try {
                const metadata = await sock.groupMetadata(GROUP_ID);
                const participants = metadata.participants;

                console.log(`Found ${participants.length} participants.`);

                const numbers = participants.map(p => {
                    const phoneNumber = p.phoneNumber || (p.id.includes('@s.whatsapp.net') ? p.id.split('@')[0] : null);
                    // If still no phone number, try to extract from ID if it matches phone pattern
                    if (!phoneNumber && p.id.includes('@s.whatsapp.net')) {
                        return p.id.split('@')[0];
                    }
                    return phoneNumber ? phoneNumber.split('@')[0] : null;
                }).filter(n => n && n.length > 5); // Simple filter for valid-looking numbers

                const content = numbers.join('\n');
                fs.writeFileSync('participants_list.txt', content);

                console.log('Successfully saved to participants_list.txt');
                
                // End process
                process.exit(0);

            } catch (error) {
                console.error('Failed to fetch group metadata:', error.message);
                process.exit(1);
            }
        }
    });
}

listParticipants().catch(err => {
    console.error('Critical error:', err);
    process.exit(1);
});
