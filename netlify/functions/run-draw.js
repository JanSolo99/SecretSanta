const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Helper function to parse CSV data into an array of objects
function parseCSV(csvData) {
    const lines = csvData.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.replace(/"/g, ''));
    const result = [];
    for (let i = 1; i < lines.length; i++) {
        const obj = {};
        const currentline = lines[i].split(',');
        for (let j = 0; j < headers.length; j++) {
            obj[headers[j]] = currentline[j].replace(/"/g, '');
        }
        result.push(obj);
    }
    return result;
}

// Helper function to shuffle an array
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    if (!process.env.NETLIFY_EMAILS_PROVIDER || !process.env.NETLIFY_EMAILS_SECRET) {
        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                message: "Required email environment variables are not set. Please configure the Netlify Email Integration."
            }),
        };
    }

    try {
        // 1. SETUP: Load participants and submission data from CSV
        const participantsPath = path.resolve(__dirname, '../../participants.json');
        const submissionsPath = path.resolve(__dirname, '../../temp-submissions.csv');
        
        const allParticipants = JSON.parse(fs.readFileSync(participantsPath, 'utf8'));
        const csvData = fs.readFileSync(submissionsPath, 'utf8');
        const submissions = parseCSV(csvData);

        // 2. LOCKING PHASE
        const lockedPairs = [];
        const lockedGivers = new Set();
        const lockedReceivers = new Set();
        const emailMap = {};

        for (const sub of submissions) {
            const giver = sub['submitter-name'];
            emailMap[giver] = sub['submitter-email'];

            const processAssignment = (receiverName, giftPurchased) => {
                if (receiverName && giftPurchased === 'true') {
                    if (allParticipants.includes(giver) && allParticipants.includes(receiverName)) {
                        // NEW: Check for duplicate locked receivers
                        if (lockedReceivers.has(receiverName)) {
                            throw new Error("Conflict: More than one person has purchased a gift for the same receiver. Manual intervention is required.");
                        }
                        lockedPairs.push({ giver, receiver: receiverName });
                        lockedGivers.add(giver);
                        lockedReceivers.add(receiverName);
                    }
                }
            };

            processAssignment(sub['receiver-1-name'], sub['gift-purchased-1']);
            processAssignment(sub['receiver-2-name'], sub['gift-purchased-2']);
        }

        // Create pools for the re-draw
        let availableGivers = allParticipants.filter(p => !lockedGivers.has(p));
        let availableReceivers = allParticipants.filter(p => !lockedReceivers.has(p));

        // 3. RE-ASSIGNMENT PHASE
        const newAssignments = [];
        let success = false;
        let attempts = 0;

        while (!success && attempts < 100) {
            attempts++;
            let givers = shuffle([...availableGivers]);
            let receivers = shuffle([...availableReceivers]);
            let possible = true;
            let assignments = [];

            for (let i = 0; i < givers.length; i++) {
                const giver = givers[i];
                let receiver = receivers[i];

                if (giver === receiver) {
                    if (i === givers.length - 1) {
                        possible = false;
                        break; 
                    }
                    [receivers[i], receivers[i + 1]] = [receivers[i + 1], receivers[i]];
                    receiver = receivers[i];
                }
                assignments.push({ giver, receiver });
            }

            if (possible) {
                newAssignments.push(...assignments);
                success = true;
            }
        }

        if (!success && newAssignments.length !== availableGivers.length) {
            throw new Error("Failed to find a valid assignment without self-pairing after 100 attempts.");
        }

        // 4. OUTPUT & DELIVERY
        const finalAssignments = [...lockedPairs, ...newAssignments];
        const emailPromises = [];
        const emailEndpoint = `${process.env.URL}/.netlify/functions/emails/assignment`;

        for (const pair of finalAssignments) {
            const { giver, receiver } = pair;
            const giverEmail = emailMap[giver];

            if (giverEmail) {
                const emailPayload = {
                    from: `santa@${process.env.NETLIFY_EMAILS_MAILGUN_DOMAIN}`,
                    to: giverEmail,
                    subject: 'Your New Secret Santa Assignment!',
                    parameters: { giver, receiver },
                };
                const promise = fetch(emailEndpoint, {
                    method: 'POST',
                    headers: { 'netlify-emails-secret': process.env.NETLIFY_EMAILS_SECRET },
                    body: JSON.stringify(emailPayload),
                });
                emailPromises.push(promise);
            } else {
                console.warn(`Could not find email for giver: ${giver}`);
            }
        }

        await Promise.all(emailPromises);

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: `Successfully processed the draw. ${finalAssignments.length} assignments were finalized and ${emailPromises.length} emails were queued for sending.`, 
                assignments: finalAssignments 
            }),
        };

    } catch (error) {
        console.error('Error executing function:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                message: `An error occurred: ${error.message}`
            }),
        };
    }
};

