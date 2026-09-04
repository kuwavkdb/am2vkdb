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
    if (span.tagName.toLowerCase() === 'a') {
      text = span.textContent;
    } else {
      for (let i = 0; i < span.childNodes.length; i++) {
        if (span.childNodes[i].nodeType === 3) {
          text += span.childNodes[i].nodeValue;
        }
      }
    }
    const currentNormalized = normalizeString(text.trim());

    if (currentNormalized === targetNormalizedAuthor) {
      // 対応するボタンを見つける
      // 従来の highlight (spanの中にボタンがある場合) または 新仕様 (要素のすぐ隣にボタンがある場合)
      let container = span.querySelector('.amz-eval-author-container');
      if (!container && span.nextElementSibling && span.nextElementSibling.classList.contains('amz-eval-author-container')) {
        container = span.nextElementSibling;
      }

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
  const card = targetSpan.closest('[data-asin]') || targetSpan.closest('.s-result-item');
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

function isExcludedAuthorElement(element) {
  return !!(
    element.closest('#averageCustomerReviews, #tellAmazon_feature_div') ||
    element.matches('#averageCustomerReviews, #tellAmazon_feature_div') ||
    element.querySelector('#averageCustomerReviews, #tellAmazon_feature_div')
  );
}

function removeExcludedAuthorButtons() {
  document.querySelectorAll('#averageCustomerReviews, #tellAmazon_feature_div').forEach(area => {
    area.querySelectorAll('.amz-eval-container, .amz-eval-author-container').forEach(buttons => buttons.remove());
    area.querySelectorAll('.amz-eval-inserted-author').forEach(element => {
      element.classList.remove('amz-eval-inserted-author');
    });
  });
}

// 著者情報として表示されている既存のリンクを探して評価ボタンを直接挿入する
function injectAuthorButtonsToExistingLinks(card, asin) {
  // すでに挿入済みかチェック
  if (card.querySelector('.amz-eval-author-container')) return;

  // 評価ボタンを追加する処理のヘルパー
  const addButtonsToLink = (element) => {
    // レビュー平均やAmazon通知エリア内の要素には挿入しない
    if (isExcludedAuthorElement(element)) return false;

    // ページ内アンカーや現在のページ自身へのリンクには挿入しない
    if (element.tagName && element.tagName.toLowerCase() === 'a') {
      const href = element.getAttribute('href') || '';
      if (href.startsWith('#')) return false;

      try {
        const linkUrl = new URL(element.href, document.baseURI);
        const currentUrl = new URL(window.location.href);
        linkUrl.hash = '';
        currentUrl.hash = '';
        if (linkUrl.href === currentUrl.href) return false;
      } catch (error) {
        return false;
      }
    }

    // 直下のテキストノードのみ取得、または特定のクラス・タグを除外してテキスト取得
    let text = "";
    if (element.tagName && element.tagName.toLowerCase() === 'a') {
      text = element.textContent.trim();
    } else {
      // spanなどの場合、子要素（リンクなど）のテキストは含まないようにする
      for (let i = 0; i < element.childNodes.length; i++) {
        if (element.childNodes[i].nodeType === 3) {
          text += element.childNodes[i].nodeValue;
        }
      }
      text = text.trim();
    }

    if (text
      && !text.includes('検索結果')
      && !text.includes('著者セントラル')
      && !text.includes('カスタマーレビュー')
      && !text.includes('在庫')
      && !text.includes('お届け')
      && !text.includes('送料')
      && !text.includes('発送')
      && !text.includes('無料')
      && !text.includes('新品')
      && !text.includes('中古')
      && !text.includes('一時的に')
      && !text.match(/^[0-9,.\s/:-]+$/) // 日付や価格、件数のみの文字列を除外
      && !text.includes('ポイント')
      && !text.match(/^[|｜,，、・]+$/) // 区切り文字のみを除外
      && !text.includes('￥')) {

      // さらに、単なる「発売日」「出版社」などのラベルは除外
      const excludedWords = ['発売', '出版', '編集', '翻訳', 'イラスト', '原作', '著', '文', '絵', '監修', '作', '版', '監督', '出演', '形式', 'レーベル', 'アーティスト', 'キャスト'];
      if (excludedWords.some(word => text === word || text === word + '日' || text === word + '者')) return false;

      // 短すぎる記号やスペースだけの場合は除外
      if (text.length === 0) return false;

      if (!element.parentNode.querySelector('.amz-eval-author-container')) {
        // UI用のラッパーを作る
        element.classList.add('amz-eval-inserted-author');

        // リンクではない場合（span等）でも、同じようにボタンを追加する
        const buttons = createAuthorButtons(text, element);

        // elementの直後に設置
        element.parentNode.insertBefore(buttons, element.nextSibling);

        // 適度なマージンを設ける
        buttons.style.marginLeft = '4px';
        buttons.style.marginRight = '4px';
        return true;
      }
    }
    return false;
  };

  let found = false;
  let titleElement = card.querySelector('h2');
  if (!titleElement) return;

  // タイトルと著者名が含まれるブロック（title-recipe 等）を特定
  let titleBlock = card.querySelector('[data-cy="title-recipe"]') || titleElement.closest('.a-section') || titleElement.parentElement;

  if (titleBlock) {
    // タイトルブロック内の .a-color-secondary 要素（著者情報等のメタデータとして使われる）を探す
    let secondaryWrappers = titleBlock.querySelectorAll('.a-color-secondary');
    secondaryWrappers.forEach(wrapper => {
      // 内部のリンクやテキストコンテナを探査
      let subElements = wrapper.querySelectorAll('a, span');
      if (subElements.length > 0) {
        subElements.forEach(el => {
          if (addButtonsToLink(el)) found = true;
        });
      } else {
        if (addButtonsToLink(wrapper)) found = true;
      }
    });

    // もしまだ見つからなければ、明確な a タグをすべて探す
    if (!found) {
      let links = titleBlock.querySelectorAll('a:not(.a-text-normal)');
      links.forEach(link => {
        if (addButtonsToLink(link)) found = true;
      });
    }
  }

  // titleBlock内に無かった場合、すぐ後ろの要素も探索（price等まで）
  if (!found && titleBlock) {
    let nextElem = titleBlock.nextElementSibling;
    while (nextElem) {
      // 価格や配送情報のブロック等に到達したら、それ以降は探さない
      if (nextElem.querySelector('.a-price') ||
        nextElem.querySelector('.a-icon-star-small') ||
        nextElem.classList.contains('a-spacing-top-small') ||
        nextElem.getAttribute('data-cy') === 'price-recipe' ||
        nextElem.getAttribute('data-cy') === 'reviews-recipe' ||
        nextElem.getAttribute('data-cy') === 'delivery-recipe') {
        break;
      }

      let secondaryWrappers = nextElem.querySelectorAll('.a-color-secondary');
      if (secondaryWrappers.length > 0) {
        secondaryWrappers.forEach(wrapper => {
          let subElements = wrapper.querySelectorAll('a, span');
          if (subElements.length > 0) {
            subElements.forEach(el => {
              if (addButtonsToLink(el)) found = true;
            });
          } else {
            if (addButtonsToLink(wrapper)) found = true;
          }
        });
      } else {
        let spans = nextElem.querySelectorAll('span, a');
        spans.forEach(el => {
          if (addButtonsToLink(el)) found = true;
        });
      }

      if (found) break;
      nextElem = nextElem.nextElementSibling;
    }
  }
}

// 従来のマウスホバー時のフェッチ処理・取得処理は削除されました

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

  // レビュー平均・Amazon通知エリアには商品評価UIも挿入しない
  if (isExcludedAuthorElement(imageContainer)) return;

  // ボタンを画像コンテナの隅に配置するため、相対配置にする
  if (imageContainer !== card) {
    imageContainer.style.position = 'relative';
  }

  imageContainer.appendChild(buttons);

  // ハイライトを適用
  highlightSuffix(card);

  // 画面上に既に存在する著者名リンクへ評価ボタンを直接挿入する
  injectAuthorButtonsToExistingLinks(card, asin);

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
      // 既存ロジック: insertAuthorを使ってタイトルリンク下に挿入していたが、
      // 画面上にすでに著者情報があるなら、今回は不要。
      // もし表示されていない商品があってフェッチが必要なら従来ロジックを残すが、
      // 今回は「画面上の著者名に付ける」という要件なので表示追加(insertAuthor)は除外する
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
        removeExcludedAuthorButtons();
      }
    });
  });
});

// 対象カテゴリ（ミュージック、DVD、本）かどうかを判定する関数
function isTargetCategory() {
  const urlParams = new URLSearchParams(window.location.search);

  // 1. 検索結果・一覧ページのドロップダウンで判定
  const searchDropdown = document.getElementById('searchDropdownBox');
  if (searchDropdown) {
    const activeValue = searchDropdown.value || '';
    const targetValues = [
      'search-alias=popular',       // 音楽
      'search-alias=digital-music', // デジタルミュージック
      'search-alias=classical',     // クラシック
      'search-alias=dvd',           // DVD
      'search-alias=stripbooks',    // 本
      'search-alias=english-books'  // 洋書
    ];

    const activeOption = searchDropdown.options[searchDropdown.selectedIndex];
    const text = activeOption ? (activeOption.textContent || activeOption.text || '') : '';

    if (targetValues.includes(activeValue) ||
      (activeValue && activeValue.startsWith('node=')) || // カテゴリ配下ノード
      text.includes('音楽') ||
      text.includes('ミュージック') ||
      text.includes('J-POP') ||
      text.includes('クラシック') ||
      text.includes('DVD') ||
      text.includes('本') ||
      text.includes('書籍') ||
      text.includes('コミック')) {
      return true;
    }
  }

  // 2. URLパラメータで判定（検索結果ページ等のiパラメータ）
  const iParam = urlParams.get('i');
  if (iParam) {
    const targetParams = ['popular', 'digital-music', 'classical', 'dvd', 'stripbooks', 'english-books'];
    if (targetParams.includes(iParam)) {
      return true;
    }
  }

  // 3. URLパラメータ「s」で判定 (詳細ページや検索結果のカテゴリパラメータ)
  const sParam = urlParams.get('s');
  if (sParam) {
    const targetS = ['music', 'popular', 'dvd', 'stripbooks', 'books', 'classical', 'digital-music'];
    if (targetS.includes(sParam)) {
      return true;
    }
  }

  // 4. 詳細ページの場合、パンくずリストで判定
  const breadcrumbs = document.getElementById('wayfinding-breadcrumbs_feature_div');
  if (breadcrumbs) {
    const text = breadcrumbs.textContent;
    if (text.includes('ミュージック') ||
      text.includes('音楽') ||
      text.includes('CD') ||
      text.includes('DVD') ||
      text.includes('ブルーレイ') ||
      text.includes('本') ||
      text.includes('コミック') ||
      text.includes('雑誌') ||
      text.includes('書籍')) {
      return true;
    }
  }

  // 5. サブナビゲーション (#nav-subnav) のテキストで判定
  const subnav = document.getElementById('nav-subnav');
  if (subnav) {
    const text = subnav.textContent;
    if (text.includes('ミュージック') || text.includes('音楽') || text.includes('CD') || 
        text.includes('DVD') || text.includes('ブルーレイ') || text.includes('本') || 
        text.includes('コミック') || text.includes('書籍') || text.includes('雑誌')) {
      return true;
    }
  }

  // 6. storeID (詳細ページのhiddenタグ等) で判定
  const storeIDInput = document.getElementById('storeID');
  if (storeIDInput) {
    const storeVal = storeIDInput.value;
    const targetStores = ['music', 'digital_music', 'dvd', 'video', 'books', 'stripbooks'];
    if (targetStores.some(s => storeVal.toLowerCase().includes(s))) {
      return true;
    }
  }

  // 7. 詳細ページでのフォールバック (除外カテゴリ以外のメディア系・グッズ系商品なら基本有効とする)
  if (isDetailPage()) {
    if (storeIDInput) {
      const storeVal = storeIDInput.value.toLowerCase();
      // 明らかに無関係な家電・日用品・食品などのストアIDリスト
      const excludeStores = [
        'electronics', 'pc', 'office-products', 'kitchen', 'appliances', 
        'home', 'diy', 'beauty', 'luxury-beauty', 'health', 'baby', 
        'pet-supplies', 'grocery', 'food', 'industrial', 'automotive', 
        'sports', 'shoes', 'apparel', 'jewelry', 'watches', 'luggage'
      ];
      if (!excludeStores.some(s => storeVal.includes(s))) {
        return true;
      }
    } else {
      // storeID要素自体が存在しない詳細ページでも、誤判定を防ぐため基本的には有効とする
      return true;
    }
  }

  return false;
}

// 初期実行
function init() {
  if (!isTargetCategory()) {
    return;
  }

  migrateLegacyData(); // データを移行（必要な場合）

  const items = document.querySelectorAll('[data-asin]');
  items.forEach(processCard);
  removeExcludedAuthorButtons();

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
    if (isExcludedAuthorElement(link)) return;

    const authorName = link.textContent.trim();
    if (authorName) {
      // UI更新対象にするためにクラスを追加
      link.classList.add('amz-eval-inserted-author');

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

// VKDBリンク追加用のヘルパー関数
function addVKDBLinks(dateStr, info, container, customDateLinkUrl) {
  // 既存のリンクがあれば削除
  const existingContainer = document.querySelector('.amz-eval-links-container');
  if (existingContainer) {
    existingContainer.remove();
  }

  if (!dateStr) return;

  const dateParts = dateStr.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!dateParts) return;

  const year = parseInt(dateParts[1], 10);
  const month = parseInt(dateParts[2], 10);
  const day = parseInt(dateParts[3], 10);
  // 新vkdbカレンダー登録へのリンク
  const nextLink = document.createElement('a');
  
  // パラメータ構成 (スペースを+に置換)
  const cleanParam = (str) => encodeURIComponent(str || '').replace(/%20/g, '+');
  const formattedReleaseDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const amazonUrl = `https://www.amazon.co.jp/dp/${info.asin}`;
  const queryParams = [
    `title=${cleanParam(info.title)}`,
    `release_date=${formattedReleaseDate}`,
    `asin=${cleanParam(info.asin)}`,
    `artist_name=${cleanParam(info.author)}`,
    `link_url=${cleanParam(amazonUrl)}`,
    `image_url=${cleanParam(info.imageUrl)}`
  ].join('&');

  nextLink.href = `https://next.vkdb.jp/admin/items/new?${queryParams}`;
  nextLink.textContent = '新vkdbカレンダー登録';
  nextLink.target = '_blank';
  nextLink.style.display = 'inline-block';
  nextLink.style.fontSize = '16px';
  nextLink.style.color = '#0066c0';
  nextLink.style.textDecoration = 'none';
  nextLink.style.border = '1px solid #0066c0';
  nextLink.style.backgroundColor = '#fff';
  nextLink.style.padding = '4px 8px';
  nextLink.style.borderRadius = '4px';

  nextLink.addEventListener('mouseenter', () => nextLink.style.textDecoration = 'underline');
  nextLink.addEventListener('mouseleave', () => nextLink.style.textDecoration = 'none');

  const linkContainer = document.createElement('div');
  linkContainer.className = 'amz-eval-links-container';
  linkContainer.style.marginTop = '4px';
  linkContainer.style.marginBottom = '16px';
  linkContainer.style.paddingRight = '60px';
  linkContainer.style.textAlign = 'right';
  linkContainer.appendChild(nextLink);

  // 商品画像の上に表示し、タイトル周辺のコンテンツを押し下げない
  const imageBlock = document.querySelector(
    '#imageBlock_feature_div, #imageBlock, #main-image-container, #imgTagWrapperId'
  );
  if (imageBlock && imageBlock.parentNode) {
    imageBlock.parentNode.insertBefore(linkContainer, imageBlock);
  } else {
    container.appendChild(linkContainer);
  }
}

// 商品情報CSVエリアの注入
function injectProductInfoArea(asin, productTitleElement) {
  if (document.getElementById('amz-eval-info-area')) return;

  let info = getProductInfo(asin);
  // フォーマット設定を読み込んで内容を生成
  safeStorageGet(['format_template', 'date_link_url'], (result) => {
    let template = result.format_template;
    if (!template) {
      template = '{{aitem [[asin]],[[title]],[[author]],[[date]],[[image_url]]}}';
    }

    const buildContent = (currentInfo) => {
      return template
        .replace(/\[\[asin\]\]/g, currentInfo.asin)
        .replace(/\[\[title\]\]/g, currentInfo.title)
        .replace(/\[\[author\]\]/g, currentInfo.author)
        .replace(/\[\[date\]\]/g, currentInfo.date)
        .replace(/\[\[image_url\]\]/g, currentInfo.imageUrl);
    };

    const container = document.createElement('div');
    container.style.marginTop = '0';
    container.style.marginBottom = '0';

    const textarea = document.createElement('textarea');
    textarea.id = 'amz-eval-info-area';
    textarea.style.display = 'none';
    textarea.style.width = '100%';
    textarea.style.height = '60px';
    textarea.style.fontSize = '12px';
    textarea.readOnly = true;
    textarea.value = buildContent(info);

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

    // 初期状態のリンク設定
    if (info.date) {
      addVKDBLinks(info.date, info, container, result.date_link_url);
    }

    // 評価ボタンがあればその前に、なければタイトルの前に挿入
    const buttonsContainer = document.querySelector('.amz-eval-container-detail');
    const targetElement = buttonsContainer || productTitleElement;

    if (targetElement && targetElement.parentNode) {
      targetElement.parentNode.insertBefore(container, targetElement);
    }

    // 初期表示状態の更新
    updateDetailAreaVisibility();

    // 遅延ロード・未描画への対策：日付が取れていない場合、一定時間ポーリングして再取得を試みる
    if (!info.date) {
      let attempts = 0;
      const maxAttempts = 12; // 0.5秒おきに最大6秒間監視
      const interval = setInterval(() => {
        attempts++;
        const newInfo = getProductInfo(asin);
        if (newInfo.date) {
          clearInterval(interval);
          info = newInfo;
          textarea.value = buildContent(info);
          addVKDBLinks(info.date, info, container, result.date_link_url);
        }
        if (attempts >= maxAttempts) {
          clearInterval(interval);
        }
      }, 500);
    }
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

  // 日付文字列から YYYY/MM/DD 形式の日付を抽出するヘルパー関数
  const extractDateFromString = (str) => {
    if (!str) return null;
    // YYYY/MM/DD or YYYY-MM-DD
    let dateMatch = str.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (dateMatch) {
      const year = dateMatch[1];
      const month = dateMatch[2];
      const day = dateMatch[3];
      return `${year}/${month}/${day}`;
    }
    // YYYY年MM月DD日
    dateMatch = str.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (dateMatch) {
      return `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
    }
    return null;
  };

  let date = '';

  // 戦略1: detailBullets_feature_div および類似の登録情報リスト (詳細リスト)
  const detailBulletContainers = document.querySelectorAll('#detailBullets_feature_div, .detail-bullet-list, #productDetails_feature_div');
  detailBulletContainers.forEach(container => {
    if (date) return;
    const lis = container.querySelectorAll('li');
    lis.forEach(li => {
      if (date) return;
      const txt = li.textContent;
      // 出版社、発売日、Publication date、またはメディア種別の直後に日付があるか
      if (txt.includes('出版社') || txt.includes('発売日') || txt.includes('Publication date') || 
          txt.includes('発売') || txt.includes('CD') || txt.includes('DVD') || txt.includes('ディスク')) {
        const foundDate = extractDateFromString(txt);
        if (foundDate) {
          date = foundDate;
        }
      }
    });
  });

  // 戦略2: 汎用的な rpi-attribute スキャン (本、CD、DVD等の製品スペックカード)
  if (!date) {
    const rpiAttributes = document.querySelectorAll('[id^="rpi-attribute-"], .rpi-attribute');
    rpiAttributes.forEach(attr => {
      if (date) return;
      const label = attr.querySelector('.rpi-attribute-label')?.textContent.trim() || '';
      if (label.includes('発売') || label.includes('出版') || label.includes('発行') || 
          label.includes('リリース') || label.includes('Release') || label.includes('Publication')) {
        const valueSpan = attr.querySelector('.rpi-attribute-value span');
        if (valueSpan) {
          const foundDate = extractDateFromString(valueSpan.textContent);
          if (foundDate) {
            date = foundDate;
          }
        }
      }
    });
  }

  // 戦略3: 右カラムの「発売予定日は...」や在庫状況 (availability inside #rightCol or #buybox)
  if (!date) {
    const availability = document.getElementById('availability');
    if (availability) {
      const foundDate = extractDateFromString(availability.textContent);
      if (foundDate) {
        date = foundDate;
      }
    }
  }

  // 戦略4: 「仕様」テーブル (#productDetails_techSpec_section_1, .prodDetTable 等)
  if (!date) {
    const techTables = document.querySelectorAll('#productDetails_techSpec_section_1, #productDetails_db_sections, .prodDetTable, #technicalSpecifications_section_1');
    techTables.forEach(table => {
      if (date) return;
      const ths = table.querySelectorAll('th');
      ths.forEach(th => {
        if (date) return;
        const thText = th.textContent.trim();
        if (thText.includes('発売日') || thText.includes('Publication date') || thText.includes('リリース') || thText.includes('発売')) {
          const td = th.nextElementSibling;
          if (td) {
            const foundDate = extractDateFromString(td.textContent);
            if (foundDate) {
              date = foundDate;
            }
          }
        }
      });
    });
  }

  // 戦略5: 発売済みCD/DVD向けの安全なフォールバック (メディア形式 + 日付のパターン)
  if (!date) {
    const targets = [];
    
    // 登録情報リストの全要素を追加
    detailBulletContainers.forEach(container => {
      targets.push(...container.querySelectorAll('li'));
    });

    // 仕様テーブルおよびページ内の主要なテーブルの全行およびセルを追加
    const techTables = document.querySelectorAll('#productDetails_techSpec_section_1, #productDetails_db_sections, .prodDetTable, #technicalSpecifications_section_1, table');
    techTables.forEach(table => {
      // ナビゲーションメニューやCookie同意等の明らかに無関係なテーブルは除外
      if (table.closest('#nav-belt') || table.closest('#nav-main') || table.closest('#sp-cc')) return;
      targets.push(...table.querySelectorAll('tr, td, th'));
    });

    for (let i = 0; i < targets.length; i++) {
      const textToSearch = targets[i].textContent;

      // メディア形式を表す言葉の後に日付が続くパターンを検索
      const mediaMatch = textToSearch.match(/(CD|DVD|Blu-ray|ディスク|レコード|LP)[\s\S]*?(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/i);
      if (mediaMatch) {
        date = mediaMatch[2].replace(/-/g, '/');
        break;
      }

      const mediaMatchJp = textToSearch.match(/(CD|DVD|Blu-ray|ディスク|レコード|LP)[\s\S]*?(\d{4})年(\d{1,2})月(\d{1,2})日/i);
      if (mediaMatchJp) {
        date = `${mediaMatchJp[2]}/${mediaMatchJp[3]}/${mediaMatchJp[4]}`;
        break;
      }
    }
  }

  // 戦略6: ページ内の「発売日」等を含むテキスト周辺からのフォールバック抽出
  if (!date) {
    const potentialElements = document.querySelectorAll('span, td, p, li, div.a-row, b, strong');
    for (let i = 0; i < potentialElements.length; i++) {
      const el = potentialElements[i];
      // 子要素が多すぎる大きなコンテナは誤爆を避けるためスキップ
      if (el.children.length > 5) continue;
      
      const txt = el.textContent.trim();
      // 「発売日」「発売予定日」「Release Date」等を含み、「一時的に」「お届け」等のノイズを除外
      if ((txt.includes('発売') || txt.includes('Release Date') || txt.includes('Publication Date')) && 
          !txt.includes('一時的に') && !txt.includes('お届け') && !txt.includes('配送')) {
        
        // 1. 要素自身のテキストから抽出を試みる
        let foundDate = extractDateFromString(txt);
        if (foundDate) {
          date = foundDate;
          break;
        }

        // 2. 「発売日:」と日付が別々の兄弟要素（隣接要素）に分かれている場合を考慮
        if (el.nextElementSibling) {
          foundDate = extractDateFromString(el.nextElementSibling.textContent);
          if (foundDate) {
            date = foundDate;
            break;
          }
        }

        // 3. 親要素内の全体のテキストから抽出を試みる (小さなコンテナ限定)
        if (el.parentElement && el.parentElement.children.length < 5) {
          foundDate = extractDateFromString(el.parentElement.textContent);
          if (foundDate) {
            date = foundDate;
            break;
          }
        }
      }
    }
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

// ------ Migration Logic ------

/**
 * localStorage (ドメイン固有) にある古いデータを
 * chrome.storage.local (拡張機能共通) に移行します。
 */
function migrateLegacyData() {
  // すでに移行済みかチェック（無限ループや無駄な処理を防止）
  if (localStorage.getItem('amz_eval_migrated')) return;

  const dataToMigrate = {};
  const keysToRemove = [];

  // 1. 著者の古いリスト (deleted_artists) を移行
  const deletedArtistsCsv = localStorage.getItem('deleted_artists');
  if (deletedArtistsCsv) {
    const authors = deletedArtistsCsv.split(',').map(s => normalizeString(s.trim())).filter(s => s);
    authors.forEach(author => {
      dataToMigrate[`author:${author}`] = 'bad';
    });
    keysToRemove.push('deleted_artists');
  }

  // 2. 個別商品の評価 (ASINがキーのデータ) を移行
  // ASINは通常10文字の英数字
  const asinRegex = /^[A-Z0-9]{10}$/;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (asinRegex.test(key)) {
      const rating = localStorage.getItem(key);
      if (rating === 'good' || rating === 'bad') {
        dataToMigrate[key] = rating;
        keysToRemove.push(key);
      }
    }
  }

  // 移行するデータがあるかチェック
  if (Object.keys(dataToMigrate).length > 0) {
    safeStorageSet(dataToMigrate, () => {
      console.log('Legacy data migrated to chrome.storage.local:', dataToMigrate);
      // 移行済みフラグを立てる
      localStorage.setItem('amz_eval_migrated', 'true');

      // オプション: 元のデータを消去（安全のため、フラグを立てるだけで残す選択肢もあるが
      // 重複表示などの混乱を避けるためここでは削除を検討する。
      // ただし、localStorageから消すと元に戻せないので、まずはフラグ管理のみにする。
      // 今回はユーザーが「消えた」と言っているので、storage.localへの統合を優先。
      keysToRemove.forEach(k => localStorage.removeItem(k));
    });
  } else {
    // 移行対象がなくてもフラグを立てて次回の走査をスキップ
    localStorage.setItem('amz_eval_migrated', 'true');
  }
}

// DOMの準備ができたら実行
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
