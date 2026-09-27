"use strict";

/* ===================== データ ===================== */
/*
 * animals には、新しい「きく→えらぶ→はなす」学習ループ用に
 * jpQuestion（「◯◯さんはどこ？」という質問文の日本語表示）を追加しています。
 * 他のカテゴリ（colors / fruits / numbers）は、既存のフラッシュカード機能でのみ
 * 使用し、今回の音声認識ループはAnimalsカテゴリから実装します。
 */
const WORD_DATA = {
  animals: [
    { emoji: "🐶", en: "dog", jp: "いぬ", jpQuestion: "わんちゃんはどこ？" },
    { emoji: "🐱", en: "cat", jp: "ねこ", jpQuestion: "ねこちゃんはどこ？" },
    { emoji: "🐰", en: "rabbit", jp: "うさぎ", jpQuestion: "うさぎさんはどこ？" },
    { emoji: "🐻", en: "bear", jp: "くま", jpQuestion: "くまさんはどこ？" },
    { emoji: "🦁", en: "lion", jp: "らいおん", jpQuestion: "らいおんさんはどこ？" },
    { emoji: "🐘", en: "elephant", jp: "ぞう", jpQuestion: "ぞうさんはどこ？" },
    { emoji: "🐸", en: "frog", jp: "かえる", jpQuestion: "かえるさんはどこ？" },
    { emoji: "🐦", en: "bird", jp: "とり", jpQuestion: "とりさんはどこ？" },
    { emoji: "🐟", en: "fish", jp: "さかな", jpQuestion: "さかなさんはどこ？" },
    { emoji: "🐵", en: "monkey", jp: "さる", jpQuestion: "さるさんはどこ？" },
  ],
  colors: [
    { emoji: "🔴", en: "red", jp: "あか" },
    { emoji: "🔵", en: "blue", jp: "あお" },
    { emoji: "🟡", en: "yellow", jp: "きいろ" },
    { emoji: "🟢", en: "green", jp: "みどり" },
    { emoji: "⚪", en: "white", jp: "しろ" },
    { emoji: "⚫", en: "black", jp: "くろ" },
    { emoji: "🟣", en: "purple", jp: "むらさき" },
    { emoji: "🟠", en: "orange", jp: "オレンジ" },
  ],
  fruits: [
    { emoji: "🍎", en: "apple", jp: "りんご" },
    { emoji: "🍌", en: "banana", jp: "バナナ" },
    { emoji: "🍇", en: "grape", jp: "ぶどう" },
    { emoji: "🍓", en: "strawberry", jp: "いちご" },
    { emoji: "🍊", en: "orange", jp: "みかん" },
    { emoji: "🍉", en: "watermelon", jp: "すいか" },
    { emoji: "🍑", en: "peach", jp: "もも" },
    { emoji: "🍍", en: "pineapple", jp: "パイナップル" },
  ],
  numbers: [
    { emoji: "1️⃣", en: "one", jp: "いち" },
    { emoji: "2️⃣", en: "two", jp: "に" },
    { emoji: "3️⃣", en: "three", jp: "さん" },
    { emoji: "4️⃣", en: "four", jp: "よん" },
    { emoji: "5️⃣", en: "five", jp: "ご" },
    { emoji: "6️⃣", en: "six", jp: "ろく" },
    { emoji: "7️⃣", en: "seven", jp: "なな" },
    { emoji: "8️⃣", en: "eight", jp: "はち" },
    { emoji: "9️⃣", en: "nine", jp: "きゅう" },
    { emoji: "🔟", en: "ten", jp: "じゅう" },
  ],
};

const QUIZ_LENGTH = 6; // 1回のクイズで扱う単語数（Animalsから出題）
const OPTION_COUNT = 4; // 選択肢の数（3〜4匹のうち今回は4で統一）
const LISTEN_TIMEOUT_MS = 6000; // マイクが無反応とみなすまでの時間
const FALLBACK_SPEAK_DELAY_MS = 2200; // 音声認識が使えない場合の「発音する時間」の目安

/* ===================== 状態 ===================== */
const state = {
  category: "animals",
  cardIndex: 0,
  quiz: {
    pool: [],
    current: 0,
    score: 0,
    picked: false, // 質問フェーズで正解をすでに選んだか
    pendingWord: null, // 発音フェーズで対象になっている単語
  },
};

/* ===================== 画面切り替え ===================== */
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

document.querySelectorAll(".back-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    Speech.cancelSpeaking();
    Speech.stopListening();
    showScreen(btn.dataset.target);
  });
});

/* ===================== 効果音 (Web Audio) ===================== */
/* 音声認識/合成とは無関係な「ちょっとした効果音」のみここで扱う。
   否定的な音（ブザーなど）は学習体験の方針上、使用しない。 */
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  return audioCtx;
}

function playTone(freq, duration, type = "sine") {
  const ctx = getAudioCtx();
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

function playCorrectSound() {
  playTone(523.25, 0.14);
  setTimeout(() => playTone(659.25, 0.14), 120);
  setTimeout(() => playTone(783.99, 0.22), 240);
}

/* ===================== 紙吹雪 ===================== */
const CONFETTI_COLORS = ["#FF6FA5", "#FFD93E", "#4DA9FF", "#5FD068", "#B18BFF", "#FFA53E"];
function launchConfetti(count = 24) {
  const layer = document.getElementById("confetti-layer");
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

/* ===================== カテゴリ選択 → フラッシュカード ===================== */
/* （既存機能：変更なし） */
document.querySelectorAll(".cat-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.category = btn.dataset.category;
    state.cardIndex = 0;
    openFlashcards();
  });
});

function openFlashcards() {
  buildProgressDots();
  renderCard();
  showScreen("screen-cards");
}

function buildProgressDots() {
  const wrap = document.getElementById("progress-dots");
  wrap.innerHTML = "";
  const words = WORD_DATA[state.category];
  words.forEach((_, i) => {
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.dataset.index = i;
    wrap.appendChild(dot);
  });
}

function renderCard() {
  const words = WORD_DATA[state.category];
  const word = words[state.cardIndex];

  document.getElementById("card-emoji").textContent = word.emoji;
  document.getElementById("card-word").textContent = word.en;
  document.getElementById("card-word-jp").textContent = word.jp;

  document.querySelectorAll("#progress-dots .dot").forEach((dot, i) => {
    dot.classList.toggle("active", i === state.cardIndex);
  });

  document.getElementById("prev-btn").disabled = state.cardIndex === 0;
  document.getElementById("next-btn").disabled = state.cardIndex === words.length - 1;

  Speech.speak(word.en);
}

document.getElementById("speak-btn").addEventListener("click", () => {
  const word = WORD_DATA[state.category][state.cardIndex];
  const btn = document.getElementById("speak-btn");
  Speech.speak(word.en, {
    onStart: () => btn.classList.add("speaking"),
    onEnd: () => btn.classList.remove("speaking"),
  });
});

document.getElementById("prev-btn").addEventListener("click", () => {
  if (state.cardIndex > 0) {
    state.cardIndex--;
    renderCard();
  }
});

document.getElementById("next-btn").addEventListener("click", () => {
  const words = WORD_DATA[state.category];
  if (state.cardIndex < words.length - 1) {
    state.cardIndex++;
    renderCard();
  }
});

// フラッシュカード自体をタップしても発音（既存機能）
document.getElementById("flashcard").addEventListener("click", () => {
  const word = WORD_DATA[state.category][state.cardIndex];
  Speech.speak(word.en);
});

/* =====================================================================
 * クイズ（新：きく → えらぶ → はなす → できたら次へ）
 * Animalsカテゴリのみ対応。
 * ===================================================================== */

const quizScoreEl = document.getElementById("quiz-score");
const questionPhaseEl = document.getElementById("quiz-question-phase");
const speakPhaseEl = document.getElementById("quiz-speak-phase");
const questionEnEl = document.getElementById("quiz-question-en");
const questionJpEl = document.getElementById("quiz-question-jp");
const quizOptionsEl = document.getElementById("quiz-options");
const quizReplayBtn = document.getElementById("quiz-replay-btn");
const speakEmojiEl = document.getElementById("speak-phase-emoji");
const micIconEl = document.getElementById("mic-icon");
const speakTargetWordEl = document.getElementById("speak-target-word");
const micStatusEl = document.getElementById("mic-status");
const hearExampleBtn = document.getElementById("hear-example-btn");
const skipBtn = document.getElementById("skip-btn");

document.getElementById("quiz-start-btn").addEventListener("click", startQuiz);
document.getElementById("result-again-btn").addEventListener("click", startQuiz);
document.getElementById("result-home-btn").addEventListener("click", () => {
  showScreen("screen-home");
});

function buildAnimalQuizPool() {
  return shuffle(WORD_DATA.animals).slice(0, QUIZ_LENGTH);
}

function startQuiz() {
  state.quiz.pool = buildAnimalQuizPool();
  state.quiz.current = 0;
  state.quiz.score = 0;
  quizScoreEl.textContent = "0";
  showScreen("screen-quiz");
  renderQuestionPhase();
}

/* ---------- フェーズ1: きいて、えらぶ ---------- */

function switchToQuestionPhase() {
  speakPhaseEl.hidden = true;
  questionPhaseEl.hidden = false;
}

function switchToSpeakPhase() {
  questionPhaseEl.hidden = true;
  speakPhaseEl.hidden = false;
}

function renderQuestionPhase() {
  Speech.cancelSpeaking();
  Speech.stopListening();
  state.quiz.picked = false;

  const correctWord = state.quiz.pool[state.quiz.current];
  switchToQuestionPhase();

  questionEnEl.textContent = `Where is the ${correctWord.en}?`;
  questionJpEl.textContent = correctWord.jpQuestion || `${correctWord.jp}はどこ？`;

  renderQuizOptions(correctWord);

  // 少し間を置いてから質問文を読み上げる（画面が切り替わった直後は聞き取りにくいため）
  setTimeout(() => {
    quizReplayBtn.classList.add("speaking");
    Speech.speak(`Where is the ${correctWord.en}?`, {
      onEnd: () => quizReplayBtn.classList.remove("speaking"),
    });
  }, 300);
}

function renderQuizOptions(correctWord) {
  quizOptionsEl.innerHTML = "";
  const distractors = shuffle(
    WORD_DATA.animals.filter((w) => w.en !== correctWord.en)
  ).slice(0, OPTION_COUNT - 1);
  const options = shuffle([correctWord, ...distractors]);

  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = "quiz-opt";
    btn.textContent = opt.emoji;
    btn.setAttribute("aria-label", opt.en);
    btn.addEventListener("click", () => handleAnimalPick(btn, opt, correctWord));
    quizOptionsEl.appendChild(btn);
  });
}

quizReplayBtn.addEventListener("click", () => {
  const correctWord = state.quiz.pool[state.quiz.current];
  quizReplayBtn.classList.add("speaking");
  Speech.speak(`Where is the ${correctWord.en}?`, {
    onEnd: () => quizReplayBtn.classList.remove("speaking"),
  });
});

function handleAnimalPick(btn, chosen, correctWord) {
  if (state.quiz.picked) return;

  if (chosen.en !== correctWord.en) {
    // 幼児向け方針：不正解でも否定的な演出はしない。そっと揺れて再挑戦を促すだけ。
    btn.classList.add("shake");
    setTimeout(() => btn.classList.remove("shake"), 400);
    return;
  }

  state.quiz.picked = true;
  document.querySelectorAll(".quiz-opt").forEach((b) => b.classList.add("disabled"));
  btn.classList.add("correct");

  // "Elephant!" と読み上げてから発音フェーズへ
  Speech.speak(correctWord.en, {
    onEnd: () => enterSpeakPhase(correctWord),
  });
}

/* ---------- フェーズ2: じぶんではなしてみよう ---------- */

function enterSpeakPhase(word) {
  state.quiz.pendingWord = word;
  switchToSpeakPhase();

  speakEmojiEl.textContent = word.emoji;
  speakEmojiEl.classList.remove("bounce-jump");
  speakTargetWordEl.textContent = word.en.toUpperCase();
  micStatusEl.textContent = "";
  micIconEl.classList.remove("listening");

  promptPronunciation(word);
}

function promptPronunciation(word) {
  Speech.speak(`Can you say ${word.en}?`, {
    onEnd: () => beginListening(word),
  });
}

function beginListening(word) {
  // 現在発音フェーズの対象が変わっていないか確認（連打・画面遷移対策）
  if (state.quiz.pendingWord !== word) return;

  if (!Speech.isRecognitionSupported()) {
    // 音声認識が使えない端末（未対応 / 権限拒否済み）向けフォールバック：
    // 「言ってみよう」の時間をとってから、そのまま成功扱いで進める。
    micIconEl.classList.remove("listening");
    micStatusEl.textContent = "🎤 いってみよう！";
    setTimeout(() => {
      if (state.quiz.pendingWord === word) handlePronunciationSuccess(word);
    }, FALLBACK_SPEAK_DELAY_MS);
    return;
  }

  micIconEl.classList.add("listening");
  micStatusEl.textContent = "きいているよ…";

  Speech.listen({
    timeoutMs: LISTEN_TIMEOUT_MS,
    onResult: (transcript) => {
      if (state.quiz.pendingWord !== word) return;
      micIconEl.classList.remove("listening");
      if (Speech.matchesWord(transcript, word.en)) {
        handlePronunciationSuccess(word);
      } else {
        handlePronunciationRetry(word);
      }
    },
    onNoSpeech: () => {
      if (state.quiz.pendingWord !== word) return;
      micIconEl.classList.remove("listening");
      handlePronunciationRetry(word);
    },
    onDenied: () => {
      if (state.quiz.pendingWord !== word) return;
      // 以降は音声認識を使わず、フォールバックの流れで進める
      micIconEl.classList.remove("listening");
      micStatusEl.textContent = "🎤 いってみよう！";
      setTimeout(() => {
        if (state.quiz.pendingWord === word) handlePronunciationSuccess(word);
      }, FALLBACK_SPEAK_DELAY_MS);
    },
    onUnsupported: () => {
      if (state.quiz.pendingWord !== word) return;
      micIconEl.classList.remove("listening");
      micStatusEl.textContent = "🎤 いってみよう！";
      setTimeout(() => {
        if (state.quiz.pendingWord === word) handlePronunciationSuccess(word);
      }, FALLBACK_SPEAK_DELAY_MS);
    },
  });
}

function handlePronunciationRetry(word) {
  if (state.quiz.pendingWord !== word) return;
  micStatusEl.textContent = "Let's try again!";
  Speech.speak("Let's try again!", {
    onEnd: () => {
      // マイクは自動で再開せず、「おてほんを聞く」または再タップを待つ。
      // （幼児が連続で聞き取られ続けることによる混乱を避けるため）
      if (state.quiz.pendingWord === word) {
        micStatusEl.textContent = "🔊 おてほんを きいてみよう";
      }
    },
  });
}

hearExampleBtn.addEventListener("click", () => {
  const word = state.quiz.pendingWord;
  if (!word) return;
  Speech.cancelSpeaking();
  Speech.stopListening();
  micIconEl.classList.remove("listening");
  micStatusEl.textContent = "";
  Speech.speak(word.en, {
    onEnd: () => beginListening(word),
  });
});

skipBtn.addEventListener("click", () => {
  const word = state.quiz.pendingWord;
  Speech.cancelSpeaking();
  Speech.stopListening();
  if (word && state.quiz.pendingWord === word) {
    advanceToNextQuestion();
  }
});

function handlePronunciationSuccess(word) {
  if (state.quiz.pendingWord !== word) return;
  state.quiz.pendingWord = null;

  state.quiz.score++;
  quizScoreEl.textContent = state.quiz.score;
  micStatusEl.textContent = "Great job! 🎉";

  Speech.speak("Great job!");
  speakEmojiEl.classList.add("bounce-jump");
  playCorrectSound();
  launchConfetti(24);

  setTimeout(() => advanceToNextQuestion(), 1600);
}

function advanceToNextQuestion() {
  state.quiz.pendingWord = null;
  state.quiz.current++;
  if (state.quiz.current >= state.quiz.pool.length) {
    finishQuiz();
  } else {
    renderQuestionPhase();
  }
}

function finishQuiz() {
  document.getElementById("final-score").textContent = state.quiz.score;
  document.getElementById("final-total").textContent = state.quiz.pool.length;
  showScreen("screen-result");
  launchConfetti(40);
}
