const formData = require('form-data');
const Mailgun = require('mailgun.js');
const fs = require('fs');
const path = require('path');

// Initialize Mailgun client
const mailgun = new Mailgun(formData);
const mg = mailgun.client({
    username: 'api',
    key: process.env.MAILGUN_API_KEY,
});
const mailgunDomain = process.env.MAILGUN_DOMAIN;

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

    if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                message: "Mailgun API Key or Domain is not set in environment variables."
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

        finalAssignments.forEach(pair => {
            const { giver, receiver } = pair;
            const giverEmail = emailMap[giver] || Object.values(submissions).find(s => s['submitter-name'] === giver)?.['submitter-email'];

            if (giverEmail) {
                const msg = {
                    to: giverEmail,
                    from: `Secret Santa Admin <mail@${mailgunDomain}>`,
                    subject: 'Your New Secret Santa Assignment!',
                    html: `
                        <div style="font-family: sans-serif; font-size: 16px; color: #333;">
                            <h2>Hi ${giver},</h2>
                            <p>The Secret Santa assignments have been corrected! Thank you for your patience.</p>
                            <p>Your new, official, final assignment is:</p>
                            <h1 style="font-size: 28px; color: #d9534f;">${receiver}</h1>
                            <p>Happy gifting!</p>
                            <br>
                            <p><em>(This is an automated message. Please do not reply.)</em></p>
                        </div>
                    `,
                };
                emailPromises.push(mg.messages.create(mailgunDomain, msg));
            } else {
                console.warn(`Could not find email for giver: ${giver}`);
            }
        });

        await Promise.all(emailPromises);

        return {
            statusCode: 200,
            body: JSON.stringify({ 
                success: true,
                message: `Successfully processed the draw. ${finalAssignments.length} assignments were finalized and ${emailPromises.length} emails were sent.`,
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
