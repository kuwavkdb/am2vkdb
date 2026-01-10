// バックグラウンドスクリプト
// コンテンツスクリプトからのリクエストを受けてfetchを行う（CSP回避のため）

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'fetchAuthor') {
        fetch(request.url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP Error: ${response.status}`);
                }
                return response.text();
            })
            .then(text => {
                // パースはコンテンツスクリプトで行うため、テキストをそのまま返す
                // (DOMParserはService Workerでは使えないため、正規表現などでここでやるよりは
                //  コンテンツスクリプトでDOMParserしたほうが堅牢)
                sendResponse({ success: true, daa: text, html: text });
            })
            .catch(error => {
                console.error('Background fetch error:', error);
                sendResponse({ success: false, error: error.toString() });
            });

        // 非同期レスポンスを示すためにtrueを返す
        return true;
    }
});
