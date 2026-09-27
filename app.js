"use strict";

/* ===================== データ ===================== */
const WORD_DATA = {
  animals: [
    { emoji: "🐶", en: "dog", jp: "いぬ" },
    { emoji: "🐱", en: "cat", jp: "ねこ" },
    { emoji: "🐰", en: "rabbit", jp: "うさぎ" },
    { emoji: "🐻", en: "bear", jp: "くま" },
    { emoji: "🦁", en: "lion", jp: "らいおん" },
    { emoji: "🐘", en: "elephant", jp: "ぞう" },
    { emoji: "🐸", en: "frog", jp: "かえる" },
    { emoji: "🐦", en: "bird", jp: "とり" },
    { emoji: "🐟", en: "fish", jp: "さかな" },
    { emoji: "🐵", en: "monkey", jp: "さる" },
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

const QUIZ_LENGTH = 6;

/* ===================== 状態 ===================== */
const state = {
  category: "animals",
  cardIndex: 0,
  quiz: {
    pool: [],
    order: [],
    current: 0,
    score: 0,
    answered: false,
  },
};

/* ===================== 画面切り替え ===================== */
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

document.querySelectorAll(".back-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    stopSpeaking();
    showScreen(btn.dataset.target);
  });
});

/* ===================== 音声合成 ===================== */
let voicesCache = [];
function loadVoices() {
  voicesCache = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
}
if (window.speechSynthesis) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

function pickEnglishVoice() {
  if (!voicesCache.length) loadVoices();
  return (
    voicesCache.find((v) => /en-US/i.test(v.lang) && /female|samantha|zira/i.test(v.name)) ||
    voicesCache.find((v) => /en-US/i.test(v.lang)) ||
    voicesCache.find((v) => /^en/i.test(v.lang)) ||
    null
  );
}

function stopSpeaking() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

function speakWord(word, onEnd) {
  if (!window.speechSynthesis) {
    playTone(660, 0.15);
    if (onEnd) setTimeout(onEnd, 300);
    return;
  }
  stopSpeaking();
  const utter = new SpeechSynthesisUtterance(word);
  utter.lang = "en-US";
  utter.rate = 0.8;
  utter.pitch = 1.15;
  const voice = pickEnglishVoice();
  if (voice) utter.voice = voice;
  if (onEnd) utter.onend = onEnd;
  window.speechSynthesis.speak(utter);
}

/* ===================== 効果音 (Web Audio) ===================== */
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

function playWrongSound() {
  playTone(220, 0.25, "triangle");
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

/* ===================== カテゴリ選択 → フラッシュカード ===================== */
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

  speakWord(word.en);
}

document.getElementById("speak-btn").addEventListener("click", () => {
  const word = WORD_DATA[state.category][state.cardIndex];
  const btn = document.getElementById("speak-btn");
  btn.classList.add("speaking");
  speakWord(word.en, () => btn.classList.remove("speaking"));
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

// フラッシュカード自体をタップしても発音
document.getElementById("flashcard").addEventListener("click", () => {
  const word = WORD_DATA[state.category][state.cardIndex];
  speakWord(word.en);
});

/* ===================== クイズ ===================== */
document.getElementById("quiz-start-btn").addEventListener("click", startQuiz);
document.getElementById("result-again-btn").addEventListener("click", startQuiz);
document.getElementById("result-home-btn").addEventListener("click", () => {
  showScreen("screen-home");
});

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildQuizPool() {
  // 全カテゴリから単語を集める（バラエティを持たせる）
  let all = [];
  Object.values(WORD_DATA).forEach((list) => {
    all = all.concat(list);
  });
  return shuffle(all).slice(0, QUIZ_LENGTH);
}

function startQuiz() {
  state.quiz.pool = buildQuizPool();
  state.quiz.current = 0;
  state.quiz.score = 0;
  state.quiz.answered = false;
  document.getElementById("quiz-score").textContent = "0";
  document.getElementById("quiz-feedback").textContent = "";
  showScreen("screen-quiz");
  renderQuizQuestion();
}

function renderQuizQuestion() {
  const { pool, current } = state.quiz;
  const correctWord = pool[current];
  state.quiz.answered = false;

  document.getElementById("quiz-feedback").textContent = "";
  document.getElementById("quiz-feedback").className = "quiz-feedback";

  // 選択肢: 正解 + ランダムな3つのダミー（重複回避）
  let allWords = [];
  Object.values(WORD_DATA).forEach((list) => (allWords = allWords.concat(list)));
  const distractors = shuffle(allWords.filter((w) => w.en !== correctWord.en)).slice(0, 3);
  const options = shuffle([correctWord, ...distractors]);

  const optWrap = document.getElementById("quiz-options");
  optWrap.innerHTML = "";
  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = "quiz-opt";
    btn.textContent = opt.emoji;
    btn.setAttribute("aria-label", opt.en);
    btn.addEventListener("click", () => handleQuizAnswer(btn, opt, correctWord));
    optWrap.appendChild(btn);
  });

  // 出題音声（少し間を置いてから発音）
  const replayBtn = document.getElementById("quiz-replay-btn");
  setTimeout(() => {
    replayBtn.classList.add("speaking");
    speakWord(correctWord.en, () => replayBtn.classList.remove("speaking"));
  }, 300);
}

document.getElementById("quiz-replay-btn").addEventListener("click", () => {
  const correctWord = state.quiz.pool[state.quiz.current];
  const btn = document.getElementById("quiz-replay-btn");
  btn.classList.add("speaking");
  speakWord(correctWord.en, () => btn.classList.remove("speaking"));
});

function handleQuizAnswer(btn, chosen, correctWord) {
  if (state.quiz.answered) return;
  state.quiz.answered = true;

  const allOptBtns = document.querySelectorAll(".quiz-opt");
  allOptBtns.forEach((b) => b.classList.add("disabled"));

  const feedback = document.getElementById("quiz-feedback");

  if (chosen.en === correctWord.en) {
    btn.classList.add("correct");
    state.quiz.score++;
    document.getElementById("quiz-score").textContent = state.quiz.score;
    feedback.textContent = "🎉 せいかい！ Great job!";
    feedback.className = "quiz-feedback";
    playCorrectSound();
    launchConfetti(18);
  } else {
    btn.classList.add("wrong");
    feedback.textContent = "😅 おしい！ Try again!";
    feedback.className = "quiz-feedback wrong-text";
    playWrongSound();
    // 正解も表示してあげる
    allOptBtns.forEach((b) => {
      if (b.getAttribute("aria-label") === correctWord.en) b.classList.add("correct");
    });
  }

  setTimeout(() => {
    state.quiz.current++;
    if (state.quiz.current >= state.quiz.pool.length) {
      finishQuiz();
    } else {
      renderQuizQuestion();
    }
  }, 1400);
}

function finishQuiz() {
  document.getElementById("final-score").textContent = state.quiz.score;
  document.getElementById("final-total").textContent = state.quiz.pool.length;
  showScreen("screen-result");
  if (state.quiz.score >= Math.ceil(state.quiz.pool.length * 0.7)) {
    launchConfetti(40);
  }
}
