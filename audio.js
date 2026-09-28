"use strict";

/**
 * ===================== Audio モジュール（BGM + 効果音） =====================
 *
 * BGM（背景音楽）と効果音（SFX）を一元管理する。speech.js（音声合成・音声認識）
 * とはあえて分離した別ファイルにしているが、speech.js側から
 * 「英語の読み上げ／マイク認識が始まったらBGMを下げ、終わったら戻す」という
 * duck/unduckをこのモジュールのAPI経由で呼べるように、window.audioManager
 * という薄いグローバルAPIとして公開する（speech.js は「あれば呼ぶ」だけで、
 * audio.jsが読み込まれていなくても壊れないようガードしてある）。
 *
 * 優先順位: Speech（英語の読み上げ・子どもの発音） > SFX（効果音） > BGM
 *   - 読み上げ中／マイク認識中はBGMを自動でduck（下げる）し、
 *     英語学習の妨げにならないようにする。
 *   - 効果音はBGMより目立つ音量で鳴らすが、常に控えめ。
 *
 * 公開API（window.audioManager）:
 *   startBgm()            BGMを再生開始（ON設定時のみ。多重再生はしない）
 *   stopBgm()              BGMを停止する
 *   setBgmEnabled(bool)    BGMのON/OFFを切り替え、localStorageに保存する
 *   isBgmEnabled()          現在のON/OFF設定を返す
 *   duck(reason)            指定した理由でBGMを一時的に下げる（複数理由の重複可）
 *   unduck(reason)          指定した理由のduckを解除する（他の理由が残っていれば下がったまま）
 *   playSfx(name)           効果音を1つ再生する（音源が無い/失敗してもゲームは止めない）
 *   registerFallback(name, fn)  音源ファイルが無い/再生できない時の代替演出（例:合成音）を登録
 *   unlock()                 iOS Safari等のautoplay制限向け。ユーザー操作(PLAYタップ等)の
 *                             直後に一度だけ呼ぶことで、以降のBGM再生を可能にする。
 *
 * 設計方針:
 *   - ページを開いただけではBGMを一切再生しない（unlock()が呼ばれるまでstartBgm()は
 *     内部的に「再生を試みない」）。
 *   - 音源ファイル（assets/audio/*.mp3）がまだ配置されていなくても、
 *     再生エラーを黙って握りつぶし、ゲーム進行を絶対に止めない。
 *   - HOME→GAME→SPEAK→GAMEと画面を行き来しても、同じBGM（同じ<audio>インスタンス）
 *     を使い続け、多重再生や再スタートはしない。
 */
(function () {
  const STORAGE_KEY = "princessEnglish.bgmEnabled";

  const BASE_BGM_VOLUME = 0.18; // 常時のBGM音量（15〜20%程度）
  const SPEECH_DUCK_VOLUME = 0.05; // 英語読み上げ中はここまで下げる（約5%）
  const MIC_DUCK_VOLUME = 0; // マイク認識中は完全mute（子どもの声の認識を最優先）
  const CLEAR_DUCK_VOLUME = 0.05; // 10問クリアのfanfare〜ダンス中もここまで下げる

  const DUCK_DOWN_MS = 300; // 下げる時は少し速く
  const DUCK_UP_MS = 450; // 戻す時は300〜500msかけて滑らかに

  const BGM_SRC = "assets/audio/princess-theme.mp3";
  const SFX_SRC = {
    play: "assets/audio/play.mp3",
    correct: "assets/audio/correct.mp3",
    wrong: "assets/audio/wrong.mp3",
    sparkle: "assets/audio/sparkle.mp3",
    clear: "assets/audio/clear.mp3",
  };
  // 効果音ごとの音量（すべて控えめ。特にwrongは「Try again!」の邪魔をしない
  // ごく軽い音にするため、他よりさらに小さくする）。
  const SFX_VOLUME = {
    play: 0.45,
    correct: 0.4,
    wrong: 0.22,
    sparkle: 0.35,
    clear: 0.5,
  };

  let bgmEnabled = loadBgmEnabled();
  let bgmAudio = null;
  let bgmStarted = false; // 同じBGMインスタンスの多重再生を防ぐ
  let unlocked = false; // iOS Safari向け：ユーザー操作を経ているか
  // reason(理由文字列) -> 現在有効なduck呼び出しの重複回数。
  // 単純なSet（有無だけ）ではなく回数で管理しているのは、例えば
  // 質問の読み上げが終わる直前に次の読み上げが始まる（cancelSpeaking()で
  // 前の発話がonerror("interrupted")になる）ようなケースで、古い方の
  // unduck()が新しい方のduck()を巻き込んで解除してしまわないようにするため。
  const duckReasons = new Map();
  let fadeRafId = null;
  const fallbacks = Object.create(null);

  function loadBgmEnabled() {
    try {
      const v = window.localStorage ? localStorage.getItem(STORAGE_KEY) : null;
      // 未設定（初回）はON扱い。一度でもOFFにされていればOFFのまま次回も維持する。
      return v === null ? true : v === "1";
    } catch (e) {
      return true;
    }
  }

  function saveBgmEnabled(value) {
    try {
      if (window.localStorage) localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch (e) {
      /* localStorageが使えない環境でも無視してゲームは続行する */
    }
  }

  function getBgmAudioEl() {
    if (bgmAudio) return bgmAudio;
    bgmAudio = new Audio();
    bgmAudio.src = BGM_SRC;
    bgmAudio.loop = true;
    bgmAudio.preload = "auto";
    bgmAudio.volume = 0;
    bgmAudio.setAttribute("data-role", "princess-bgm");
    // 音源ファイルが存在しない/読み込めない場合でも、エラーを飲み込んで
    // ゲーム進行に一切影響させない（再生できないだけで、他は通常どおり動く）。
    bgmAudio.addEventListener("error", () => {
      bgmStarted = false;
    });
    // 一部のブラウザ（特にiOS Safari）では、<audio>要素がDOMに実在している方が
    // 再生が安定するため、画面には一切見えない形でbodyに1つだけ挿入しておく
    // （表示崩れやタップ判定への影響は無い。生成は一度きりで、多重挿入もしない）。
    if (document.body) document.body.appendChild(bgmAudio);
    return bgmAudio;
  }

  /** 現在のON/OFF設定とduck状態から、あるべきBGM音量を計算する。 */
  function targetBgmVolume() {
    if (!bgmEnabled) return 0;
    if (duckReasons.get("mic") > 0) return MIC_DUCK_VOLUME;
    if (duckReasons.get("clear") > 0) return CLEAR_DUCK_VOLUME;
    if (duckReasons.get("speech") > 0) return SPEECH_DUCK_VOLUME;
    return BASE_BGM_VOLUME;
  }

  function fadeBgmVolumeTo(target, durationMs) {
    const audio = getBgmAudioEl();
    if (fadeRafId) {
      cancelAnimationFrame(fadeRafId);
      fadeRafId = null;
    }
    const clampedTarget = Math.max(0, Math.min(1, target));
    const start = audio.volume;
    const diff = clampedTarget - start;
    if (Math.abs(diff) < 0.002 || durationMs <= 0 || !window.requestAnimationFrame) {
      audio.volume = clampedTarget;
      return;
    }
    const startTime = performance.now();
    function step(now) {
      const t = Math.min(1, (now - startTime) / durationMs);
      audio.volume = Math.max(0, Math.min(1, start + diff * t));
      if (t < 1) {
        fadeRafId = requestAnimationFrame(step);
      } else {
        fadeRafId = null;
      }
    }
    fadeRafId = requestAnimationFrame(step);
  }

  function applyBgmVolume(durationMs) {
    fadeBgmVolumeTo(targetBgmVolume(), durationMs);
  }

  /**
   * BGMの再生を開始する。ON設定でない場合や、まだユーザー操作による
   * unlock()前の場合は何もしない（iPhone Safariのautoplay制限対策）。
   * すでに再生中の場合は何もしない（多重再生防止）。
   */
  function startBgm() {
    if (!bgmEnabled || !unlocked) return;
    const audio = getBgmAudioEl();
    if (bgmStarted && !audio.paused) return;
    bgmStarted = true;
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        // 自動再生制限や音源未配置などで失敗しても、ゲームは止めない。
        bgmStarted = false;
      });
    }
    applyBgmVolume(600);
  }

  function stopBgm() {
    bgmStarted = false;
    if (fadeRafId) {
      cancelAnimationFrame(fadeRafId);
      fadeRafId = null;
    }
    if (bgmAudio) {
      try {
        bgmAudio.pause();
      } catch (e) {
        /* noop */
      }
    }
  }

  function setBgmEnabled(enabled) {
    bgmEnabled = !!enabled;
    saveBgmEnabled(bgmEnabled);
    if (bgmEnabled) {
      // 音楽ボタンのタップ自体がユーザー操作なので、ここでunlockしてから再生してよい。
      unlocked = true;
      startBgm();
    } else {
      stopBgm();
    }
  }

  function isBgmEnabled() {
    return bgmEnabled;
  }

  function duck(reason) {
    const key = reason || "speech";
    duckReasons.set(key, (duckReasons.get(key) || 0) + 1);
    applyBgmVolume(DUCK_DOWN_MS);
  }

  function unduck(reason) {
    const key = reason || "speech";
    const count = (duckReasons.get(key) || 0) - 1;
    if (count > 0) duckReasons.set(key, count);
    else duckReasons.delete(key);
    applyBgmVolume(DUCK_UP_MS);
  }

  /**
   * 効果音を1つ再生する。音源ファイルが存在しない・読み込めない・
   * 再生に失敗した場合は、登録済みのフォールバック（合成音など）があれば
   * それを実行し、無ければ何もしない（無音のまま。ゲームは絶対に止めない）。
   */
  function playSfx(name) {
    const src = SFX_SRC[name];
    if (!src) {
      runFallback(name);
      return;
    }
    try {
      const el = new Audio(src);
      el.volume = SFX_VOLUME[name] != null ? SFX_VOLUME[name] : 0.4;
      let fellBack = false;
      const doFallback = () => {
        if (fellBack) return;
        fellBack = true;
        runFallback(name);
      };
      el.addEventListener("error", doFallback);
      const playPromise = el.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(doFallback);
      }
    } catch (e) {
      runFallback(name);
    }
  }

  function runFallback(name) {
    const fn = fallbacks[name];
    if (typeof fn === "function") fn();
  }

  function registerFallback(name, fn) {
    fallbacks[name] = fn;
  }

  /**
   * ユーザー操作（PLAYタップなど）を起点に、以降のBGM再生を許可する。
   * iPhone Safariをはじめ多くのブラウザは、ユーザー操作を伴わない
   * <audio>の再生を許可しないため、必ずクリック/タップイベントの
   * ハンドラ内から（非同期処理を挟まず）呼び出すこと。
   */
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    startBgm();
  }

  window.audioManager = {
    startBgm,
    stopBgm,
    setBgmEnabled,
    isBgmEnabled,
    duck,
    unduck,
    playSfx,
    registerFallback,
    unlock,
  };
})();
