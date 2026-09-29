"use strict";

/**
 * MAGIC ARROWS（非言語のタップパズルゲーム / Arrow Escape方式 / STAGE制）
 * ---------------------------------------------------------------------
 * 英語学習・発音練習（speech.js / SpeechRecognition / SpeechSynthesis）とは
 * 完全に独立したミニゲーム。文字が読めなくても、説明文を読まなくても
 * 100%遊べることを目標に設計している。
 *
 * ルール（Arrow Escape系）：
 *   盤面には「1本の長い折れ曲がった線」そのものがArrowとして複数置かれている。
 *   終点には大きく明確なarrowhead(▶◀▲▼相当)が付いており、どちらへ進む線かが
 *   一目で分かる。Arrowをタップすると、そのArrow全体（形は絶対に変形しない・
 *   剛体）が自分の出口方向(exitDirection)へ向かって平行移動する。
 *     - 他のArrowに一切触れずに盤面の外まで出られるなら → そのまま画面外へ
 *       消える（exit成功）。
 *     - 途中で他のArrowに触れる場合 → 触れる位置まで進み、コツンと当たって
 *       LIFEを1つ減らし、元の位置へ戻る（collide）。
 *   衝突判定は「Arrow全体 × 他Arrow全体」を、線の太さを含めて全line segment
 *   同士で行う（先端だけを見る判定は禁止）。
 *
 * STAGE制：
 *   LEVEL 1 = STAGE 1〜10 / LEVEL 2 = STAGE 11〜20 / LEVEL 3 = STAGE 21〜30、
 *   というようにSTAGEを10個ずつまとめてLEVELとして表示する
 *   （level = Math.ceil(stage / STAGES_PER_LEVEL)）。盤面データは
 *   magic-arrow-levels.js の MAGIC_ARROW_STAGES 配列（{stage,level,boardSize,
 *   arrows}の配列）から取得する。将来STAGE100まで拡張する場合は、この配列へ
 *   要素を追記するだけでよく、magic-arrows.js側のロジックは一切変更不要
 *   （MAX_STAGE/LEVEL数はすべてMAGIC_ARROW_STAGES.lengthから自動算出される）。
 *
 * 進捗保存：
 *   localStorageへ highestUnlockedStage を保存する。STAGE 1のみ最初から解放
 *   されており、STAGE Nをクリアすると STAGE N+1 が解放される。データ破損時は
 *   安全にSTAGE1のみ解放の状態へフォールバックする。
 *
 * ファイル構成の方針（盤面データ→判定ロジック→renderの分離）：
 *   1) ロジック層：segmentsOfArrow/sweepGap/computeTravel/canArrowExit/
 *      findAvailableMoves/isSolvable/solveBoard/hasInitialOverlap/
 *      validateExitDirections は純粋関数（DOM非依存）。Node上でも直接
 *      requireしてユニットテストできる（全STAGEのsolver検証で使用）。
 *   2) 盤面データ層：magic-arrow-levels.js の MAGIC_ARROW_STAGES。
 *   3) ゲーム状態：module-scopeの `game` オブジェクト1つだけが状態を持つ。
 *   4) render層：renderBoard/updateLivesDisplay/renderStageSelect等がDOMを
 *      更新する。盤面はSVGで描画し、1 Arrow = 1 SVG <g class="ma-polyline-arrow">
 *      （visible line + arrowhead polygon + hit area）。
 *
 * 「必ず解ける盤面」の保証について：
 *   このパズルには「今動かせるArrowをどれか1つ取り除いても、他のArrowが
 *   新たに動かせなくなることは絶対に無い」という合流性(confluence)が
 *   polyline方式でも成り立つ。そのため isSolvable() は「今動かせるArrowを
 *   1つ選んで取り除く」をArrowが無くなるまで貪欲に繰り返すだけで判定でき、
 *   これは「MAGIC_ARROW_STAGESの全STAGEは、プレイヤーが実際にどんな順番で
 *   タップしても絶対に詰まない」ことも同時に保証する。全STAGEはビルド時に
 *   このsolverで検証済み（scratchpadのstage_generator2.js参照。手作りpreset
 *   ＋solver検証というspecの方針に沿い、実行時のランダム生成は行わない）。
 */
(function () {
  /* ===================== ロジック層（DOM非依存・純粋関数） ===================== */

  const THICKNESS = 0.58; // 衝突判定用の太さ(グリッド単位)。1マス=1。

  const DIR_VEC = {
    up: { ux: 0, uy: -1 },
    down: { ux: 0, uy: 1 },
    left: { ux: -1, uy: 0 },
    right: { ux: 1, uy: 0 },
  };

  function rectForSegment(p1, p2, thickness) {
    const half = (thickness != null ? thickness : THICKNESS) / 2;
    return {
      x1: Math.min(p1.x, p2.x) - half,
      x2: Math.max(p1.x, p2.x) + half,
      y1: Math.min(p1.y, p2.y) - half,
      y2: Math.max(p1.y, p2.y) + half,
    };
  }

  function segmentsOfArrow(arrow, thickness) {
    const segs = [];
    for (let i = 0; i < arrow.points.length - 1; i++) {
      segs.push(rectForSegment(arrow.points[i], arrow.points[i + 1], thickness));
    }
    return segs;
  }

  /** rectAをux,uy方向へ動かしたときrectBへ触れるまでの距離。触れ得ないならnull。 */
  function sweepGap(rectA, rectB, ux, uy) {
    if (ux !== 0) {
      if (rectA.y2 <= rectB.y1 || rectA.y1 >= rectB.y2) return null;
      if (ux > 0) {
        if (rectB.x1 >= rectA.x2) return rectB.x1 - rectA.x2;
        return null;
      }
      if (rectB.x2 <= rectA.x1) return rectA.x1 - rectB.x2;
      return null;
    }
    if (rectA.x2 <= rectB.x1 || rectA.x1 >= rectB.x2) return null;
    if (uy > 0) {
      if (rectB.y1 >= rectA.y2) return rectB.y1 - rectA.y2;
      return null;
    }
    if (rectB.y2 <= rectA.y1) return rectA.y1 - rectB.y2;
    return null;
  }

  /** そのArrowが盤面の外まで完全に抜けきるのに必要な移動距離。 */
  function exitDistance(arrow, boardSize, dirVec) {
    const segs = segmentsOfArrow(arrow);
    if (dirVec.ux > 0) return boardSize - Math.min(...segs.map((s) => s.x1));
    if (dirVec.ux < 0) return Math.max(...segs.map((s) => s.x2));
    if (dirVec.uy > 0) return boardSize - Math.min(...segs.map((s) => s.y1));
    return Math.max(...segs.map((s) => s.y2));
  }

  /**
   * arrowをexitDirectionへ動かしたときの結果を計算する。
   * 「先端だけ」ではなく、arrowの全segmentと他Arrowの全segmentの組み合わせを
   * 太さ込みで判定する（L字の胴体・コの字の横棒などが衝突源になり得る）。
   */
  function computeTravel(arrow, allArrows, boardSize) {
    const dirVec = DIR_VEC[arrow.exitDirection];
    const segsA = segmentsOfArrow(arrow);
    const dExit = exitDistance(arrow, boardSize, dirVec);
    let minBlock = Infinity;
    let blockerId = null;
    for (const other of allArrows) {
      if (other.id === arrow.id || other.state === "removed") continue;
      const segsB = segmentsOfArrow(other);
      for (const ra of segsA) {
        for (const rb of segsB) {
          const g = sweepGap(ra, rb, dirVec.ux, dirVec.uy);
          if (g !== null && g < minBlock) {
            minBlock = g;
            blockerId = other.id;
          }
        }
      }
    }
    if (minBlock >= dExit - 1e-9) {
      return { blocked: false, distance: dExit, dirVec, blockerId: null };
    }
    return { blocked: true, distance: Math.max(minBlock, 0), dirVec, blockerId };
  }

  function canArrowExit(arrow, allArrows, boardSize) {
    return !computeTravel(arrow, allArrows, boardSize).blocked;
  }

  function findAvailableMoves(arrows, boardSize) {
    const active = arrows.filter((a) => a.state === "active");
    return active.filter((a) => canArrowExit(a, active, boardSize));
  }

  /**
   * 貪欲solver：動かせるArrowを1つ選んで取り除く、を繰り返して全て消せるか判定する。
   * 合流性（このパズルでは除去が新たなブロックを生まない）により、
   * バックトラック無しのこの単純な貪欲法で判定として十分かつ正しい。
   */
  function isSolvable(arrows, boardSize) {
    let remaining = arrows
      .filter((a) => a.state === "active")
      .map((a) => ({ id: a.id, points: a.points, exitDirection: a.exitDirection, state: "active" }));
    while (remaining.length > 0) {
      const idx = remaining.findIndex((a) => canArrowExit(a, remaining, boardSize));
      if (idx === -1) return false;
      remaining.splice(idx, 1);
    }
    return true;
  }

  /** solver：実際に取り除く順序（idの配列）を1つ返す。テスト/デバッグ用。 */
  function solveBoard(arrows, boardSize) {
    let remaining = arrows
      .filter((a) => a.state === "active")
      .map((a) => ({ id: a.id, points: a.points, exitDirection: a.exitDirection, state: "active" }));
    const order = [];
    while (remaining.length > 0) {
      const idx = remaining.findIndex((a) => canArrowExit(a, remaining, boardSize));
      if (idx === -1) return null;
      order.push(remaining[idx].id);
      remaining.splice(idx, 1);
    }
    return order;
  }

  /** 初期配置で他のArrowと重なっていないか(実際に置けるか)を確認する。盤面検証専用。 */
  function rectsOverlap(a, b) {
    return !(a.x2 <= b.x1 || a.x1 >= b.x2 || a.y2 <= b.y1 || a.y1 >= b.y2);
  }
  function hasInitialOverlap(arrows) {
    for (let i = 0; i < arrows.length; i++) {
      const segsI = segmentsOfArrow(arrows[i]);
      for (let j = i + 1; j < arrows.length; j++) {
        const segsJ = segmentsOfArrow(arrows[j]);
        for (const ra of segsI) {
          for (const rb of segsJ) {
            if (rectsOverlap(ra, rb)) return { a: arrows[i].id, b: arrows[j].id };
          }
        }
      }
    }
    return null;
  }

  /** 各Arrowの最終segmentの向きがexitDirectionと一致しているかを確認する。盤面検証専用。 */
  function validateExitDirections(arrows) {
    for (const a of arrows) {
      const n = a.points.length;
      if (n < 2) return { id: a.id, error: "points.length < 2" };
      const p1 = a.points[n - 2];
      const p2 = a.points[n - 1];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      let actual = null;
      if (dx > 0 && dy === 0) actual = "right";
      else if (dx < 0 && dy === 0) actual = "left";
      else if (dy > 0 && dx === 0) actual = "down";
      else if (dy < 0 && dx === 0) actual = "up";
      if (actual !== a.exitDirection) return { id: a.id, error: "last segment dir=" + actual + " != exitDirection=" + a.exitDirection };
      for (let i = 0; i < n - 1; i++) {
        const q1 = a.points[i];
        const q2 = a.points[i + 1];
        if (q1.x !== q2.x && q1.y !== q2.y) return { id: a.id, error: "segment " + i + " is not axis-aligned" };
        if (q1.x === q2.x && q1.y === q2.y) return { id: a.id, error: "segment " + i + " has zero length" };
      }
    }
    return null;
  }

  /* ===================== 盤面データ層（STAGE 1〜30。将来STAGE100まで拡張可） ===================== */

  const STAGES_PER_LEVEL = 10;

  /* Node環境(require)とブラウザ環境(<script>順読み込みでwindow.MAGIC_ARROW_STAGES)の
     両方からMAGIC_ARROW_STAGESを取得する。 */
  const MAGIC_ARROW_STAGES =
    typeof module !== "undefined" && module.exports
      ? require("./magic-arrow-levels.js")
      : typeof window !== "undefined" && window.MAGIC_ARROW_STAGES
      ? window.MAGIC_ARROW_STAGES
      : [];

  const MAX_STAGE = MAGIC_ARROW_STAGES.length;
  const MAX_LEVEL = MAX_STAGE > 0 ? Math.ceil(MAX_STAGE / STAGES_PER_LEVEL) : 0;
  const START_LIVES = 3;

  function stageToLevel(stageNum) {
    return Math.ceil(stageNum / STAGES_PER_LEVEL);
  }

  function stagesInLevel(levelNum) {
    const start = (levelNum - 1) * STAGES_PER_LEVEL + 1;
    const end = Math.min(levelNum * STAGES_PER_LEVEL, MAX_STAGE);
    const list = [];
    for (let s = start; s <= end; s++) list.push(s);
    return list;
  }

  function getStageEntry(stageNum) {
    return MAGIC_ARROW_STAGES.find((s) => s.stage === stageNum) || null;
  }

  /** {points,exitDirection,color,state:"active"}配列を独立コピーする(参照共有を断つ)。 */
  function deepCloneArrows(arrows) {
    return arrows.map((a) => ({
      id: a.id,
      points: a.points.map((p) => ({ x: p.x, y: p.y })),
      exitDirection: a.exitDirection,
      color: a.color,
      state: "active",
    }));
  }

  /** このSTAGEの固定盤面データを独立コピーして返す（ランダム生成はしない）。 */
  function getStageBoard(stageNum) {
    const entry = getStageEntry(stageNum);
    if (!entry) return null;
    return { stage: entry.stage, level: entry.level, boardSize: entry.boardSize, arrows: deepCloneArrows(entry.arrows) };
  }

  /* ===================== 進捗保存（localStorage） ===================== */
  const PROGRESS_KEY = "magicArrowsProgress_v1";

  function loadProgress() {
    try {
      if (typeof localStorage === "undefined") return { highestUnlockedStage: 1 };
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (!raw) return { highestUnlockedStage: 1 };
      const parsed = JSON.parse(raw);
      const n = parsed && Number(parsed.highestUnlockedStage);
      if (!Number.isFinite(n) || n < 1) return { highestUnlockedStage: 1 }; // データ破損時は安全にSTAGE1へ
      return { highestUnlockedStage: Math.min(Math.floor(n), Math.max(MAX_STAGE, 1)) };
    } catch (e) {
      return { highestUnlockedStage: 1 }; // 破損・アクセス不可時も安全にSTAGE1へ
    }
  }

  function saveProgress(highestUnlockedStage) {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(PROGRESS_KEY, JSON.stringify({ highestUnlockedStage: highestUnlockedStage }));
    } catch (e) {
      /* 保存できない環境(プライベートブラウズ等)でもゲーム自体は継続させる */
    }
  }

  function resetProgress() {
    try {
      if (typeof localStorage !== "undefined") localStorage.removeItem(PROGRESS_KEY);
    } catch (e) {
      /* noop */
    }
  }

  /* Node環境（盤面検証テストからのrequire）向けエクスポート。ブラウザでは無視される。 */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      THICKNESS,
      DIR_VEC,
      rectForSegment,
      segmentsOfArrow,
      sweepGap,
      exitDistance,
      computeTravel,
      canArrowExit,
      findAvailableMoves,
      isSolvable,
      solveBoard,
      hasInitialOverlap,
      validateExitDirections,
      MAGIC_ARROW_STAGES,
      MAX_STAGE,
      MAX_LEVEL,
      STAGES_PER_LEVEL,
      stageToLevel,
      stagesInLevel,
      getStageBoard,
      PROGRESS_KEY,
    };
  }

  /* ブラウザ以外（Node単体require時）ではDOM操作以降は実行しない。 */
  if (typeof document === "undefined") return;

  /* ===================== 色（Princess Englishパレット。視認性のため濃いめの線色を使用） ===================== */
  const ARROW_LINE_COLOR = {
    lavender: "#7A54D6",
    pink: "#D6467A",
    sky: "#3F8FCE",
    gold: "#C98A12",
    mint: "#2F8F63",
  };
  const ARROW_HIGHLIGHT_COLOR = {
    lavender: "#E4D6FF",
    pink: "#FFDCE8",
    sky: "#E4F4FF",
    gold: "#FFEFC2",
    mint: "#DFF7EA",
  };
  const VISIBLE_STROKE = 0.4; // グリッド単位(1マス=1)。太いrounded stroke。
  const HIGHLIGHT_STROKE = 0.14;
  const HIT_STROKE = 0.78; // 子どもでも押しやすいよう、visibleより明確に太い透明stroke。
  const HEAD_WIDTH = VISIBLE_STROKE * 2.3; // arrowhead幅：visible線の太さの約2.3倍
  const HEAD_LENGTH = VISIBLE_STROKE * 1.7; // arrowhead長さ：隣のセルへはみ出しすぎない範囲

  const SVG_NS = "http://www.w3.org/2000/svg";

  const EXIT_MS = 480;
  const EXIT_REDUCED_MS = 190;
  const CLEAR_DELAY_MS = 200;

  // 衝突（blocked）演出：実際に接触する位置まで進む→コツンと当たる(impact)→
  // ❤️を1つ減らす→元の位置へ戻る、という一連の流れの時間配分。
  const COLLIDE_MS = 420;
  const COLLIDE_REDUCED_MS = 170;
  const COLLIDE_IMPACT_RATIO = 0.55; // このタイミングでimpact spark + ❤️減少を発生させる
  const GAMEOVER_SHOW_DELAY_MS = 220; // 最後の衝突アニメーションが収まってからGAME OVERを表示

  /* ===================== DOM参照 ===================== */
  const homeStartBtn = document.getElementById("magic-arrows-start-btn");
  const stageNumEl = document.getElementById("magic-arrows-stage-num");
  const levelNumEl = document.getElementById("magic-arrows-level-num");
  const boardFrameEl = document.querySelector(".magic-arrows-board-frame");
  const boardEl = document.getElementById("magic-arrows-board");
  const fxLayerEl = document.getElementById("magic-arrows-fx-layer");
  const clearOverlayEl = document.getElementById("magic-arrows-clear-overlay");
  const youDidItEl = document.getElementById("magic-arrows-you-did-it");
  const clearSubEl = document.getElementById("magic-arrows-clear-sub");
  const clearPrincessEl = document.getElementById("magic-arrows-clear-princess");
  const nextBtn = document.getElementById("magic-arrows-next-btn");
  const againBtn = document.getElementById("magic-arrows-again-btn");
  const stageSelectBtnInClear = document.getElementById("magic-arrows-stageselect-btn");
  const homeBtn = document.getElementById("magic-arrows-home-btn");
  const livesEl = document.getElementById("magic-arrows-lives");
  const gameoverOverlayEl = document.getElementById("magic-arrows-gameover-overlay");
  const gameoverHeartsEl = document.getElementById("magic-arrows-gameover-hearts");
  const retryBtn = document.getElementById("magic-arrows-retry-btn");
  const gameoverHomeBtn = document.getElementById("magic-arrows-gameover-home-btn");
  const selectTabsEl = document.getElementById("magic-arrows-select-tabs");
  const selectGridEl = document.getElementById("magic-arrows-select-grid");

  if (!homeStartBtn || !boardEl) return; // このHTMLが無い環境（他ページ等）では何もしない

  /* ===================== ゲーム状態 ===================== */
  const game = {
    stage: 1,
    level: 1,
    boardSize: 5,
    arrows: [],
    arrowEls: {}, // id -> {g, visible, highlight, hit, head}
    locked: false, // クリア演出/GAME OVER中など、盤面全体の新規タップを一時停止したい場合に使う
    lives: START_LIVES,
    gameState: "playing", // "playing" | "gameover"
    initialBoardState: [], // このSTAGEを開始した瞬間のArrow配置(deep copy)。RETRYで使う。
    selectLevelTab: 1, // STAGE SELECT画面で現在選んでいるLEVELタブ
    progress: loadProgress(),
  };

  /* ===================== 小さなユーティリティ ===================== */
  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function playAudioSfx(name) {
    if (window.audioManager) window.audioManager.playSfx(name);
  }
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }
  function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  /* ===================== SVG生成 ===================== */
  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const k in attrs) el.setAttribute(k, attrs[k]);
    }
    return el;
  }

  function pointsToPath(points) {
    return points.map((p, i) => (i === 0 ? "M" : "L") + p.x + "," + p.y).join(" ");
  }

  /**
   * Arrowの終点に付ける、明確に見える大きなarrowhead(▶◀▲▼相当)の三角形
   * polygon座標(points属性文字列)を計算する。最終segmentの方向(=exitDirection)
   * を向き、線と同じ位置から隙間なく生えるようにする。
   */
  function arrowHeadPolygonPoints(points, exitDirection) {
    const tip = points[points.length - 1];
    const dirVec = DIR_VEC[exitDirection];
    // 進行方向の単位ベクトル・その垂直ベクトル
    const ux = dirVec.ux, uy = dirVec.uy;
    const px = -uy, py = ux; // 垂直方向
    const apex = { x: tip.x + ux * HEAD_LENGTH, y: tip.y + uy * HEAD_LENGTH };
    const baseCenter = tip; // 線の終点＝三角形の底辺の中心（隙間なし）
    const baseL = { x: baseCenter.x + px * (HEAD_WIDTH / 2), y: baseCenter.y + py * (HEAD_WIDTH / 2) };
    const baseR = { x: baseCenter.x - px * (HEAD_WIDTH / 2), y: baseCenter.y - py * (HEAD_WIDTH / 2) };
    return [apex, baseL, baseR].map((p) => p.x + "," + p.y).join(" ");
  }

  let defsBuilt = false;
  function ensureDefs(svg) {
    if (defsBuilt) return;
    // 現状arrowheadはpolygonで直接描画するため<defs>のmarkerは不要だが、
    // 将来的な拡張(グラデーション等)に備えて空のdefsだけ用意しておく。
    const defs = svgEl("defs", {});
    svg.appendChild(defs);
    defsBuilt = true;
  }

  /** 1つのArrow(polyline)をSVG <g>として組み立てる。visible/highlight/hit/headの4要素を持つ。 */
  function createArrowEl(svg, arrow) {
    ensureDefs(svg);
    const d = pointsToPath(arrow.points);
    const g = svgEl("g", { class: "ma-polyline-arrow ma-color-" + arrow.color, "data-arrow-id": arrow.id, tabindex: "0", role: "button", "aria-label": "magic arrow" });

    const hit = svgEl("path", {
      class: "ma-arrow-hit",
      d: d,
      fill: "none",
      stroke: "rgba(0,0,0,0.001)",
      "stroke-width": String(HIT_STROKE),
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    });

    const highlight = svgEl("path", {
      class: "ma-arrow-highlight",
      d: d,
      fill: "none",
      stroke: ARROW_HIGHLIGHT_COLOR[arrow.color] || "#ffffff",
      "stroke-width": String(HIGHLIGHT_STROKE),
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "pointer-events": "none",
      opacity: "0.55",
    });

    const visible = svgEl("path", {
      class: "ma-arrow-visible",
      d: d,
      fill: "none",
      stroke: ARROW_LINE_COLOR[arrow.color] || "#8F6AE0",
      "stroke-width": String(VISIBLE_STROKE),
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "pointer-events": "none",
    });

    // arrowhead：SVG markerに頼らず、明示的な<polygon>として描画する
    // （iPhone Safariでも確実に表示させるため）。Arrow本体と同じ<g>内、
    // Arrow移動時は線と完全に一緒に動く。ここも押せるようpointer-eventsは
    // 無効化しない（Dの要件：arrowhead部分をタップしてもそのArrowを選択できる）。
    const head = svgEl("polygon", {
      class: "ma-arrow-head",
      points: arrowHeadPolygonPoints(arrow.points, arrow.exitDirection),
      fill: ARROW_LINE_COLOR[arrow.color] || "#8F6AE0",
    });

    g.appendChild(hit);
    g.appendChild(highlight);
    g.appendChild(visible);
    g.appendChild(head);

    g.addEventListener("click", () => handleTap(arrow.id));
    g.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        handleTap(arrow.id);
      }
    });

    return { g: g, visible: visible, highlight: highlight, hit: hit, head: head };
  }

  /* ===================== FX（sparkle / ripple） ===================== */
  function elCenterInFxLayer(el) {
    const layerRect = fxLayerEl.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { cx: r.left - layerRect.left + r.width / 2, cy: r.top - layerRect.top + r.height / 2, size: Math.max(r.width, r.height) };
  }

  function spawnTileSparkle(el) {
    if (!fxLayerEl) return;
    const { cx, cy, size } = elCenterInFxLayer(el);
    const ring = document.createElement("div");
    ring.className = "princess-glow-ring";
    const ringSize = Math.max(size, 30) * 0.9;
    ring.style.left = cx - ringSize / 2 + "px";
    ring.style.top = cy - ringSize / 2 + "px";
    ring.style.width = ringSize + "px";
    ring.style.height = ringSize + "px";
    fxLayerEl.appendChild(ring);
    setTimeout(() => ring.remove(), 1000);

    const chars = ["✨", "⭐", "💫"];
    const count = prefersReducedMotion() ? 2 : 6;
    for (let i = 0; i < count; i++) {
      const s = document.createElement("div");
      s.className = "princess-sparkle";
      s.textContent = chars[i % chars.length];
      s.style.left = cx + "px";
      s.style.top = cy + "px";
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const dist = 24 + Math.random() * 16;
      s.style.setProperty("--sx", Math.cos(angle) * dist + "px");
      s.style.setProperty("--sy", Math.sin(angle) * dist + "px");
      fxLayerEl.appendChild(s);
      setTimeout(() => s.remove(), 1000);
    }
  }

  /**
   * 衝突(collide)の「コツンと当たった瞬間」に、実際に接触した位置(現在のel中心)へ
   * 小さなspark(輪+粒)を出す。赤色・×は使わない。
   */
  function spawnImpactSpark(el) {
    if (!fxLayerEl) return;
    const { cx, cy, size } = elCenterInFxLayer(el);

    const ring = document.createElement("div");
    ring.className = "princess-glow-ring magic-arrows-impact-ring";
    const ringSize = Math.max(size, 24) * 0.7;
    ring.style.left = cx - ringSize / 2 + "px";
    ring.style.top = cy - ringSize / 2 + "px";
    ring.style.width = ringSize + "px";
    ring.style.height = ringSize + "px";
    fxLayerEl.appendChild(ring);
    setTimeout(() => ring.remove(), 800);

    const count = prefersReducedMotion() ? 1 : 3;
    for (let i = 0; i < count; i++) {
      const s = document.createElement("div");
      s.className = "princess-sparkle magic-arrows-impact-spark";
      s.textContent = "✨";
      s.style.left = cx + "px";
      s.style.top = cy + "px";
      const angle = Math.random() * Math.PI * 2;
      const dist = 10 + Math.random() * 10;
      s.style.setProperty("--sx", Math.cos(angle) * dist + "px");
      s.style.setProperty("--sy", Math.sin(angle) * dist + "px");
      fxLayerEl.appendChild(s);
      setTimeout(() => s.remove(), 800);
    }
  }

  /**
   * STAGEのboardSizeに応じて盤面占有率(画面幅に対する%)を92〜96%の範囲で
   * 広げる（spec J：STAGE 20以降は盤面をもっと大きく使ってよい）。
   * gridが小さい序盤STAGEは92vw、盤面が密集する後半STAGEほど96vwに近づける。
   */
  function applyBoardFrameSize() {
    if (!boardFrameEl) return;
    const size = game.boardSize || 5;
    const pct = Math.max(92, Math.min(96, 90 + size * 0.5));
    boardFrameEl.style.setProperty("--ma-board-vw", pct + "vw");
  }

  /* ===================== render層（ゲーム盤面） ===================== */
  function renderBoard() {
    applyBoardFrameSize();
    boardEl.innerHTML = "";
    if (fxLayerEl) fxLayerEl.innerHTML = "";
    defsBuilt = false;
    const svg = svgEl("svg", {
      viewBox: "0 0 " + game.boardSize + " " + game.boardSize,
      width: "100%",
      height: "100%",
      class: "magic-arrows-svg",
      "aria-hidden": "false",
    });
    boardEl.appendChild(svg);
    game.arrowEls = {};
    game.arrows.forEach((arrow) => {
      if (arrow.state === "removed") return;
      const els = createArrowEl(svg, arrow);
      svg.appendChild(els.g);
      game.arrowEls[arrow.id] = els;
    });
  }

  function isBoardClear() {
    return game.arrows.length > 0 && game.arrows.every((a) => a.state === "removed");
  }

  /** LIFE表示（❤️×lives + 失ったぶんは🤍）。スコア・順位ではなく視覚だけで残り回数を伝える。 */
  function updateLivesDisplay() {
    if (!livesEl) return;
    livesEl.innerHTML = "";
    for (let i = 0; i < START_LIVES; i++) {
      const span = document.createElement("span");
      const alive = i < game.lives;
      span.className = "magic-arrows-life" + (alive ? " is-alive" : " is-lost");
      span.textContent = alive ? "❤️" : "🤍";
      livesEl.appendChild(span);
    }
  }

  function updateStageHud() {
    if (stageNumEl) stageNumEl.textContent = String(game.stage);
    if (levelNumEl) levelNumEl.textContent = String(game.level);
  }

  /* ===================== タップ処理 ===================== */
  function handleTap(arrowId) {
    if (game.locked || game.gameState !== "playing") return; // GAME OVER中は操作不可
    const arrow = game.arrows.find((a) => a.id === arrowId);
    if (!arrow || arrow.state !== "active") return; // 連打対策：exiting/colliding/removed中は無視

    const activeArrows = game.arrows.filter((a) => a.state === "active");
    const travel = computeTravel(arrow, activeArrows, game.boardSize);
    if (!travel.blocked) {
      exitArrow(arrow, travel);
    } else {
      collideArrow(arrow, travel);
    }
  }

  /** requestAnimationFrameでArrowの<g>のtransformを直接更新する汎用アニメーション。 */
  function animateTransform(g, dirVec, fromDist, toDist, durationMs, easing, onDone) {
    const start = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = easing(t);
      const dist = fromDist + (toDist - fromDist) * eased;
      g.setAttribute("transform", "translate(" + dirVec.ux * dist + "," + dirVec.uy * dist + ")");
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        if (onDone) onDone();
      }
    }
    requestAnimationFrame(frame);
  }

  function exitArrow(arrow, travel) {
    arrow.state = "exiting"; // タップ連打対策：飛んでいる最中は他の状態遷移を受け付けない
    playAudioSfx("sparkle");
    const els = game.arrowEls[arrow.id];
    const reduced = prefersReducedMotion();
    if (els) spawnTileSparkle(els.g);
    const dur = reduced ? EXIT_REDUCED_MS : EXIT_MS;
    // exit距離ぶんは常にrigid-bodyで平行移動する（形は絶対に変形しない）。
    const finish = () => {
      arrow.state = "removed";
      if (els && els.g.parentNode) els.g.remove();
      delete game.arrowEls[arrow.id];
      if (isBoardClear()) {
        setTimeout(onStageClear, CLEAR_DELAY_MS);
      }
    };
    if (els) {
      if (reduced) {
        els.g.style.transition = "opacity " + EXIT_REDUCED_MS + "ms ease-in";
        els.g.style.opacity = "0";
        setTimeout(finish, dur);
      } else {
        animateTransform(els.g, travel.dirVec, 0, travel.distance, dur, easeOutCubic, finish);
      }
    } else {
      setTimeout(finish, dur);
    }
  }

  /**
   * LIFE制の衝突処理：即座には消えず、
   *   1) 実際に他のArrowへ接触する位置まで進む
   *   2) コツンと当たる(impact spark)
   *   3) ❤️を1つ減らす
   *   4) 元の位置へ戻る
   * という一連の流れを見せる。赤い×・ブザー・強い振動・盤面全体のシェイクは
   * 一切使わない。3回目でLIFEが0になったらGAME OVERへ遷移する。
   */
  function collideArrow(arrow, travel) {
    arrow.state = "colliding"; // 連打対策：アニメーション中は同じArrowの再タップを無視する
    playAudioSfx("wrong"); // ブザーではなく、audio.js側で「ごく軽いpop」として定義されている想定のSFX
    const els = game.arrowEls[arrow.id];
    const reduced = prefersReducedMotion();
    const totalDur = reduced ? COLLIDE_REDUCED_MS : COLLIDE_MS;
    const outDur = Math.round(totalDur * COLLIDE_IMPACT_RATIO);
    const backDur = totalDur - outDur;
    // 接触位置までの実距離が大きすぎて不自然に長く見えないよう、視覚上は
    // 最大1.4マス分の移動にとどめる（衝突であることを示すには十分）。
    const visualDist = Math.min(travel.distance, 1.4);

    const doImpact = () => {
      if (els) spawnImpactSpark(els.g);
      game.lives = Math.max(0, game.lives - 1);
      updateLivesDisplay();
      if (game.lives <= 0) {
        game.gameState = "gameover";
        game.locked = true; // これ以降、他のArrowも含めて一切操作を受け付けない
      }
    };

    const doReturn = () => {
      const finishReturn = () => {
        if (els) els.g.removeAttribute("transform");
        if (game.gameState === "gameover") {
          setTimeout(showGameOverOverlay, GAMEOVER_SHOW_DELAY_MS);
        } else {
          arrow.state = "active";
        }
      };
      if (els && !reduced) {
        animateTransform(els.g, travel.dirVec, visualDist, 0, backDur, easeInOutQuad, finishReturn);
      } else {
        setTimeout(finishReturn, backDur);
      }
    };

    if (els && !reduced) {
      animateTransform(els.g, travel.dirVec, 0, visualDist, outDur, easeOutCubic, () => {
        doImpact();
        doReturn();
      });
    } else {
      setTimeout(() => {
        doImpact();
        doReturn();
      }, outDur);
    }
  }

  function showGameOverOverlay() {
    if (gameoverHeartsEl) gameoverHeartsEl.textContent = "❤️ 0";
    if (gameoverOverlayEl) gameoverOverlayEl.hidden = false;
  }

  /* ===================== STAGE進行 ===================== */
  /** 新しいSTAGEの固定盤面を開始する。bypassLock=trueの場合はロック状態を無視する
   *  （NEXT STAGE直後・デバッグAPI用）。ロックされていて開始できない場合は
   *  falseを返す（STAGE SELECT側で無視される）。
   *  この瞬間のArrow配置を initialBoardState として保存しておき、
   *  以降このSTAGE内でGAME OVER→RETRYになっても、この状態へ完全に戻せるようにする。 */
  function loadStage(n, opts) {
    const bypassLock = !!(opts && opts.bypassLock);
    if (n < 1 || n > MAX_STAGE) return false;
    if (!bypassLock && n > game.progress.highestUnlockedStage) return false; // 未解放STAGEは開始しない
    const lvl = getStageBoard(n);
    if (!lvl) return false;
    game.stage = n;
    game.level = lvl.level;
    game.boardSize = lvl.boardSize;
    game.arrows = lvl.arrows;
    game.initialBoardState = deepCloneArrows(lvl.arrows);
    game.lives = START_LIVES;
    game.gameState = "playing";
    game.locked = false;
    updateStageHud();
    if (clearOverlayEl) clearOverlayEl.hidden = true;
    if (gameoverOverlayEl) gameoverOverlayEl.hidden = true;
    updateLivesDisplay();
    renderBoard();
    return true;
  }

  /** RETRY：新しい盤面は一切生成せず、「このSTAGEを開始した瞬間の配置」の
   *  deep copyへ完全に戻す。消していたArrowもすべて復活し、LIFEも3へ全回復する。
   *  currentBoard = deepClone(initialBoardState); lives = 3; gameState = "playing";
   *  STAGE SELECTへは戻さない。 */
  function retryStage() {
    game.arrows = deepCloneArrows(game.initialBoardState);
    game.lives = START_LIVES;
    game.gameState = "playing";
    game.locked = false;
    if (gameoverOverlayEl) gameoverOverlayEl.hidden = true;
    updateLivesDisplay();
    renderBoard();
  }

  /** STAGE Nをクリアしたら、STAGE N+1 を解放してlocalStorageへ保存する。 */
  function unlockStage(n) {
    if (n < 1) return;
    const bounded = Math.min(n, Math.max(MAX_STAGE, 1));
    if (bounded > game.progress.highestUnlockedStage) {
      game.progress.highestUnlockedStage = bounded;
      saveProgress(bounded);
    }
  }

  function spawnClearCelebration(isFinal) {
    if (!clearOverlayEl) return;
    const cardEl = clearOverlayEl.querySelector(".magic-arrows-clear-card") || clearOverlayEl;
    const rect = cardEl.getBoundingClientRect();
    const topY = rect.height * 0.16;
    const chars = ["✨", "⭐", "💫", "💗", "💕"];
    const sparkleCount = prefersReducedMotion() ? 3 : isFinal ? 10 : 7;
    for (let i = 0; i < sparkleCount; i++) {
      const s = document.createElement("div");
      s.className = "princess-sparkle";
      s.textContent = chars[i % chars.length];
      s.style.left = rect.width * (0.15 + Math.random() * 0.7) + "px";
      s.style.top = topY + "px";
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.7;
      const dist = 22 + Math.random() * 20;
      s.style.setProperty("--sx", Math.cos(angle) * dist + "px");
      s.style.setProperty("--sy", Math.sin(angle) * dist - 8 + "px");
      cardEl.appendChild(s);
      setTimeout(() => s.remove(), 1000);
    }
    if (!prefersReducedMotion()) {
      const confettiColors = ["#FFC94D", "#FF8FB1", "#B18BFF", "#BFE3FF", "#7FD9A6"];
      const confettiCount = isFinal ? 12 : 8;
      for (let i = 0; i < confettiCount; i++) {
        const c = document.createElement("div");
        c.className = "princess-confetti-piece";
        c.style.left = rect.width * Math.random() + "px";
        c.style.background = confettiColors[i % confettiColors.length];
        c.style.animationDelay = Math.random() * 0.15 + "s";
        cardEl.appendChild(c);
        setTimeout(() => c.remove(), 1400);
      }
    }
  }

  function onStageClear() {
    playAudioSfx("clear");
    game.locked = true;
    const isFinal = game.stage >= MAX_STAGE;
    unlockStage(game.stage + 1); // ボタンを押さずに離脱しても解放状態は残す

    if (youDidItEl) youDidItEl.textContent = "✨ YOU DID IT! ✨";
    if (clearSubEl) clearSubEl.textContent = isFinal ? "Magic complete! 🎉👑" : "Great job! 🎉";
    if (nextBtn) nextBtn.hidden = isFinal;
    if (againBtn) againBtn.hidden = !isFinal; // PLAY AGAINは最終STAGEクリア時のみ表示
    if (stageSelectBtnInClear) stageSelectBtnInClear.hidden = false;
    if (homeBtn) homeBtn.hidden = false;
    if (clearOverlayEl) clearOverlayEl.hidden = false;

    if (clearPrincessEl && !prefersReducedMotion()) {
      clearPrincessEl.classList.remove("ma-clear-dance", "ma-clear-dance-big");
      void clearPrincessEl.offsetWidth;
      clearPrincessEl.classList.add("ma-clear-dance");
      if (isFinal) clearPrincessEl.classList.add("ma-clear-dance-big");
    }
    spawnClearCelebration(isFinal);
  }

  /* ===================== STAGE SELECT画面 ===================== */
  function renderStageSelectTabs() {
    if (!selectTabsEl) return;
    selectTabsEl.innerHTML = "";
    for (let lvl = 1; lvl <= MAX_LEVEL; lvl++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "magic-arrows-select-tab" + (lvl === game.selectLevelTab ? " is-active" : "");
      btn.textContent = "LEVEL " + lvl;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", lvl === game.selectLevelTab ? "true" : "false");
      btn.addEventListener("click", () => {
        game.selectLevelTab = lvl;
        renderStageSelect();
      });
      selectTabsEl.appendChild(btn);
    }
  }

  function renderStageSelectGrid() {
    if (!selectGridEl) return;
    selectGridEl.innerHTML = "";
    const stages = stagesInLevel(game.selectLevelTab);
    const highest = game.progress.highestUnlockedStage;
    stages.forEach((s) => {
      const unlocked = s <= highest;
      const cleared = s < highest; // まだ挑戦していないhighest自身は「クリア済み」扱いにしない
      const isNextPlayable = s === highest;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "magic-arrows-stage-btn" +
        (!unlocked ? " is-locked" : "") +
        (cleared ? " is-cleared" : "") +
        (isNextPlayable ? " is-next" : "");
      btn.dataset.stage = String(s);
      btn.disabled = !unlocked;
      btn.setAttribute("aria-label", (unlocked ? "STAGE " + s : "STAGE " + s + "（ロック中）"));

      const numSpan = document.createElement("span");
      numSpan.className = "magic-arrows-stage-btn-num";
      numSpan.textContent = String(s);
      btn.appendChild(numSpan);

      const badge = document.createElement("span");
      badge.className = "magic-arrows-stage-btn-badge";
      badge.setAttribute("aria-hidden", "true");
      badge.textContent = !unlocked ? "🔒" : cleared ? "✓" : "";
      btn.appendChild(badge);

      if (unlocked) {
        btn.addEventListener("click", () => startStageFromSelect(s));
      }
      selectGridEl.appendChild(btn);
    });
  }

  function renderStageSelect() {
    renderStageSelectTabs();
    renderStageSelectGrid();
  }

  function openStageSelect() {
    game.progress = loadProgress(); // 他タブ等での進捗変化も拾えるよう毎回読み直す
    game.selectLevelTab = stageToLevel(Math.min(game.progress.highestUnlockedStage, MAX_STAGE || 1));
    renderStageSelect();
    if (typeof showScreen === "function") showScreen("screen-magic-arrows-select");
  }

  function startStageFromSelect(n) {
    if (window.audioManager) {
      window.audioManager.unlock();
      if (window.audioManager.isBgmEnabled && window.audioManager.isBgmEnabled()) {
        window.audioManager.startBgm();
      }
    }
    playAudioSfx("play");
    const ok = loadStage(n);
    if (ok && typeof showScreen === "function") showScreen("screen-magic-arrows");
  }

  /* ===================== 画面遷移 / ボタン ===================== */
  // HOME → MAGIC ARROWS を押した直後にいきなり盤面を開始せず、STAGE SELECTを開く。
  homeStartBtn.addEventListener("click", openStageSelect);

  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      const next = Math.min(game.stage + 1, MAX_STAGE);
      loadStage(next, { bypassLock: true }); // クリア直後に解放したばかりのSTAGEへ確実に入れる
    });
  }
  if (againBtn) {
    // PLAY AGAIN：STAGE30(最終)クリア時のみ表示。RETRY(同じSTAGE)ともNEXT STAGEとも違い、
    // ゲーム全体をSTAGE1の新しい盤面からやり直す(進捗はリセットしない)。
    againBtn.addEventListener("click", () => {
      loadStage(1, { bypassLock: true });
      if (typeof showScreen === "function") showScreen("screen-magic-arrows");
    });
  }
  if (stageSelectBtnInClear) {
    stageSelectBtnInClear.addEventListener("click", () => {
      if (clearOverlayEl) clearOverlayEl.hidden = true;
      game.locked = false;
      openStageSelect();
    });
  }
  if (homeBtn) {
    homeBtn.addEventListener("click", () => {
      if (clearOverlayEl) clearOverlayEl.hidden = true;
      game.locked = false;
      if (typeof showScreen === "function") showScreen("screen-home");
    });
  }
  if (retryBtn) {
    // RETRY：「失敗した直前の状態」ではなく、このSTAGEを開始した最初の盤面へ完全に戻す。
    // STAGE SELECTには戻さない。
    retryBtn.addEventListener("click", retryStage);
  }
  if (gameoverHomeBtn) {
    gameoverHomeBtn.addEventListener("click", () => {
      if (gameoverOverlayEl) gameoverOverlayEl.hidden = true;
      game.locked = false;
      if (typeof showScreen === "function") showScreen("screen-home");
    });
  }

  /* ===================== テスト専用デバッグAPI（本番UIからは呼ばれない） ===================== */
  window.__magicArrowsDebug = {
    getState() {
      return {
        stage: game.stage,
        level: game.level,
        boardSize: game.boardSize,
        lives: game.lives,
        gameState: game.gameState,
        arrows: game.arrows.map((a) => ({
          id: a.id,
          points: a.points.map((p) => ({ x: p.x, y: p.y })),
          exitDirection: a.exitDirection,
          color: a.color,
          state: a.state,
        })),
      };
    },
    getInitialBoardState() {
      return game.initialBoardState.map((a) => ({
        id: a.id,
        points: a.points.map((p) => ({ x: p.x, y: p.y })),
        exitDirection: a.exitDirection,
        color: a.color,
      }));
    },
    getAvailableMoves() {
      return findAvailableMoves(game.arrows, game.boardSize).map((a) => a.id);
    },
    solveCurrentBoard() {
      return solveBoard(game.arrows, game.boardSize);
    },
    getMaxStage() {
      return MAX_STAGE;
    },
    getMaxLevel() {
      return MAX_LEVEL;
    },
    getProgress() {
      return { highestUnlockedStage: game.progress.highestUnlockedStage };
    },
    resetProgress() {
      resetProgress();
      game.progress = loadProgress();
    },
    // テスト用：ロック状態を無視してSTAGEを開始し、ゲーム画面も表示する(本番UIからは呼ばれない)
    loadStage(n) {
      const ok = loadStage(n, { bypassLock: true });
      if (ok && typeof showScreen === "function") showScreen("screen-magic-arrows");
      return ok;
    },
    // テスト用：ロックを尊重してSTAGE SELECTと同じ経路でSTAGEを開始する
    loadStageRespectingLock(n) {
      const ok = loadStage(n, { bypassLock: false });
      if (ok && typeof showScreen === "function") showScreen("screen-magic-arrows");
      return ok;
    },
    retryStage() {
      retryStage();
    },
    tapArrow(id) {
      handleTap(id);
    },
    openStageSelect() {
      openStageSelect();
    },
    unlockStage(n) {
      unlockStage(n);
    },
    // 後方互換：旧デバッグAPI名(loadLevel/retryLevel)も残しておく
    loadLevel(n) {
      const ok = loadStage(n, { bypassLock: true });
      if (ok && typeof showScreen === "function") showScreen("screen-magic-arrows");
      return ok;
    },
    retryLevel() {
      retryStage();
    },
  };
})();
