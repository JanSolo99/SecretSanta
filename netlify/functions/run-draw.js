const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

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

    // The Netlify Email Integration requires these variables to be set
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
        // 1. SETUP: Load participants and submission data
        const participantsPath = path.resolve(__dirname, '../../participants.json');
        const submissionsPath = path.resolve(__dirname, '../../temp-submissions.json');
        
        const allParticipants = JSON.parse(fs.readFileSync(participantsPath, 'utf8'));
        const submissions = JSON.parse(fs.readFileSync(submissionsPath, 'utf8'));

        // 2. LOCKING PHASE
        const lockedPairs = [];
        const lockedGivers = new Set();
        const lockedReceivers = new Set();
        const emailMap = {};

        submissions.forEach(sub => {
            const giver = sub['submitter-name'];
            emailMap[giver] = sub['submitter-email'];

            // Check assignment 1
            if (sub['receiver-1-name'] && sub['gift-purchased-1'] === 'true') {
                const receiver = sub['receiver-1-name'];
                if (allParticipants.includes(giver) && allParticipants.includes(receiver)) {
                    lockedPairs.push({ giver, receiver });
                    lockedGivers.add(giver);
                    lockedReceivers.add(receiver);
                }
            }
            // Check assignment 2 (for cases like Erica's)
            if (sub['receiver-2-name'] && sub['gift-purchased-2'] === 'true') {
                const receiver = sub['receiver-2-name'];
                 if (allParticipants.includes(giver) && allParticipants.includes(receiver)) {
                    lockedPairs.push({ giver, receiver });
                    lockedGivers.add(giver);
                    lockedReceivers.add(receiver);
                }
            }
        });

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

                // Crucial constraint: No self-assignment
                if (giver === receiver) {
                    // If it's the last person and they got themselves, the shuffle failed.
                    if (i === givers.length - 1) {
                        possible = false;
                        break; 
                    }
                    // Otherwise, swap with the next person
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

        if (!success) {
            throw new Error("Failed to find a valid assignment without self-pairing after 100 attempts.");
        }

        // 4. OUTPUT & DELIVERY
        const finalAssignments = [...lockedPairs, ...newAssignments];
        const emailPromises = [];

        // URL is a built-in Netlify environment variable
        const emailEndpoint = `${process.env.URL}/.netlify/functions/emails/assignment`;

        for (const pair of finalAssignments) {
            const { giver, receiver } = pair;
            const giverEmail = emailMap[giver] || Object.values(submissions).find(s => s['submitter-name'] === giver)?.['submitter-email'];

            if (giverEmail) {
                const emailPayload = {
                    from: `santa@${process.env.NETLIFY_EMAILS_MAILGUN_DOMAIN}`,
                    to: giverEmail,
                    subject: 'Your New Secret Santa Assignment!',
                    parameters: {
                        giver: giver,
                        receiver: receiver,
                    },
                };

                const promise = fetch(emailEndpoint, {
                    method: 'POST',
                    headers: {
                        'netlify-emails-secret': process.env.NETLIFY_EMAILS_SECRET,
                    },
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
