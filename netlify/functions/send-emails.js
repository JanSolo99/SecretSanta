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
        // 1. GET ASSIGNMENTS AND EMAIL DATA
        const { assignments } = JSON.parse(event.body);
        if (!assignments || !Array.isArray(assignments)) {
            throw new Error("Invalid or missing assignments payload.");
        }

        const submissionsPath = path.resolve(__dirname, '../../temp-submissions.csv');
        const csvData = fs.readFileSync(submissionsPath, 'utf8');
        const submissions = parseCSV(csvData);
        
        const emailMap = {};
        submissions.forEach(sub => {
            emailMap[sub['submitter-name']] = sub['submitter-email'];
        });

        // 2. SEND EMAILS
        const emailPromises = [];
        const emailEndpoint = `${process.env.URL}/.netlify/functions/emails/assignment`;

        for (const pair of assignments) {
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
                message: `${emailPromises.length} emails were successfully queued for sending.`,
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