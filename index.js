const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeInMemoryStore,
    jidDecode,
    delay
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

// Configuration
const USER_NUMBERS = [
   
]; 

const GROUP_ID = '120363407463933339@g.us'; // Existing group ID
const DELAY_BETWEEN_PEOPLE = 30000; // 30 seconds
const BATCH_SIZE = 20;
const DELAY_BETWEEN_BATCHES = 60000; // 1 minute

async function resolveJids(sock, numbers) {
    const jids = [];
    for (const number of numbers) {
        try {
            const cleanNumber = number.replace(/\D/g, '');
            if (!cleanNumber) continue;
            
            const formattedNumber = cleanNumber.startsWith('55') ? cleanNumber : '55' + cleanNumber;
            
            console.log(`Resolving JID for: ${formattedNumber}`);
            const [result] = await sock.onWhatsApp(formattedNumber);
            
            if (result && result.exists) {
                console.log(`✓ Resolved: ${result.jid}`);
                jids.push(result.jid);
            } else {
                console.warn(`✗ Could not find WhatsApp account for: ${number}`);
            }
        } catch (err) {
            console.error(`Error resolving JID for ${number}:`, err.message);
        }
    }
    return jids;
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version, isLatest } = await fetchLatestBaileysVersion();

    console.log(`Using WhatsApp v${version.join('.')}, isLatest: ${isLatest}`);

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
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
            const shouldReconnect = (lastDisconnect.error instanceof Boom) ? 
                lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut : true;
            console.log('Connection closed due to', lastDisconnect.error, ', reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('Opened connection');
            
            try {
                const participantJids = await resolveJids(sock, USER_NUMBERS);
                
                if (participantJids.length === 0) {
                    console.error('No valid participants found. Cannot proceed.');
                    return;
                }

                if (GROUP_ID) {
                    console.log(`Starting to add ${participantJids.length} participants to group: ${GROUP_ID}`);
                    
                    for (let i = 0; i < participantJids.length; i++) {
                        const jid = participantJids[i];
                        
                        // Check for batch delay
                        if (i > 0 && i % BATCH_SIZE === 0) {
                            console.log(`Reached batch limit of ${BATCH_SIZE}. Waiting ${DELAY_BETWEEN_BATCHES / 1000}s...`);
                            await delay(DELAY_BETWEEN_BATCHES);
                        } else if (i > 0) {
                            console.log(`Waiting ${DELAY_BETWEEN_PEOPLE / 1000}s before adding next participant...`);
                            await delay(DELAY_BETWEEN_PEOPLE);
                        }

                        console.log(`[${i + 1}/${participantJids.length}] Adding participant: ${jid}`);
                        await sock.groupParticipantsUpdate(GROUP_ID, [jid], 'add');
                    }
                    
                    console.log('All participants processed successfully');
                } else {
                    console.log('No GROUP_ID provided. Please provide a group ID to add participants.');
                }
                
            } catch (error) {
                console.error('Failed to perform group operation:', error);
                if (error.data) {
                    console.error('Error detail:', JSON.stringify(error.data, null, 2));
                }
            }
        }
    });

    return sock;
}

connectToWhatsApp();
