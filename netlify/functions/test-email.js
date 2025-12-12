const fetch = require('node-fetch');

exports.handler = async function(event, context) {
    // Ensure this is a GET request
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // Check for required environment variables
    if (!process.env.NETLIFY_EMAILS_PROVIDER || !process.env.NETLIFY_EMAILS_SECRET || !process.env.NETLIFY_EMAILS_MAILGUN_DOMAIN) {
        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                message: "Required email environment variables are not set. Please configure the Netlify Email Integration."
            }),
        };
    }

    const emailEndpoint = `${process.env.URL}/.netlify/functions/emails/test-email`;

    const emailPayload = {
        from: `santa@${process.env.NETLIFY_EMAILS_MAILGUN_DOMAIN}`,
        to: 'jtedingvberkh@gmail.com', // Hardcoded recipient from your example
        subject: 'Hello Jan',
        parameters: {}, // No parameters needed for this simple template
    };

    try {
        const response = await fetch(emailEndpoint, {
            method: 'POST',
            headers: {
                'netlify-emails-secret': process.env.NETLIFY_EMAILS_SECRET,
            },
            body: JSON.stringify(emailPayload),
        });

        if (response.ok) {
            return {
                statusCode: 200,
                body: "Test email sent successfully! Check the inbox for jtedingvberkh@gmail.com.",
            };
        } else {
            const errorBody = await response.text();
            return {
                statusCode: response.status,
                body: `Failed to send test email. Status: ${response.status}. Body: ${errorBody}`,
            };
        }

    } catch (error) {
        return {
            statusCode: 500,
            body: `An unexpected error occurred: ${error.message}`,
        };
    }
};
