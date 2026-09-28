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
 *   - 画像素材は現時点で HAIR（髪型）・DRESS（ドレス）・CROWN（かんむり）
 *     カテゴリーの実写素材が揃っている（assets/dressup/hair/、
 *     assets/dressup/dresses/、assets/dressup/crowns/）。SHOESはまだ無い
 *     ので、そこでは選択状態をプレビュー下のLook Badgesと選択肢カードの
 *     金枠+✓だけに反映する。
 *   - 【着せ替え状態：dressup.equipped】 hair/crown/dress/shoesは
 *     完全に独立した状態として dressup.equipped = {hair,crown,dress,shoes}
 *     に保持される。あるカテゴリーで正解しても、他カテゴリーの
 *     equippedは一切リセットされない（例：Ponytail + Flower Crown +
 *     Blue Dress + Purple Shoesを同時に「装着中」として保持できる）。
 *     これは将来、好きな順・好きな組み合わせで自由に着せ替えられる
 *     FREE DRESS UPモードを追加する際にも、このゲーム進行（固定順の
 *     クイズ）とは別に、そのまま流用できる状態設計にしてある。
 *   - 【見た目のレイヤー合成：dressup-layer-*、CROWNは本物の独立レイヤー】
 *     index.html側は base→dress→shoes→hair→crown→effectsの順に重ねる
 *     透明レイヤースタック（#dressup-portrait-layers内の各
 *     .dressup-layer）を前提にしたDOM構造になっている。CROWNは
 *     Gold/Flower/Purpleの3枚とも実際に item.layerPath
 *     （assets/dressup/crowns/*.webp）を持ち、#dressup-layer-crownへ
 *     単独で重ね描画される本物の独立レイヤー実装（hasAssetの「全身丸ごと
 *     上書き」とは異なり、正解タップのたびにCrownだけが交換される）。
 *     HAIR/DRESS/SHOESはまだ全身画像(hasAsset)のみでlayerPath未設定。
 *   - 【重要な既知の制約：HAIRの全身画像とCrownレイヤーの優先表示】
 *     DRESSは2回目のリクエストでCrownなしの素材（Pink/Blue/Yellow、
 *     assets/dressup/dresses/*.webp）に差し替え済みのため、DRESSと
 *     CROWNは完全に独立して同時成立する（Dressを変えてもCrownは消えず、
 *     Crownを変えてもDressは変わらない）。一方HAIRの画像（Purple Dress
 *     +Gold Crown固定の全身portrait）は元から王冠が焼き込まれた
 *     ままなので、HAIRの全身画像がPreviewに表示されている間
 *     （＝まだDRESSを選んでいない間）は、二重王冠を避けるため
 *     Crownレイヤーを必ず非表示にする。これは各アイテムの
 *     `crownBaked`フラグ（trueならCrown同時表示を禁止）による
 *     データ駆動の判定で、WHOLE_BODY_PRIORITY（shoes > dress > hair）
 *     で選ばれた全身画像のcrownBakedを見るだけで済むようにしてある。
 *     dressup.equipped.crown/hair自体はきちんと保持されたままなので、
 *     Look Badge／選択肢カードの金枠+✓には正しく反映され続ける。
 *     詳細と将来の完全解消への移行方針（Crownなし版Hair素材が必要）は
 *     assets/dressup/README.md、および computeDressupVisual /
 *     handleDressUpChoiceTap内のコメントを参照。
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
   *              （HAIRで使用。CROWNはかんむり画像そのものをthumbPathに
   *              使う。DRESSは色スウォッチのままの方がPink/Blue/Yellowの
   *              違いが一目でわかるため、意図的にthumbPathを付けていない）
   *   layerPath  髪だけ／ドレスだけ／かんむりだけ等を切り抜いた独立透明
   *              レイヤー素材のパス。CROWNの3アイテムはすべて設定済み
   *              （assets/dressup/crowns/*.webp）。設定されたアイテムは
   *              対応するdressup-layer-*へ単独で重ね描画される（hasAsset
   *              方式の「全身丸ごと上書き」とは併用しない）。HAIR/DRESS/
   *              SHOESはまだ未設定（全身画像のみ）。
   *   crownStyle CROWNのlayerPathアイテムのみ使用。#dressup-layer-crownに
   *              適用するtop/left/width（Base Princessの頭部にPlaywright
   *              スクリーンショットで目視確認しながら個別調整した値）。
   *              Gold/Flower/Purpleで形が違うため、共通の数値を無理に
   *              共有していない。
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
          // この全身画像には元からGold Crown相当が焼き込まれている。
          // Crownレイヤーと同時表示すると二重王冠になるため、この画像が
          // Baseレイヤーに表示されている間はCrownレイヤーを必ず隠す
          // （computeDressupVisual参照）。
          crownBaked: true,
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
          crownBaked: true,
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
          crownBaked: true,
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
          layerPath: "assets/dressup/crowns/gold.webp",
          thumbPath: "assets/dressup/crowns/gold.webp",
          // #dressup-layer-crown へ適用するCSS位置。Baseレイヤーに表示中の
          // 画像（bodyKey: base/pink/blue/yellow）ごとに頭の位置が微妙に
          // 違うため、bodyKeyごとに個別値を持つ（Playwrightスクリーン
          // ショットで目視確認・調整済み。pink/blue/yellowはbaseと
          // ほぼ同じポーズだったため実質同値で問題なかった）。
          crownStyle: {
            base: { top: "3.6%", left: "37.3%", width: "26%" },
            pink: { top: "3.6%", left: "37.3%", width: "26%" },
            blue: { top: "3.6%", left: "37.3%", width: "26%" },
            yellow: { top: "3.6%", left: "37.3%", width: "26%" },
          },
        },
        {
          id: "flower",
          en: "Flower Crown",
          speakWord: "Flower",
          jp: "はなの かんむりは どれ？",
          swatch: "#FF8FB1",
          icon: "🌸",
          layerPath: "assets/dressup/crowns/flower.webp",
          thumbPath: "assets/dressup/crowns/flower.webp",
          crownStyle: {
            base: { top: "3.8%", left: "35.5%", width: "29.5%" },
            pink: { top: "3.8%", left: "35.5%", width: "29.5%" },
            blue: { top: "3.8%", left: "35.5%", width: "29.5%" },
            yellow: { top: "3.8%", left: "35.5%", width: "29.5%" },
          },
        },
        {
          id: "purple",
          en: "Purple Crown",
          speakWord: "Purple",
          jp: "むらさきの かんむりは どれ？",
          swatch: "#B18BFF",
          icon: "👑",
          layerPath: "assets/dressup/crowns/purple.webp",
          thumbPath: "assets/dressup/crowns/purple.webp",
          crownStyle: {
            base: { top: "3.2%", left: "37.6%", width: "25.3%" },
            pink: { top: "3.2%", left: "37.6%", width: "25.3%" },
            blue: { top: "3.2%", left: "37.6%", width: "25.3%" },
            yellow: { top: "3.2%", left: "37.6%", width: "25.3%" },
          },
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
          // この全身画像はCrownなしで作り直した素材（2回目のリクエストで
          // 差し替え）。crownBakedを付けないことで、DRESS表示中も
          // Crownレイヤーを独立して重ねられる（二重王冠にならない）。
          bodyKey: "pink",
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
          bodyKey: "blue",
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
          bodyKey: "yellow",
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
  // 「ベース画像」を分けて持っておく。CrownなしのBase Princess
  // （assets/dressup/base/base.webp）を使うことで、CROWNレイヤーを
  // 重ねても既存のGold Crownと二重表示にならないようにしてある
  // （旧assets/princess.webpには元からGold Crownが焼き込まれているため
  // Dress Up専用でこちらに差し替えた。他ゲーム画面のprincess.webpは
  // 変更していない）。
  const DRESSUP_BASE_IMAGE = "assets/dressup/base/base.webp";
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
  };
  // Crownは「今どのポートレートが画面に見えているか」に関わらず常に同じ
  // 見た目を保つ必要があるため（発音練習カード・完成カードでも外れて
  // 見えてはいけない）、メインプレビュー／発音練習／完成の3枚すべての
  // Crownレイヤー<img>をまとめて同期する。
  const crownLayerEls = [
    document.getElementById("dressup-layer-crown"),
    document.getElementById("dressup-speak-crown"),
    document.getElementById("dressup-round-crown"),
  ].filter(Boolean);
  const fxLayerEl = document.getElementById("dressup-fx-layer");
  const badgesWrapEl = document.getElementById("dressup-look-badges");
  const choicesWrapEl = document.getElementById("dressup-choices");

  const speakOverlayEl = document.getElementById("dressup-speak-overlay");
  const speakPortraitEl = document.getElementById("dressup-speak-portrait");
  const speakCrownEl = document.getElementById("dressup-speak-crown");
  const speakWordEl = document.getElementById("dressup-speak-word");
  const micIconEl = document.getElementById("dressup-mic-icon");
  const micRingEl = document.getElementById("dressup-mic-ring");
  const micStatusEl = document.getElementById("dressup-mic-status");
  const hearExampleBtn = document.getElementById("dressup-hear-example-btn");
  const skipBtn = document.getElementById("dressup-skip-btn");

  const completeEl = document.getElementById("dressup-complete");
  const youLookEl = document.getElementById("dressup-you-did-it");
  const roundPortraitEl = document.getElementById("dressup-round-portrait");
  const roundCrownEl = document.getElementById("dressup-round-crown");
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
  // ときに、どれか1枚だけをPrincess Preview全体（Baseレイヤー）に表示する
  // ための優先順位。「無理に合成せず、質の高い1枚をそのまま見せる」という
  // 方針の実装で、出題順(HAIR→CROWN→DRESS→SHOES)と揃えて「後の工程ほど
  // 優先」にしてある（将来SHOESに全身画像が増えれば、SHOESが最優先で
  // 表示される）。CROWNはここには含まれない：CROWNは独立透明レイヤー
  // （layerPath）で実装されているため、全身画像の優先順位とは別ロジック
  // （下のcomputeDressupVisual）で扱う。
  const WHOLE_BODY_PRIORITY = ["shoes", "dress", "hair"];

  /**
   * 現在のdressup.equippedから、実際に描画すべき見た目を1つ計算する。
   * 戻り値: { bodySrc, showCrownLayer, crownItem, bodyKey }
   *
   *   bodySrc         Baseレイヤー（#dressup-preview-img）に表示する画像。
   *   showCrownLayer  #dressup-layer-crownを表示してよいかどうか。
   *   crownItem       showCrownLayerがtrueのとき、表示すべきCrownアイテム。
   *   bodyKey         今表示しているbodySrcの種類（"base"/"pink"/"blue"/
   *                   "yellow"）。Crownの頭位置(crownStyle)はbodySrcごとに
   *                   微妙に違うため、applyCrownLayerがこれを見て
   *                   crownItem.crownStyle[bodyKey]を選ぶ。
   *
   * 【判定ロジックと「二重王冠」対策（データ駆動）】
   * SHOES/DRESSの全身画像（hasAsset:true、HAIRは除く）が選ばれている
   * 場合は最優先で表示する。その画像がitem.crownBaked===trueなら
   * （＝元から王冠が焼き込まれた画像、現在はHAIRの3枚のみ。ただしHAIRは
   * このSHOES/DRESSチェックには含めず、常に3番目の分岐で扱う）、Crown
   * レイヤーを重ねると二重王冠になるため必ず非表示にする（ご指示の
   * 「二重王冠は絶対禁止」を最優先）。crownBakedが付いていない全身画像
   * （現在はDRESSのPink/Blue/Yellow。2回目のリクエストでCrownなし素材に
   * 差し替え済み）は、Crownレイヤーと安全に共存できるため、
   * equipped.crownがあればそのまま独立レイヤーとして重ねる＝
   * 「Dress×Crownが同時に成立する」。
   * SHOES/DRESSが未選択でCROWNが選ばれていれば、CrownなしのBase
   * Princess（assets/dressup/base/base.webp）をBaseレイヤーに表示し、
   * その上に選んだCrownレイヤーを重ねる（＝まだHAIRの全身画像しか無い
   * 状態より、CROWNが選ばれていることを優先する）。
   * CROWNも未選択でHAIRの全身画像があればそれを表示する（Crownが
   * 選ばれるまでの、これまでと同じ見た目を維持するための分岐）。
   * 何も選ばれていなければBase Princessのまま。
   *
   * 優先順位まとめ：SHOES/DRESS(crownBaked時はCrown強制非表示) >
   * CROWN(Base Princess+Crownレイヤー) > HAIR(crown常に非表示) > 無地。
   *
   * 【既知の制約（HAIRのみ残存）】HAIRの全身画像がBaseレイヤーに
   * 表示されている間（＝まだDRESS/CROWNを選んでいない状態）は、上記の
   * 通りCrownレイヤーが非表示になる（dressup.equipped.crown自体は
   * 保持されたまま。Look Badge/選択肢カードの金枠には影響しない）。
   * これはHAIR画像に元から別の王冠が焼き込まれており、二重王冠を避ける
   * には「Crownなし版のHair全身画像」が別途必要なため。詳細はREADME参照。
   */
  function computeDressupVisual() {
    const crownItem = dressup.equipped.crown;
    const hasCrown = !!(crownItem && crownItem.layerPath);

    // 1. SHOES/DRESSの全身画像(hair以外)を優先順位順にチェックする。
    //    hairはここでは意図的にスキップする＝下のCROWN判定より優先度を
    //    下げるため（CROWNが選ばれていれば、単に選ばれているだけのHAIRの
    //    全身画像より優先してBase Princess+Crownを見せたい）。
    for (const catId of WHOLE_BODY_PRIORITY) {
      if (catId === "hair") continue;
      const item = dressup.equipped[catId];
      if (item && item.hasAsset && item.assetPath) {
        if (item.crownBaked) {
          // 二重王冠防止：この全身画像には既に王冠が焼き込まれているため
          // Crownレイヤーは必ず非表示にする。
          return { bodySrc: item.assetPath, showCrownLayer: false, crownItem: null, bodyKey: null };
        }
        // crownBakedが付いていない全身画像（Pink/Blue/Yellow Dress）は
        // Crownレイヤーと安全に共存できる。
        return {
          bodySrc: item.assetPath,
          showCrownLayer: hasCrown,
          crownItem: hasCrown ? crownItem : null,
          bodyKey: item.bodyKey || "base",
        };
      }
    }

    // 2. SHOES/DRESSが未選択でCROWNが選ばれていれば、CrownなしのBase
    //    Princessの上にCrownレイヤーを重ねる（まだHAIRの全身画像しか
    //    無い状態より、こちらを優先する）。
    if (hasCrown) {
      return { bodySrc: DRESSUP_BASE_IMAGE, showCrownLayer: true, crownItem, bodyKey: "base" };
    }

    // 3. CROWNも未選択でHAIRの全身画像があればそれを表示する（Crownが
    //    選ばれるまでの、これまでと同じ見た目を維持するための分岐。
    //    HAIR画像は常にcrownBaked扱いなのでCrownレイヤーは表示しない）。
    const hairItem = dressup.equipped.hair;
    if (hairItem && hairItem.hasAsset && hairItem.assetPath) {
      return { bodySrc: hairItem.assetPath, showCrownLayer: false, crownItem: null, bodyKey: null };
    }

    return { bodySrc: DRESSUP_BASE_IMAGE, showCrownLayer: false, crownItem: null, bodyKey: "base" };
  }

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
   * dress/shoes/hairの各独立透明レイヤー(layerPath)を反映する。今のところ
   * どのアイテムもlayerPathを持たないため、常に非表示のまま（将来素材が
   * 追加されたカテゴリーから自動的にここで表示されるようになる）。
   * CROWNは二重王冠を避けるための専用ロジック(applyCrownLayer)が別にある
   * ため、ここでは扱わない。
   */
  function applyIndependentLayers() {
    ["dress", "shoes", "hair"].forEach((slot) => {
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
   * メインプレビュー／発音練習／完成の3枚すべてのCrownレイヤー<img>を、
   * computeDressupVisual()の結果に合わせて同期する（「発音画面に進んでも
   * Crownを外さないこと」「DRESSを変えてもCrownを外さないこと」という
   * 要件のため、3枚とも常に同じ見た目に保つ）。
   * 表示する場合は、そのCrownアイテムのcrownStyle（頭の位置に合わせて
   * 個別調整したtop/left/width）を毎回適用し直す。crownStyleは
   * bodyKey（今Baseレイヤーに表示中の画像の種類："base"/"pink"/"blue"/
   * "yellow"）ごとの値を持つオブジェクトになっており、Dress画像ごとに
   * 微妙に違う頭の位置に合わせて個別に選ばれる（見つからない場合は
   * baseの値にフォールバック）。Crownごとに形もサイズも違うため、
   * 共通のCSS数値を無理に共有しない。
   * playPop=trueのとき、装着/交換の瞬間の「魔法でポンッ」演出
   * （dressup-crown-pop、0.3秒・opacity+均一scaleのみ）を発火する。
   */
  function applyCrownLayer(visual, playPop) {
    crownLayerEls.forEach((el) => {
      if (visual.showCrownLayer && visual.crownItem && visual.crownItem.layerPath) {
        const styleMap = visual.crownItem.crownStyle || {};
        const style = styleMap[visual.bodyKey] || styleMap.base || {};
        el.style.top = style.top || "4%";
        el.style.left = style.left || "37%";
        el.style.width = style.width || "26%";
        el.src = visual.crownItem.layerPath;
        el.hidden = false;
        if (playPop && !prefersReducedMotion()) {
          el.classList.remove("dressup-crown-pop");
          void el.offsetWidth; // remove→addを確実に再トリガーするためのreflow
          el.classList.add("dressup-crown-pop");
        }
      } else {
        el.hidden = true;
        el.classList.remove("dressup-crown-pop");
        el.removeAttribute("src");
      }
    });
  }

  /**
   * プリンセスのプレビューを、アニメーション無しで即座に現在の状態
   * （dressup.equipped全体）に同期する。ゲーム開始時／PLAY AGAIN時に使う。
   */
  function renderDressUpPreview() {
    applyIndependentLayers();
    const visual = computeDressupVisual();
    dressup.activePortraitSrc = visual.bodySrc;
    if (previewImgEl) previewImgEl.src = visual.bodySrc;
    applyCrownLayer(visual, false);
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

    // Crownレイヤーが「タップした瞬間だけポンッと装着演出する」ために、
    // equippedを更新する前の状態を覚えておく（何も変わっていないのに
    // 演出を再生しないようにするため）。
    const prevVisual = computeDressupVisual();

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
    // （dress/shoes/hairは今のところどのアイテムも未設定なので実際には
    // 何も起きない。CROWNはapplyCrownLayerで別途扱う）。
    applyIndependentLayers();

    // 全身画像(hasAsset:true)を持つアイテムがequipped中にあれば、
    // WHOLE_BODY_PRIORITYに従って1枚を選びPrincess Preview（Baseレイヤー）
    // をその見た目へ「変身」させる。横スライドはせず、ふわっとした
    // フェード＋scaleと、プレビュー自身の上に咲くsparkleで演出する。
    //
    // 【重要：Hair × Dressの組み合わせについて】
    // 現在のHAIR画像は「Purple Dress + Gold Crown + 選んだ髪型」の全身
    // portraitであり、髪だけの透明レイヤー素材ではない（layerPath未設定）。
    // 一方DRESS画像（Pink/Blue/Yellow）は2回目のリクエストでCrownなし素材
    // に差し替え済みで、Hairは含まれていない（Long Hair固定ですらない、
    // Crownと同様に独立ではないだけ）。そのため今の実装は
    // 「WHOLE_BODY_PRIORITY（shoes > dress > hair）に従って1枚だけを
    // portrait全体として表示する」方式のまま。現状DRESSがHAIRより優先
    // されるため、実際には
    //   HAIRを選ぶ → Previewがその髪型のportrait（Gold Crown込み）に変身
    //   DRESSを選ぶ → Previewがそのドレス色のportrait（Crownなし）に変身
    //                 （＝見た目上は選んだ髪型が消える。ただしCrownは
    //                   下記の通りDRESS画像がCrownなしになったため
    //                   引き続き独立レイヤーとして重なり続ける）
    // という挙動になる。dressup.equipped.hair 自体はそのままきちんと
    // 保持されており（Look Badgeの「HAIR達成」表示やスコアには影響
    // しない）、あくまで“今表示されている見た目”だけがDress優先になる、
    // という仕様上の制約。将来、髪だけの透明レイヤー素材（同一base・
    // 同一座標）が揃った場合は、そのアイテムにlayerPath/layerSlotを
    // 設定するだけでWHOLE_BODY_PRIORITYより優先されず独立表示に切り替わる
    // （コード変更不要。assets/dressup/README.md参照）。
    const nextVisual = computeDressupVisual();
    if (nextVisual.bodySrc !== dressup.activePortraitSrc && previewImgEl) {
      const previewCenter = elementRelativeCenter(previewImgEl);
      spawnSparkleBurst(previewCenter.cx, previewCenter.cy, Math.max(previewCenter.width, previewCenter.height) * 0.5, {
        chars: ["✨", "⭐", "💫"],
        count: 8,
      });
      swapDressUpPreviewImage(nextVisual.bodySrc);
    }

    // CROWNレイヤーの反映。【重要：二重王冠の防止（データ駆動）】
    // 今Baseレイヤーに表示されている全身画像がitem.crownBaked===trueの
    // 場合のみ（現在はHAIRの3枚のみ）、Crownレイヤーを必ず非表示にする
    // （computeDressupVisual内でshowCrownLayer:falseとして保証している。
    // ご指示の「絶対に二重王冠にしない」を最優先している）。DRESS
    // （Pink/Blue/Yellow）は2回目のリクエストでCrownなし素材に差し替え
    // 済みのためcrownBakedを持たず、equipped.crownがあればDRESS表示中も
    // Crownレイヤーがそのまま独立して重なり続ける（＝Dress×Crownが
    // 同時に成立し、Dressを変えてもCrownは消えない）。HAIRを選んだ瞬間
    // （まだDRESS未選択の間）だけ、直前まで見えていたCrownは見た目上
    // 消える（dressup.equipped.crown自体は保持され、Look Badge/選択肢
    // カードの金枠には影響しない）。Crownを選んだ瞬間・別のCrownに交換
    // した瞬間だけ、「魔法でポンッ」の装着演出（dressup-crown-pop）を
    // 発火する（Dressだけを変えてCrown自体は変わっていない場合は
    // ポップインを再生しない＝「Crownを変えてもDressは変えない、逆も
    // 同様」という要件どおり、それぞれの変化だけを独立して演出する）。
    const crownVisibleChanged =
      nextVisual.showCrownLayer &&
      (!prevVisual.showCrownLayer || !prevVisual.crownItem || prevVisual.crownItem.id !== nextVisual.crownItem.id);
    applyCrownLayer(nextVisual, crownVisibleChanged);

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
      if (speakCrownEl) speakCrownEl.classList.remove("pe-mini-dance");
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
      // Crownレイヤーも同じダンスで一緒に揺れるようにする（頭だけ動いて
      // Crownが置いてけぼりにならないように、同じキーフレームを適用）。
      if (speakCrownEl) {
        speakCrownEl.classList.remove("pe-mini-dance");
        void speakCrownEl.offsetWidth;
        speakCrownEl.classList.add("pe-mini-dance");
        setTimeout(() => speakCrownEl.classList.remove("pe-mini-dance"), 900);
      }
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
      // Crownレイヤーも同じSPECIAL DANCEで一緒に揺れるようにする。
      if (roundCrownEl) {
        roundCrownEl.classList.remove("pe-special-dance");
        void roundCrownEl.offsetWidth;
        roundCrownEl.classList.add("pe-special-dance");
      }
      spawnCompleteCelebrationParticles();
    } else {
      spawnCompleteCelebrationParticles({ staticOnly: true });
    }

    setTimeout(() => {
      if (roundPortraitEl) roundPortraitEl.classList.remove("pe-special-dance");
      if (roundCrownEl) roundCrownEl.classList.remove("pe-special-dance");
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

  /**
   * 【テスト専用フック】window.__dressupDebug
   * 現在のクイズは固定順(HAIR→CROWN→DRESS→SHOES)で1カテゴリーにつき1問しか
   * 出題されないため、「DRESSを選び終えた後に、別のCrownへ架け替える」
   * （＝将来のFREE DRESS UPモードで起きる操作）は、実際のカード操作だけでは
   * 再現できない。dressup.equippedを直接書き換えてrenderDressUpPreview()を
   * 再実行するだけの薄いテスト用フックをここに公開し、Playwrightから
   * 「Dressを変えてもCrownは消えない／Crownを変えてもDressは変わらない」
   * という中核要件を、実際のレンダリング関数(computeDressupVisual /
   * applyCrownLayer)を通して直接検証できるようにする。ゲーム画面のUIや
   * ボタンからは一切呼ばれない、副作用のない検証専用のAPI。
   */
  window.__dressupDebug = {
    equip: function (catId, itemId) {
      const category = findCategory(catId);
      if (!category) return false;
      const item = category.items.find((i) => i.id === itemId);
      if (!item) return false;
      dressup.equipped[catId] = item;
      renderDressUpPreview();
      return true;
    },
    getEquipped: function () {
      const out = {};
      Object.keys(dressup.equipped).forEach((k) => {
        out[k] = dressup.equipped[k] ? dressup.equipped[k].id : null;
      });
      return out;
    },
  };
})();
