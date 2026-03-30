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
const fs = require('fs');


// Global state
let isOnline = false;

// Configuration
const USER_NUMBERS = [
    // "88993181649",
    // "88094915583",
    // "88993749282",
    // "88994147169",
    // "88993531007",
    // "88993217608",
    // "88992451157",
    // "88994291710",
    // "88992803168",
    // "88993417224",
    // "88992020590",
    // "88992768580",
    // "88994326439",
    // "88993704063",
    // "88992784072",
    // "88992874235",
    // "88992774215",
    // "88992025181",
    // "88993646144",
    // "55889923278",
    // "88992455250",
    // "88994170346",
    // "88992707805",
    // "85992350341",
    // "88994420589",
    // // "85991822515",
    // // "88981935886",
    "88992495168",
    "88993214752",
    "88992813487",
    "88993053325",
    "88993398735",
    "88994110094",
    "88992472337",
    "88992747616",
    "88994593059",
    "88992803212",
    "88992918643",
    "85999261124",
    "88994400998",
    "88994877045",
    "88994055435"
];

const GROUP_ID = '120363407127587847@g.us'; // Existing group ID
const DELAY_BETWEEN_PEOPLE = 10000; // 10 seconds
const BATCH_SIZE = 20;
const DELAY_BETWEEN_BATCHES = 30000; // 30 seconds

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
            isOnline = false;
            const statusCode = (lastDisconnect.error instanceof Boom) ? lastDisconnect.error.output.statusCode : 0;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            console.log(`Connection closed (Status: ${statusCode}). Reconnecting: ${shouldReconnect}`);
            
            if (shouldReconnect) {
                // Wait 5 seconds before reconnecting to avoid spam/conflicts
                setTimeout(() => {
                    console.log('Attempting to reconnect...');
                    connectToWhatsApp();
                }, 5000);
            }
        } else if (connection === 'open') {
            isOnline = true;
            console.log('Opened connection');

            const resultsLog = {
                success: [],
                alreadyInGroup: [],
                privacyError: [],
                otherErrors: []
            };

            try {
                const participantJids = await resolveJids(sock, USER_NUMBERS);

                if (participantJids.length === 0) {
                    console.error('No valid participants found. Cannot proceed.');
                    return;
                }

                if (GROUP_ID) {
                    console.log(`Starting to add ${participantJids.length} participants to group: ${GROUP_ID}`);

                    for (let i = 0; i < participantJids.length; i++) {
                        // CRITICAL: Check if still online before each addition
                        if (!isOnline) {
                            console.warn('Connection lost. Stopping group addition loop.');
                            break;
                        }

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
                        const updateResult = await sock.groupParticipantsUpdate(GROUP_ID, [jid], 'add');
                        updateResult.forEach((response) => {
                            const statusLabel = response.status === '200' ? 'OK' : response.status;
                            console.log(`  ↳ ${response.jid} status: ${statusLabel}${response.error ? ` (${response.error})` : ''}`);

                            const logEntry = { jid: response.jid, status: response.status, error: response.error || null };

                            if (response.status === '200') {
                                resultsLog.success.push(logEntry);
                            } else if (response.status === '409') {
                                resultsLog.alreadyInGroup.push(logEntry);
                            } else if (response.status === '403') {
                                resultsLog.privacyError.push(logEntry);
                            } else {
                                resultsLog.otherErrors.push(logEntry);
                            }
                        });
                    }

                    // Save the results to a file
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const logFileName = `group_addition_results_${timestamp}.json`;
                    fs.writeFileSync(logFileName, JSON.stringify(resultsLog, null, 2));
                    console.log(`\nResults report saved to: ${logFileName}`);

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
