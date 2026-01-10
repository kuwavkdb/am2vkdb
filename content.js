// 要素からASINを取得するユーティリティ
function getAsin(element) {
  return element.getAttribute('data-asin');
}

// ボタンを作成する関数
function createButtons(asin) {
  const container = document.createElement('div');
  container.className = 'amz-eval-container';

  const goodBtn = document.createElement('div');
  goodBtn.textContent = '○';
  goodBtn.className = 'amz-eval-btn good';
  goodBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleRating(asin, 'good', goodBtn);
  };

  const badBtn = document.createElement('div');
  badBtn.textContent = '✗';
  badBtn.className = 'amz-eval-btn bad';
  badBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleRating(asin, 'bad', badBtn);
  };

  container.appendChild(goodBtn);
  container.appendChild(badBtn);
  return container;
}

// 評価の切り替え: 既に選択されている場合は解除、そうでなければ保存
function toggleRating(asin, newRating, btnElement) {
  if (btnElement.classList.contains('selected')) {
    // 既に選択されているので解除する
    removeRating(asin);
  } else {
    // 新しい評価
    saveRating(asin, newRating);
  }
}

// ------ Safe Storage Helpers ------

function checkRuntime() {
  if (!chrome.runtime?.id) {
    alert('拡張機能が更新されました。正しく動作させるためにページを再読み込みしてください。');
    return false;
  }
  return true;
}

function safeStorageGet(keys, callback) {
  if (!checkRuntime()) return;
  try {
    chrome.storage.local.get(keys, callback);
  } catch (e) {
    console.error(e);
    checkRuntime();
  }
}

function safeStorageSet(data, callback) {
  if (!checkRuntime()) return;
  try {
    chrome.storage.local.set(data, callback);
  } catch (e) {
    console.error(e);
    checkRuntime();
  }
}

function safeStorageRemove(keys, callback) {
  if (!checkRuntime()) return;
  try {
    chrome.storage.local.remove(keys, callback);
  } catch (e) {
    console.error(e);
    checkRuntime();
  }
}

// 評価をストレージから削除
function removeRating(asin) {
  safeStorageRemove(asin, () => {
    updateProductStyle(asin, null);
    if (typeof isDetailPage === 'function' && isDetailPage()) {
      updateDetailPageStyle(asin, null);
    }
  });
}

// 評価をストレージに保存し、UIを更新
function saveRating(asin, rating) {
  const data = {};
  data[asin] = rating;
  safeStorageSet(data, () => {
    updateProductStyle(asin, rating);
    if (typeof isDetailPage === 'function' && isDetailPage()) {
      updateDetailPageStyle(asin, rating);
    }

    // 商品が「良い」と評価された場合、その著者も自動的に「良い」にする
    if (rating === 'good') {
      const card = document.querySelector(`[data-asin="${asin}"]`);
      if (card) {
        // 既にタイトル内でハイライト（表示）されている場合はそれを使う
        const highlight = card.querySelector('.amz-eval-highlight');
        if (highlight) {
          let authorName = "";
          // 直下のテキストノードを取得（ボタンのテキストを除外するため）
          for (let i = 0; i < highlight.childNodes.length; i++) {
            if (highlight.childNodes[i].nodeType === 3) {
              authorName += highlight.childNodes[i].nodeValue;
            }
          }
          authorName = authorName.trim();

          if (authorName) {
            autoRateAuthorGood(authorName);
            // キャッシュとストレージも整合性を保つために更新
            if (!authorCache[asin]) {
              authorCache[asin] = authorName;
              const data = {};
              data[`asin_author:${asin}`] = authorName;
              safeStorageSet(data);
            }
          }
          return;
        }

        getAuthorName(card, asin, (authorName) => {
          if (authorName && authorName !== "著者情報なし") {
            autoRateAuthorGood(authorName);
            // 画面上の表示更新（getAuthorName内でキャッシュ更新されるが、
            // カラムへの挿入(insertAuthor)はコールバックでやっていないので、
            // ここで必要ならやるべきだが、autoRateAuthorGoodがupdateAllAuthorsを呼ぶので
            // おそらく大丈夫。ただし、まだDOMに著者名が出てない場合は...
            // getAuthorNameは要素挿入をしないので、もし未表示なら挿入してあげたほうが親切。

            // insertAuthor用のリンク再取得
            let titleLink = card.querySelector('h2 a');
            if (!titleLink) {
              const textSpan = card.querySelector('.a-link-normal .a-text-normal');
              if (textSpan) {
                titleLink = textSpan.closest('a');
              }
            }
            if (titleLink) {
              insertAuthor(titleLink, authorName);
            }
          }
        });
      }
    }
  });
}

// 著者を「良い」に自動設定するヘルパー
function autoRateAuthorGood(authorName) {
  const normalizedAuthor = normalizeString(authorName);
  const storageKey = `author:${normalizedAuthor}`;
  safeStorageGet(storageKey, (result) => {
    // 既に 'good' でない場合のみ更新（無駄な書き込みを防ぐ）
    if (result[storageKey] !== 'good') {
      const data = {};
      data[storageKey] = 'good';
      safeStorageSet(data, () => {
        updateAllAuthors(normalizedAuthor, 'good');
      });
    }
  });
}

// 評価に基づいてUIを更新
function updateProductStyle(asin, rating) {
  const cards = document.querySelectorAll(`[data-asin="${asin}"]`);
  cards.forEach((card) => {
    // 既存のボタンの状態を更新
    const goodBtn = card.querySelector('.amz-eval-btn.good');
    const badBtn = card.querySelector('.amz-eval-btn.bad');

    if (goodBtn) goodBtn.classList.toggle('selected', rating === 'good');
    if (badBtn) badBtn.classList.toggle('selected', rating === 'bad');

    // カード全体の強調表示を更新
    updateCardEmphasis(card);
  });
}

// カードの強調表示状態を判定して更新する関数
function updateCardEmphasis(card) {
  const isProductGood = card.querySelector('.amz-eval-btn.good.selected');
  const isProductBad = card.querySelector('.amz-eval-btn.bad.selected');
  // 著者評価が良いかどうか（カード内の著者ボタンを探す）
  const isAuthorGood = card.querySelector('.amz-eval-author-btn.good.selected');
  const isAuthorBad = card.querySelector('.amz-eval-author-btn.bad.selected');

  // スタイルをリセット
  card.classList.remove('amz-eval-good-product', 'amz-eval-bad-product', 'amz-eval-author-good-emphasized');

  // 優先順位: 商品評価 > 著者評価
  if (isProductGood) {
    card.classList.add('amz-eval-good-product');
  } else if (isProductBad) {
    card.classList.add('amz-eval-bad-product');
  } else if (isAuthorBad) {
    // 商品未評価かつ著者が悪い場合 -> 商品をグレーアウト
    card.classList.add('amz-eval-bad-product');
  } else if (isAuthorGood) {
    // 商品未評価かつ著者が良い場合 -> 商品を強調
    card.classList.add('amz-eval-author-good-emphasized');
  }
}


// ------ Author Rating System ------

function normalizeString(str) {
  if (!str) return str;
  return str.replace(/[！-～]/g, function (s) {
    return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
  }).replace(/　/g, ' '); // 全角スペースを半角スペースに
}

function getLegacyAuthorRating(authorName) {
  const normalizedAuthor = normalizeString(authorName);
  const deletedArtists = localStorage.getItem('deleted_artists');
  if (deletedArtists) {
    const badAuthors = deletedArtists.split(',').map(s => normalizeString(s.trim()));
    if (badAuthors.includes(normalizedAuthor)) {
      return 'bad';
    }
  }
  return null;
}

function createAuthorButtons(authorName, targetSpan) {
  const container = document.createElement('span'); // inline-flexにするためspan/div
  container.className = 'amz-eval-author-container';
  const normalizedAuthor = normalizeString(authorName);

  const goodBtn = document.createElement('div');
  goodBtn.textContent = '○';
  goodBtn.className = 'amz-eval-author-btn good';
  goodBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleAuthorRating(normalizedAuthor, authorName, 'good'); // 保存は正規化、更新通知は元の名前も渡す（あるいは両方）
  };

  const badBtn = document.createElement('div');
  badBtn.textContent = '✗';
  badBtn.className = 'amz-eval-author-btn bad';
  badBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleAuthorRating(normalizedAuthor, authorName, 'bad');
  };

  container.appendChild(goodBtn);
  container.appendChild(badBtn);

  // 初期状態の反映
  const storageKey = `author:${normalizedAuthor}`;
  safeStorageGet(storageKey, (result) => {
    let rating = result[storageKey];
    if (!rating) {
      rating = getLegacyAuthorRating(authorName);
    }
    if (rating) {
      updateAuthorUI(targetSpan, goodBtn, badBtn, rating);
    }
  });

  return container;
}

function toggleAuthorRating(normalizedAuthor, displayAuthorName, type) {
  const storageKey = `author:${normalizedAuthor}`;
  safeStorageGet(storageKey, (result) => {
    const currentRating = result[storageKey];
    if (currentRating === type) {
      // Toggle off
      safeStorageRemove(storageKey, () => {
        const fallback = getLegacyAuthorRating(displayAuthorName);
        updateAllAuthors(normalizedAuthor, fallback);
      });
    } else {
      // Set new rating
      const data = {};
      data[storageKey] = type;
      safeStorageSet(data, () => {
        updateAllAuthors(normalizedAuthor, type);
      });
    }
  });
}


function updateAllAuthors(targetNormalizedAuthor, rating) {
  // 画面上の同じ著者のすべての表示を更新する必要がある
  // Simple check: iterate all author elements and normalize their text to match target
  const highlights = document.querySelectorAll('.amz-eval-highlight, .amz-eval-inserted-author');
  highlights.forEach(span => {
    let text = "";
    // spanの直下のテキストノードだけ取得
    for (let i = 0; i < span.childNodes.length; i++) {
      if (span.childNodes[i].nodeType === 3) {
        text += span.childNodes[i].nodeValue;
      }
    }
    const currentNormalized = normalizeString(text.trim());

    if (currentNormalized === targetNormalizedAuthor) {
      // 対応するボタンを見つける
      const container = span.querySelector('.amz-eval-author-container');
      if (container) {
        const goodBtn = container.querySelector('.good');
        const badBtn = container.querySelector('.bad');
        updateAuthorUI(span, goodBtn, badBtn, rating);
      }
    }
  });
}

function updateAuthorUI(targetSpan, goodBtn, badBtn, rating) {
  // 既存スタイル削除
  targetSpan.classList.remove('amz-eval-author-good', 'amz-eval-author-bad');
  if (goodBtn) goodBtn.classList.remove('selected');
  if (badBtn) badBtn.classList.remove('selected');

  if (rating === 'good') {
    targetSpan.classList.add('amz-eval-author-good');
    if (goodBtn) goodBtn.classList.add('selected');
  } else if (rating === 'bad') {
    targetSpan.classList.add('amz-eval-author-bad');
    if (badBtn) badBtn.classList.add('selected');
  }

  // 親カードの強調表示も更新（商品未評価で著者が良い場合のため）
  // 親カードの強調表示も更新（商品未評価で著者が良い場合のため）
  const card = targetSpan.closest('[data-asin]');
  if (card) {
    updateCardEmphasis(card);
  }

  // 詳細ページの場合はテキストエリアの表示切替を行う
  if (typeof isDetailPage === 'function' && isDetailPage()) {
    updateDetailAreaVisibility();
  }
}

// 商品タイトルの末尾をハイライト
function highlightSuffix(card) {
  // Amazonのタイトルは通常 h2 -> a -> span または h2 -> a にある
  // より確実にタイトルを見つけるために h2 を優先的に探す
  // h2 がない場合は従来のクラス検索を行う
  const titleElement = card.querySelector('h2') || card.querySelector('.a-link-normal .a-text-normal');

  if (!titleElement) return;

  // パターンを含むテキストノードを見つけるために子ノードを走査する
  // innerHTMLの置換はイベントやスタイル/構造を壊す可能性があるため、より安全な方法をとる
  const processNode = (node) => {
    if (node.nodeType === 3) { // Text node
      const text = node.nodeValue;
      // " - " で始まる末尾の文字列を検出
      // 区切り文字 " - " はハイライト対象外
      // さらに、ハイライト対象内にカッコ "(" "（" "[" "［" がある場合、それ以降もハイライト対象外とする
      // グループ1: 区切り文字, グループ2: ハイライト対象（カッコ以外の文字）, グループ3: 残りの文字列（カッコ含む）
      const regex = /( - )([^[［(（]*)(.*)$/;
      const match = text.match(regex);
      if (match) {
        const separator = match[1]; // " - "
        let highlightText = match[2]; // ハイライトする文字列（未加工）
        const remainder = match[3]; // カッコ以降の残り（あれば）
        const prefix = text.substring(0, match.index); // マッチ部分より前

        // ハイライト部分の末尾の空白を除外
        // 末尾の空白をremainder（ハイライトなし）の先頭に移動するような扱いにする
        const trimmedHighlight = highlightText.replace(/\s+$/, '');
        const trailingSpaces = highlightText.slice(trimmedHighlight.length);

        const fragment = document.createDocumentFragment();
        // prefix部分
        fragment.appendChild(document.createTextNode(prefix));

        // 区切り文字（ハイライトなし）
        fragment.appendChild(document.createTextNode(separator));

        // ハイライト部分（空白除去済み）
        if (trimmedHighlight) {
          const span = document.createElement('span');
          span.className = 'amz-eval-highlight';
          span.textContent = trimmedHighlight;

          // 未評価の場合にクリックで検索
          span.addEventListener('click', (e) => {
            // ボタンのクリックは除外
            if (e.target.closest('.amz-eval-author-container')) return;

            // 評価済みなら何もしない
            if (span.classList.contains('amz-eval-author-good') || span.classList.contains('amz-eval-author-bad')) return;

            // Google検索
            const query = encodeURIComponent(trimmedHighlight);
            window.open(`https://www.google.com/search?q=${query}`, '_blank');
          });

          // 著者評価ボタンを追加
          const buttons = createAuthorButtons(trimmedHighlight, span);
          span.appendChild(buttons);

          fragment.appendChild(span);
        }

        // 末尾の空白（ハイライトなし）
        if (trailingSpaces) {
          fragment.appendChild(document.createTextNode(trailingSpaces));
        }

        // カッコ以降（ハイライトなし）
        if (remainder) {
          fragment.appendChild(document.createTextNode(remainder));
        }

        node.parentNode.replaceChild(fragment, node);
        return true; // マッチしてハイライトしたら終了
      }
    } else if (node.nodeType === 1) { // Element node
      // 自分たちのボタンの中には入らない
      if (node.classList.contains('amz-eval-container')) return;

      for (let i = 0; i < node.childNodes.length; i++) {
        if (processNode(node.childNodes[i])) return true;
      }
    }
    return false;
  };

  processNode(titleElement);
}

// 著者情報のキャッシュ
const authorCache = {};
let tooltipElement = null;
let fetchTimeout = null;

// ツールチップを表示
function showTooltip(text, x, y) {
  if (!tooltipElement) {
    tooltipElement = document.createElement('div');
    tooltipElement.className = 'amz-eval-author-tooltip';
    document.body.appendChild(tooltipElement);
  }
  tooltipElement.textContent = text;
  tooltipElement.style.left = x + 'px';
  tooltipElement.style.top = (y + 20) + 'px'; // マウスの少し下
  tooltipElement.classList.add('visible');
}

// ツールチップを非表示
function hideTooltip() {
  if (tooltipElement) {
    tooltipElement.classList.remove('visible');
  }
}

// 著者情報を取得する共通関数
function getAuthorName(card, asin, callback) {
  // キャッシュにあればそれを返す
  if (authorCache[asin]) {
    callback(authorCache[asin]);
    return;
  }

  // タイトルリンクを探す（setupAuthorFetchと同じロジック）
  let titleLink = card.querySelector('h2 a');
  if (!titleLink) {
    const textSpan = card.querySelector('.a-link-normal .a-text-normal');
    if (textSpan) {
      titleLink = textSpan.closest('a');
    }
  }

  if (!titleLink || !titleLink.href) {
    callback(null);
    return;
  }

  // バックグラウンドスクリプト経由でfetchする
  chrome.runtime.sendMessage({ action: 'fetchAuthor', url: titleLink.href }, (response) => {
    if (chrome.runtime.lastError || !response || !response.success) {
      console.error('Fetch failed:', chrome.runtime.lastError || response?.error);
      callback(null);
      return;
    }

    const html = response.html;
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const authorElement = doc.querySelector('.author');

    let resultText = null;
    if (authorElement) {
      // テキストのみ取得し、余計な空白を除去
      let authorText = authorElement.innerText.trim();

      // カッコ文字（角括弧も含む）があった場合、それ以降は取得対象外にする
      const match = authorText.match(/^([^[(（［\[]*)/);
      if (match) {
        authorText = match[1].trim();
      }

      if (authorText) {
        resultText = authorText;
      }
    }

    if (resultText) {
      authorCache[asin] = resultText;
      // ASINに紐づけて保存
      const data = {};
      data[`asin_author:${asin}`] = resultText;
      safeStorageSet(data);
    }

    callback(resultText || "著者情報なし");
  });
}

// 著者情報を取得して表示設定
function setupAuthorFetch(card, asin) {
  // すでに商品名の一部がハイライトされている場合は、それが著者情報（または同等の情報）であるため、
  // 新たに著者情報を取得する必要はない。
  if (card.querySelector('.amz-eval-highlight')) {
    return;
  }

  // 画像リンク（.a-link-normal）を誤って取得しないようにする
  // h2内のリンク、または a-text-normal (タイトルテキスト) を含むリンクを探す
  let titleLink = card.querySelector('h2 a');

  if (!titleLink) {
    // フォールバック: テキストクラスを持つスパンを含むリンクを探す
    const textSpan = card.querySelector('.a-link-normal .a-text-normal');
    if (textSpan) {
      titleLink = textSpan.closest('a');
    }
  }

  if (!titleLink) return;

  let lastMouseX = 0;
  let lastMouseY = 0;

  titleLink.addEventListener('mouseenter', (e) => {
    const url = titleLink.href;
    if (!url) return;

    lastMouseX = e.pageX;
    lastMouseY = e.pageY;

    // キャッシュにあれば即表示
    if (authorCache[asin]) {
      // すでにキャッシュがある（取得済み）場合は、ツールチップを表示しない
      // （商品名に埋め込まれているか、情報なしのため）
      return;
    }

    // デバウンス（マウスオーバーして500ms後に取得）
    fetchTimeout = setTimeout(() => {
      // 取得中または取得済みの場合はスキップ（二重防止）
      if (authorCache[asin]) return;

      showTooltip("fetching...", lastMouseX, lastMouseY);

      getAuthorName(card, asin, (authorName) => {
        // エラーまたは情報なしの場合も authorCache には何かが入るかもしれないが
        // getAuthorName は "著者情報なし" を返すこともある

        if (!authorName) {
          if (tooltipElement && tooltipElement.classList.contains('visible')) {
            showTooltip("Error", lastMouseX, lastMouseY);
          }
          return;
        }

        // ツールチップを隠す
        hideTooltip();

        if (authorName && authorName !== "著者情報なし") {
          insertAuthor(titleLink, authorName);
        }
      });
    }, 500);
  });

  titleLink.addEventListener('mousemove', (e) => {
    lastMouseX = e.pageX;
    lastMouseY = e.pageY;

    // 既に挿入済みならツールチップは出さない、またはキャッシュがあれば出さない
    // ここでは「fetching...」の間だけツールチップを出し、完了したら消す挙動にする
    if (!authorCache[asin] && tooltipElement && tooltipElement.classList.contains('visible') && tooltipElement.textContent === "fetching...") {
      showTooltip("fetching...", e.pageX, e.pageY);
    }
  });

  titleLink.addEventListener('mouseleave', () => {
    hideTooltip();
    if (fetchTimeout) {
      clearTimeout(fetchTimeout);
      fetchTimeout = null;
    }
  });
}

// 著者名をDOMに挿入
function insertAuthor(targetElement, authorText) {
  // 既に挿入済みかチェック
  if (targetElement.querySelector('.amz-eval-inserted-author')) return;

  const span = document.createElement('span');
  span.className = 'amz-eval-inserted-author';
  span.textContent = authorText;

  // 未評価の場合にクリックで検索
  span.addEventListener('click', (e) => {
    // ボタンのクリックは除外
    if (e.target.closest('.amz-eval-author-container')) return;

    // 評価済みなら何もしない
    if (span.classList.contains('amz-eval-author-good') || span.classList.contains('amz-eval-author-bad')) return;

    // Google検索
    const query = encodeURIComponent(authorText);
    window.open(`https://www.google.com/search?q=${query}`, '_blank');
  });

  // 著者評価ボタンを追加
  const buttons = createAuthorButtons(authorText, span);
  span.appendChild(buttons);

  targetElement.appendChild(span);
}

// ASINを表示
function insertAsin(card, asin) {
  // 既に表示済みかチェック
  if (card.querySelector('.amz-eval-asin')) return;

  // タイトルリンクを探す（setupAuthorFetchと同じロジックを使用）
  let titleLink = card.querySelector('h2 a');
  if (!titleLink) {
    const textSpan = card.querySelector('.a-link-normal .a-text-normal');
    if (textSpan) {
      titleLink = textSpan.closest('a');
    }
  }

  if (!titleLink) return;

  const div = document.createElement('div');
  div.className = 'amz-eval-asin';
  div.textContent = `ASIN: ${asin}`;

  // リンクの直後（兄弟要素として）に挿入
  // これにより、Aタグの外側、かつタイトルの直下（ブロック要素なので改行される）に表示される
  titleLink.parentNode.insertBefore(div, titleLink.nextSibling);
}

// 個々の商品カードを処理
function processCard(card) {
  if (card.hasAttribute('data-amz-eval-processed')) return;

  const asin = getAsin(card);
  if (!asin) return;

  // 重複処理を防ぐために処理済みとしてマーク
  card.setAttribute('data-amz-eval-processed', 'true');
  card.style.position = 'relative'; // ボタンの絶対配置がカードに対して機能するようにする

  const buttons = createButtons(asin);

  // 可視性を良くするために画像コンテナに追加することを試みる、無理ならカード自体に追加
  const imageContainer = card.querySelector('.s-image-fixed-height') || card.querySelector('.s-product-image-container') || card;

  // ボタンを画像コンテナの隅に配置するため、相対配置にする
  if (imageContainer !== card) {
    imageContainer.style.position = 'relative';
  }

  imageContainer.appendChild(buttons);

  // ハイライトを適用
  highlightSuffix(card);

  // 著者情報取得設定（ホバー時）
  setupAuthorFetch(card, asin);

  // ASINを表示
  insertAsin(card, asin);

  // 初期状態をロード (+著者情報)
  safeStorageGet([asin, `asin_author:${asin}`], (result) => {
    if (result[asin]) {
      updateProductStyle(asin, result[asin]);
    }
    const savedAuthor = result[`asin_author:${asin}`];
    if (savedAuthor) {
      authorCache[asin] = savedAuthor;
      // タイトルリンクを探す (insertAuthor用)
      let titleLink = card.querySelector('h2 a');
      if (!titleLink) {
        const textSpan = card.querySelector('.a-link-normal .a-text-normal');
        if (textSpan) {
          titleLink = textSpan.closest('a');
        }
      }
      if (titleLink) {
        insertAuthor(titleLink, savedAuthor);
      }
    }
  });
}

// 動的コンテンツを処理するためのメインオブザーバー
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node.nodeType === 1) {
        // ノード自体が結果アイテムかどうかを確認
        if (node.getAttribute('data-asin')) {
          processCard(node);
        }
        // 子孫を確認
        const items = node.querySelectorAll('[data-asin]');
        items.forEach(processCard);
      }
    });
  });
});

// 初期実行
function init() {
  const items = document.querySelectorAll('[data-asin]');
  items.forEach(processCard);

  // 検索結果コンテナを具体的に監視（可能なら）、そうでなければbody全体
  const resultsContainer = document.querySelector('.s-main-slot') || document.body;
  observer.observe(resultsContainer, { childList: true, subtree: true });

  // 詳細ページの処理
  if (isDetailPage()) {
    processDetailPage();
  }
}

// 詳細ページかどうかを判定
function isDetailPage() {
  return !!document.getElementById('ASIN') || window.location.pathname.includes('/dp/') || window.location.pathname.includes('/gp/product/');
}

// 詳細ページの処理
function processDetailPage() {
  const asinInput = document.getElementById('ASIN');
  let asin = asinInput ? asinInput.value : null;

  if (!asin) {
    const match = window.location.pathname.match(/\/(dp|gp\/product)\/([A-Z0-9]{10})/);
    if (match) {
      asin = match[2];
    }
  }

  if (!asin) return;

  // 評価ボタンの注入
  const titleSection = document.getElementById('centerCol') || document.getElementById('ppd'); // centerColはタイトル周辺
  const productTitle = document.getElementById('productTitle');

  if (productTitle && titleSection) {
    const buttons = createButtons(asin);
    buttons.classList.add('amz-eval-container-detail');
    buttons.style.position = 'relative';
    buttons.style.marginBottom = '10px';
    buttons.style.display = 'inline-flex'; // リスト表示とは少しスタイルを変える必要があるかも

    // タイトルの直前に挿入してみる
    productTitle.parentNode.insertBefore(buttons, productTitle);

    // 初期状態ロード
    safeStorageGet([asin], (result) => {
      if (result[asin]) {
        updateDetailPageStyle(asin, result[asin]);
      }
    });

    // 著者評価ボタンと商品情報CSV
    // 少し遅延させて要素が揃うのを待つ（念のため）
    setTimeout(() => {
      injectDetailPageAuthorRating(asin);
      injectProductInfoArea(asin, productTitle);
    }, 500);
  }
}

// 詳細ページ用のスタイル更新
function updateDetailPageStyle(asin, rating) {
  const container = document.querySelector('.amz-eval-container-detail');
  if (!container) return;

  const goodBtn = container.querySelector('.amz-eval-btn.good');
  const badBtn = container.querySelector('.amz-eval-btn.bad');

  if (goodBtn) goodBtn.classList.toggle('selected', rating === 'good');
  if (badBtn) badBtn.classList.toggle('selected', rating === 'bad');

  updateDetailAreaVisibility();
  // 詳細ページ全体へのスタイル適用は、必要であれば body や main container にクラスを付与する
  // 今回はボタンの状態更新のみにしておくか、タイトル周辺を少し変える
}

// 詳細ページの著者評価ボタン注入
function injectDetailPageAuthorRating(asin) {
  const byline = document.getElementById('bylineInfo');
  if (!byline) return;

  // 著者名リンクを取得
  const authorLinks = byline.querySelectorAll('a');
  authorLinks.forEach(link => {
    const authorName = link.textContent.trim();
    if (authorName) {
      // 既存の createAuthorButtons を利用
      // 見た目を整えるためのコンテナ
      const container = document.createElement('span');
      container.style.marginLeft = '5px';
      container.style.verticalAlign = 'middle';

      const buttons = createAuthorButtons(authorName, link); // linkをtargetSpanとして渡すが、スタイル適用がうまくいくか確認が必要
      // createAuthorButtons内で targetSpan.classList.add(...) などをしているため、link自体にクラスがつくとCSSによっては崩れるかも
      // ここでは link 自体ではなく、コンテナを渡す手もあるが、ハイライトなどの連動を考えると...
      // とりあえず link を渡してみる。詳細ページではタイトルハイライトロジックとは別だが、
      // createAuthorButtons 内で legacy check とかやってくれるので。

      container.appendChild(buttons);
      link.parentNode.insertBefore(container, link.nextSibling);
    }
  });
}

// 商品情報CSVエリアの注入
// 商品情報CSVエリアの注入
function injectProductInfoArea(asin, productTitleElement) {
  if (document.getElementById('amz-eval-info-area')) return;

  const info = getProductInfo(asin);
  // フォーマット設定を読み込んで内容を生成
  safeStorageGet(['format_template', 'date_link_url'], (result) => {
    let template = result.format_template;
    if (!template) {
      template = '{{aitem [[asin]],[[title]],[[author]],[[date]],[[image_url]]}}';
    }

    // プレースホルダーの置換
    // エスケープが必要な文字が含まれている場合は注意が必要だが、[]は正規表現で意味を持つためエスケープする
    let content = template
      .replace(/\[\[asin\]\]/g, info.asin)
      .replace(/\[\[title\]\]/g, info.title)
      .replace(/\[\[author\]\]/g, info.author)
      .replace(/\[\[date\]\]/g, info.date)
      .replace(/\[\[image_url\]\]/g, info.imageUrl);

    const container = document.createElement('div');
    container.style.marginTop = '10px';
    container.style.marginBottom = '10px';

    const textarea = document.createElement('textarea');
    textarea.id = 'amz-eval-info-area';
    textarea.style.width = '100%';
    textarea.style.height = '60px';
    textarea.style.fontSize = '12px';
    textarea.readOnly = true;
    textarea.value = content;

    textarea.addEventListener('click', async function () {
      try {
        await navigator.clipboard.writeText(this.value);

        // フィードバック表示
        const originalBg = this.style.backgroundColor;
        const originalTransition = this.style.transition;

        this.style.transition = 'background-color 0.2s';
        this.style.backgroundColor = '#d0f0c0'; // 薄い緑

        // ツールチップ的なメッセージを表示（一時的）
        let msg = document.getElementById('amz-eval-copy-msg');
        if (!msg) {
          msg = document.createElement('span');
          msg.id = 'amz-eval-copy-msg';
          msg.style.position = 'absolute';
          msg.style.fontSize = '12px';
          msg.style.color = 'green';
          msg.style.fontWeight = 'bold';
          msg.style.marginLeft = '5px';
          msg.textContent = 'Copied!';
          container.insertBefore(msg, textarea);
        }
        msg.style.display = 'inline';
        msg.style.opacity = 1;

        setTimeout(() => {
          this.style.backgroundColor = originalBg || '';
          if (msg) {
            msg.style.transition = 'opacity 0.5s';
            msg.style.opacity = 0;
            setTimeout(() => msg.style.display = 'none', 500);
          }
        }, 1000);

      } catch (err) {
        console.error('Failed to copy: ', err);
        this.select(); // フォールバック
      }
    });

    container.appendChild(textarea);

    // VKDBリンクの追加
    if (info.date) {
      // 日付を YYYY-M-D 形式（ゼロ埋めなし）に変換
      const dateParts = info.date.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
      if (dateParts) {
        const year = parseInt(dateParts[1], 10);
        const month = parseInt(dateParts[2], 10);
        const day = parseInt(dateParts[3], 10);
        const formattedDate = `${year}-${month}-${day}`;

        const baseUrl = result.date_link_url || 'https://www.vkdb.jp/wiki.cgi?action=EDIT&page=%A5%AB%A5%EC%A5%F3%A5%C0%A1%BC/';

        // カレンダー編集ページへのリンク
        const link = document.createElement('a');
        link.href = baseUrl + formattedDate;
        link.textContent = 'VKDBカレンダー登録';
        link.target = '_blank';
        link.style.display = 'block';
        link.style.marginTop = '4px';
        link.style.fontSize = '12px';
        link.style.color = '#0066c0';
        link.style.textDecoration = 'none';

        link.addEventListener('mouseenter', () => link.style.textDecoration = 'underline');
        link.addEventListener('mouseleave', () => link.style.textDecoration = 'none');

        container.appendChild(link);
      }
    }

    // 評価ボタンがあればその前に、なければタイトルの前に挿入
    const buttonsContainer = document.querySelector('.amz-eval-container-detail');
    const targetElement = buttonsContainer || productTitleElement;

    if (targetElement && targetElement.parentNode) {
      targetElement.parentNode.insertBefore(container, targetElement);
    }

    // 初期表示状態の更新
    updateDetailAreaVisibility();
  });
}

// 詳細ページのテキストエリア表示/非表示を更新
function updateDetailAreaVisibility() {
  const textarea = document.getElementById('amz-eval-info-area');
  if (!textarea) return;
  const container = textarea.parentNode;

  const isProductBad = document.querySelector('.amz-eval-btn.bad.selected');
  // 詳しいコンテナの中を見るか、ページ全体から探すか。詳細ページは1つなので全体でOKだが、著者が複数いる場合は？
  // 著者が複数いて、そのうち1人でもBadなら隠すべきか？ -> リクエストは「著者の評価が✗の場合」
  // 安全側に倒して、ページ内のいずれかの著者がBadなら隠す、で良いと思われる。
  const isAuthorBad = document.querySelector('.amz-eval-author-btn.bad.selected');

  if (isProductBad || isAuthorBad) {
    container.style.display = 'none';
  } else {
    container.style.display = 'block';
  }
}

// 商品情報を取得するヘルパー
function getProductInfo(asin) {
  const title = document.getElementById('productTitle')?.textContent.trim() || '';

  let author = '';
  const byline = document.getElementById('bylineInfo');
  if (byline) {
    const links = byline.querySelectorAll('a.a-link-normal');
    const authorNames = [];
    links.forEach(l => {
      const txt = l.textContent.trim();
      if (txt && !txt.includes('検索結果') && !txt.includes('著者セントラル')) {
        authorNames.push(txt);
      }
    });
    if (authorNames.length === 0) {
      author = byline.textContent.trim().replace(/\s+/g, ' ');
    } else {
      author = authorNames.join('; ');
    }
  }

  let date = '';
  // 戦略1: detailBullets_feature_div (既存)
  const detailBullets = document.getElementById('detailBullets_feature_div');
  if (detailBullets) {
    const lis = detailBullets.querySelectorAll('li');
    lis.forEach(li => {
      const txt = li.textContent;
      if (txt.includes('出版社') || txt.includes('発売日') || txt.includes('Publication date')) {
        const spans = li.querySelectorAll('span');
        spans.forEach(span => {
          if (span.classList.contains('a-list-item')) {
            // YYYY/MM/DD or YYYY-MM-DD
            let dateMatch = span.textContent.match(/\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/);
            if (dateMatch) {
              date = dateMatch[0].replace(/-/g, '/');
            } else {
              // YYYY年MM月DD日
              dateMatch = span.textContent.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
              if (dateMatch) {
                date = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
              }
            }
          }
        });
      }
    });
  }

  // 戦略2: rpi-attribute-book_details-publication_date (本など)
  if (!date) {
    const rpiDate = document.querySelector('#rpi-attribute-book_details-publication_date .rpi-attribute-value span');
    if (rpiDate) {
      const txt = rpiDate.textContent.trim();
      // YYYY/MM/DD or YYYY-MM-DD
      let dateMatch = txt.match(/\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/);
      if (dateMatch) {
        date = dateMatch[0].replace(/-/g, '/');
      } else {
        // YYYY年MM月DD日
        dateMatch = txt.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
        if (dateMatch) {
          date = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
        }
      }
    }
  }

  // 戦略3: 右カラムの「発売予定日は...」 (availability inside #rightCol or #buybox)
  if (!date) {
    const availability = document.getElementById('availability');
    if (availability) {
      const txt = availability.textContent.trim();
      const dateMatch = txt.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
      if (dateMatch) {
        date = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
      }
    }
  }

  // 戦略4: 「仕様」テーブル (#productDetails_techSpec_section_1)
  if (!date) {
    const techTables = document.querySelectorAll('#productDetails_techSpec_section_1, #productDetails_db_sections');
    techTables.forEach(table => {
      if (date) return;
      const ths = table.querySelectorAll('th');
      ths.forEach(th => {
        if (th.textContent.includes('発売日') || th.textContent.includes('Publication date')) {
          const td = th.nextElementSibling;
          if (td) {
            const txt = td.textContent.trim();
            let dateMatch = txt.match(/\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/);
            if (dateMatch) {
              date = dateMatch[0].replace(/-/g, '/');
            } else {
              dateMatch = txt.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
              if (dateMatch) {
                date = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
              }
            }
          }
        }
      });
    });
  }

  let imageUrl = '';
  const img1 = document.getElementById('landingImage');
  const img2 = document.getElementById('imgBlkFront');
  if (img1) imageUrl = img1.src;
  else if (img2) imageUrl = img2.src;

  const processField = (str) => {
    if (!str) return '';
    return str.replace(/[\r\n]+/g, ' ').trim();
  };

  return {
    asin: processField(asin),
    title: processField(title),
    author: processField(author),
    date: processField(date),
    imageUrl: processField(imageUrl)
  };
}

// DOMの準備ができたら実行
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
