"use strict";

/**
 * ===================== Dress Up モジュール =====================
 *
 * Princess Englishの「からださがし」と同じ世界観・演出（HUD、質問カード、
 * MAGIC SPEAK CARD、mini dance / special dance、BGM ducking等）を最大限
 * 再利用しつつ、遊び方だけ「英語を聞く→3択から選ぶ→発音する」に変えた
 * 第2のゲーム。
 *
 * 設計方針：
 *   - princess.js / zoo.js と同じく、app.js には依存しない自己完結モジュール。
 *     window.Speech（speech.js）と window.audioManager（audio.js、あれば）
 *     だけを使う。どちらも「無い」ケースを想定して安全にガードする。
 *   - 選択肢はすべて DRESSUP_ITEMS というデータ定義から生成するデータ駆動
 *     構造にしてあるので、将来「もっと髪型を増やす」「もっとドレスを増やす」
 *     場合も、このデータに項目を足すだけで対応できる（コード変更不要）。
 *   - 画像素材（assets/dressup/配下）はまだ無いので、プレビューは
 *     assets/princess.webp を表示したまま、選択状態はプレビュー下の
 *     Look Badgesにだけ反映する。各アイテムの assetPath はすでに用意して
 *     あるので、素材が揃ったら値を入れてレイヤー合成に切り替えられる。
 */
(function () {
  const LISTEN_TIMEOUT_MS = 6000;
  const FALLBACK_SPEAK_DELAY_MS = 2200;
  const CORRECT_CELEBRATE_DELAY_MS = 1600;
  const AUTO_SPEAK_DELAY_MS = 300;
  const SPECIAL_DANCE_MS = 3000;
  const SPECIAL_DANCE_REDUCED_MS = 900;

  /* ===================== 設定：データ駆動の選択肢定義 =====================
   * 各カテゴリーは { id, emoji, label, items[] } を持つ。
   * 各アイテムは以下を持つ：
   *   id         カテゴリー内で一意のID
   *   en         カードに表示する英語のフルネーム（例: "Blue Dress"）
   *   speakWord  読み上げ・発音練習で使う短い単語（例: "Blue"）。
   *              色の付かない項目（Ponytailなど）はenと同じでよい。
   *   jp         「どれ？」形式の日本語サブテキスト
   *   swatch     3択カードに表示する色スウォッチ（CSS color）
   *   assetPath  将来のレイヤー画像パス（今は未使用。素材が揃ったら設定）
   */
  const DRESSUP_CATEGORIES = [
    {
      id: "hair",
      emoji: "💇",
      label: "HAIR",
      items: [
        {
          id: "long",
          en: "Long Hair",
          speakWord: "Long",
          jp: "ロングヘアは どれ？",
          swatch: "#7A4A2B",
          icon: "💁‍♀️",
          assetPath: "assets/dressup/hair/long.webp", // 未配置
        },
        {
          id: "ponytail",
          en: "Ponytail",
          speakWord: "Ponytail",
          jp: "ポニーテールは どれ？",
          swatch: "#B5722E",
          icon: "🎀",
          assetPath: "assets/dressup/hair/ponytail.webp", // 未配置
        },
        {
          id: "braids",
          en: "Braids",
          speakWord: "Braids",
          jp: "おさげは どれ？",
          swatch: "#8F5B2E",
          icon: "👧",
          assetPath: "assets/dressup/hair/braids.webp", // 未配置
        },
      ],
    },
    {
      id: "crown",
      emoji: "👑",
      label: "CROWN",
      items: [
        {
          id: "gold",
          en: "Gold Crown",
          speakWord: "Gold",
          jp: "きんいろの かんむりは どれ？",
          swatch: "#FFD24D",
          icon: "👑",
          assetPath: "assets/dressup/crowns/gold.webp", // 未配置
        },
        {
          id: "flower",
          en: "Flower Crown",
          speakWord: "Flower",
          jp: "はなの かんむりは どれ？",
          swatch: "#FF8FB1",
          icon: "🌸",
          assetPath: "assets/dressup/crowns/flower.webp", // 未配置
        },
        {
          id: "purple",
          en: "Purple Crown",
          speakWord: "Purple",
          jp: "むらさきの かんむりは どれ？",
          swatch: "#B18BFF",
          icon: "👑",
          assetPath: "assets/dressup/crowns/purple.webp", // 未配置
        },
      ],
    },
    {
      id: "dress",
      emoji: "👗",
      label: "DRESS",
      items: [
        {
          id: "pink",
          en: "Pink Dress",
          speakWord: "Pink",
          jp: "ピンクの ドレスは どれ？",
          swatch: "#FF8FB1",
          icon: "👗",
          assetPath: "assets/dressup/dresses/pink.webp", // 未配置
        },
        {
          id: "blue",
          en: "Blue Dress",
          speakWord: "Blue",
          jp: "みずいろの ドレスは どれ？",
          swatch: "#7EC8F2",
          icon: "👗",
          assetPath: "assets/dressup/dresses/blue.webp", // 未配置
        },
        {
          id: "yellow",
          en: "Yellow Dress",
          speakWord: "Yellow",
          jp: "きいろの ドレスは どれ？",
          swatch: "#FFD24D",
          icon: "👗",
          assetPath: "assets/dressup/dresses/yellow.webp", // 未配置
        },
      ],
    },
    {
      id: "shoes",
      emoji: "👠",
      label: "SHOES",
      items: [
        {
          id: "pink",
          en: "Pink Shoes",
          speakWord: "Pink",
          jp: "ピンクの くつは どれ？",
          swatch: "#FF8FB1",
          icon: "👠",
          assetPath: "assets/dressup/shoes/pink.webp", // 未配置
        },
        {
          id: "blue",
          en: "Blue Shoes",
          speakWord: "Blue",
          jp: "みずいろの くつは どれ？",
          swatch: "#7EC8F2",
          icon: "👠",
          assetPath: "assets/dressup/shoes/blue.webp", // 未配置
        },
        {
          id: "purple",
          en: "Purple Shoes",
          speakWord: "Purple",
          jp: "むらさきの くつは どれ？",
          swatch: "#B18BFF",
          icon: "👠",
          assetPath: "assets/dressup/shoes/purple.webp", // 未配置
        },
      ],
    },
  ];

  // 将来のFREE DRESS UPモード（好きな組み合わせで自由に着せ替え）でも
  // そのまま使えるよう、「カテゴリーID→カテゴリー定義」のルックアップと
  // 「ベース画像」を分けて持っておく。
  const DRESSUP_BASE_IMAGE = "assets/princess.webp"; // 将来 assets/dressup/base/base.webp に差し替え可能
  function findCategory(catId) {
    return DRESSUP_CATEGORIES.find((c) => c.id === catId) || null;
  }

  /* ===================== DOM参照 ===================== */
  const screenEl = document.getElementById("screen-dressup");
  const startBtn = document.getElementById("dressup-start-btn");
  const homeBackBtn = screenEl ? screenEl.querySelector(".princess-home-btn") : null;
  const musicBtn = document.getElementById("dressup-music-btn");
  const scoreEl = document.getElementById("dressup-score");
  const categoryLabelEl = document.getElementById("dressup-category-label");
  const questionEnEl = document.getElementById("dressup-question-en");
  const questionJpEl = document.getElementById("dressup-question-jp");
  const replayBtn = document.getElementById("dressup-replay-btn");
  const previewImgEl = document.getElementById("dressup-preview-img");
  const fxLayerEl = document.getElementById("dressup-fx-layer");
  const badgesWrapEl = document.getElementById("dressup-look-badges");
  const choicesWrapEl = document.getElementById("dressup-choices");

  const speakOverlayEl = document.getElementById("dressup-speak-overlay");
  const speakPortraitEl = document.getElementById("dressup-speak-portrait");
  const speakWordEl = document.getElementById("dressup-speak-word");
  const micIconEl = document.getElementById("dressup-mic-icon");
  const micRingEl = document.getElementById("dressup-mic-ring");
  const micStatusEl = document.getElementById("dressup-mic-status");
  const hearExampleBtn = document.getElementById("dressup-hear-example-btn");
  const skipBtn = document.getElementById("dressup-skip-btn");

  const completeEl = document.getElementById("dressup-complete");
  const youLookEl = document.getElementById("dressup-you-did-it");
  const roundPortraitEl = document.getElementById("dressup-round-portrait");
  const roundSubEl = document.getElementById("dressup-round-sub");
  const againBtn = document.getElementById("dressup-again-btn");
  const homeBtnResult = document.getElementById("dressup-home-btn");

  // 必須要素が無いページ（このHTMLを使っていない）では何もしない。
  if (!screenEl || !startBtn) return;

  /* ===================== ゲーム状態 ===================== */
  const dressup = {
    order: DRESSUP_CATEGORIES.map((c) => c.id), // 1 HAIR → 2 CROWN → 3 DRESS → 4 SHOES（固定順）
    currentIndex: 0,
    awaitingPick: true,
    targetItem: null,
    targetCatId: null,
    pendingItem: null,
    selections: {}, // catId -> itemId
    autoSpokenIndex: -1,
  };

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** BGM/SFXをまとめて鳴らす薄いヘルパー。audio.jsが無い環境でも安全に無視する。 */
  function playAudioSfx(name) {
    if (window.audioManager) window.audioManager.playSfx(name);
  }

  function setMicListening(isListening) {
    if (micIconEl) micIconEl.classList.toggle("listening", isListening);
    if (micRingEl) micRingEl.classList.toggle("active", isListening);
  }

  /* ===================== 見た目の描画 ===================== */

  /** Look Badges（プレビュー下の小さな絵文字バッジ）を現在の状態に合わせて更新する。 */
  function renderLookBadges() {
    if (!badgesWrapEl) return;
    badgesWrapEl.querySelectorAll(".dressup-look-badge").forEach((badge) => {
      const catId = badge.dataset.cat;
      const done = !!dressup.selections[catId];
      const active = catId === dressup.targetCatId && !done;
      badge.classList.toggle("is-done", done);
      badge.classList.toggle("is-active", active);
    });
  }

  /**
   * プリンセスのプレビューを更新する。
   * 将来 assets/dressup/配下にレイヤー画像が揃ったら、ここを
   * 「base → hair → crown → dress → shoes」の順に透明画像を重ねる実装に
   * 差し替える（各アイテムのassetPathはすでに用意してある）。
   * 現時点では画像が無いので、常に同じprincess.webpを表示し、選択状態は
   * renderLookBadges()のバッジ側だけで表現する（画像を歪ませない・
   * 偽の見た目を無理に作らない、という方針のため）。
   */
  function renderDressUpPreview() {
    if (previewImgEl) previewImgEl.src = DRESSUP_BASE_IMAGE;
    renderLookBadges();
  }

  /** 3択カードを描画する。画像素材が無いので、色スウォッチ＋絵文字＋英単語の仮カード。 */
  function renderDressUpChoices(category, target) {
    if (!choicesWrapEl) return;
    choicesWrapEl.innerHTML = "";
    const shuffled = shuffle(category.items);
    shuffled.forEach((item) => {
      const btn = document.createElement("button");
      btn.className = "dressup-option-card";
      btn.dataset.itemId = item.id;
      btn.setAttribute("aria-label", item.en);

      const swatch = document.createElement("span");
      swatch.className = "dressup-option-swatch";
      swatch.style.background = item.swatch;
      swatch.textContent = item.icon || "";

      const label = document.createElement("span");
      label.className = "dressup-option-label";
      label.textContent = item.en;

      btn.appendChild(swatch);
      btn.appendChild(label);
      btn.addEventListener("click", () => handleDressUpChoiceTap(item, btn));
      choicesWrapEl.appendChild(btn);
    });
  }

  /* ===================== 演出（Princess Englishと同じ考え方を再利用） ===================== */

  /** 要素の中心座標を、fxLayerの親要素基準のpx座標に変換する。 */
  function elementRelativeCenter(el) {
    const hostRect = fxLayerEl.parentElement.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return {
      cx: r.left - hostRect.left + r.width / 2,
      cy: r.top - hostRect.top + r.height / 2,
      width: r.width,
      height: r.height,
    };
  }

  function spawnSparkleBurst(cx, cy, refSize, options) {
    if (!fxLayerEl) return;
    const opts = options || {};
    const chars = opts.chars || ["✨", "⭐", "💫"];
    const count = opts.count != null ? opts.count : 6;
    const size = Math.max(refSize || 40, 28) * 1.5;

    const ring = document.createElement("div");
    ring.className = "princess-glow-ring";
    ring.style.left = cx - size / 2 + "px";
    ring.style.top = cy - size / 2 + "px";
    ring.style.width = size + "px";
    ring.style.height = size + "px";
    fxLayerEl.appendChild(ring);
    setTimeout(() => ring.remove(), 1000);

    for (let i = 0; i < count; i++) {
      const s = document.createElement("div");
      s.className = "princess-sparkle";
      s.textContent = chars[i % chars.length];
      s.style.left = cx + "px";
      s.style.top = cy + "px";
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const dist = 24 + Math.random() * 18;
      s.style.setProperty("--sx", Math.cos(angle) * dist + "px");
      s.style.setProperty("--sy", Math.sin(angle) * dist - 8 + "px");
      fxLayerEl.appendChild(s);
      setTimeout(() => s.remove(), 1000);
    }
  }

  function spawnMissRipple(cx, cy, refSize) {
    if (!fxLayerEl) return;
    const size = Math.max(refSize || 46, 30) * 1.3;
    const ripple = document.createElement("div");
    ripple.className = "princess-miss-ripple";
    ripple.style.left = cx - size / 2 + "px";
    ripple.style.top = cy - size / 2 + "px";
    ripple.style.width = size + "px";
    ripple.style.height = size + "px";
    fxLayerEl.appendChild(ripple);
    setTimeout(() => ripple.remove(), 700);
  }

  /* ===================== ラウンドの開始 ===================== */

  function startDressUpGame() {
    Speech.cancelSpeaking();
    Speech.stopListening();

    dressup.currentIndex = 0;
    dressup.selections = {};
    dressup.awaitingPick = true;
    dressup.pendingItem = null;
    dressup.autoSpokenIndex = -1;

    if (scoreEl) scoreEl.textContent = "0";
    if (speakOverlayEl) speakOverlayEl.hidden = true;
    if (completeEl) completeEl.hidden = true;

    renderDressUpPreview();
    showScreenSafe("screen-dressup");
    askNextDressUpQuestion();
  }

  startBtn.addEventListener("click", () => {
    // iPhone Safariのautoplay制限対策：ユーザー操作(このタップ)を起点に
    // BGMの再生を解禁する（Body Partsと全く同じ考え方）。
    if (window.audioManager) window.audioManager.unlock();
    playAudioSfx("play");
    startDressUpGame();
  });

  /* ===================== 🎵 BGM ON/OFFボタン（GAME HUD） ===================== */
  function syncMusicBtn() {
    if (!musicBtn || !window.audioManager) return;
    const on = window.audioManager.isBgmEnabled();
    musicBtn.textContent = on ? "🎵" : "🔇";
    musicBtn.setAttribute("aria-label", on ? "BGM オフにする" : "BGM オンにする");
    musicBtn.classList.toggle("is-muted", !on);
  }
  if (musicBtn) {
    syncMusicBtn();
    musicBtn.addEventListener("click", () => {
      if (!window.audioManager) return;
      window.audioManager.setBgmEnabled(!window.audioManager.isBgmEnabled());
      syncMusicBtn();
    });
  }

  /* ===================== フェーズ1: きいて、えらぶ ===================== */

  function questionTextFor(item) {
    return `Choose the ${item.en.toLowerCase()}!`;
  }

  function askNextDressUpQuestion() {
    if (dressup.currentIndex >= dressup.order.length) {
      finishDressUp();
      return;
    }

    dressup.awaitingPick = true;
    dressup.pendingItem = null;

    const catId = dressup.order[dressup.currentIndex];
    const category = findCategory(catId);
    if (!category) {
      finishDressUp();
      return;
    }
    const target = category.items[Math.floor(Math.random() * category.items.length)];
    dressup.targetItem = target;
    dressup.targetCatId = catId;

    if (categoryLabelEl) categoryLabelEl.textContent = `${category.emoji} ${category.label}`;
    if (questionEnEl) questionEnEl.textContent = questionTextFor(target);
    if (questionJpEl) questionJpEl.textContent = target.jp;
    renderDressUpChoices(category, target);
    renderLookBadges();

    // 自動読み上げは、この問題番号につき1回だけ。
    const questionIndex = dressup.currentIndex;
    setTimeout(() => {
      if (dressup.currentIndex !== questionIndex) return;
      if (dressup.autoSpokenIndex === questionIndex) return;
      dressup.autoSpokenIndex = questionIndex;
      speakDressUpQuestion(target);
    }, AUTO_SPEAK_DELAY_MS);
  }

  function speakDressUpQuestion(target) {
    if (replayBtn) replayBtn.classList.add("speaking");
    Speech.speak(questionTextFor(target), {
      onEnd: () => {
        if (replayBtn) replayBtn.classList.remove("speaking");
      },
    });
  }

  if (replayBtn) {
    replayBtn.addEventListener("click", () => {
      if (dressup.targetItem) speakDressUpQuestion(dressup.targetItem);
    });
  }

  function handleDressUpChoiceTap(item, cardEl) {
    if (!dressup.awaitingPick) return;
    const target = dressup.targetItem;
    if (!target) return;

    if (item.id !== target.id) {
      handleDressUpMiss(cardEl);
      return;
    }

    // 正解！
    dressup.awaitingPick = false;
    const { cx, cy, width, height } = elementRelativeCenter(cardEl);
    const refSize = Math.max(width, height);
    spawnSparkleBurst(cx, cy, refSize, { chars: ["✨", "⭐", "💫"], count: 6 });
    playAudioSfx("correct");
    if (!prefersReducedMotion()) {
      cardEl.classList.remove("dressup-correct-pop");
      void cardEl.offsetWidth;
      cardEl.classList.add("dressup-correct-pop");
    }

    dressup.selections[dressup.targetCatId] = item.id;
    renderLookBadges();

    Speech.speak(`${item.speakWord}!`, {
      onEnd: () => enterDressUpSpeakPhase(item),
    });
  }

  function handleDressUpMiss(cardEl) {
    const { cx, cy, width, height } = elementRelativeCenter(cardEl);
    const refSize = Math.max(width, height);
    spawnMissRipple(cx, cy, refSize);
    playAudioSfx("wrong");
    Speech.speak("Try again!");
  }

  /* ===================== フェーズ2: じぶんではなしてみよう ===================== */

  function enterDressUpSpeakPhase(item) {
    dressup.pendingItem = item;

    if (speakPortraitEl) speakPortraitEl.classList.remove("pe-mini-dance");
    setMicListening(false);
    if (speakWordEl) speakWordEl.textContent = item.speakWord.toUpperCase();
    if (micStatusEl) micStatusEl.textContent = "";
    if (speakOverlayEl) speakOverlayEl.hidden = false;

    Speech.speak(`Can you say ${item.speakWord}?`, {
      onEnd: () => beginDressUpListening(item),
    });
  }

  function beginDressUpListening(item) {
    if (!dressup.pendingItem || dressup.pendingItem.id !== item.id) return;

    if (!Speech.isRecognitionSupported()) {
      setMicListening(false);
      if (micStatusEl) micStatusEl.textContent = "🎤 いってみよう！";
      setTimeout(() => {
        if (dressup.pendingItem && dressup.pendingItem.id === item.id) {
          handleDressUpPronunciationSuccess(item);
        }
      }, FALLBACK_SPEAK_DELAY_MS);
      return;
    }

    setMicListening(true);
    if (micStatusEl) micStatusEl.textContent = "";

    Speech.listen({
      timeoutMs: LISTEN_TIMEOUT_MS,
      onResult: (transcript) => {
        if (!dressup.pendingItem || dressup.pendingItem.id !== item.id) return;
        setMicListening(false);
        if (Speech.matchesWord(transcript, item.speakWord)) {
          handleDressUpPronunciationSuccess(item);
        } else {
          handleDressUpPronunciationRetry(item);
        }
      },
      onNoSpeech: () => {
        if (!dressup.pendingItem || dressup.pendingItem.id !== item.id) return;
        setMicListening(false);
        handleDressUpPronunciationRetry(item);
      },
      onDenied: () => {
        if (!dressup.pendingItem || dressup.pendingItem.id !== item.id) return;
        setMicListening(false);
        if (micStatusEl) micStatusEl.textContent = "🎤 いってみよう！";
        setTimeout(() => {
          if (dressup.pendingItem && dressup.pendingItem.id === item.id) {
            handleDressUpPronunciationSuccess(item);
          }
        }, FALLBACK_SPEAK_DELAY_MS);
      },
      onUnsupported: () => {
        if (!dressup.pendingItem || dressup.pendingItem.id !== item.id) return;
        setMicListening(false);
        if (micStatusEl) micStatusEl.textContent = "🎤 いってみよう！";
        setTimeout(() => {
          if (dressup.pendingItem && dressup.pendingItem.id === item.id) {
            handleDressUpPronunciationSuccess(item);
          }
        }, FALLBACK_SPEAK_DELAY_MS);
      },
    });
  }

  function handleDressUpPronunciationRetry(item) {
    if (!dressup.pendingItem || dressup.pendingItem.id !== item.id) return;
    if (micStatusEl) micStatusEl.textContent = "Let's try again!";
    Speech.speak("Let's try again!", {
      onEnd: () => {
        if (dressup.pendingItem && dressup.pendingItem.id === item.id && micStatusEl) {
          micStatusEl.textContent = "🔊 おてほんを きいてみよう";
        }
      },
    });
  }

  if (hearExampleBtn) {
    hearExampleBtn.addEventListener("click", () => {
      const item = dressup.pendingItem;
      if (!item) return;
      Speech.cancelSpeaking();
      Speech.stopListening();
      setMicListening(false);
      if (micStatusEl) micStatusEl.textContent = "";
      Speech.speak(item.speakWord, {
        onEnd: () => beginDressUpListening(item),
      });
    });
  }

  if (skipBtn) {
    skipBtn.addEventListener("click", () => {
      const item = dressup.pendingItem;
      if (!item) return;
      Speech.cancelSpeaking();
      Speech.stopListening();
      handleDressUpPronunciationSuccess(item, { viaSkip: true });
    });
  }

  function handleDressUpPronunciationSuccess(item) {
    if (!dressup.pendingItem || dressup.pendingItem.id !== item.id) return;
    dressup.pendingItem = null;

    if (scoreEl) scoreEl.textContent = String(dressup.currentIndex + 1);
    if (micStatusEl) micStatusEl.textContent = "Great job! 🎉";
    Speech.speak("Great job!");
    playGreatJobCelebration();

    setTimeout(() => {
      if (speakOverlayEl) speakOverlayEl.hidden = true;
      dressup.currentIndex++;
      askNextDressUpQuestion();
    }, CORRECT_CELEBRATE_DELAY_MS);
  }

  /**
   * 発音成功時のミニダンス演出。Princess Englishと全く同じCSSクラス
   * （.princess-speak-portrait.pe-mini-dance）を再利用するため、
   * #dressup-speak-portrait にも同じ base class を付けてある。
   */
  function playGreatJobCelebration() {
    playAudioSfx("sparkle");

    if (speakPortraitEl && !prefersReducedMotion()) {
      speakPortraitEl.classList.remove("pe-mini-dance");
      void speakPortraitEl.offsetWidth;
      speakPortraitEl.classList.add("pe-mini-dance");
      setTimeout(() => speakPortraitEl.classList.remove("pe-mini-dance"), 900);
    }

    if (!speakOverlayEl) return;
    const overlayRect = speakOverlayEl.getBoundingClientRect();
    const topY = overlayRect.height * 0.14;
    const sparkleChars = ["✨", "⭐", "💫", "💗", "💕"];
    for (let i = 0; i < 7; i++) {
      const s = document.createElement("div");
      s.className = "princess-sparkle";
      s.textContent = sparkleChars[i % sparkleChars.length];
      const x = overlayRect.width * (0.2 + Math.random() * 0.6);
      s.style.left = x + "px";
      s.style.top = topY + "px";
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const dist = 24 + Math.random() * 20;
      s.style.setProperty("--sx", Math.cos(angle) * dist + "px");
      s.style.setProperty("--sy", Math.sin(angle) * dist - 8 + "px");
      speakOverlayEl.appendChild(s);
      setTimeout(() => s.remove(), 1000);
    }

    if (!prefersReducedMotion()) {
      const confettiColors = ["#FFC94D", "#FF8FB1", "#B18BFF", "#BFE3FF"];
      for (let i = 0; i < 8; i++) {
        const c = document.createElement("div");
        c.className = "princess-confetti-piece";
        c.style.left = overlayRect.width * Math.random() + "px";
        c.style.background = confettiColors[i % confettiColors.length];
        c.style.animationDelay = Math.random() * 0.15 + "s";
        speakOverlayEl.appendChild(c);
        setTimeout(() => c.remove(), 1400);
      }
    }
  }

  /* ===================== 完成演出：YOU LOOK BEAUTIFUL! ===================== */

  function finishDressUp() {
    Speech.cancelSpeaking();
    Speech.stopListening();

    if (!completeEl) return;
    completeEl.hidden = false;
    if (youLookEl) youLookEl.hidden = false;
    if (roundSubEl) roundSubEl.hidden = true;
    if (againBtn) againBtn.hidden = true;
    if (homeBtnResult) homeBtnResult.hidden = true;

    // 10問クリア時と同じ考え方：通常BGMをduck → fanfare → SPECIAL DANCE →
    // このsetTimeoutの中で自然に通常BGMへ戻す。
    if (window.audioManager) window.audioManager.duck("clear");
    playAudioSfx("clear");

    Speech.speak("You look beautiful!");

    const reduced = prefersReducedMotion();
    if (!reduced) {
      if (roundPortraitEl) {
        roundPortraitEl.classList.remove("pe-special-dance");
        void roundPortraitEl.offsetWidth;
        roundPortraitEl.classList.add("pe-special-dance");
      }
      spawnCompleteCelebrationParticles();
    } else {
      spawnCompleteCelebrationParticles({ staticOnly: true });
    }

    setTimeout(() => {
      if (roundPortraitEl) roundPortraitEl.classList.remove("pe-special-dance");
      if (youLookEl) youLookEl.hidden = true;
      if (roundSubEl) roundSubEl.hidden = false;
      if (againBtn) againBtn.hidden = false;
      if (homeBtnResult) homeBtnResult.hidden = false;
      if (window.audioManager) window.audioManager.unduck("clear");
      Speech.speak("Great job!");
    }, reduced ? SPECIAL_DANCE_REDUCED_MS : SPECIAL_DANCE_MS);
  }

  function spawnCompleteCelebrationParticles(options) {
    if (!completeEl) return;
    const staticOnly = !!(options && options.staticOnly);
    const overlayRect = completeEl.getBoundingClientRect();
    const sparkleChars = ["✨", "⭐", "💫", "💗", "💕"];
    const confettiColors = ["#FFC94D", "#FF8FB1", "#B18BFF", "#BFE3FF"];

    for (let i = 0; i < (staticOnly ? 6 : 14); i++) {
      const s = document.createElement("div");
      s.className = "princess-sparkle";
      s.textContent = sparkleChars[i % sparkleChars.length];
      const x = overlayRect.width * (0.12 + Math.random() * 0.76);
      const y = overlayRect.height * (0.16 + Math.random() * 0.26);
      s.style.left = x + "px";
      s.style.top = y + "px";
      if (staticOnly) {
        s.style.opacity = "0.95";
      } else {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2;
        const dist = 26 + Math.random() * 24;
        s.style.setProperty("--sx", Math.cos(angle) * dist + "px");
        s.style.setProperty("--sy", Math.sin(angle) * dist - 10 + "px");
      }
      completeEl.appendChild(s);
      setTimeout(() => s.remove(), staticOnly ? SPECIAL_DANCE_REDUCED_MS : 1000);
    }

    if (!staticOnly) {
      for (let i = 0; i < 10; i++) {
        const c = document.createElement("div");
        c.className = "princess-confetti-piece";
        c.style.left = overlayRect.width * Math.random() + "px";
        c.style.background = confettiColors[i % confettiColors.length];
        c.style.animationDelay = Math.random() * 0.6 + "s";
        completeEl.appendChild(c);
        setTimeout(() => c.remove(), 2000);
      }
    }
  }

  if (againBtn) {
    againBtn.addEventListener("click", () => {
      completeEl.hidden = true;
      startDressUpGame();
    });
  }

  if (homeBtnResult) {
    homeBtnResult.addEventListener("click", () => {
      Speech.cancelSpeaking();
      Speech.stopListening();
      completeEl.hidden = true;
      showScreenSafe("screen-home");
    });
  }

  /* ===================== 画面遷移（既存の showScreen を再利用） ===================== */
  function showScreenSafe(id) {
    if (typeof showScreen === "function") {
      showScreen(id);
      return;
    }
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    const el = document.getElementById(id);
    if (el) el.classList.add("active");
  }
})();
