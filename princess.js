"use strict";

/**
 * ===================== Princess English モジュール =====================
 *
 * 「選択肢カードから答えを選ぶ」のではなく、画面中央の大きなプリンセス
 * イラストに直接タップして、英語で指定された身体の部位を探すゲーム。
 *
 * 設計方針（zoo.jsと同じ考え方）:
 *   - このファイルは app.js / zoo.js に依存しません。window.Speech（speech.js）
 *     と共有DOM（#confetti-layer は使わず、専用の演出レイヤーを自前で持つ）だけを使う
 *     自己完結モジュールです。
 *   - プリンセスの見た目は今は仮のインラインSVGイラストですが、当たり判定
 *     （どこを押したら正解になるか）は見た目から完全に切り離し、画像の
 *     左上を基準にした「%座標」の設定値（PRINCESS_BODY_PARTS の hotspots）
 *     だけで管理しています。将来、こちらで用意したプリンセスのPNG/WebP画像に
 *     差し替えたいときは、PRINCESS_CONFIG.imageSrc に画像パスを設定し、
 *     必要なら各パーツの hotspots の数値（%）を新しい画像に合わせて
 *     調整するだけで対応できます（renderPrincessVisual を参照）。
 */
(function () {
  const LISTEN_TIMEOUT_MS = 6000;
  const FALLBACK_SPEAK_DELAY_MS = 2200;
  const CORRECT_CELEBRATE_DELAY_MS = 1600;
  const AUTO_SPEAK_DELAY_MS = 300;

  /* ===================== 設定：見た目と当たり判定 ===================== */
  const PRINCESS_CONFIG = {
    // Princess Englishの正式イラスト（実写ベースのプリンセス画像）。
    // 縦横比は 1024×1536（2:3）。差し替える場合はここのパスと、下の
    // PRINCESS_BODY_PARTS の各 hotspots の%座標を新しい画像に合わせて
    // 調整するだけでよい。
    imageSrc: "assets/princess.webp",
    imageAspect: "1024 / 1536",
  };

  /*
   * 各 body part の hotspots は、プリンセスの表示領域（#princess-stage）
   * 左上を基準にした % 座標 { left, top, width, height } の配列。
   * 配列にしているのは、髪の毛のように1つの部位が複数の場所に分かれて
   * 見えている場合（頭の上＋左右の髪）にも対応するため。
   * 座標は現在の仮イラスト（viewBox 0 0 300 500）に合わせて設定してあり、
   * 見た目の輪郭より少し大きめに取って2〜5歳でもタップしやすくしている。
   * 画像を差し替えた場合は、この数値だけを調整すればよい。
   */
  const PRINCESS_BODY_PARTS = [
    {
      // 「head」は顔全体を覆う1つの大きな四角形にしない。目・鼻・口・耳・髪の
      // 領域と重なると、それらのDOM要素（headより後に描画される）に常に
      // タップを奪われてしまい、headだけが絶対に押せなくなるバグになるため
      // （実機テストで発見）、他パーツと重ならない「ほほ（左右）」と「あご」を
      // headの当たり判定として使う。
      id: "head",
      en: "head",
      jp: "あたまは どこ？",
      plural: false,
      hotspots: [
        { left: 35, top: 17, width: 6, height: 11 }, // 左ほほ
        { left: 60, top: 17, width: 6, height: 11 }, // 右ほほ
        { left: 43, top: 29, width: 14, height: 6 }, // あご
      ],
    },
    {
      id: "hair",
      en: "hair",
      jp: "かみのけは どこ？",
      plural: false,
      hotspots: [
        { left: 30, top: 8, width: 40, height: 9 }, // 前髪
        { left: 17, top: 17, width: 10, height: 12 }, // 左：もみあげ
        { left: 28, top: 29, width: 14, height: 16 }, // 左：肩にかかる髪
        { left: 74, top: 17, width: 10, height: 12 }, // 右：もみあげ
        { left: 58, top: 29, width: 14, height: 16 }, // 右：肩にかかる髪
      ],
    },
    {
      id: "eyes",
      en: "eyes",
      jp: "めは どこ？",
      plural: true,
      hotspots: [
        { left: 41, top: 17, width: 5, height: 4 },
        { left: 55, top: 17, width: 5, height: 4 },
      ],
    },
    {
      id: "ears",
      en: "ears",
      jp: "みみは どこ？",
      plural: true,
      hotspots: [
        { left: 27, top: 19, width: 8, height: 10 },
        { left: 66, top: 19, width: 8, height: 10 },
      ],
    },
    {
      id: "nose",
      en: "nose",
      jp: "はなは どこ？",
      plural: false,
      hotspots: [{ left: 47, top: 21, width: 7, height: 3 }],
    },
    {
      id: "mouth",
      en: "mouth",
      jp: "くちは どこ？",
      plural: false,
      hotspots: [{ left: 44, top: 25, width: 10, height: 3 }],
    },
    {
      id: "hands",
      en: "hands",
      jp: "てはどこ？",
      plural: true,
      hotspots: [
        { left: 9, top: 42, width: 13, height: 12 }, // 左手
        { left: 83, top: 46, width: 16, height: 6 }, // 右手
      ],
    },
    {
      id: "fingers",
      en: "fingers",
      jp: "ゆびは どこ？",
      plural: true,
      hotspots: [
        { left: 0, top: 47, width: 9, height: 11 }, // 左ゆび
        { left: 85, top: 40, width: 15, height: 6 }, // 右ゆび
      ],
    },
    {
      id: "legs",
      en: "legs",
      jp: "あしは どこ？",
      plural: true,
      hotspots: [
        { left: 38, top: 82, width: 7, height: 5 }, // 左あし
        { left: 57, top: 82, width: 8, height: 5 }, // 右あし
      ],
    },
    {
      id: "feet",
      en: "feet",
      jp: "あんよは どこ？",
      plural: true,
      hotspots: [
        { left: 31, top: 89, width: 16, height: 10 }, // 左あんよ
        { left: 56, top: 89, width: 17, height: 9 }, // 右あんよ
      ],
    },
  ];

  /* ===================== 状態 ===================== */
  const princess = {
    order: [], // 出題順（シャッフル済み・重複なし）
    currentIndex: 0,
    score: 0,
    awaitingPick: true,
    pendingPart: null,
    autoSpokenIndex: -1, // どの問題番号まで自動読み上げ済みか（同じ問題を2回自動で読まないための保証）
  };

  /* ===================== DOM参照 ===================== */
  const princessScoreEl = document.getElementById("princess-score");
  const princessStageEl = document.getElementById("princess-stage");
  const princessImgHost = document.querySelector(".princess-illustration");
  const princessHotspotsEl = document.getElementById("princess-hotspots");
  const princessFxLayerEl = document.getElementById("princess-fx-layer");
  const princessQuestionEnEl = document.getElementById("princess-question-en");
  const princessQuestionJpEl = document.getElementById("princess-question-jp");
  const princessReplayBtn = document.getElementById("princess-replay-btn");
  const princessSpeakOverlay = document.getElementById("princess-speak-overlay");
  const princessSpeakEmojiEl = document.getElementById("princess-speak-emoji");
  const princessMicIconEl = document.getElementById("princess-mic-icon");
  const princessSpeakWordEl = document.getElementById("princess-speak-word");
  const princessMicStatusEl = document.getElementById("princess-mic-status");
  const princessHearExampleBtn = document.getElementById("princess-hear-example-btn");
  const princessSkipBtn = document.getElementById("princess-skip-btn");
  const princessRoundCompleteEl = document.getElementById("princess-round-complete");
  const princessRoundScoreEl = document.getElementById("princess-round-score");
  const princessAgainBtn = document.getElementById("princess-again-btn");
  const princessHomeBtn = document.getElementById("princess-home-btn");
  const princessStartBtn = document.getElementById("princess-start-btn");

  if (!princessStageEl || !princessStartBtn) return;

  /* ===================== 効果音・キラキラ（自己完結） ===================== */
  let princessAudioCtx = null;
  function getPrincessAudioCtx() {
    if (!princessAudioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) princessAudioCtx = new AC();
    }
    return princessAudioCtx;
  }
  function playPrincessTone(freq, duration, type = "sine") {
    const ctx = getPrincessAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }
  function playPrincessCorrectSound() {
    playPrincessTone(659.25, 0.13);
    setTimeout(() => playPrincessTone(783.99, 0.13), 110);
    setTimeout(() => playPrincessTone(987.77, 0.2), 220);
  }

  /**
   * 正解した部位のあたり（hotspot要素の実際の位置）に、光る輪とキラキラを表示する。
   * イラストがSVGでもPNGでも、hotspot要素自体の実測位置を使うので同じコードで動く。
   */
  function launchPrincessSparkle(hotspotEl) {
    const stageRect = princessStageEl.getBoundingClientRect();
    const spotRect = hotspotEl.getBoundingClientRect();
    const cx = spotRect.left - stageRect.left + spotRect.width / 2;
    const cy = spotRect.top - stageRect.top + spotRect.height / 2;
    const size = Math.max(spotRect.width, spotRect.height) * 1.6;

    const ring = document.createElement("div");
    ring.className = "princess-glow-ring";
    ring.style.left = cx - size / 2 + "px";
    ring.style.top = cy - size / 2 + "px";
    ring.style.width = size + "px";
    ring.style.height = size + "px";
    princessFxLayerEl.appendChild(ring);
    setTimeout(() => ring.remove(), 1000);

    const sparkleChars = ["✨", "⭐", "💫"];
    for (let i = 0; i < 6; i++) {
      const s = document.createElement("div");
      s.className = "princess-sparkle";
      s.textContent = sparkleChars[i % sparkleChars.length];
      s.style.left = cx + "px";
      s.style.top = cy + "px";
      const angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.4;
      const dist = 26 + Math.random() * 18;
      s.style.setProperty("--sx", Math.cos(angle) * dist + "px");
      s.style.setProperty("--sy", Math.sin(angle) * dist - 10 + "px");
      princessFxLayerEl.appendChild(s);
      setTimeout(() => s.remove(), 1000);
    }
  }

  /* ===================== ユーティリティ ===================== */
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function capitalize(word) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }

  function questionTextFor(part) {
    return part.plural ? `Where are her ${part.en}?` : `Where is her ${part.en}?`;
  }

  function findPart(id) {
    return PRINCESS_BODY_PARTS.find((p) => p.id === id) || null;
  }

  /* ===================== 見た目の描画（差し替え可能な部分） ===================== */
  /**
   * プリンセスの見た目を用意する。PRINCESS_CONFIG.imageSrc が設定されていれば
   * その画像に、なければ既にHTML側に置いてある仮のSVGイラストのままにする。
   * どちらの場合も #princess-hotspots に当たり判定を重ねるだけでよい。
   */
  function ensurePrincessVisual() {
    if (PRINCESS_CONFIG.imageSrc && princessImgHost) {
      const existingImg = princessStageEl.querySelector("img.princess-illustration");
      if (!existingImg) {
        princessImgHost.style.display = "none";
        const img = document.createElement("img");
        img.className = "princess-illustration";
        img.src = PRINCESS_CONFIG.imageSrc;
        img.alt = "Princess";
        img.draggable = false;
        princessStageEl.insertBefore(img, princessHotspotsEl);
      }
    }
  }

  /**
   * 当たり判定（透明なタップ用ボタン）を配置する。ゲーム開始時に1回だけ呼べばよい
   * （プリンセス自身は問題ごとに再配置しないため）。
   */
  function renderPrincessHotspots() {
    princessHotspotsEl.innerHTML = "";
    PRINCESS_BODY_PARTS.forEach((part) => {
      part.hotspots.forEach((rect) => {
        const btn = document.createElement("button");
        btn.className = "princess-hotspot";
        btn.style.left = rect.left + "%";
        btn.style.top = rect.top + "%";
        btn.style.width = rect.width + "%";
        btn.style.height = rect.height + "%";
        btn.setAttribute("aria-label", part.en);
        btn.dataset.partId = part.id;
        btn.addEventListener("click", () => handlePrincessTap(part, btn));
        princessHotspotsEl.appendChild(btn);
      });
    });
  }

  /* ===================== ラウンドの開始 ===================== */

  function startPrincessGame() {
    Speech.cancelSpeaking();
    Speech.stopListening();

    princess.order = shuffle(PRINCESS_BODY_PARTS.map((p) => p.id));
    princess.currentIndex = 0;
    princess.score = 0;
    princess.awaitingPick = true;
    princess.pendingPart = null;
    princess.autoSpokenIndex = -1;

    princessScoreEl.textContent = "0";
    princessSpeakOverlay.hidden = true;
    princessRoundCompleteEl.hidden = true;

    ensurePrincessVisual();
    renderPrincessHotspots();
    showScreenSafe("screen-princess");
    askNextPrincessQuestion();
  }

  princessStartBtn.addEventListener("click", () => startPrincessGame());

  /* ===================== フェーズ1: きいて、さがす ===================== */

  function currentTargetPart() {
    const id = princess.order[princess.currentIndex];
    return findPart(id);
  }

  function askNextPrincessQuestion() {
    if (princess.currentIndex >= princess.order.length) {
      finishPrincessRound();
      return;
    }

    princess.awaitingPick = true;
    princess.pendingPart = null;

    const target = currentTargetPart();
    if (!target) {
      finishPrincessRound();
      return;
    }

    princessQuestionEnEl.textContent = questionTextFor(target);
    princessQuestionJpEl.textContent = target.jp;

    // 自動読み上げは、この問題番号につき1回だけ。
    // 「🔊 もういちど」ボタン（speakPrincessQuestionを直接呼ぶ）はこの対象外なので、
    // 子どもは何度でも聞き直せる。
    const questionIndex = princess.currentIndex;
    setTimeout(() => {
      if (princess.currentIndex !== questionIndex) return;
      if (princess.autoSpokenIndex === questionIndex) return;
      princess.autoSpokenIndex = questionIndex;
      speakPrincessQuestion(target);
    }, AUTO_SPEAK_DELAY_MS);
  }

  function speakPrincessQuestion(target) {
    princessReplayBtn.classList.add("speaking");
    Speech.speak(questionTextFor(target), {
      onEnd: () => princessReplayBtn.classList.remove("speaking"),
    });
  }

  princessReplayBtn.addEventListener("click", () => {
    const target = currentTargetPart();
    if (target) speakPrincessQuestion(target);
  });

  /* ---------- タップ処理 ---------- */

  function handlePrincessTap(part, hotspotEl) {
    if (!princess.awaitingPick) return;

    const target = currentTargetPart();
    if (!target) return;

    if (part.id !== target.id) {
      handlePrincessMiss();
      return;
    }

    // 正解！
    princess.awaitingPick = false;
    launchPrincessSparkle(hotspotEl);
    playPrincessCorrectSound();
    if (princessImgHost) princessImgHost.classList.add("bounce-jump");

    Speech.speak(`${capitalize(target.en)}!`, {
      onEnd: () => enterPrincessSpeakPhase(target),
    });
  }

  // ドレスなど、当たり判定のない場所をタップした場合の「はずれ」
  princessStageEl.addEventListener("click", () => {
    if (!princess.awaitingPick) return;
    handlePrincessMiss();
  });

  function handlePrincessMiss() {
    // 幼児向け方針：×・ブザー・赤い画面などは一切使わない。
    // 軽くゆれるだけの、否定的でないリアクション。
    princessStageEl.classList.add("shake");
    setTimeout(() => princessStageEl.classList.remove("shake"), 400);
    Speech.speak("Try again!");
  }

  /* ===================== フェーズ2: じぶんではなしてみよう ===================== */

  function enterPrincessSpeakPhase(part) {
    princess.pendingPart = part;

    princessSpeakEmojiEl.textContent = "👸";
    princessMicIconEl.classList.remove("listening");
    princessSpeakWordEl.textContent = part.en.toUpperCase();
    princessMicStatusEl.textContent = "";
    princessSpeakOverlay.hidden = false;

    Speech.speak(`Can you say ${part.en}?`, {
      onEnd: () => beginPrincessListening(part),
    });
  }

  function beginPrincessListening(part) {
    if (!princess.pendingPart || princess.pendingPart.id !== part.id) return;

    if (!Speech.isRecognitionSupported()) {
      princessMicIconEl.classList.remove("listening");
      princessMicStatusEl.textContent = "🎤 いってみよう！";
      setTimeout(() => {
        if (princess.pendingPart && princess.pendingPart.id === part.id) {
          handlePrincessPronunciationSuccess(part);
        }
      }, FALLBACK_SPEAK_DELAY_MS);
      return;
    }

    princessMicIconEl.classList.add("listening");
    princessMicStatusEl.textContent = "きいているよ…";

    Speech.listen({
      timeoutMs: LISTEN_TIMEOUT_MS,
      onResult: (transcript) => {
        if (!princess.pendingPart || princess.pendingPart.id !== part.id) return;
        princessMicIconEl.classList.remove("listening");
        if (Speech.matchesWord(transcript, part.en)) {
          handlePrincessPronunciationSuccess(part);
        } else {
          handlePrincessPronunciationRetry(part);
        }
      },
      onNoSpeech: () => {
        if (!princess.pendingPart || princess.pendingPart.id !== part.id) return;
        princessMicIconEl.classList.remove("listening");
        handlePrincessPronunciationRetry(part);
      },
      onDenied: () => {
        if (!princess.pendingPart || princess.pendingPart.id !== part.id) return;
        princessMicIconEl.classList.remove("listening");
        princessMicStatusEl.textContent = "🎤 いってみよう！";
        setTimeout(() => {
          if (princess.pendingPart && princess.pendingPart.id === part.id) {
            handlePrincessPronunciationSuccess(part);
          }
        }, FALLBACK_SPEAK_DELAY_MS);
      },
      onUnsupported: () => {
        if (!princess.pendingPart || princess.pendingPart.id !== part.id) return;
        princessMicIconEl.classList.remove("listening");
        princessMicStatusEl.textContent = "🎤 いってみよう！";
        setTimeout(() => {
          if (princess.pendingPart && princess.pendingPart.id === part.id) {
            handlePrincessPronunciationSuccess(part);
          }
        }, FALLBACK_SPEAK_DELAY_MS);
      },
    });
  }

  function handlePrincessPronunciationRetry(part) {
    if (!princess.pendingPart || princess.pendingPart.id !== part.id) return;
    princessMicStatusEl.textContent = "Let's try again!";
    Speech.speak("Let's try again!", {
      onEnd: () => {
        if (princess.pendingPart && princess.pendingPart.id === part.id) {
          princessMicStatusEl.textContent = "🔊 おてほんを きいてみよう";
        }
      },
    });
  }

  princessHearExampleBtn.addEventListener("click", () => {
    const part = princess.pendingPart;
    if (!part) return;
    Speech.cancelSpeaking();
    Speech.stopListening();
    princessMicIconEl.classList.remove("listening");
    princessMicStatusEl.textContent = "";
    Speech.speak(part.en, {
      onEnd: () => beginPrincessListening(part),
    });
  });

  princessSkipBtn.addEventListener("click", () => {
    const part = princess.pendingPart;
    if (!part) return;
    Speech.cancelSpeaking();
    Speech.stopListening();
    if (princessImgHost) princessImgHost.classList.remove("bounce-jump");
    princess.pendingPart = null;
    princessSpeakOverlay.hidden = true;
    advancePrincessQuestion();
  });

  function handlePrincessPronunciationSuccess(part) {
    if (!princess.pendingPart || princess.pendingPart.id !== part.id) return;
    princess.pendingPart = null;

    princess.score++;
    princessScoreEl.textContent = princess.score;
    princessMicStatusEl.textContent = "Great job! 🎉";
    Speech.speak("Great job!");

    setTimeout(() => {
      if (princessImgHost) princessImgHost.classList.remove("bounce-jump");
      princessSpeakOverlay.hidden = true;
      advancePrincessQuestion();
    }, CORRECT_CELEBRATE_DELAY_MS);
  }

  function advancePrincessQuestion() {
    princess.currentIndex++;
    askNextPrincessQuestion();
  }

  /* ===================== ラウンド終了 ===================== */

  function finishPrincessRound() {
    princessRoundScoreEl.textContent = `${princess.score} / ${princess.order.length} こ できたね！`;
    princessRoundCompleteEl.hidden = false;
  }

  princessAgainBtn.addEventListener("click", () => {
    princessRoundCompleteEl.hidden = true;
    startPrincessGame();
  });

  princessHomeBtn.addEventListener("click", () => {
    Speech.cancelSpeaking();
    Speech.stopListening();
    princessRoundCompleteEl.hidden = true;
    showScreenSafe("screen-home");
  });

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
