document.addEventListener('DOMContentLoaded', () => {
    const goodListContainer = document.getElementById('good-authors-list');
    const badListContainer = document.getElementById('bad-authors-list');
    const newGoodInput = document.getElementById('new-good-author');
    const addGoodBtn = document.getElementById('add-good-btn');
    const newBadInput = document.getElementById('new-bad-author');
    const addBadBtn = document.getElementById('add-bad-btn');

    // Format settings elements
    const formatInput = document.getElementById('format-template');
    const saveFormatBtn = document.getElementById('save-format-btn');
    const saveStatus = document.getElementById('format-save-status');

    // Link settings elements
    const dateLinkInput = document.getElementById('date-link-url');
    const saveDateLinkBtn = document.getElementById('save-date-link-btn');
    const linkSaveStatus = document.getElementById('link-save-status');

    // Default template
    const DEFAULT_TEMPLATE = '{{aitem [[asin]],[[title]],[[author]],[[date]],[[image_url]]}}';
    const DEFAULT_DATE_LINK_URL = 'https://www.vkdb.jp/wiki.cgi?action=EDIT&page=%A5%AB%A5%EC%A5%F3%A5%C0%A1%BC/';

    // Load all data from storage
    loadData();

    function loadData() {
        chrome.storage.local.get(null, (items) => {
            const goodAuthors = [];
            const badAuthors = [];

            // Clear current lists
            goodListContainer.innerHTML = '';
            badListContainer.innerHTML = '';

            for (const key in items) {
                if (key.startsWith('author:')) {
                    const rating = items[key];
                    const authorName = key.substring(7); // "author:".length === 7

                    if (rating === 'good') {
                        goodAuthors.push(authorName);
                    } else if (rating === 'bad') {
                        badAuthors.push(authorName);
                    }
                }
            }

            // Load format template
            if (items.format_template) {
                formatInput.value = items.format_template;
            } else {
                formatInput.value = DEFAULT_TEMPLATE;
            }

            // Load date link url
            if (items.date_link_url) {
                dateLinkInput.value = items.date_link_url;
            } else {
                dateLinkInput.value = DEFAULT_DATE_LINK_URL;
            }

            // Sort alphabetically
            goodAuthors.sort();
            badAuthors.sort();

            renderList(goodAuthors, goodListContainer, 'good', '○');
            renderList(badAuthors, badListContainer, 'bad', '✗');
        });
    }

    function addAuthor(inputElement, rating) {
        const name = inputElement.value.trim();
        if (!name) return;

        const key = `author:${name}`;
        const data = {};
        data[key] = rating;

        chrome.storage.local.set(data, () => {
            inputElement.value = '';
            loadData();
        });
    }

    addGoodBtn.addEventListener('click', () => addAuthor(newGoodInput, 'good'));
    newGoodInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addAuthor(newGoodInput, 'good');
    });

    addBadBtn.addEventListener('click', () => addAuthor(newBadInput, 'bad'));
    newBadInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addAuthor(newBadInput, 'bad');
    });

    saveFormatBtn.addEventListener('click', () => {
        const template = formatInput.value;
        chrome.storage.local.set({ format_template: template }, () => {
            saveStatus.style.display = 'block';
            setTimeout(() => {
                saveStatus.style.display = 'none';
            }, 2000);
        });
    });

    saveDateLinkBtn.addEventListener('click', () => {
        const url = dateLinkInput.value;
        chrome.storage.local.set({ date_link_url: url }, () => {
            linkSaveStatus.style.display = 'block';
            setTimeout(() => {
                linkSaveStatus.style.display = 'none';
            }, 2000);
        });
    });
});

function renderList(authors, container, type, symbol) {
    if (authors.length === 0) {
        const label = type === 'good' ? '"Good"' : '"Bad"';
        container.innerHTML = `<div class="empty-message">No authors rated as ${label} yet.</div>`;
        return;
    }

    authors.forEach(author => {
        const item = document.createElement('div');
        item.className = 'author-item';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'author-name';
        nameSpan.textContent = author;

        const badge = document.createElement('span');
        badge.className = `badge ${type}`;
        badge.textContent = symbol;

        item.appendChild(nameSpan);
        item.appendChild(badge);

        // Allow deletion on click
        item.addEventListener('click', () => {
            if (confirm(`Remove "${author}" from ${type === 'good' ? 'Good' : 'Bad'} authors list?`)) {
                chrome.storage.local.remove(`author:${author}`, () => {
                    item.remove();
                    // Check if list is empty
                    if (container.children.length === 0) {
                        const label = type === 'good' ? '"Good"' : '"Bad"';
                        container.innerHTML = `<div class="empty-message">No authors rated as ${label} yet.</div>`;
                    }
                });
            }
        });

        container.appendChild(item);
    });
}
