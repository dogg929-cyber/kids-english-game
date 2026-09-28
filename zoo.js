"use strict";

/**
 * ===================== Zoo Adventure モジュール =====================
 *
 * 「静止した4択カードを選ぶ」既存のクイズとは違い、
 * 画面全体が動いている動物園そのものになっているモードです。
 * 子どもは英語で言われた動物を、動き回る動物園の中から探してタップします。
 *
 * 設計方針:
 *   - このファイルは app.js に依存しません（confetti-layer という
 *     共有DOM要素と、speech.js が公開する window.Speech だけを使います）。
 *     将来、Farm / Ocean / Jungle / Home / City など別のステージを
 *     追加するときも、このファイルのゲームエンジン部分（ラウンド進行・
 *     配置・当たり判定・発音練習ループ）はそのまま流用できるはずです。
 *   - ステージ固有の情報（登場する生きものと、その見た目・動き）は
 *     STAGE_DATA にまとめてあります。新しいステージを増やすときは、
 *     ここに新しいキー（例: "ocean"）を追加し、対応する背景HTML/CSSと
 *     ホーム画面のボタンを用意するだけで済むようにしています。
 *   - 動物の見た目は今は絵文字ですが、animal.img にPNG/WebPの画像パスを
 *     指定するだけで、コードの変更なしに画像表示へ切り替えられます
 *     （renderAnimalVisual を参照）。
 */
(function () {
  const ROUND_LENGTH_FALLBACK = 7; // 1ステージの動物の種類数の目安
  const LISTEN_TIMEOUT_MS = 6000;
  const FALLBACK_SPEAK_DELAY_MS = 2200;
  const CORRECT_CELEBRATE_DELAY_MS = 1600;

  /* ===================== ステージ定義 ===================== */
  /*
   * 将来のステージ追加例（雛形。今回はzooのみ実装）:
   *   ocean: {
   *     label: "Ocean Adventure",
   *     animals: [{ id:"shark", emoji:"🦈", en:"shark", jp:"さめ", movement:"cross", duration:9 }, ...],
   *   },
   *   home:  { label: "Home Adventure",  animals: [{ id:"chair", emoji:"🪑", en:"chair", jp:"いす", movement:"walk", duration:8 }, ...] },
   *   city:  { label: "City Adventure",  animals: [{ id:"bus",   emoji:"🚌", en:"bus",   jp:"バス", movement:"cross", duration:9 }, ...] },
   */
  const STAGE_DATA = {
    zoo: {
      label: "Zoo Adventure",
      animals: [
        { id: "elephant", emoji: "🐘", img: null, en: "elephant", jp: "ぞう", movement: "walk", duration: 8 },
        { id: "cat", emoji: "🐱", img: null, en: "cat", jp: "ねこ", movement: "cross", duration: 9 },
        { id: "dog", emoji: "🐶", img: null, en: "dog", jp: "いぬ", movement: "walk", duration: 6 },
        { id: "lion", emoji: "🦁", img: null, en: "lion", jp: "らいおん", movement: "walkstop", duration: 7 },
        { id: "monkey", emoji: "🐒", img: null, en: "monkey", jp: "さる", movement: "jump", duration: 3.2 },
        { id: "rabbit", emoji: "🐰", img: null, en: "rabbit", jp: "うさぎ", movement: "hop", duration: 1.6 },
        { id: "panda", emoji: "🐼", img: null, en: "panda", jp: "パンダ", movement: "walk", duration: 12 },
      ],
    },
  };

  // 動物の配置候補ゾーン（zoo-play-area基準の% 座標）。
  // 重なりを避けるため、動物の数だけシャッフルして割り当てる。
  const ZONES = [
    { left: 18, top: 16 },
    { left: 50, top: 12 },
    { left: 82, top: 18 },
    { left: 15, top: 50 },
    { left: 50, top: 52 },
    { left: 83, top: 48 },
    { left: 32, top: 82 },
    { left: 68, top: 84 },
  ];

  /* ===================== 状態 ===================== */
  const zoo = {
    stageId: null,
    animals: [], // このラウンドで画面に出ている動物（順不同）
    order: [], // 出題順（シャッフル済み・重複なし）
    currentIndex: 0,
    score: 0,
    awaitingPick: true, // タップを受け付けてよい状態か
    pendingAnimal: null, // 発音練習フェーズの対象
    autoSpokenIndex: -1, // 自動読み上げ済みの問題番号（同じ問題を自動で2回読まないための保証）
  };

  /* ===================== DOM参照 ===================== */
  const zooScoreEl = document.getElementById("zoo-score");
  const zooPlayAreaEl = document.getElementById("zoo-play-area");
  const zooQuestionEnEl = document.getElementById("zoo-question-en");
  const zooQuestionJpEl = document.getElementById("zoo-question-jp");
  const zooReplayBtn = document.getElementById("zoo-replay-btn");
  const zooSpeakOverlay = document.getElementById("zoo-speak-overlay");
  const zooSpeakEmojiEl = document.getElementById("zoo-speak-emoji");
  const zooMicIconEl = document.getElementById("zoo-mic-icon");
  const zooSpeakWordEl = document.getElementById("zoo-speak-word");
  const zooMicStatusEl = document.getElementById("zoo-mic-status");
  const zooHearExampleBtn = document.getElementById("zoo-hear-example-btn");
  const zooSkipBtn = document.getElementById("zoo-skip-btn");
  const zooRoundCompleteEl = document.getElementById("zoo-round-complete");
  const zooRoundScoreEl = document.getElementById("zoo-round-score");
  const zooAgainBtn = document.getElementById("zoo-again-btn");
  const zooHomeBtn = document.getElementById("zoo-home-btn");
  const zooStartBtn = document.getElementById("zoo-start-btn");

  // このゲームモードが読み込まれていないページ（想定外の状況）では何もしない
  if (!zooPlayAreaEl || !zooStartBtn) return;

  /* ===================== 効果音・紙吹雪（自己完結・app.jsに依存しない） ===================== */
  let zooAudioCtx = null;
  function getZooAudioCtx() {
    if (!zooAudioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) zooAudioCtx = new AC();
    }
    return zooAudioCtx;
  }
  function playZooTone(freq, duration, type = "sine") {
    const ctx = getZooAudioCtx();
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
  function playZooCorrectSound() {
    playZooTone(523.25, 0.14);
    setTimeout(() => playZooTone(659.25, 0.14), 120);
    setTimeout(() => playZooTone(783.99, 0.22), 240);
  }

  const CONFETTI_COLORS = ["#FF6FA5", "#FFD93E", "#4DA9FF", "#5FD068", "#B18BFF", "#FFA53E"];
  function launchZooConfetti(count = 22) {
    const layer = document.getElementById("confetti-layer");
    if (!layer) return;
    for (let i = 0; i < count; i++) {
      const piece = document.createElement("div");
      piece.className = "confetti-piece";
      piece.style.left = Math.random() * 100 + "vw";
      piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      piece.style.animationDuration = 1.4 + Math.random() * 1.2 + "s";
      piece.style.width = piece.style.height = 6 + Math.random() * 8 + "px";
      layer.appendChild(piece);
      setTimeout(() => piece.remove(), 3000);
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

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  /**
   * 動物の見た目を描画する。
   * animal.img が指定されていれば画像を、なければ絵文字を表示する。
   * → 将来オリジナルキャラクターのPNG/WebPに差し替えたい場合は、
   *    STAGE_DATA側で img パスを設定するだけでよい。
   */
  function renderAnimalVisual(animal) {
    if (animal.img) {
      const img = document.createElement("img");
      img.src = animal.img;
      img.alt = animal.en;
      img.className = "zoo-emoji zoo-emoji-img";
      img.draggable = false;
      return img;
    }
    const span = document.createElement("span");
    span.className = "zoo-emoji";
    span.textContent = animal.emoji;
    return span;
  }

  /* ===================== ラウンドの開始・描画 ===================== */

  function startStage(stageId) {
    const stage = STAGE_DATA[stageId];
    if (!stage) return;

    Speech.cancelSpeaking();
    Speech.stopListening();

    zoo.stageId = stageId;
    zoo.animals = stage.animals.slice();
    zoo.order = shuffle(stage.animals.map((a) => a.id));
    zoo.currentIndex = 0;
    zoo.score = 0;
    zoo.awaitingPick = true;
    zoo.pendingAnimal = null;
    zoo.autoSpokenIndex = -1;

    zooScoreEl.textContent = "0";
    zooSpeakOverlay.hidden = true;
    zooRoundCompleteEl.hidden = true;

    renderZooAnimals();
    showScreenSafe("screen-zoo");
    askNextZooQuestion();
  }

  function renderZooAnimals() {
    zooPlayAreaEl.innerHTML = "";
    const zones = shuffle(ZONES).slice(0, zoo.animals.length);

    zoo.animals.forEach((animal, i) => {
      const zone = zones[i] || { left: 50, top: 50 };
      const jitterX = (Math.random() - 0.5) * 8; // ±4%
      const jitterY = (Math.random() - 0.5) * 8;
      const left = clamp(zone.left + jitterX, 8, 92);
      const top = clamp(zone.top + jitterY, 8, 92);

      const wrap = document.createElement("div");
      wrap.className = "zoo-animal";
      wrap.style.left = left + "%";
      wrap.style.top = top + "%";
      wrap.dataset.animalId = animal.id;

      const mover = document.createElement("div");
      mover.className = "zoo-animal-mover mv-" + animal.movement;
      mover.style.animationDuration = animal.duration + "s";
      // 開始位置をずらし、複数の動物が同じタイミングで一斉に動かないようにする
      mover.style.animationDelay = "-" + (Math.random() * animal.duration).toFixed(2) + "s";

      const tapBtn = document.createElement("button");
      tapBtn.className = "zoo-tap";
      tapBtn.setAttribute("aria-label", animal.en);
      tapBtn.appendChild(renderAnimalVisual(animal));
      tapBtn.addEventListener("click", () => handleZooTap(animal, wrap, tapBtn));

      mover.appendChild(tapBtn);
      wrap.appendChild(mover);
      zooPlayAreaEl.appendChild(wrap);
    });
  }

  /* ===================== フェーズ1: きいて、さがす ===================== */

  function currentTargetAnimal() {
    const id = zoo.order[zoo.currentIndex];
    return zoo.animals.find((a) => a.id === id) || null;
  }

  function askNextZooQuestion() {
    if (zoo.currentIndex >= zoo.order.length) {
      finishZooRound();
      return;
    }

    zoo.awaitingPick = true;
    zoo.pendingAnimal = null;

    const target = currentTargetAnimal();
    if (!target) {
      finishZooRound();
      return;
    }

    zooQuestionEnEl.textContent = `Where is the ${target.en}?`;
    zooQuestionJpEl.textContent = `${target.jp}はどこ？`;

    // この問題番号に対する自動読み上げは1回だけ、という状態ベースの保証。
    // askNextZooQuestion() が何らかの理由で同じ問題番号に対して再度呼ばれても
    // （例: 将来のコード変更でイベントが重複した場合など）、
    // 同じ問題を自動で二重に読み上げることはない。
    // 「🔊 もういちど」ボタン（speakZooQuestionを直接呼ぶ）はこのガードの対象外なので、
    // 子どもは何回でも聞き直せる。
    const questionIndex = zoo.currentIndex;
    setTimeout(() => {
      if (zoo.currentIndex !== questionIndex) return; // 既に次の問題へ進んでいた
      if (zoo.autoSpokenIndex === questionIndex) return; // この問題は自動読み上げ済み
      zoo.autoSpokenIndex = questionIndex;
      speakZooQuestion(target);
    }, 250);
  }

  function speakZooQuestion(target) {
    zooReplayBtn.classList.add("speaking");
    Speech.speak(`Where is the ${target.en}?`, {
      onEnd: () => zooReplayBtn.classList.remove("speaking"),
    });
  }

  zooReplayBtn.addEventListener("click", () => {
    const target = currentTargetAnimal();
    if (target) speakZooQuestion(target);
  });

  function handleZooTap(animal, wrapEl, tapBtn) {
    if (!zoo.awaitingPick) return;

    const target = currentTargetAnimal();
    if (!target) return;

    if (animal.id !== target.id) {
      // 幼児向け方針：不正解でも×・ブザー・赤い画面などは一切使わない。
      // 軽く揺れるだけの、否定的でないリアクション。
      tapBtn.classList.add("shake");
      setTimeout(() => tapBtn.classList.remove("shake"), 400);
      Speech.speak("Try again!");
      return;
    }

    // 正解！
    zoo.awaitingPick = false;
    wrapEl.classList.add("correct");
    tapBtn.classList.add("bounce-jump");
    playZooCorrectSound();
    launchZooConfetti(20);

    Speech.speak(target.en, {
      onEnd: () => enterZooSpeakPhase(target, wrapEl, tapBtn),
    });
  }

  /* ===================== フェーズ2: じぶんではなしてみよう ===================== */

  function enterZooSpeakPhase(animal, wrapEl, tapBtn) {
    zoo.pendingAnimal = { animal, wrapEl, tapBtn };

    zooSpeakEmojiEl.textContent = animal.emoji;
    zooSpeakEmojiEl.classList.remove("bounce-jump");
    zooSpeakWordEl.textContent = animal.en.toUpperCase();
    zooMicStatusEl.textContent = "";
    zooMicIconEl.classList.remove("listening");
    zooSpeakOverlay.hidden = false;

    Speech.speak(`Can you say ${animal.en}?`, {
      onEnd: () => beginZooListening(animal),
    });
  }

  function beginZooListening(animal) {
    if (!zoo.pendingAnimal || zoo.pendingAnimal.animal.id !== animal.id) return;

    if (!Speech.isRecognitionSupported()) {
      // 音声認識が使えない端末（iPhone Safariなど）・権限拒否済みの場合の
      // フォールバック：「言ってみよう」の時間をとってから成功扱いで進める。
      zooMicIconEl.classList.remove("listening");
      zooMicStatusEl.textContent = "🎤 いってみよう！";
      setTimeout(() => {
        if (zoo.pendingAnimal && zoo.pendingAnimal.animal.id === animal.id) {
          handleZooPronunciationSuccess(animal);
        }
      }, FALLBACK_SPEAK_DELAY_MS);
      return;
    }

    zooMicIconEl.classList.add("listening");
    zooMicStatusEl.textContent = "きいているよ…";

    Speech.listen({
      timeoutMs: LISTEN_TIMEOUT_MS,
      onResult: (transcript) => {
        if (!zoo.pendingAnimal || zoo.pendingAnimal.animal.id !== animal.id) return;
        zooMicIconEl.classList.remove("listening");
        if (Speech.matchesWord(transcript, animal.en)) {
          handleZooPronunciationSuccess(animal);
        } else {
          handleZooPronunciationRetry(animal);
        }
      },
      onNoSpeech: () => {
        if (!zoo.pendingAnimal || zoo.pendingAnimal.animal.id !== animal.id) return;
        zooMicIconEl.classList.remove("listening");
        handleZooPronunciationRetry(animal);
      },
      onDenied: () => {
        if (!zoo.pendingAnimal || zoo.pendingAnimal.animal.id !== animal.id) return;
        zooMicIconEl.classList.remove("listening");
        zooMicStatusEl.textContent = "🎤 いってみよう！";
        setTimeout(() => {
          if (zoo.pendingAnimal && zoo.pendingAnimal.animal.id === animal.id) {
            handleZooPronunciationSuccess(animal);
          }
        }, FALLBACK_SPEAK_DELAY_MS);
      },
      onUnsupported: () => {
        if (!zoo.pendingAnimal || zoo.pendingAnimal.animal.id !== animal.id) return;
        zooMicIconEl.classList.remove("listening");
        zooMicStatusEl.textContent = "🎤 いってみよう！";
        setTimeout(() => {
          if (zoo.pendingAnimal && zoo.pendingAnimal.animal.id === animal.id) {
            handleZooPronunciationSuccess(animal);
          }
        }, FALLBACK_SPEAK_DELAY_MS);
      },
    });
  }

  function handleZooPronunciationRetry(animal) {
    if (!zoo.pendingAnimal || zoo.pendingAnimal.animal.id !== animal.id) return;
    zooMicStatusEl.textContent = "Let's try again!";
    Speech.speak("Let's try again!", {
      onEnd: () => {
        if (zoo.pendingAnimal && zoo.pendingAnimal.animal.id === animal.id) {
          zooMicStatusEl.textContent = "🔊 おてほんを きいてみよう";
        }
      },
    });
  }

  zooHearExampleBtn.addEventListener("click", () => {
    const pending = zoo.pendingAnimal;
    if (!pending) return;
    Speech.cancelSpeaking();
    Speech.stopListening();
    zooMicIconEl.classList.remove("listening");
    zooMicStatusEl.textContent = "";
    Speech.speak(pending.animal.en, {
      onEnd: () => beginZooListening(pending.animal),
    });
  });

  zooSkipBtn.addEventListener("click", () => {
    const pending = zoo.pendingAnimal;
    if (!pending) return;
    Speech.cancelSpeaking();
    Speech.stopListening();
    releaseZooAnimal(pending.wrapEl, pending.tapBtn);
    zoo.pendingAnimal = null;
    zooSpeakOverlay.hidden = true;
    advanceZooQuestion();
  });

  function handleZooPronunciationSuccess(animal) {
    if (!zoo.pendingAnimal || zoo.pendingAnimal.animal.id !== animal.id) return;
    const pending = zoo.pendingAnimal;
    zoo.pendingAnimal = null;

    zoo.score++;
    zooScoreEl.textContent = zoo.score;
    zooMicStatusEl.textContent = "Great job! 🎉";
    Speech.speak("Great job!");
    launchZooConfetti(24);

    setTimeout(() => {
      releaseZooAnimal(pending.wrapEl, pending.tapBtn);
      zooSpeakOverlay.hidden = true;
      advanceZooQuestion();
    }, CORRECT_CELEBRATE_DELAY_MS);
  }

  function releaseZooAnimal(wrapEl, tapBtn) {
    if (wrapEl) wrapEl.classList.remove("correct");
    if (tapBtn) tapBtn.classList.remove("bounce-jump");
  }

  function advanceZooQuestion() {
    zoo.currentIndex++;
    askNextZooQuestion();
  }

  /* ===================== ラウンド終了 ===================== */

  function finishZooRound() {
    zooRoundScoreEl.textContent = `${zoo.score} / ${zoo.order.length} こ できたね！`;
    zooRoundCompleteEl.hidden = false;
    launchZooConfetti(36);
  }

  zooAgainBtn.addEventListener("click", () => {
    zooRoundCompleteEl.hidden = true;
    startStage(zoo.stageId || "zoo");
  });

  zooHomeBtn.addEventListener("click", () => {
    Speech.cancelSpeaking();
    Speech.stopListening();
    zooRoundCompleteEl.hidden = true;
    showScreenSafe("screen-home");
  });

  /* ===================== 画面遷移（既存の showScreen を再利用） ===================== */
  /*
   * 画面の切り替え（.screen.active の付け替え）は app.js の showScreen() が
   * 既に一元管理しているため、ここでも同じ関数を呼び出して二重管理を避ける。
   * app.js が何らかの理由で読み込まれていない場合に備え、簡易フォールバックも用意する。
   */
  function showScreenSafe(id) {
    if (typeof showScreen === "function") {
      showScreen(id);
      return;
    }
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    const el = document.getElementById(id);
    if (el) el.classList.add("active");
  }

  /* ===================== 起動 ===================== */
  zooStartBtn.addEventListener("click", () => startStage("zoo"));
})();
