chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'scrape_page') {
        const emails = extractEmails();
        chrome.runtime.sendMessage({
            action: 'emails_extracted',
            data: emails
        });
    }
});

function extractEmails() {
    const bodyText = document.body.innerText;
    // Regex to find emails
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

    const found = bodyText.match(emailRegex) || [];

    // Basic cleaning (remove trailing dots, etc if regex caught them)
    const cleanEmails = found.map(email => {
        // sometimes regex grabs a trailing dot if it's at end of sentence
        if (email.endsWith('.')) return email.slice(0, -1);
        return email;
    }).filter(email => {
        // Filter out some common false positives or junk
        return !email.endsWith('.png') && !email.endsWith('.jpg') && !email.endsWith('.gif');
    });

    // Unique
    return [...new Set(cleanEmails)];
}
