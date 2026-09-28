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
        // UPPER BODY VIEW（ズーム後）でも画面外に切れないよう、画像の
        // 端ぎりぎり（0%・100%）から少しだけ内側に寄せてある
        // （handsのhotspotと接する内側の境界はそのまま、外側だけを詰めた）。
        { left: 3, top: 47, width: 6, height: 11 }, // 左ゆび
        { left: 80, top: 40, width: 11, height: 6 }, // 右ゆび
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

  /*
   * 問題のbody partに応じて、プリンセスの見せ方（カメラの寄り方）を
   * 自動的に変える設定。
   *   scale: 何倍に拡大するか（1 = 等倍＝現在に近い全身表示）
   *   focusX/focusY: 画像の%座標（hotspotsと同じ基準）のうち、ズーム後も
   *                  画面中央に来続けさせたい点。
   * #princess-camera 要素に scale(s) translate(tx%, ty%) を設定することで、
   * 「focusX%, focusY% の点がステージ中央に来る」ような拡大を実現する
   * （tx = 50/s - focusX, ty = 50/s - focusY）。画像とhotspotは同じ
   * #princess-camera の中に入っているため、常に完全に一致したまま動く。
   */
  const PRINCESS_CAMERA_VIEWS = {
    face: { scale: 1.6, focusX: 50, focusY: 24 }, // 顔〜上半身を大きく
    upper: { scale: 1.1, focusX: 50, focusY: 40 }, // 上半身＋両手（画面外に切れないよう控えめに）
    full: { scale: 1, focusX: 50, focusY: 50 }, // 現在に近い全身表示
  };
  const PRINCESS_PART_VIEW = {
    head: "face",
    hair: "face",
    eyes: "face",
    ears: "face",
    nose: "face",
    mouth: "face",
    hands: "upper",
    fingers: "upper",
    legs: "full",
    feet: "full",
  };

  /* ===================== DOM参照 ===================== */
  const princessScoreEl = document.getElementById("princess-score");
  const princessStageEl = document.getElementById("princess-stage");
  const princessCameraEl = document.getElementById("princess-camera");
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
   * 見た目に依存しない「今実際に画面に表示されているプリンセス本体の要素」を返す。
   * PRINCESS_CONFIG.imageSrc 設定時、ensurePrincessVisual() は元の
   * .princess-illustration（SVG、display:noneで隠される）はそのまま残し、
   * 同じクラス名を持つ新しい<img>要素を追加で挿入する。起動時に一度だけ
   * 取得した princessImgHost 定数はその「元のSVG」を指したままになるため、
   * ボディモーション（揺れ・ジャンプ等）をそこに適用しても実際には見えない
   * （SVG側が非表示のまま）。そのため、演出を適用する瞬間に毎回、実際に
   * 表示されている方（<img>があればそれ、なければ元のSVG）を探し直す。
   */
  function getVisiblePrincessEl() {
    return princessStageEl.querySelector("img.princess-illustration") || princessImgHost;
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  /**
   * 現在 #princess-camera に適用中の transform（scale/tx/ty）。
   * spawnTiaraSparkle など「%座標→ステージ内px」の変換をする処理が、
   * ズーム中でも正しい画面位置を計算できるように保持しておく。
   */
  let princessCurrentCamera = { scale: 1, tx: 0, ty: 0 };

  /**
   * 問題のbody partに応じて、プリンセスの見せ方（顔アップ／上半身／全身）を
   * 切り替える。#princess-camera（画像＋当たり判定を1つにまとめたラッパー）
   * にscale/translateを設定するだけなので、画像とhotspotは常に完全に
   * 一致したまま拡大・移動する。切り替えはCSSのtransitionで自然に補間される。
   */
  function applyPrincessCameraView(part) {
    const viewName = (part && PRINCESS_PART_VIEW[part.id]) || "full";
    const view = PRINCESS_CAMERA_VIEWS[viewName] || PRINCESS_CAMERA_VIEWS.full;
    const s = view.scale;
    const tx = 50 / s - view.focusX;
    const ty = 50 / s - view.focusY;
    princessCurrentCamera = { scale: s, tx, ty };
    if (princessCameraEl) {
      princessCameraEl.style.transform = `scale(${s}) translate(${tx}%, ${ty}%)`;
    }
  }

  /**
   * hotspot要素（実際にタップされた領域）の、ステージ内での中心座標(px)を返す。
   * イラストがSVGでもPNGでも、hotspot要素自体の実測位置を使うので同じコードで動く。
   */
  function stageRelativeCenter(hotspotEl) {
    const stageRect = princessStageEl.getBoundingClientRect();
    const spotRect = hotspotEl.getBoundingClientRect();
    return {
      cx: spotRect.left - stageRect.left + spotRect.width / 2,
      cy: spotRect.top - stageRect.top + spotRect.height / 2,
      width: spotRect.width,
      height: spotRect.height,
    };
  }

  /**
   * #princess-camera内の%座標(PRINCESS_BODY_PARTSのhotspotsと同じ基準)を、
   * 現在のカメラズーム状態を考慮した上でステージ内px座標に変換する。
   * （ズームしていない全身表示の時は従来どおり単純な%→px変換と一致する）
   */
  function stagePercentToPx(leftPct, topPct) {
    const stageRect = princessStageEl.getBoundingClientRect();
    const cam = princessCurrentCamera;
    const fx = (leftPct / 100 + cam.tx / 100) * cam.scale;
    const fy = (topPct / 100 + cam.ty / 100) * cam.scale;
    return { cx: fx * stageRect.width, cy: fy * stageRect.height };
  }

  /**
   * タップした場所に「小さな光」と「星・キラキラ」を表示する。
   * cx, cy はステージ内のpx座標（stageRelativeCenter / stagePercentToPxで求めたもの）。
   */
  function spawnHitEffect(cx, cy, refSize, options) {
    const opts = options || {};
    const chars = opts.chars || ["✨", "⭐", "💫"];
    const count = opts.count != null ? opts.count : 6;
    const biasUp = !!opts.biasUp;
    const size = Math.max(refSize || 40, 28) * 1.6;

    const ring = document.createElement("div");
    ring.className = "princess-glow-ring";
    ring.style.left = cx - size / 2 + "px";
    ring.style.top = cy - size / 2 + "px";
    ring.style.width = size + "px";
    ring.style.height = size + "px";
    princessFxLayerEl.appendChild(ring);
    setTimeout(() => ring.remove(), 1000);

    for (let i = 0; i < count; i++) {
      const s = document.createElement("div");
      s.className = "princess-sparkle";
      s.textContent = chars[i % chars.length];
      s.style.left = cx + "px";
      s.style.top = cy + "px";
      // biasUp（headのティアラ演出など）の場合は、ほぼ真上方向に星が飛ぶようにする。
      const angle = biasUp
        ? -Math.PI / 2 + (Math.random() - 0.5) * 0.8
        : (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const dist = biasUp ? 30 + Math.random() * 22 : 26 + Math.random() * 18;
      s.style.setProperty("--sx", Math.cos(angle) * dist + "px");
      s.style.setProperty("--sy", Math.sin(angle) * dist - (biasUp ? 6 : 10) + "px");
      princessFxLayerEl.appendChild(s);
      setTimeout(() => s.remove(), 1000);
    }
  }

  /** プリンセス本体に、部位に応じた軽いボディモーション（揺れ・ジャンプ等）のCSSクラスを一瞬つける。 */
  function triggerBodyMotion(className, durationMs) {
    if (prefersReducedMotion()) return; // 大きな動きは reduced motion では無効化
    const el = getVisiblePrincessEl();
    if (!el) return;
    el.classList.remove(className); // 連続で同じ部位が続けて出た場合に再生し直せるようにする
    // eslint-disable-next-line no-unused-expressions
    void el.offsetWidth; // reflow強制でアニメーションを確実に再スタートさせる
    el.classList.add(className);
    setTimeout(() => el.classList.remove(className), durationMs);
  }

  /** eyes専用：両目のhotspot要素の実測位置に「まばたき」風オーバーレイを一瞬重ねる。 */
  function spawnBlinkOverlay() {
    if (prefersReducedMotion()) return;
    const eyeButtons = princessHotspotsEl.querySelectorAll('.princess-hotspot[aria-label="eyes"]');
    eyeButtons.forEach((btn) => {
      const stageRect = princessStageEl.getBoundingClientRect();
      const r = btn.getBoundingClientRect();
      const lid = document.createElement("div");
      lid.className = "princess-blink-lid";
      lid.style.left = r.left - stageRect.left + "px";
      lid.style.top = r.top - stageRect.top + "px";
      lid.style.width = r.width + "px";
      lid.style.height = r.height + "px";
      princessFxLayerEl.appendChild(lid);
      setTimeout(() => lid.remove(), 550);
    });
  }

  /** head専用：ティアラ付近から星が上に飛ぶ、おまけの演出（タップ位置の光とは別に追加）。 */
  function spawnTiaraSparkle() {
    const { cx, cy } = stagePercentToPx(50, 4);
    spawnHitEffect(cx, cy, 30, { chars: ["✨", "⭐"], count: 3, biasUp: true });
  }

  /**
   * 部位ごとの「正解リアクション」をまとめて再生する。
   * 1) 実際にタップされたhotspotの位置から光＋キラキラ（部位ごとに絵文字を変える）
   * 2) 部位に応じて、プリンセス本体に軽いボディモーション（揺れ・ジャンプ等）
   * 3) head/eyesだけ追加の演出（ティアラの光／まばたき風オーバーレイ）
   * どの演出も、tapされたhotspot要素自身の実測位置（%座標から算出した実ピクセル）
   * を使うので、左右どちらの手足を押したかで発生位置が変わり、画面サイズが
   * 変わっても常に正しい部位の位置から演出が出る。
   */
  function playPrincessCorrectReaction(part, hotspotEl) {
    const { cx, cy, width, height } = stageRelativeCenter(hotspotEl);
    const refSize = Math.max(width, height);

    switch (part.id) {
      case "head":
        spawnHitEffect(cx, cy, refSize, { chars: ["✨", "⭐", "💫"], count: 6 });
        spawnTiaraSparkle();
        break;
      case "hair":
        spawnHitEffect(cx, cy, refSize, { chars: ["✨", "⭐", "💫"], count: 6 });
        triggerBodyMotion("pe-sway", 600);
        break;
      case "eyes":
        spawnHitEffect(cx, cy, refSize, { chars: ["✨", "⭐"], count: 5 });
        spawnBlinkOverlay();
        break;
      case "ears":
        spawnHitEffect(cx, cy, refSize, { chars: ["🎵", "♪", "✨"], count: 5 });
        break;
      case "nose":
        spawnHitEffect(cx, cy, refSize, { chars: ["✨", "⭐"], count: 2 });
        break;
      case "mouth":
        spawnHitEffect(cx, cy, refSize, { chars: ["💗", "💕", "✨"], count: 5 });
        triggerBodyMotion("pe-nod", 600);
        break;
      case "hands":
        spawnHitEffect(cx, cy, refSize, { chars: ["✨", "⭐", "💫"], count: 6 });
        triggerBodyMotion("pe-wave", 600);
        break;
      case "fingers":
        spawnHitEffect(cx, cy, refSize, { chars: ["✨", "⭐", "✨", "⭐"], count: 7 });
        break;
      case "legs":
        spawnHitEffect(cx, cy, refSize, { chars: ["✨", "⭐"], count: 5 });
        triggerBodyMotion("pe-hop-small", 500);
        break;
      case "feet":
        spawnHitEffect(cx, cy, refSize, { chars: ["✨", "⭐", "💫"], count: 6 });
        triggerBodyMotion("pe-hop-big", 600);
        break;
      default:
        spawnHitEffect(cx, cy, refSize);
    }
  }

  /**
   * 発音練習が成功した「Great job!」の瞬間の、短いお祝い演出（約1〜1.5秒）。
   *
   * このタイミングでは #princess-speak-overlay（不透明度95%のカード）が
   * プリンセス本体の上に被さっているため、ステージ側（#princess-fx-layer /
   * プリンセス画像本体）に演出を出しても子どもには見えない。そのため、
   * 1) 実際に見えているスピークカード側のプリンセス絵文字(👸)をbounceさせ、
   * 2) 星とconfettiも、隠れているステージではなく表示中のオーバーレイの上に
   * 出す。
   */
  function playGreatJobCelebration() {
    // ステージ上の本体（次の質問で見える状態に戻った時のための演出）も一応bounceさせる。
    triggerBodyMotion("pe-great-bounce", 800);
    // 今まさに見えているスピークカードの👸も、既存のbounce-jump（Zoo Adventureと共通）でbounce。
    if (princessSpeakEmojiEl) {
      princessSpeakEmojiEl.classList.remove("bounce-jump");
      void princessSpeakEmojiEl.offsetWidth;
      princessSpeakEmojiEl.classList.add("bounce-jump");
      setTimeout(() => princessSpeakEmojiEl.classList.remove("bounce-jump"), 800);
    }

    const overlayRect = princessSpeakOverlay.getBoundingClientRect();
    const topY = overlayRect.height * 0.14;
    const starChars = ["✨", "⭐", "💫"];
    for (let i = 0; i < 6; i++) {
      const s = document.createElement("div");
      s.className = "princess-sparkle";
      s.textContent = starChars[i % starChars.length];
      const x = overlayRect.width * (0.2 + Math.random() * 0.6);
      s.style.left = x + "px";
      s.style.top = topY + "px";
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const dist = 24 + Math.random() * 20;
      s.style.setProperty("--sx", Math.cos(angle) * dist + "px");
      s.style.setProperty("--sy", Math.sin(angle) * dist - 8 + "px");
      princessSpeakOverlay.appendChild(s);
      setTimeout(() => s.remove(), 1000);
    }

    if (!prefersReducedMotion()) {
      const confettiColors = ["#FFD24D", "#FF8FB1", "#B18BFF", "#8FE3C0"];
      for (let i = 0; i < 8; i++) {
        const c = document.createElement("div");
        c.className = "princess-confetti-piece";
        c.style.left = overlayRect.width * Math.random() + "px";
        c.style.background = confettiColors[i % confettiColors.length];
        c.style.animationDelay = Math.random() * 0.15 + "s";
        princessSpeakOverlay.appendChild(c);
        setTimeout(() => c.remove(), 1400);
      }
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
        // 画像は #princess-camera（当たり判定と同じズーム対象）の中に入れる。
        const insertHost = princessCameraEl || princessStageEl;
        insertHost.insertBefore(img, princessHotspotsEl);
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
        btn.addEventListener("click", (e) => handlePrincessTap(part, btn, e));
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
    applyPrincessCameraView(target);

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

  function handlePrincessTap(part, hotspotEl, event) {
    if (!princess.awaitingPick) return;
    // hotspotボタンのクリックが #princess-stage 側の「はずれ」リスナーにも
    // バブリングして二重にhandlePrincessMiss等が呼ばれないようにする。
    if (event) event.stopPropagation();

    const target = currentTargetPart();
    if (!target) return;

    if (part.id !== target.id) {
      handlePrincessMiss(hotspotEl, null);
      return;
    }

    // 正解！
    princess.awaitingPick = false;
    playPrincessCorrectReaction(target, hotspotEl);
    playPrincessCorrectSound();

    Speech.speak(`${capitalize(target.en)}!`, {
      onEnd: () => enterPrincessSpeakPhase(target),
    });
  }

  // ドレスなど、当たり判定のない場所をタップした場合の「はずれ」
  princessStageEl.addEventListener("click", (event) => {
    if (!princess.awaitingPick) return;
    handlePrincessMiss(null, event);
  });

  /**
   * 不正解時のリアクション。
   * ×・赤色・ブザー・画面/キャラクターのシェイクは一切使わない。
   * 代わりに、実際にタップされた場所（間違えたhotspot、または
   * hotspotの無い場所をタップした場合はそのタップ座標）にだけ、
   * 赤くない柔らかい光の波紋を一度だけ表示し、「Try again!」を
   * 優しい音声で再生する。プリンセス本体・画面全体は一切動かさない。
   */
  function handlePrincessMiss(hotspotEl, event) {
    const stageRect = princessStageEl.getBoundingClientRect();
    let cx, cy, refSize;
    if (hotspotEl) {
      const c = stageRelativeCenter(hotspotEl);
      cx = c.cx;
      cy = c.cy;
      refSize = Math.max(c.width, c.height);
    } else if (event && typeof event.clientX === "number") {
      cx = event.clientX - stageRect.left;
      cy = event.clientY - stageRect.top;
      refSize = 40;
    } else {
      cx = stageRect.width / 2;
      cy = stageRect.height / 2;
      refSize = 40;
    }
    spawnMissRipple(cx, cy, refSize);
    Speech.speak("Try again!");
  }

  /** 不正解タップの位置にだけ出す、赤色を使わない柔らかい波紋（一度だけ）。 */
  function spawnMissRipple(cx, cy, refSize) {
    const size = Math.max(refSize || 46, 30) * 1.4;
    const ripple = document.createElement("div");
    ripple.className = "princess-miss-ripple";
    ripple.style.left = cx - size / 2 + "px";
    ripple.style.top = cy - size / 2 + "px";
    ripple.style.width = size + "px";
    ripple.style.height = size + "px";
    princessFxLayerEl.appendChild(ripple);
    setTimeout(() => ripple.remove(), 700);
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
    playGreatJobCelebration();

    setTimeout(() => {
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
