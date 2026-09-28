"use strict";

/**
 * ===================== Speech モジュール =====================
 *
 * SpeechSynthesis（音声合成）と SpeechRecognition（音声認識）を
 * ゲームロジック（app.js）から分離するための薄いラッパーです。
 *
 * 狙い:
 *   - app.js は window.Speech の公開APIだけを呼べばよく、
 *     「どの音声エンジンを使っているか」を意識しなくてよい。
 *   - 将来、以下のような差し替えを行いたくなった場合、
 *     このファイルの中身だけを書き換えれば済むようにする。
 *       ・高品質なAI音声（クラウドTTS）への切り替え
 *       ・単語ごとのMP3ネイティブ音声への切り替え
 *       ・別の音声認識API（クラウドSTTなど）への切り替え
 *
 * 公開API（window.Speech）:
 *   speak(text, opts)              英語テキストを読み上げる
 *   cancelSpeaking()                読み上げを停止する
 *   isRecognitionSupported()        この端末で音声認識が使えそうか
 *   listen(opts)                    音声認識を1回だけ開始する
 *   stopListening()                 音声認識を止める
 *   matchesWord(transcript, word)   認識結果が対象単語と一致するか判定
 */
(function () {
  const RecognitionCtor =
    window.SpeechRecognition || window.webkitSpeechRecognition || null;

  /* ---------- 音声合成 (Text-to-Speech) ---------- */

  let voicesCache = [];
  function loadVoices() {
    voicesCache = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  }
  if (window.speechSynthesis) {
    loadVoices();
    // iOS Safari を含む多くのブラウザは非同期に声のリストを読み込む
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

  function cancelSpeaking() {
    if (!window.speechSynthesis) return;
    // 何も話していない（＝アイドル）状態でも speechSynthesis.cancel() を呼ぶと、
    // 一部のブラウザ（特にiOS SafariのWebKit実装）で、直後に speak() した
    // 発話が内部的に二重に再生されてしまう既知の不安定挙動がある。
    // 「本当に何か話している/話す予定がある時だけ止める」ことで、
    // 不要な cancel() 呼び出しそのものをなくし、この不具合の引き金を断つ。
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      window.speechSynthesis.cancel();
    }
  }

  /**
   * 英語テキストを読み上げる。
   * @param {string} text 読み上げるテキスト（英語）
   * @param {{rate?:number, pitch?:number, onStart?:Function, onEnd?:Function}} [opts]
   */
  function speak(text, opts = {}) {
    const { rate = 0.8, pitch = 1.15, onStart, onEnd } = opts;

    if (!window.speechSynthesis) {
      // 音声合成が使えない環境向けのフォールバック：
      // 何も話さないが、時間経過だけはシミュレートして呼び出し元を進める。
      if (onStart) onStart();
      setTimeout(() => onEnd && onEnd(), 400);
      return;
    }

    cancelSpeaking();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US";
    utter.rate = rate;
    utter.pitch = pitch;
    const voice = pickEnglishVoice();
    if (voice) utter.voice = voice;
    if (onStart) utter.onstart = onStart;
    utter.onend = () => onEnd && onEnd();
    utter.onerror = () => onEnd && onEnd();
    window.speechSynthesis.speak(utter);
  }

  /* ---------- 音声認識 (Speech-to-Text) ---------- */

  // 一度マイク権限が拒否されたら、そのセッション中は再度プロンプトしない
  let micPermissionDenied = false;
  let currentRecognition = null;

  function isRecognitionSupported() {
    return !!RecognitionCtor && !micPermissionDenied;
  }

  /**
   * 英語の音声認識を1回だけ開始する。
   * 結果の「正解判定」はここでは行わず、認識結果の文字列だけを返す。
   * （判定ロジックは matchesWord() またはゲーム側に委ねる）
   *
   * @param {{
   *   timeoutMs?: number,               無音・無反応時に諦めるまでの時間
   *   onStart?: () => void,             認識開始時
   *   onResult?: (transcript:string) => void,  認識結果が得られた時
   *   onNoSpeech?: () => void,          発話が検出できなかった/タイムアウト時
   *   onDenied?: () => void,            マイク権限が拒否された時
   *   onUnsupported?: () => void,       この端末で音声認識が使えない/開始に失敗した時
   *   onEnd?: () => void,               認識セッション終了時（結果の有無に関わらず）
   * }} [opts]
   * @returns {SpeechRecognition|null}
   */
  function listen(opts = {}) {
    const {
      timeoutMs = 6000,
      onStart,
      onResult,
      onNoSpeech,
      onDenied,
      onUnsupported,
      onEnd,
    } = opts;

    if (!RecognitionCtor || micPermissionDenied) {
      if (onUnsupported) onUnsupported();
      return null;
    }

    stopListening();

    let recognition;
    try {
      recognition = new RecognitionCtor();
    } catch (e) {
      if (onUnsupported) onUnsupported();
      return null;
    }

    currentRecognition = recognition;
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 3;

    let settled = false;

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        recognition.stop();
      } catch (e) {
        /* noop */
      }
      if (onNoSpeech) onNoSpeech();
    }, timeoutMs);

    recognition.onstart = () => {
      if (onStart) onStart();
    };

    recognition.onresult = (event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      const results = event.results && event.results[0];
      if (!results) {
        if (onNoSpeech) onNoSpeech();
        return;
      }
      const transcripts = [];
      for (let i = 0; i < results.length; i++) {
        transcripts.push(results[i].transcript || "");
      }
      if (onResult) onResult(transcripts.join(" "));
    };

    recognition.onerror = (event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      const err = event && event.error;
      if (err === "not-allowed" || err === "permission-denied" || err === "service-not-allowed") {
        micPermissionDenied = true;
        if (onDenied) onDenied();
      } else if (err === "no-speech" || err === "audio-capture") {
        if (onNoSpeech) onNoSpeech();
      } else {
        // "aborted", "network" など、端末側の事情で使えないケースは
        // ゲームを止めないようフォールバック扱いにする
        if (onUnsupported) onUnsupported();
      }
    };

    recognition.onend = () => {
      clearTimeout(timeoutId);
      currentRecognition = null;
      if (onEnd) onEnd();
    };

    try {
      recognition.start();
    } catch (e) {
      clearTimeout(timeoutId);
      currentRecognition = null;
      if (onUnsupported) onUnsupported();
    }

    return recognition;
  }

  function stopListening() {
    if (currentRecognition) {
      try {
        currentRecognition.stop();
      } catch (e) {
        /* noop */
      }
      currentRecognition = null;
    }
  }

  /**
   * 認識結果の文字列に対象単語が含まれているかを判定する。
   * 幼児の発音のゆれを考慮し、大文字小文字・記号を無視した部分一致で判定する
   * （厳密な正誤判定はしない）。
   */
  function matchesWord(transcript, targetWord) {
    if (!transcript || !targetWord) return false;
    const normalize = (s) =>
      s
        .toLowerCase()
        .replace(/[^a-z\s]/g, "")
        .trim();
    const t = normalize(transcript);
    const target = normalize(targetWord);
    if (!t || !target) return false;
    return t.includes(target) || target.includes(t);
  }

  window.Speech = {
    speak,
    cancelSpeaking,
    isRecognitionSupported,
    listen,
    stopListening,
    matchesWord,
  };
})();
