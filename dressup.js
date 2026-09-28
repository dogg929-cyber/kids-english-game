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
 *   - 画像素材は現時点で HAIR（髪型）とDRESS（ドレス）カテゴリーの
 *     実写素材が揃っている（assets/dressup/hair/long|ponytail|braids.webp、
 *     assets/dressup/dresses/pink|blue|yellow.webp）。CROWN/SHOESはまだ
 *     無いので、そこでは選択状態をプレビュー下のLook Badgesと選択肢
 *     カードの金枠+✓だけに反映する。
 *   - 【着せ替え状態：dressup.equipped】 hair/crown/dress/shoesは
 *     完全に独立した状態として dressup.equipped = {hair,crown,dress,shoes}
 *     に保持される。あるカテゴリーで正解しても、他カテゴリーの
 *     equippedは一切リセットされない（例：Ponytail + Flower Crown +
 *     Blue Dress + Purple Shoesを同時に「装着中」として保持できる）。
 *     これは将来、好きな順・好きな組み合わせで自由に着せ替えられる
 *     FREE DRESS UPモードを追加する際にも、このゲーム進行（固定順の
 *     クイズ）とは別に、そのまま流用できる状態設計にしてある。
 *   - 【見た目のレイヤー合成：dressup-layer-*】 index.html側は
 *     base→dress→shoes→hair→crown→effectsの順に重ねる透明レイヤー
 *     スタック（#dressup-portrait-layers内の各 .dressup-layer）を
 *     前提にしたDOM構造になっている。各アイテムが「髪だけ／ドレスだけ」
 *     を切り抜いた独立透明素材を持つ場合は item.layerPath +
 *     item.layerSlot（'hair'|'crown'|'dress'|'shoes'）を設定すれば、
 *     対応するレイヤー<img>にそのまま表示される（拡大縮小やscaleX/scaleY
 *     の個別調整は不要）。
 *   - 【重要な既知の制約：全身画像の優先表示】 現在のHAIR/DRESS画像は
 *     どちらも「もう片方のカテゴリー込みの全身portrait」（HAIR画像=
 *     Purple Dress固定、DRESS画像=Long Hair固定）であり、上記の
 *     layerPathを使った独立レイヤーではない（どのアイテムもlayerPathは
 *     未設定）。そのため実装は、hasAsset:true な「全身画像」アイテムが
 *     equipped中に複数あるとき、WHOLE_BODY_PRIORITY（下記）の優先順位に
 *     従って1枚だけをPrincess Preview全体に表示する（無理な合成はしない）。
 *     優先順位は shoes > dress > crown > hair なので、今のところ
 *     DRESSがHAIRより優先される（HAIR選択後にDRESSを選ぶと、見た目上は
 *     選んだ髪型がDress画像に焼き込まれたLong Hairに戻って見える）。
 *     dressup.equipped.hair 自体はきちんと保持されたままなので、
 *     Look Badge／選択肢カードの金枠+✓には正しく反映され続ける。
 *     詳細と将来のレイヤー合成への移行方針は assets/dressup/README.md、
 *     および handleDressUpChoiceTap内のコメントを参照。
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
   *   swatch     実画像が無い項目向けの3択カード色スウォッチ（CSS color）
   *   icon       実画像が無い項目向けの3択カード絵文字
   *   assetPath  Princess Preview全体をこの画像に差し替えるための実画像パス
   *              （未配置カテゴリーはコメントのみでコード上は未設定）
   *   hasAsset   true の場合、正解タップでPrincess Preview全体を
   *              assetPathの画像へ変身させる（HAIR/DRESSで使用。
   *              WHOLE_BODY_PRIORITYの優先順位で1枚だけが表示される）
   *   thumbPath  3択カード自体に表示する、頭〜髪型部分だけを切り出した
   *              サムネイル画像。あれば色スウォッチの代わりにこの写真を使う
   *              （HAIRで使用。DRESSは色スウォッチのままの方がPink/Blue/
   *              Yellowの違いが一目でわかるため、意図的にthumbPathを付けていない）
   *   layerPath  【将来用・現在はどのアイテムも未設定】髪だけ／
   *              ドレスだけ／かんむりだけ等を切り抜いた独立透明レイヤー
   *              素材のパス。設定されたアイテムは、対応する
   *              dressup-layer-*（layerSlot参照）に単独で重ね描画される
   *              （hasAsset方式の「全身丸ごと上書き」とは併用しない）。
   *   layerSlot  layerPathを使う場合、どのレイヤー('hair'|'crown'|
   *              'dress'|'shoes')に表示するか。省略時はcatIdと同じとみなす。
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
          assetPath: "assets/dressup/hair/long.webp",
          thumbPath: "assets/dressup/hair/long_thumb.webp",
          hasAsset: true,
        },
        {
          id: "ponytail",
          en: "Ponytail",
          speakWord: "Ponytail",
          jp: "ポニーテールは どれ？",
          swatch: "#B5722E",
          icon: "🎀",
          assetPath: "assets/dressup/hair/ponytail.webp",
          thumbPath: "assets/dressup/hair/ponytail_thumb.webp",
          hasAsset: true,
        },
        {
          id: "braids",
          en: "Braids",
          speakWord: "Braids",
          jp: "おさげは どれ？",
          swatch: "#8F5B2E",
          icon: "👧",
          assetPath: "assets/dressup/hair/braids.webp",
          thumbPath: "assets/dressup/hair/braids_thumb.webp",
          hasAsset: true,
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
          assetPath: "assets/dressup/dresses/pink.webp",
          hasAsset: true, // 実画像あり：正解タップでPrincess Previewがこの画像に変身する
        },
        {
          id: "blue",
          en: "Blue Dress",
          speakWord: "Blue",
          jp: "みずいろの ドレスは どれ？",
          swatch: "#7EC8F2",
          icon: "👗",
          assetPath: "assets/dressup/dresses/blue.webp",
          hasAsset: true,
        },
        {
          id: "yellow",
          en: "Yellow Dress",
          speakWord: "Yellow",
          jp: "きいろの ドレスは どれ？",
          swatch: "#FFD24D",
          icon: "👗",
          assetPath: "assets/dressup/dresses/yellow.webp",
          hasAsset: true,
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
  // 将来layerPath付きの独立透明素材が揃ったカテゴリーから使われる、
  // base以外のレイヤー<img>参照（今はどれもhiddenのまま未使用）。
  const layerEls = {
    dress: document.getElementById("dressup-layer-dress"),
    shoes: document.getElementById("dressup-layer-shoes"),
    hair: document.getElementById("dressup-layer-hair"),
    crown: document.getElementById("dressup-layer-crown"),
  };
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
    order: DRESSUP_CATEGORIES.map((c) => c.id), // 1 HAIR → 2 CROWN → 3 DRESS → 4 SHOES（固定順・クイズの出題順）
    currentIndex: 0,
    awaitingPick: true,
    targetItem: null,
    targetCatId: null,
    pendingItem: null,
    // catId -> 選んだアイテム（オブジェクト）。4カテゴリーが完全に独立して
    // おり、あるカテゴリーで正解しても他カテゴリーのequippedは一切
    // リセットされない（例：hair=ponytail, crown=flower, dress=blue,
    // shoes=purpleを同時に保持できる）。FREE DRESS UPモードでもそのまま
    // 使える状態設計。
    equipped: { hair: null, crown: null, dress: null, shoes: null },
    autoSpokenIndex: -1,
    // 現在Baseレイヤー（プレビューの主画像）に表示すべき画像。
    // hasAsset:trueのアイテムを選ぶまではベースのprincess.webpのまま。
    // 選んだ実画像は、発音練習・Great job・次のステージ・完成画面まで、
    // PLAY AGAINでリセットされるまでずっと維持する（要件「状態維持」）。
    activePortraitSrc: DRESSUP_BASE_IMAGE,
  };

  // 全身画像（hasAsset:true）が複数のカテゴリーで同時にequippedされた
  // ときに、どれか1枚だけをPrincess Preview全体に表示するための優先順位。
  // 「無理に合成せず、質の高い1枚をそのまま見せる」という方針の実装で、
  // 出題順(HAIR→CROWN→DRESS→SHOES)と揃えて「後の工程ほど優先」にしてある
  // （将来SHOESに全身画像が増えれば、SHOESが最優先で表示される）。
  const WHOLE_BODY_PRIORITY = ["shoes", "dress", "crown", "hair"];

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
      const done = !!dressup.equipped[catId];
      const active = catId === dressup.targetCatId && !done;
      badge.classList.toggle("is-done", done);
      badge.classList.toggle("is-active", active);
    });
  }

  /**
   * dressup.equipped の中から、独立透明レイヤー素材(layerPath)を持つ
   * アイテムだけを対応する dressup-layer-* へ反映する。今のところ
   * どのアイテムもlayerPathを持たないため、常に全レイヤーhiddenのまま
   * だが、将来layerPath付きの素材が追加されたカテゴリーから自動的に
   * ここで表示されるようになる（このロジックは変更不要）。
   */
  function applyIndependentLayers() {
    ["dress", "shoes", "hair", "crown"].forEach((slot) => {
      const el = layerEls[slot];
      if (!el) return;
      const item = dressup.equipped[slot];
      if (item && item.layerPath) {
        el.src = item.layerPath;
        el.hidden = false;
      } else {
        el.hidden = true;
        el.removeAttribute("src");
      }
    });
  }

  /**
   * dressup.equipped の中から、全身画像(hasAsset:true)を持つアイテムを
   * WHOLE_BODY_PRIORITYの優先順位で探し、Baseレイヤーに表示すべき画像を
   * 1枚決める。該当が無ければベースのprincess.webpのまま。
   */
  function pickWholeBodyPortraitSrc() {
    for (const catId of WHOLE_BODY_PRIORITY) {
      const item = dressup.equipped[catId];
      if (item && item.hasAsset && item.assetPath) return item.assetPath;
    }
    return DRESSUP_BASE_IMAGE;
  }

  /**
   * プリンセスのプレビューを、アニメーション無しで即座に現在の状態
   * （dressup.equipped全体）に同期する。ゲーム開始時／PLAY AGAIN時に使う。
   */
  function renderDressUpPreview() {
    applyIndependentLayers();
    dressup.activePortraitSrc = pickWholeBodyPortraitSrc();
    if (previewImgEl) previewImgEl.src = dressup.activePortraitSrc;
    renderLookBadges();
  }

  /**
   * プリンセスのプレビューを「魔法で変身した」ように見せながら、
   * 指定した画像に切り替える。横方向へのスライドはさせず、
   * ふわっとしたフェード＋わずかな縮小拡大（scale）だけで変化させる
   * （非対称スケールは使わない。CSS側の dressup-portrait-transform
   * keyframeがopacity/transformのみを使っているため、画像が歪む心配は無い）。
   * prefers-reduced-motionの場合はアニメーションなしで即座に切り替える。
   */
  function swapDressUpPreviewImage(newSrc) {
    dressup.activePortraitSrc = newSrc;
    if (!previewImgEl) return;

    if (prefersReducedMotion()) {
      previewImgEl.src = newSrc;
      return;
    }

    previewImgEl.classList.remove("dressup-portrait-transform");
    void previewImgEl.offsetWidth; // remove→addを確実に再トリガーするためのreflow
    previewImgEl.classList.add("dressup-portrait-transform");
    // keyframeの中間地点（フェードアウトし切ったタイミング）で実際のsrcを差し替える。
    setTimeout(() => {
      previewImgEl.src = newSrc;
    }, 160);
    setTimeout(() => {
      previewImgEl.classList.remove("dressup-portrait-transform");
    }, 420);
  }

  /**
   * 3択カードを描画する。thumbPath（頭〜髪型を切り出した実写サムネイル）が
   * あればそれを使い、無ければ「色スウォッチ＋絵文字」の仮カードにする。
   * 2〜5歳児が文字を読めなくても写真だけで「この髪型！」と選べるように、
   * サムネイルがある場合は絵文字を重ねない（写真そのものが答えのため）。
   */
  function renderDressUpChoices(category, target) {
    if (!choicesWrapEl) return;
    choicesWrapEl.innerHTML = "";
    const shuffled = shuffle(category.items);
    shuffled.forEach((item) => {
      const btn = document.createElement("button");
      btn.className = "dressup-option-card";
      btn.dataset.itemId = item.id;
      btn.setAttribute("aria-label", item.en);

      let swatch;
      if (item.thumbPath) {
        btn.classList.add("dressup-option-card-photo");
        swatch = document.createElement("img");
        swatch.className = "dressup-option-thumb";
        swatch.src = item.thumbPath;
        swatch.alt = item.en;
        swatch.draggable = false;
      } else {
        swatch = document.createElement("span");
        swatch.className = "dressup-option-swatch";
        swatch.style.background = item.swatch;
        swatch.textContent = item.icon || "";
      }

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
    dressup.equipped = { hair: null, crown: null, dress: null, shoes: null };
    dressup.awaitingPick = true;
    dressup.pendingItem = null;
    dressup.autoSpokenIndex = -1;
    // PLAY AGAIN時も含め、プリンセスの見た目を初期状態（ベース画像）に戻す。
    dressup.activePortraitSrc = DRESSUP_BASE_IMAGE;

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

    // このカテゴリーだけを「今これを着けている」に更新する。他カテゴリーの
    // equippedには一切触れない＝独立した着せ替え状態（要件「選択した
    // カテゴリー以外をリセットしないこと」）。
    dressup.equipped[dressup.targetCatId] = item;
    renderLookBadges();
    // 「今これを着けている」の金枠＋✓バッジをカードに付ける（次の問題へ
    // 切り替わるまでの短い間だけ表示される。FREE DRESS UPモードでは
    // 同じクラスをそのまま常時表示に使える設計）。
    cardEl.classList.add("dressup-option-equipped");

    // 独立透明レイヤー素材(layerPath)があれば対応するレイヤーへ反映する
    // （今のところどのアイテムも未設定なので実際には何も起きない）。
    applyIndependentLayers();

    // 全身画像(hasAsset:true)を持つアイテムがequipped中にあれば、
    // WHOLE_BODY_PRIORITYに従って1枚を選びPrincess Preview全体を
    // その見た目へ「変身」させる。横スライドはせず、ふわっとした
    // フェード＋scaleと、プレビュー自身の上に咲くsparkleで演出する。
    //
    // 【重要：Hair × Dressの組み合わせについて】
    // 現在のHAIR画像は「Purple Dress + 選んだ髪型」の全身portrait、
    // DRESS画像は「Long Hair + 選んだドレス色」の全身portraitであり、
    // どちらも“もう片方のカテゴリー込みの完成画像”しか無い（髪だけ・
    // ドレスだけの透明レイヤー素材ではない＝layerPath未設定）。そのため
    // 今の実装は「WHOLE_BODY_PRIORITY（shoes > dress > crown > hair）に
    // 従って1枚だけを portrait 全体として表示する」方式にしてある。
    // 現状DRESSがHAIRより優先されるため、実際には
    //   HAIRを選ぶ → Previewがその髪型のportraitに変身
    //   （CROWNは仮素材なので見た目は変わらず）
    //   DRESSを選ぶ → Previewがそのドレス色のportraitに変身
    //                 （＝見た目上は選んだ髪型が消え、Dress画像に
    //                   焼き込まれているLong Hairに戻って見える）
    // という挙動になる。dressup.equipped.hair 自体はそのままきちんと
    // 保持されており（Look Badgeの「HAIR達成」表示やスコアには影響
    // しない）、あくまで“今表示されている見た目”だけがDress優先になる、
    // という仕様上の制約。将来、髪だけ／ドレスだけの透明レイヤー素材
    // （同一base・同一座標）が揃った場合は、そのアイテムに
    // layerPath/layerSlotを設定するだけでWHOLE_BODY_PRIORITYより優先され
    // ず独立表示に切り替わる（コード変更不要。assets/dressup/README.md参照）。
    const nextWholeBodySrc = pickWholeBodyPortraitSrc();
    if (nextWholeBodySrc !== dressup.activePortraitSrc && previewImgEl) {
      const previewCenter = elementRelativeCenter(previewImgEl);
      spawnSparkleBurst(previewCenter.cx, previewCenter.cy, Math.max(previewCenter.width, previewCenter.height) * 0.5, {
        chars: ["✨", "⭐", "💫"],
        count: 8,
      });
      swapDressUpPreviewImage(nextWholeBodySrc);
    }

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

    if (speakPortraitEl) {
      speakPortraitEl.classList.remove("pe-mini-dance");
      // 発音練習カードのプリンセスも、選んだ見た目（activePortraitSrc）を維持する。
      speakPortraitEl.src = dressup.activePortraitSrc;
    }
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
    // 完成画面のプリンセスも、最後に選んだ見た目を維持して表示する。
    if (roundPortraitEl) roundPortraitEl.src = dressup.activePortraitSrc;

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
