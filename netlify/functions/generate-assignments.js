const fs = require('fs');
const path = require('path');

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

        for (const sub of submissions) {
            const giver = sub['submitter-name'];

            const processAssignment = (receiverName, giftPurchased) => {
                if (receiverName && giftPurchased === 'true') {
                    if (allParticipants.includes(giver) && allParticipants.includes(receiverName)) {
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

        // 4. OUTPUT
        const finalAssignments = [...lockedPairs, ...newAssignments];

        return {
            statusCode: 200,
            body: JSON.stringify({ 
                success: true,
                message: `Successfully generated ${finalAssignments.length} assignments.`, 
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