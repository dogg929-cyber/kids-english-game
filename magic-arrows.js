"use strict";

/**
 * MAGIC ARROWS（非言語のタップパズルゲーム）
 * ---------------------------------------------------------------------
 * 英語学習・発音練習（speech.js / SpeechRecognition / SpeechSynthesis）とは
 * 完全に独立したミニゲーム。文字が読めなくても、説明文を読まなくても
 * 100%遊べることを目標に設計している。
 *
 * ルール（Arrow Out系）：
 *   盤面に矢印タイルが複数置かれている。矢印をタップしたとき、その矢印の
 *   向いている方向に、盤面の端まで他の矢印が1つも無ければ、その矢印は
 *   キラッと光ってその方向へ飛んでいき、画面外へ消える。
 *   進行方向に別の矢印がある場合は動けない（赤い×・ブザー・強い振動・
 *   盤面全体を揺らすことは一切しない。小さなsoft bump + magic rippleのみ）。
 *
 * ファイル構成の方針（盤面データ→判定ロジック→renderの分離）：
 *   1) ロジック層：cellsToEdge/canArrowExit/getBlockingArrow/
 *      findAvailableMoves/isSolvable/generateLevel は純粋関数（DOM非依存）。
 *      Node上でも直接requireしてユニットテストできる（盤面生成テストで使用）。
 *   2) ゲーム状態：module-scopeの `game` オブジェクト1つだけが状態を持つ。
 *   3) render層：renderBoard/updateRemaining/showClearOverlay等がDOMを更新。
 *
 * 「必ず解ける盤面」の保証について：
 *   このパズルには「今動かせる矢印をどれか1つ取り除いても、他の矢印が
 *   新たに動かせなくなることは絶対に無い（取り除く＝マスが空くだけで、
 *   経路をふさぐマスが増えることは無い）」という合流性(confluence)がある。
 *   そのため isSolvable() は「今動かせる矢印を1つ選んで取り除く」を
 *   矢印が無くなるまで貪欲に繰り返すだけで判定でき（バックトラック不要）、
 *   これはつまり「生成時にsolverが解けると確認した盤面は、プレイヤーが
 *   実際にどんな順番でタップしても絶対に詰まない」ことも同時に保証する。
 *
 *   generateLevel()は「完成状態（空の盤面）から逆算する」方式：
 *   1. ランダムに空きセルの中から矢印を置くセルをk個選び、その並び順を
 *      「実際に除去されるであろう順序」とみなす。
 *   2. その除去順序を後ろから前へたどりながら、「まだ除去されていない
 *      （＝このセルより後で除去される）セル」の集合を育てていく。
 *   3. 各セルについて、進行方向の先（盤面端まで）にその集合のセルを
 *      1つも含まない向きだけを選ぶ（=生成時に決めた順序で確実に解ける）。
 *   4. 失敗したら最大60回まで生成をやり直す。
 *   5. 最後に isSolvable() でも独立検証してから採用する（保険の二重チェック）。
 *   これにより、盤面生成テストで100盤面ずつ isSolvable()===true を確認できる。
 */
(function () {
  /* ===================== 設定 ===================== */
  const DIRS = {
    up: { dr: -1, dc: 0 },
    right: { dr: 0, dc: 1 },
    down: { dr: 1, dc: 0 },
    left: { dr: 0, dc: -1 },
  };
  const DIR_LIST = Object.keys(DIRS);
  const COLORS = ["lavender", "pink", "sky", "gold", "mint"];

  const LEVEL_CONFIG = {
    1: { gridSize: 3, minArrows: 4, maxArrows: 6 },
    2: { gridSize: 4, minArrows: 8, maxArrows: 10 },
    3: { gridSize: 5, minArrows: 12, maxArrows: 15 },
  };
  const MAX_LEVEL = 3;

  const EXIT_MS = 450;
  const EXIT_REDUCED_MS = 180;
  const CLEAR_DELAY_MS = 200;
  const GENERATE_ATTEMPTS = 60;
  const START_LIVES = 3;

  // 衝突（blocked）演出：進行方向へ少し動く→コツンと当たる(impact)→
  // ❤️を1つ減らす→元の位置へ戻る、という一連の流れの時間配分。
  const COLLIDE_MS = 420;
  const COLLIDE_REDUCED_MS = 170;
  const COLLIDE_IMPACT_RATIO = 0.4; // このタイミングでimpact spark + ❤️減少を発生させる
  const GAMEOVER_SHOW_DELAY_MS = 220; // 最後の衝突アニメーションが収まってからGAME OVERを表示

  /* ===================== ロジック層（DOM非依存・純粋関数） ===================== */

  /** (row,col)から dir 方向へ、盤面の端まで辿ったセル座標の配列を返す（自セルは含まない）。 */
  function cellsToEdge(row, col, dir, gridSize) {
    const d = DIRS[dir];
    const cells = [];
    let r = row + d.dr;
    let c = col + d.dc;
    while (r >= 0 && r < gridSize && c >= 0 && c < gridSize) {
      cells.push({ row: r, col: c });
      r += d.dr;
      c += d.dc;
    }
    return cells;
  }

  function hasArrowAt(arrows, row, col, excludeId) {
    return arrows.some((a) => a.state === "active" && a.id !== excludeId && a.row === row && a.col === col);
  }

  /** その矢印が今すぐ盤面外へ抜けられるか（進行方向に他の矢印が1つも無いか）。 */
  function canArrowExit(arrow, arrows, gridSize) {
    const path = cellsToEdge(arrow.row, arrow.col, arrow.dir, gridSize);
    return path.every((cell) => !hasArrowAt(arrows, cell.row, cell.col, arrow.id));
  }

  /** 動けない矢印について、進行方向で一番近くにいる「ふさいでいる矢印」を返す（無ければnull）。 */
  function getBlockingArrow(arrow, arrows, gridSize) {
    const path = cellsToEdge(arrow.row, arrow.col, arrow.dir, gridSize);
    for (const cell of path) {
      const blocker = arrows.find(
        (a) => a.id !== arrow.id && a.state === "active" && a.row === cell.row && a.col === cell.col
      );
      if (blocker) return blocker;
    }
    return null;
  }

  /** 現在アクティブな矢印のうち、今すぐ動かせるものだけを返す。 */
  function findAvailableMoves(arrows, gridSize) {
    const active = arrows.filter((a) => a.state === "active");
    return active.filter((a) => canArrowExit(a, active, gridSize));
  }

  /**
   * 貪欲solver：動かせる矢印を1つ選んで取り除く、を繰り返して全て消せるか判定する。
   * 合流性（このパズルでは除去が新たなブロックを生まない）により、
   * バックトラック無しのこの単純な貪欲法で判定として十分かつ正しい。
   */
  function isSolvable(arrows, gridSize) {
    let remaining = arrows.filter((a) => a.state === "active").map((a) => ({ id: a.id, row: a.row, col: a.col, dir: a.dir, state: "active" }));
    while (remaining.length > 0) {
      const idx = remaining.findIndex((a) => canArrowExit(a, remaining, gridSize));
      if (idx === -1) return false;
      remaining.splice(idx, 1);
    }
    return true;
  }

  /** solver：実際に取り除く順序（idの配列）を1つ返す。テスト/デバッグ用。 */
  function solveBoard(arrows, gridSize) {
    let remaining = arrows.filter((a) => a.state === "active").map((a) => ({ id: a.id, row: a.row, col: a.col, dir: a.dir, state: "active" }));
    const order = [];
    while (remaining.length > 0) {
      const idx = remaining.findIndex((a) => canArrowExit(a, remaining, gridSize));
      if (idx === -1) return null;
      order.push(remaining[idx].id);
      remaining.splice(idx, 1);
    }
    return order;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  function randInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  /** 完成状態（空の盤面）から逆算して、必ず解ける盤面を生成する。詳細はファイル冒頭のコメント参照。 */
  function generateLevel(levelNum) {
    const config = LEVEL_CONFIG[levelNum] || LEVEL_CONFIG[MAX_LEVEL];
    const gridSize = config.gridSize;
    const allCells = [];
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) allCells.push({ row: r, col: c });
    }

    for (let attempt = 0; attempt < GENERATE_ATTEMPTS; attempt++) {
      const count = Math.min(randInt(config.minArrows, config.maxArrows), allCells.length);
      const removalOrder = shuffle(allCells).slice(0, count); // [0]が最初に除去される想定の順序
      const arrows = new Array(count);
      const stillPresent = new Set(); // 「この時点(逆算中)ではまだ除去されていない」セルのkey集合
      let ok = true;

      for (let i = count - 1; i >= 0; i--) {
        const cell = removalOrder[i];
        const dirsToTry = shuffle(DIR_LIST);
        let chosenDir = null;
        for (const dir of dirsToTry) {
          const path = cellsToEdge(cell.row, cell.col, dir, gridSize);
          const blocked = path.some((p) => stillPresent.has(p.row + "," + p.col));
          if (!blocked) {
            chosenDir = dir;
            break;
          }
        }
        if (!chosenDir) {
          ok = false;
          break;
        }
        arrows[i] = {
          id: "a" + i + "_" + cell.row + "_" + cell.col,
          row: cell.row,
          col: cell.col,
          dir: chosenDir,
          color: COLORS[randInt(0, COLORS.length - 1)],
          state: "active",
        };
        stillPresent.add(cell.row + "," + cell.col);
      }

      if (ok && isSolvable(arrows, gridSize)) {
        return { level: levelNum, gridSize, arrows };
      }
    }

    // 生成に失敗した場合の保険：全矢印を盤面の一番外周に外向きに置く、常に
    // 即座に全部解ける手作りフォールバック盤面（万一にもプレイ不能にはしない）。
    return fallbackLevel(levelNum);
  }

  function fallbackLevel(levelNum) {
    const config = LEVEL_CONFIG[levelNum] || LEVEL_CONFIG[MAX_LEVEL];
    const gridSize = config.gridSize;
    const ring = [];
    for (let c = 0; c < gridSize; c++) ring.push({ row: 0, col: c, dir: "up" });
    for (let r = 1; r < gridSize; r++) ring.push({ row: r, col: gridSize - 1, dir: "right" });
    const picked = shuffle(ring).slice(0, Math.min(config.maxArrows, ring.length));
    const arrows = picked.map((p, i) => ({
      id: "f" + i + "_" + p.row + "_" + p.col,
      row: p.row,
      col: p.col,
      dir: p.dir,
      color: COLORS[randInt(0, COLORS.length - 1)],
      state: "active",
    }));
    return { level: levelNum, gridSize, arrows };
  }

  /* Node環境（盤面生成テストからのrequire）向けエクスポート。ブラウザでは無視される。 */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { cellsToEdge, canArrowExit, getBlockingArrow, findAvailableMoves, isSolvable, solveBoard, generateLevel, LEVEL_CONFIG, MAX_LEVEL };
  }

  /* ブラウザ以外（Node単体require時）ではDOM操作以降は実行しない。 */
  if (typeof document === "undefined") return;

  /* ===================== DOM参照 ===================== */
  const homeStartBtn = document.getElementById("magic-arrows-start-btn");
  const levelNumEl = document.getElementById("magic-arrows-level-num");
  const remainingEl = document.getElementById("magic-arrows-remaining");
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
    gridSize: 3,
    arrows: [],
    tileEls: {},
    tutorialArrowId: null,
    locked: false, // クリア演出/GAME OVER中など、盤面全体の新規タップを一時停止したい場合に使う
    lives: START_LIVES,
    gameState: "playing", // "playing" | "gameover"
    initialBoardState: [], // このLEVELを開始した瞬間のArrow配置(deep copy)。RETRYで使う。
  };

  /** {id,row,col,dir,color,state:"active"}の配列を独立コピーする(参照共有を断つ)。 */
  function deepCloneArrows(arrows) {
    return arrows.map((a) => ({ id: a.id, row: a.row, col: a.col, dir: a.dir, color: a.color, state: "active" }));
  }

  /* ===================== 小さなユーティリティ ===================== */
  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function playAudioSfx(name) {
    if (window.audioManager) window.audioManager.playSfx(name);
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
    const ringSize = Math.max(size, 30) * 1.5;
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

  function spawnTileRipple(el) {
    if (!fxLayerEl) return;
    const { cx, cy, size } = elCenterInFxLayer(el);
    const ripple = document.createElement("div");
    ripple.className = "princess-miss-ripple magic-arrows-ripple";
    const rSize = Math.max(size, 30) * 1.3;
    ripple.style.left = cx - rSize / 2 + "px";
    ripple.style.top = cy - rSize / 2 + "px";
    ripple.style.width = rSize + "px";
    ripple.style.height = rSize + "px";
    fxLayerEl.appendChild(ripple);
    setTimeout(() => ripple.remove(), 750);
  }

  /**
   * 衝突(collide)の「コツンと当たった瞬間」に、進行方向側の縁のあたりへ
   * 小さなspark(輪+2粒)を出す。赤色・×は使わない。dirの分だけタイル中心から
   * オフセットして、実際にぶつかった位置に見えるようにする。
   */
  function spawnImpactSpark(el, dir) {
    if (!fxLayerEl) return;
    const { cx, cy, size } = elCenterInFxLayer(el);
    const d = DIRS[dir];
    const offset = Math.max(size, 30) * 0.55;
    const ix = cx + d.dc * offset;
    const iy = cy + d.dr * offset;

    const ring = document.createElement("div");
    ring.className = "princess-glow-ring magic-arrows-impact-ring";
    const ringSize = Math.max(size, 30) * 0.85;
    ring.style.left = ix - ringSize / 2 + "px";
    ring.style.top = iy - ringSize / 2 + "px";
    ring.style.width = ringSize + "px";
    ring.style.height = ringSize + "px";
    fxLayerEl.appendChild(ring);
    setTimeout(() => ring.remove(), 800);

    const count = prefersReducedMotion() ? 1 : 3;
    for (let i = 0; i < count; i++) {
      const s = document.createElement("div");
      s.className = "princess-sparkle magic-arrows-impact-spark";
      s.textContent = "✨";
      s.style.left = ix + "px";
      s.style.top = iy + "px";
      const angle = Math.random() * Math.PI * 2;
      const dist = 10 + Math.random() * 10;
      s.style.setProperty("--sx", Math.cos(angle) * dist + "px");
      s.style.setProperty("--sy", Math.sin(angle) * dist + "px");
      fxLayerEl.appendChild(s);
      setTimeout(() => s.remove(), 800);
    }
  }

  /* ===================== render層 ===================== */
  function createTileEl(arrow) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "magic-arrow-tile ma-color-" + arrow.color + " ma-dir-" + arrow.dir;
    btn.style.gridRowStart = String(arrow.row + 1);
    btn.style.gridColumnStart = String(arrow.col + 1);
    btn.dataset.arrowId = arrow.id;
    btn.setAttribute("aria-label", "magic arrow " + arrow.dir);
    const highlight = document.createElement("span");
    highlight.className = "magic-arrow-tile-highlight";
    highlight.setAttribute("aria-hidden", "true");
    btn.appendChild(highlight);
    const glyph = document.createElement("span");
    glyph.className = "magic-arrow-glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = "▲"; // ▲（CSSのrotateで4方向を表現する）
    btn.appendChild(glyph);
    btn.addEventListener("click", () => handleTap(arrow.id));
    return btn;
  }

  function renderBoard() {
    boardEl.innerHTML = "";
    if (fxLayerEl) fxLayerEl.innerHTML = "";
    boardEl.style.setProperty("--ma-grid", String(game.gridSize));
    game.tileEls = {};
    game.arrows.forEach((arrow) => {
      if (arrow.state === "removed") return;
      const el = createTileEl(arrow);
      boardEl.appendChild(el);
      game.tileEls[arrow.id] = el;
    });
    updateRemaining();
  }

  function updateRemaining() {
    if (!remainingEl) return;
    const activeCount = game.arrows.filter((a) => a.state !== "removed").length;
    remainingEl.innerHTML = "";
    const capped = Math.min(activeCount, 15);
    for (let i = 0; i < capped; i++) {
      const dot = document.createElement("span");
      dot.className = "magic-arrows-remaining-dot";
      remainingEl.appendChild(dot);
    }
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

  /* ===================== チュートリアル（LEVEL1開始時のみ） ===================== */
  function maybeShowTutorial() {
    if (game.level !== 1) return;
    const moves = findAvailableMoves(game.arrows, game.gridSize);
    if (!moves.length) return;
    const target = moves[0];
    game.tutorialArrowId = target.id;
    const el = game.tileEls[target.id];
    if (!el) return;
    if (prefersReducedMotion()) {
      el.classList.add("ma-tutorial-pulse-reduced");
    } else {
      el.classList.add("ma-tutorial-pulse");
    }
  }
  function dismissTutorial() {
    if (!game.tutorialArrowId) return;
    const el = game.tileEls[game.tutorialArrowId];
    if (el) el.classList.remove("ma-tutorial-pulse", "ma-tutorial-pulse-reduced");
    game.tutorialArrowId = null;
  }

  /* ===================== タップ処理 ===================== */
  function handleTap(arrowId) {
    if (game.locked || game.gameState !== "playing") return; // GAME OVER中は操作不可
    const arrow = game.arrows.find((a) => a.id === arrowId);
    if (!arrow || arrow.state !== "active") return; // 連打対策：exiting/colliding/removed中は無視
    dismissTutorial();

    const activeArrows = game.arrows.filter((a) => a.state === "active");
    if (canArrowExit(arrow, activeArrows, game.gridSize)) {
      removeArrowWithAnimation(arrow);
    } else {
      playBlockedCollision(arrow);
    }
  }

  function removeArrowWithAnimation(arrow) {
    arrow.state = "exiting"; // タップ連打対策：飛んでいる最中は他の状態遷移を受け付けない
    playAudioSfx("sparkle");
    const el = game.tileEls[arrow.id];
    const reduced = prefersReducedMotion();
    if (el) {
      spawnTileSparkle(el);
      if (reduced) {
        el.classList.add("ma-exit-reduced");
      } else {
        el.classList.add("ma-exit-" + arrow.dir);
      }
    }
    const dur = reduced ? EXIT_REDUCED_MS : EXIT_MS;
    setTimeout(() => {
      arrow.state = "removed";
      if (el && el.parentNode) el.remove();
      delete game.tileEls[arrow.id];
      updateRemaining();
      if (isBoardClear()) {
        setTimeout(onLevelClear, CLEAR_DELAY_MS);
      }
    }, dur);
  }

  /**
   * LIFE制の衝突処理：即座には消えず、
   *   1) 進行方向へ少し動く
   *   2) 他のArrowへコツンと当たる(impact spark)
   *   3) ❤️を1つ減らす
   *   4) 元の位置へ戻る
   * という一連の流れを見せる。赤い×・ブザー・強い振動・盤面全体のシェイクは
   * 一切使わない。3回目でLIFEが0になったらGAME OVERへ遷移する。
   */
  function playBlockedCollision(arrow) {
    arrow.state = "colliding"; // 連打対策：アニメーション中は同じArrowの再タップを無視する
    playAudioSfx("wrong"); // ブザーではなく、audio.js側で「ごく軽いpop」として定義されている想定のSFX
    const el = game.tileEls[arrow.id];
    const reduced = prefersReducedMotion();
    const collideClasses = ["ma-collide-up", "ma-collide-down", "ma-collide-left", "ma-collide-right", "ma-collide-reduced"];
    if (el) {
      el.classList.remove(...collideClasses);
      void el.offsetWidth; // reflow強制で連打時もアニメーションを毎回再スタートさせる
      el.classList.add(reduced ? "ma-collide-reduced" : "ma-collide-" + arrow.dir);
    }

    const totalDur = reduced ? COLLIDE_REDUCED_MS : COLLIDE_MS;
    const impactDelay = Math.round(totalDur * COLLIDE_IMPACT_RATIO);

    // impactの瞬間：spark + ❤️を1つ減らす（GAME OVER判定もここで確定させる）
    setTimeout(() => {
      if (el) spawnImpactSpark(el, arrow.dir);
      game.lives = Math.max(0, game.lives - 1);
      updateLivesDisplay();
      if (game.lives <= 0) {
        game.gameState = "gameover";
        game.locked = true; // これ以降、他のArrowも含めて一切操作を受け付けない
      }
    }, impactDelay);

    // アニメーション終了：元の位置へ戻り、GAME OVERでなければ再度タップ可能にする
    setTimeout(() => {
      if (el) el.classList.remove(...collideClasses);
      if (game.gameState === "gameover") {
        setTimeout(showGameOverOverlay, GAMEOVER_SHOW_DELAY_MS);
      } else {
        arrow.state = "active";
      }
    }, totalDur);
  }

  function showGameOverOverlay() {
    if (gameoverHeartsEl) gameoverHeartsEl.textContent = "❤️ 0";
    if (gameoverOverlayEl) gameoverOverlayEl.hidden = false;
  }

  /* ===================== レベル進行 ===================== */
  /** 新しいLEVEL(または同じLEVELの新しい盤面)を生成して開始する。
   *  この瞬間のArrow配置を initialBoardState として保存しておき、
   *  以降このLEVEL内でGAME OVER→RETRYになっても、この状態へ完全に戻せるようにする。 */
  function loadLevel(n) {
    const lvl = generateLevel(n);
    game.level = n;
    game.gridSize = lvl.gridSize;
    game.arrows = lvl.arrows;
    game.initialBoardState = deepCloneArrows(lvl.arrows);
    game.lives = START_LIVES;
    game.gameState = "playing";
    game.tutorialArrowId = null;
    game.locked = false;
    if (levelNumEl) levelNumEl.textContent = String(n);
    if (clearOverlayEl) clearOverlayEl.hidden = true;
    if (gameoverOverlayEl) gameoverOverlayEl.hidden = true;
    updateLivesDisplay();
    renderBoard();
    maybeShowTutorial();
  }

  /** RETRY：新しい盤面は一切生成せず、「このLEVELを開始した瞬間の配置」の
   *  deep copyへ完全に戻す。消していたArrowもすべて復活し、LIFEも3へ全回復する。
   *  currentBoard = deepClone(initialBoardState); lives = 3; gameState = "playing"; */
  function retryLevel() {
    game.arrows = deepCloneArrows(game.initialBoardState);
    game.lives = START_LIVES;
    game.gameState = "playing";
    game.locked = false;
    game.tutorialArrowId = null; // RETRYでは初回チュートリアルは再表示しない
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
        gridSize: game.gridSize,
        lives: game.lives,
        gameState: game.gameState,
        arrows: game.arrows.map((a) => ({ id: a.id, row: a.row, col: a.col, dir: a.dir, color: a.color, state: a.state })),
      };
    },
    getInitialBoardState() {
      return game.initialBoardState.map((a) => ({ id: a.id, row: a.row, col: a.col, dir: a.dir, color: a.color }));
    },
    getAvailableMoves() {
      return findAvailableMoves(game.arrows, game.gridSize).map((a) => a.id);
    },
    solveCurrentBoard() {
      return solveBoard(game.arrows, game.gridSize);
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
