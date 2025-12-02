document.addEventListener('DOMContentLoaded', () => {
  // --- Elements ---
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const startStopBtn = document.getElementById('start-stop-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const statusBar = document.getElementById('status-bar');
  const statusText = document.getElementById('status-text');
  const totalEmailsEl = document.getElementById('total-emails');
  const downloadBtn = document.getElementById('download-btn');
  const clearBtn = document.getElementById('clear-btn');

  // Inputs
  const keywordInput = document.getElementById('keyword');
  const locationInput = document.getElementById('location');
  const platformInput = document.getElementById('platform');
  const emailDomainInput = document.getElementById('email-domain');

  // Credits & Tokens
  const creditBalanceEl = document.getElementById('credit-balance');
  const tokenInput = document.getElementById('token-input');
  const claimBtn = document.getElementById('claim-btn');

  // --- State ---
  let isRunning = false;
  let isPaused = false;
  let credits = 0;

  // --- Initialization ---
  loadState();

  // --- Tab Switching ---
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      const tabId = tab.getAttribute('data-tab');
      document.getElementById(tabId).classList.add('active');
    });
  });

  // --- Start/Stop Logic ---
  startStopBtn.addEventListener('click', () => {
    if (isRunning) {
      stopScraping();
    } else {
      startScraping();
    }
  });

  // --- Pause Logic ---
  pauseBtn.addEventListener('click', () => {
    if (isPaused) {
      resumeScraping();
    } else {
      pauseScraping();
    }
  });

  function startScraping() {
    chrome.storage.local.get(['tokenExpiry', 'tokenType'], (result) => {
      const tokenType = result.tokenType || null;
      const tokenExpiryIso = result.tokenExpiry || null;
      if (tokenExpiryIso) {
        const isExpired = new Date(tokenExpiryIso).getTime() < Date.now();
        if (isExpired && tokenType !== 'UNLIMITED') {
          alert('Token expired. Please claim a new token.');
          document.querySelector('[data-tab="credits"]').click();
          return;
        }
      }

      if (credits <= 0) {
        alert('Insufficient credits! Please claim a token or purchase more credits.');
        document.querySelector('[data-tab="credits"]').click();
        return;
      }

      const keyword = keywordInput.value.trim();
      const location = locationInput.value.trim();
      const platform = platformInput.value;
      const emailDomain = emailDomainInput.value;

      if (!keyword || !location) {
        alert('Please enter a keyword and location.');
        return;
      }

      updateCredits(credits - 1);

      chrome.runtime.sendMessage({
        action: 'start_scraping',
        data: { keyword, location, platform, emailDomain }
      }, (response) => {
        if (response && response.status === 'started') {
          updateUIState(true, false);
        }
      });
    });
  }

  function stopScraping() {
    chrome.runtime.sendMessage({ action: 'stop_scraping' }, (response) => {
      if (response && response.status === 'stopped') {
        updateUIState(false, false);
      }
    });
  }

  function pauseScraping() {
    chrome.runtime.sendMessage({ action: 'pause_scraping' }, (response) => {
      if (response && response.status === 'paused') {
        updateUIState(true, true);
      }
    });
  }

  function resumeScraping() {
    chrome.runtime.sendMessage({ action: 'resume_scraping' }, (response) => {
      if (response && response.status === 'resumed') {
        updateUIState(true, false);
      }
    });
  }

  function updateUIState(running, paused) {
    isRunning = running;
    isPaused = paused;

    if (running) {
      startStopBtn.textContent = 'Stop';
      startStopBtn.classList.add('stop');
      statusBar.classList.remove('hidden');
      pauseBtn.classList.remove('hidden');

      if (paused) {
        pauseBtn.textContent = 'Resume';
        statusText.textContent = 'Scraping Paused...';
      } else {
        pauseBtn.textContent = 'Pause';
        // status text will be updated by background
      }
    } else {
      startStopBtn.textContent = 'Start';
      startStopBtn.classList.remove('stop');
      statusBar.classList.add('hidden');
      pauseBtn.classList.add('hidden');
      pauseBtn.textContent = 'Pause';
    }
  }

  // --- Data Handling ---
  function loadState() {
    chrome.storage.local.get(['isRunning', 'isPaused', 'emails', 'stats', 'credits'], (result) => {
      credits = result.credits || 0; // Default to 0, user needs to claim free trial
      creditBalanceEl.textContent = credits;

      if (result.isRunning) {
        updateUIState(true, result.isPaused || false);
      } else {
        updateUIState(false, false);
      }

      if (result.emails) {
        totalEmailsEl.textContent = result.emails.length;
      }

      if (result.stats && !result.isPaused) {
        statusText.textContent = `Found ${result.stats.emailsFound} emails across ${result.stats.pagesScraped} pages`;
      }
    });
  }

  // Listen for updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'update_stats') {
      totalEmailsEl.textContent = message.stats.totalEmails;
      if (!isPaused) {
        statusText.textContent = `Found ${message.stats.totalEmails} emails across ${message.stats.pagesScraped} pages`;
      }
    } else if (message.action === 'scraping_stopped') {
      updateUIState(false, false);
    }
  });

  // --- Token System ---
  claimBtn.addEventListener('click', () => {
    const token = tokenInput.value.trim();
    if (!token) {
      alert('Please enter a token.');
      return;
    }

    validateToken(token);
  });

  function computeChecksum(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = (hash * 31 + data[i]) >>> 0;
    }
    const hex = hash.toString(16).toUpperCase().padStart(8, '0');
    return hex.slice(0, 6);
  }

  function validateToken(token) {
    chrome.storage.local.get(['usedTokens'], (result) => {
      const usedTokens = result.usedTokens || [];
      if (usedTokens.includes(token)) {
        alert('This token has already been used.');
        return;
      }

      const parts = token.split('-');
      if (parts.length !== 4) {
        alert('Invalid token format.');
        return;
      }

      const type = parts[0];
      const days = parseInt(parts[1]);
      const random = parts[2];
      const checksum = parts[3];

      if (!['TRIAL', 'PAID', 'UNLIMITED'].includes(type)) {
        alert('Unknown token type.');
        return;
      }
      if (isNaN(days) || days < 0) {
        alert('Invalid token duration.');
        return;
      }
      if (!/^[A-Z0-9]{10}$/.test(random)) {
        alert('Invalid token code.');
        return;
      }
      const expected = computeChecksum(`${type}-${days}-${random}`);
      if (checksum !== expected) {
        alert('Invalid token checksum.');
        return;
      }

      let creditsToAdd = 0;
      if (type === 'TRIAL') {
        creditsToAdd = 5;
      } else if (type === 'PAID') {
        creditsToAdd = 100;
      } else if (type === 'UNLIMITED') {
        creditsToAdd = 9999;
      }

      const now = Date.now();
      let expiryIso = null;
      if (type !== 'UNLIMITED') {
        const expiryMs = now + (days * 24 * 60 * 60 * 1000);
        expiryIso = new Date(expiryMs).toISOString();
      }

      updateCredits(credits + creditsToAdd);
      usedTokens.push(token);
      chrome.storage.local.set({ usedTokens: usedTokens, tokenExpiry: expiryIso, tokenType: type });

      alert(`Success! Added ${creditsToAdd} credits.`);
      tokenInput.value = '';
    });
  }

  function updateCredits(newAmount) {
    credits = newAmount;
    creditBalanceEl.textContent = credits;
    chrome.storage.local.set({ credits: credits });
  }

  // --- CSV Download ---
  downloadBtn.addEventListener('click', () => {
    chrome.storage.local.get(['emails'], (result) => {
      const emails = result.emails || [];
      if (emails.length === 0) {
        alert('No emails to download.');
        return;
      }

      const csvContent = generateCSV(emails);
      downloadFile(csvContent, 'mailhunter-emails.csv');
    });
  });

  function generateCSV(data) {
    const headers = ['Email', 'Domain', 'Keyword', 'Location', 'Platform', 'Date Collected'];
    const rows = data.map(item => [
      item.email,
      item.domain,
      item.keyword,
      item.location,
      item.platform,
      item.date
    ]);

    const csvArray = [headers, ...rows];
    return csvArray.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
  }

  function downloadFile(content, fileName) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // --- Clear Data ---
  clearBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all collected data?')) {
      chrome.storage.local.set({ emails: [], stats: { emailsFound: 0, pagesScraped: 0 } }, () => {
        totalEmailsEl.textContent = '0';
        statusText.textContent = 'Found 0 emails across 0 pages';
      });
    }
  });
});
