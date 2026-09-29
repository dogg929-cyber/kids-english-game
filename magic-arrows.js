"use strict";

/**
 * MAGIC ARROWS（非言語のタップパズルゲーム / Arrow Escape方式）
 * ---------------------------------------------------------------------
 * 英語学習・発音練習（speech.js / SpeechRecognition / SpeechSynthesis）とは
 * 完全に独立したミニゲーム。文字が読めなくても、説明文を読まなくても
 * 100%遊べることを目標に設計している。
 *
 * ルール（Arrow Escape系。旧「四角いタイルの中に矢印」方式は完全廃止）：
 *   盤面には「1本の長い折れ曲がった線」そのものがArrowとして複数置かれている。
 *   直線・L字・コの字（U字）・階段状・ジグザグなど、形は様々。
 *   Arrowをタップすると、そのArrow全体（形は絶対に変形しない・剛体）が
 *   自分の出口方向(exitDirection)へ向かって平行移動する。
 *     - 他のArrowに一切触れずに盤面の外まで出られるなら → そのまま画面外へ
 *       消える（exit成功）。
 *     - 途中で他のArrowに触れる場合 → 触れる位置まで進み、コツンと当たって
 *       LIFEを1つ減らし、元の位置へ戻る（collide）。
 *   衝突判定は「Arrow全体 × 他Arrow全体」を、線の太さを含めて全line segment
 *   同士で行う（先端だけを見る判定は禁止）。L字やコの字は、先端が空いていても
 *   曲がった部分の胴体や横棒が他Arrowにぶつかってblockedになることがある。
 *
 * ファイル構成の方針（盤面データ→判定ロジック→renderの分離）：
 *   1) ロジック層：segmentsOfArrow/sweepGap/computeTravel/canArrowExit/
 *      findAvailableMoves/isSolvable/solveBoard/hasInitialOverlap/
 *      validateExitDirections は純粋関数（DOM非依存）。Node上でも直接
 *      requireしてユニットテストできる（盤面検証テストで使用）。
 *   2) 盤面データ層：LEVEL_BOARDSに、LEVEL1〜3それぞれ3盤面ずつ、計9盤面以上の
 *      手作り固定盤面を用意している（ランダム生成はしない）。全盤面は
 *      このファイル下部のNode向けエクスポート経由でsolverにより検証済み。
 *   3) ゲーム状態：module-scopeの `game` オブジェクト1つだけが状態を持つ。
 *   4) render層：renderBoard/updateLivesDisplay/showClearOverlay等がDOMを
 *      更新する。盤面はSVGで描画し、1 Arrow = 1 SVG <g class="ma-polyline-arrow">。
 *
 * 「必ず解ける盤面」の保証について：
 *   このパズルには「今動かせるArrowをどれか1つ取り除いても、他のArrowが
 *   新たに動かせなくなることは絶対に無い（取り除く＝スペースが空くだけで、
 *   経路をふさぐ領域が増えることは無い）」という合流性(confluence)が
 *   polyline方式でも成り立つ（各Arrowの必要スペースは単調に減るだけ）。
 *   そのため isSolvable() は「今動かせるArrowを1つ選んで取り除く」を
 *   Arrowが無くなるまで貪欲に繰り返すだけで判定でき（バックトラック不要）、
 *   これは「LEVEL_BOARDSの全盤面は、プレイヤーが実際にどんな順番でタップ
 *   しても絶対に詰まない」ことも同時に保証する。
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

  /* ===================== 盤面データ層（手作り固定盤面。ランダム生成はしない） ===================== */

  /** セル座標(col,row) -> 中心座標{x,y}（グリッド単位）。 */
  function pt(x, y) {
    return { x: x + 0.5, y: y + 0.5 };
  }
  /** [[col,row],[col,row],...] のセル列とexitDirection/colorから1本のArrowを組み立てる。 */
  function mkArrow(id, cells, exitDirection, color) {
    return { id: id, points: cells.map((c) => pt(c[0], c[1])), exitDirection: exitDirection, color: color, state: "active" };
  }

  const LEVEL_BOARDS = {
    1: [
      // level1a: 4本。直線3 + 長めのL字1。かなり簡単。
      {
        boardSize: 5,
        arrows: [
          mkArrow("a", [[1, 0], [3, 0]], "right", "pink"),
          mkArrow("b", [[0, 1], [0, 3]], "down", "sky"),
          mkArrow("c", [[4, 1], [4, 3], [2, 3]], "left", "gold"),
          mkArrow("d", [[1, 4], [3, 4]], "right", "lavender"),
        ],
      },
      // level1b: level1aを左右反転した構造同型の盤面（配色・向きが変わり見た目は変わる）。
      {
        boardSize: 5,
        arrows: [
          mkArrow("a", [[3, 0], [1, 0]], "left", "mint"),
          mkArrow("b", [[4, 1], [4, 3]], "down", "gold"),
          mkArrow("c", [[0, 1], [0, 3], [2, 3]], "right", "lavender"),
          mkArrow("d", [[3, 4], [1, 4]], "left", "pink"),
        ],
      },
      // level1c: 5本。短い直線を1本追加。
      {
        boardSize: 5,
        arrows: [
          mkArrow("a", [[0, 0], [2, 0]], "right", "gold"),
          mkArrow("b", [[4, 0], [4, 2]], "down", "sky"),
          mkArrow("c", [[0, 2], [0, 4]], "down", "pink"),
          mkArrow("d", [[2, 4], [4, 4]], "right", "mint"),
          mkArrow("e", [[2, 1], [2, 2]], "down", "lavender"),
        ],
      },
    ],
    2: [
      // level2a: 6本。L字・コの字(U字)を含む。
      {
        boardSize: 6,
        arrows: [
          mkArrow("a", [[2, 0], [0, 0]], "left", "pink"),
          mkArrow("b", [[5, 0], [5, 2], [3, 2]], "left", "gold"),
          mkArrow("c", [[0, 1], [0, 3]], "down", "sky"),
          mkArrow("d", [[1, 4], [1, 2], [2, 2], [2, 4]], "down", "lavender"),
          mkArrow("e", [[2, 5], [4, 5]], "right", "mint"),
          mkArrow("f", [[5, 3], [5, 5]], "down", "pink"),
        ],
      },
      // level2b: 7本。階段状(staircase)とコの字(U字)を含む。
      {
        boardSize: 6,
        arrows: [
          mkArrow("a", [[0, 0], [2, 0], [2, 1], [4, 1]], "right", "gold"),
          mkArrow("b", [[5, 0], [5, 2]], "down", "sky"),
          mkArrow("c", [[0, 2], [0, 4]], "down", "pink"),
          mkArrow("d", [[1, 5], [1, 3], [2, 3], [2, 5]], "down", "lavender"),
          mkArrow("e", [[3, 5], [4, 5]], "right", "mint"),
          mkArrow("f", [[5, 3], [5, 5]], "down", "gold"),
          mkArrow("g", [[1, 2], [3, 2]], "right", "pink"),
        ],
      },
      // level2c: 8本。level2aを拡張。
      {
        boardSize: 6,
        arrows: [
          mkArrow("a", [[2, 0], [0, 0]], "left", "pink"),
          mkArrow("b", [[5, 0], [5, 2], [3, 2]], "left", "gold"),
          mkArrow("c", [[0, 1], [0, 3]], "down", "sky"),
          mkArrow("d", [[1, 4], [1, 2], [2, 2], [2, 4]], "down", "lavender"),
          mkArrow("e", [[2, 5], [4, 5]], "right", "mint"),
          mkArrow("f", [[5, 3], [5, 5]], "down", "pink"),
          mkArrow("g", [[2, 1], [1, 1]], "left", "sky"),
          mkArrow("h", [[3, 4], [4, 4]], "right", "gold"),
        ],
      },
    ],
    3: [
      // level3a: 9本。7x7。盤面いっぱいに折れ線が絡み合う。
      {
        boardSize: 7,
        arrows: [
          mkArrow("a", [[2, 0], [0, 0]], "left", "pink"),
          mkArrow("b", [[6, 0], [6, 2], [4, 2]], "left", "gold"),
          mkArrow("c", [[0, 1], [0, 3]], "down", "sky"),
          mkArrow("d", [[1, 4], [1, 2], [2, 2], [2, 4]], "down", "lavender"),
          mkArrow("g", [[2, 1], [1, 1]], "left", "mint"),
          mkArrow("e", [[2, 6], [4, 6]], "right", "pink"),
          mkArrow("f", [[6, 3], [6, 5]], "down", "gold"),
          mkArrow("h", [[3, 5], [4, 5]], "right", "sky"),
          mkArrow("i", [[3, 3], [5, 3], [5, 4]], "down", "lavender"),
        ],
      },
      // level3b: 11本。level3aを拡張。
      {
        boardSize: 7,
        arrows: [
          mkArrow("a", [[2, 0], [0, 0]], "left", "pink"),
          mkArrow("b", [[6, 0], [6, 2], [4, 2]], "left", "gold"),
          mkArrow("c", [[0, 1], [0, 3]], "down", "sky"),
          mkArrow("d", [[1, 4], [1, 2], [2, 2], [2, 4]], "down", "lavender"),
          mkArrow("g", [[2, 1], [1, 1]], "left", "mint"),
          mkArrow("e", [[2, 6], [4, 6]], "right", "pink"),
          mkArrow("f", [[6, 3], [6, 5]], "down", "gold"),
          mkArrow("h", [[3, 5], [4, 5]], "right", "sky"),
          mkArrow("i", [[3, 3], [5, 3], [5, 4]], "down", "lavender"),
          mkArrow("j", [[5, 0], [3, 0]], "left", "mint"),
          mkArrow("k", [[5, 1], [3, 1]], "left", "gold"),
        ],
      },
      // level3c: 12本。7x7の中で最も密度が高い盤面。
      {
        boardSize: 7,
        arrows: [
          mkArrow("a", [[2, 0], [0, 0]], "left", "pink"),
          mkArrow("b", [[6, 0], [6, 2], [4, 2]], "left", "gold"),
          mkArrow("c", [[0, 1], [0, 3]], "down", "sky"),
          mkArrow("d", [[1, 4], [1, 2], [2, 2], [2, 4]], "down", "lavender"),
          mkArrow("g", [[2, 1], [1, 1]], "left", "mint"),
          mkArrow("e", [[2, 6], [4, 6]], "right", "pink"),
          mkArrow("f", [[6, 3], [6, 5]], "down", "gold"),
          mkArrow("h", [[3, 5], [4, 5]], "right", "sky"),
          mkArrow("i", [[3, 3], [5, 3], [5, 4]], "down", "lavender"),
          mkArrow("j", [[5, 0], [3, 0]], "left", "mint"),
          mkArrow("k", [[5, 1], [3, 1]], "left", "gold"),
          mkArrow("l", [[1, 5], [1, 6], [0, 6]], "left", "sky"),
        ],
      },
    ],
  };
  const MAX_LEVEL = 3;
  const START_LIVES = 3;

  function randInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
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

  /**
   * このLEVELの固定盤面プリセットからランダムに1つを選んで返す
   * （手作り高品質盤面を優先し、ランダム生成は行わない）。
   * すべてのプリセットはこのファイル下部のNode向けエクスポート経由で
   * isSolvable()===true / hasInitialOverlap()===null / validateExitDirections()===null を
   * 事前に検証済み。
   */
  function pickLevelBoard(levelNum) {
    const presets = LEVEL_BOARDS[levelNum] || LEVEL_BOARDS[MAX_LEVEL];
    const preset = presets[randInt(0, presets.length - 1)];
    return { level: levelNum, boardSize: preset.boardSize, arrows: deepCloneArrows(preset.arrows) };
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
      LEVEL_BOARDS,
      MAX_LEVEL,
      pickLevelBoard,
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
  const levelNumEl = document.getElementById("magic-arrows-level-num");
  const boardEl = document.getElementById("magic-arrows-board");
  const fxLayerEl = document.getElementById("magic-arrows-fx-layer");
  const clearOverlayEl = document.getElementById("magic-arrows-clear-overlay");
  const youDidItEl = document.getElementById("magic-arrows-you-did-it");
  const clearSubEl = document.getElementById("magic-arrows-clear-sub");
  const clearPrincessEl = document.getElementById("magic-arrows-clear-princess");
  const nextBtn = document.getElementById("magic-arrows-next-btn");
  const againBtn = document.getElementById("magic-arrows-again-btn");
  const homeBtn = document.getElementById("magic-arrows-home-btn");
  const livesEl = document.getElementById("magic-arrows-lives");
  const gameoverOverlayEl = document.getElementById("magic-arrows-gameover-overlay");
  const gameoverHeartsEl = document.getElementById("magic-arrows-gameover-hearts");
  const retryBtn = document.getElementById("magic-arrows-retry-btn");
  const gameoverHomeBtn = document.getElementById("magic-arrows-gameover-home-btn");

  if (!homeStartBtn || !boardEl) return; // このHTMLが無い環境（他ページ等）では何もしない

  /* ===================== ゲーム状態 ===================== */
  const game = {
    level: 1,
    boardSize: 5,
    arrows: [],
    arrowEls: {}, // id -> {g, visible, hit, highlight}
    locked: false, // クリア演出/GAME OVER中など、盤面全体の新規タップを一時停止したい場合に使う
    lives: START_LIVES,
    gameState: "playing", // "playing" | "gameover"
    initialBoardState: [], // このLEVELを開始した瞬間のArrow配置(deep copy)。RETRYで使う。
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

  let defsBuilt = false;
  function ensureMarkerDefs(svg) {
    if (defsBuilt) return;
    const defs = svgEl("defs", {});
    Object.keys(ARROW_LINE_COLOR).forEach((color) => {
      const marker = svgEl("marker", {
        id: "ma-arrowhead-" + color,
        viewBox: "0 0 1 1",
        markerWidth: "1",
        markerHeight: "1",
        refX: "0.72",
        refY: "0.5",
        markerUnits: "strokeWidth",
        orient: "auto",
      });
      const tri = svgEl("path", { d: "M0,0 L1,0.5 L0,1 Z", fill: ARROW_LINE_COLOR[color] });
      marker.appendChild(tri);
      defs.appendChild(marker);
    });
    svg.appendChild(defs);
    defsBuilt = true;
  }

  /** 1つのArrow(polyline)をSVG <g>として組み立てる。visible/highlight/hitの3本のpathを持つ。 */
  function createArrowEl(svg, arrow) {
    ensureMarkerDefs(svg);
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
      "marker-end": "url(#ma-arrowhead-" + arrow.color + ")",
    });

    g.appendChild(hit);
    g.appendChild(highlight);
    g.appendChild(visible);

    g.addEventListener("click", () => handleTap(arrow.id));
    g.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        handleTap(arrow.id);
      }
    });

    return { g: g, visible: visible, highlight: highlight, hit: hit };
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

  /* ===================== render層 ===================== */
  function renderBoard() {
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
        setTimeout(onLevelClear, CLEAR_DELAY_MS);
      }
    };
    if (els) {
      if (reduced) {
        els.g.style.transition = "opacity " + EXIT_REDUCED_MS + "ms ease-in";
        els.g.style.opacity = "0";
        setTimeout(finish, dur);
      } else {
        // 少し盛り上がってから加速して抜ける、というease-inの動き。
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

  /* ===================== レベル進行 ===================== */
  /** 新しいLEVEL(このLEVELの固定盤面プリセットからランダムに1つ)を開始する。
   *  この瞬間のArrow配置を initialBoardState として保存しておき、
   *  以降このLEVEL内でGAME OVER→RETRYになっても、この状態へ完全に戻せるようにする。 */
  function loadLevel(n) {
    const lvl = pickLevelBoard(n);
    game.level = n;
    game.boardSize = lvl.boardSize;
    game.arrows = lvl.arrows;
    game.initialBoardState = deepCloneArrows(lvl.arrows);
    game.lives = START_LIVES;
    game.gameState = "playing";
    game.locked = false;
    if (levelNumEl) levelNumEl.textContent = String(n);
    if (clearOverlayEl) clearOverlayEl.hidden = true;
    if (gameoverOverlayEl) gameoverOverlayEl.hidden = true;
    updateLivesDisplay();
    renderBoard();
  }

  /** RETRY：新しい盤面は一切生成せず、「このLEVELを開始した瞬間の配置」の
   *  deep copyへ完全に戻す。消していたArrowもすべて復活し、LIFEも3へ全回復する。
   *  currentBoard = deepClone(initialBoardState); lives = 3; gameState = "playing"; */
  function retryLevel() {
    game.arrows = deepCloneArrows(game.initialBoardState);
    game.lives = START_LIVES;
    game.gameState = "playing";
    game.locked = false;
    if (gameoverOverlayEl) gameoverOverlayEl.hidden = true;
    updateLivesDisplay();
    renderBoard();
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

  function onLevelClear() {
    playAudioSfx("clear");
    game.locked = true;
    const isFinal = game.level >= MAX_LEVEL;
    if (youDidItEl) youDidItEl.textContent = "✨ YOU DID IT! ✨";
    if (clearSubEl) clearSubEl.textContent = isFinal ? "Magic complete! 🎉👑" : "Great job! 🎉";
    if (nextBtn) nextBtn.hidden = isFinal;
    if (againBtn) againBtn.hidden = false;
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

  /* ===================== 画面遷移 / ボタン ===================== */
  function startGame() {
    if (window.audioManager) {
      window.audioManager.unlock();
      if (window.audioManager.isBgmEnabled && window.audioManager.isBgmEnabled()) {
        window.audioManager.startBgm();
      }
    }
    playAudioSfx("play");
    loadLevel(1);
    if (typeof showScreen === "function") showScreen("screen-magic-arrows");
  }

  homeStartBtn.addEventListener("click", startGame);

  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      const next = Math.min(game.level + 1, MAX_LEVEL);
      loadLevel(next);
    });
  }
  if (againBtn) {
    // PLAY AGAIN：RETRY(同じLEVEL・同じ盤面)ともNEXT LEVEL(次のLEVELの新しい盤面)とも違い、
    // ゲーム全体をLEVEL1の新しい盤面からやり直す。
    againBtn.addEventListener("click", () => {
      loadLevel(1);
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
    // RETRY：「失敗した直前の状態」ではなく、このLEVELを開始した最初の盤面へ完全に戻す。
    retryBtn.addEventListener("click", retryLevel);
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
    loadLevel(n) {
      loadLevel(n);
    },
    retryLevel() {
      retryLevel();
    },
    tapArrow(id) {
      handleTap(id);
    },
  };
})();
