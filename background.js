let scrapingState = {
    isRunning: false,
    isPaused: false,
    tabId: null,
    config: null,
    page: 0,
    stats: {
        emailsFound: 0,
        pagesScraped: 0
    }
};

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'start_scraping') {
        startScraping(message.data);
        sendResponse({ status: 'started' });
    } else if (message.action === 'stop_scraping') {
        stopScraping();
        sendResponse({ status: 'stopped' });
    } else if (message.action === 'pause_scraping') {
        pauseScraping();
        sendResponse({ status: 'paused' });
    } else if (message.action === 'resume_scraping') {
        resumeScraping();
        sendResponse({ status: 'resumed' });
    }
    return true;
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'emails_extracted') {
        handleExtractedEmails(message.data);
    }
});

// Listen for tab updates to inject script/trigger scraping on next page
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (scrapingState.isRunning && !scrapingState.isPaused && tabId === scrapingState.tabId && changeInfo.status === 'complete') {
        setTimeout(() => {
            chrome.tabs.sendMessage(tabId, { action: 'scrape_page' }).catch(err => {
                // If message fails, inject script
                chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['content.js']
                }).then(() => {
                    chrome.tabs.sendMessage(tabId, { action: 'scrape_page' });
                });
            });
        }, 2000);
    }
});

// Handle tab closure
chrome.tabs.onRemoved.addListener((tabId) => {
    if (scrapingState.isRunning && tabId === scrapingState.tabId) {
        stopScraping();
    }
});

function startScraping(data) {
    scrapingState.isRunning = true;
    scrapingState.isPaused = false;
    scrapingState.config = data;
    scrapingState.page = 0;
    scrapingState.stats = { emailsFound: 0, pagesScraped: 0 };

    // Save state
    chrome.storage.local.set({ isRunning: true, isPaused: false, stats: scrapingState.stats });

    const query = `site:${data.platform} "${data.keyword}" "${data.location}" "${data.emailDomain}"`;
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

    chrome.tabs.create({ url: url, active: false }, (tab) => {
        scrapingState.tabId = tab.id;
    });
}

function stopScraping() {
    scrapingState.isRunning = false;
    scrapingState.isPaused = false;
    chrome.storage.local.set({ isRunning: false, isPaused: false });
    chrome.runtime.sendMessage({ action: 'scraping_stopped' });
}

function pauseScraping() {
    if (scrapingState.isRunning) {
        scrapingState.isPaused = true;
        chrome.storage.local.set({ isPaused: true });
    }
}

function resumeScraping() {
    if (scrapingState.isRunning && scrapingState.isPaused) {
        scrapingState.isPaused = false;
        chrome.storage.local.set({ isPaused: false });
        // Trigger next page or current page scrape to restart loop
        goToNextPage();
    }
}

function handleExtractedEmails(emails) {
    if (!scrapingState.isRunning || scrapingState.isPaused) return;

    // Process and save emails
    chrome.storage.local.get(['emails'], (result) => {
        let existingEmails = result.emails || [];
        const newEmails = [];

        emails.forEach(email => {
            // Check for duplicates
            if (!existingEmails.some(e => e.email === email)) {
                newEmails.push({
                    email: email,
                    domain: email.split('@')[1],
                    keyword: scrapingState.config.keyword,
                    location: scrapingState.config.location,
                    platform: scrapingState.config.platform,
                    date: new Date().toISOString().split('T')[0]
                });
            }
        });

        const updatedEmails = [...existingEmails, ...newEmails];

        // Update stats
        scrapingState.stats.emailsFound = updatedEmails.length;
        scrapingState.stats.pagesScraped++;

        chrome.storage.local.set({
            emails: updatedEmails,
            stats: scrapingState.stats
        });

        // Notify popup
        chrome.runtime.sendMessage({
            action: 'update_stats',
            stats: {
                totalEmails: updatedEmails.length,
                pagesScraped: scrapingState.stats.pagesScraped
            }
        });

        // Next page logic
        goToNextPage();
    });
}

function goToNextPage() {
    if (!scrapingState.isRunning || scrapingState.isPaused) return;

    const delay = Math.floor(Math.random() * 3000) + 2000; // 2-5 seconds delay
    scrapingState.page += 10; // Google pagination

    setTimeout(() => {
        if (!scrapingState.isRunning || scrapingState.isPaused) return;

        const query = `site:${scrapingState.config.platform} "${scrapingState.config.keyword}" "${scrapingState.config.location}" "${scrapingState.config.emailDomain}"`;
        const nextUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&start=${scrapingState.page}`;

        chrome.tabs.update(scrapingState.tabId, { url: nextUrl });
    }, delay);
}
