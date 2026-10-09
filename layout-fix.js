(() => {
  if (document.getElementById("signaldesk-layout-fix")) return;

  const style = document.createElement("style");
  style.id = "signaldesk-layout-fix";
  style.textContent = `
    html,
    body {
      max-width: 100%;
      overflow-x: clip;
    }

    .app-shell,
    .app-body,
    .main-content,
    .page-hero,
    .market-pulse,
    .buy-panel,
    .movers-panel,
    .dashboard-grid,
    .table-panel,
    .table-scroll,
    .side-panel {
      min-width: 0;
      box-sizing: border-box;
    }

    .page-hero,
    .market-pulse,
    .buy-panel,
    .movers-panel,
    .dashboard-grid {
      width: min(1320px, 100%);
      max-width: 100%;
      margin-inline: auto;
    }

    .table-panel,
    .side-panel {
      max-width: 100%;
    }

    .table-panel {
      width: 100%;
      overflow: visible !important;
    }

    .table-scroll {
      width: 100%;
      max-width: 100%;
      overflow-x: visible !important;
      overflow-y: visible !important;
    }

    .table-scroll table {
      width: 100% !important;
      min-width: 0;
      table-layout: auto;
    }

    .ticker-cell,
    .ticker-name,
    .quote-meta,
    .why-chip,
    td {
      min-width: 0;
    }

    .ticker-name strong,
    .ticker-name small,
    .quote-meta {
      overflow-wrap: anywhere;
    }

    .ticker-spark {
      max-width: 66px;
      overflow: hidden;
    }

    @media (min-width: 761px) {
      #rankingBody td {
        vertical-align: top;
      }

      #rankingBody .ticker-cell {
        align-items: flex-start;
      }

      #rankingBody .ticker-name small {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      #rankingBody .why-chips {
        display: flex;
        flex-wrap: nowrap;
        gap: 5px;
        margin-top: 7px;
        max-width: 100%;
        overflow: hidden;
      }

      #rankingBody .why-chip {
        flex: 0 1 auto;
        max-width: 170px;
        overflow: hidden;
        padding: 3px 7px;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 0.72rem;
        line-height: 1.2;
      }

      #rankingBody .why-chip:nth-child(n+3) {
        display: none;
      }
    }

    @media (min-width: 1181px) {
      .dashboard-grid:not(.details-hidden) {
        grid-template-columns: minmax(0, 1.2fr) minmax(360px, 1fr) !important;
        gap: 16px;
      }

      .dashboard-grid.details-hidden {
        grid-template-columns: minmax(0, 1fr) !important;
      }

      .dashboard-grid {
        height: clamp(520px, calc(100dvh - 252px), 820px);
        align-items: stretch;
      }

      .dashboard-grid .table-panel {
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden !important;
      }

      .table-panel > :not(.table-scroll) { flex-shrink: 0; }

      .dashboard-grid .table-scroll {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto !important;
        scrollbar-gutter: stable;
        overscroll-behavior-y: contain;
      }

      .dashboard-grid.details-hidden .side-panel,
      .dashboard-grid.board-is-empty .side-panel {
        display: none !important;
      }

      .dashboard-grid.board-is-empty { grid-template-columns: 1fr !important; height: auto; }
      .dashboard-grid.board-is-empty .table-scroll { display: none; }

      .side-panel {
        display: block;
        position: static !important;
        align-self: stretch;
        min-height: 0;
        max-height: none;
        overflow-y: auto;
        scrollbar-gutter: stable;
        overscroll-behavior-y: contain;
      }

      .table-panel th { top: 0; }

      th:nth-child(1), td:nth-child(1) { width: 46px; }
      th:nth-child(3), td:nth-child(3) { width: 86px; }
      th:nth-child(4), td:nth-child(4) { width: 102px; }
      th:nth-child(5), td:nth-child(5) { width: 86px; }
      th:nth-child(6), td:nth-child(6) { width: 86px; }

      .app-shell:not(.sidebar-hidden) .dashboard-grid:not(.details-hidden) {
        grid-template-columns: minmax(0, 1fr) minmax(320px, .9fr) !important;
      }
    }

    @media (min-width: 1181px) and (max-width: 1500px) {
      .table-scroll table {
        table-layout: fixed;
      }

      th.col-secondary,
      td.col-secondary {
        display: none !important;
      }

      .ticker-spark {
        display: none;
      }

      #rankingBody .why-chip:nth-child(n+2) {
        display: none;
      }

      .quote-meta {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        max-width: none;
        overflow: hidden;
      }

      th:nth-child(1), td:nth-child(1) { width: 42px; }
      th:nth-child(2), td:nth-child(2) { width: auto; }
      th:nth-child(3), td:nth-child(3) { width: 82px; }
      th:nth-child(4), td:nth-child(4) { width: 94px; }
      th:nth-child(5), td:nth-child(5) { width: 82px; }
      th:nth-child(6), td:nth-child(6) { width: 82px; }
    }

    @media (max-width: 1180px) {
      .dashboard-grid {
        grid-template-columns: minmax(0, 1fr) !important;
      }

      .side-panel {
        position: static !important;
        max-height: none;
        overflow: visible;
      }
    }

    @media (max-width: 760px) {
      .main-content {
        padding-inline: 8px !important;
      }

      .page-hero,
      .market-pulse,
      .buy-panel,
      .movers-panel,
      .dashboard-grid {
        width: 100%;
        max-width: 100%;
      }

      .table-panel {
        padding: 14px !important;
        overflow: visible !important;
      }

      .table-scroll {
        overflow: visible !important;
      }

      .table-scroll table,
      .table-scroll thead,
      .table-scroll tbody,
      .table-scroll tr,
      .table-scroll td {
        display: block;
        width: 100% !important;
        min-width: 0 !important;
      }

      .table-scroll table {
        border-collapse: separate;
        table-layout: auto;
      }

      .table-scroll thead {
        display: none;
      }

      .table-scroll tbody {
        display: grid;
        gap: 12px;
      }

      .table-scroll tbody tr {
        border: 1px solid var(--line);
        border-radius: var(--radius);
        background: var(--panel-2);
        overflow: hidden;
        box-shadow: none;
      }

      .table-scroll tbody tr.selected {
        background: var(--accent-dim);
        border-color: var(--accent-line);
      }

      .table-scroll tbody tr.selected td:first-child {
        box-shadow: inset 3px 0 0 var(--accent);
      }

      .table-scroll td {
        display: grid !important;
        grid-template-columns: minmax(86px, 32%) minmax(0, 1fr);
        align-items: start;
        gap: 10px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--line);
        font-size: 0.86rem;
      }

      .table-scroll td:last-child {
        border-bottom: 0;
      }

      .table-scroll td::before {
        color: var(--faint);
        content: "";
        font-size: 0.66rem;
        font-weight: 800;
        letter-spacing: 0.07em;
        line-height: 1.5;
        text-transform: uppercase;
      }

      .table-scroll td:nth-child(1)::before { content: "Rank"; }
      .table-scroll td:nth-child(2)::before { content: "Ticker"; }
      .table-scroll td:nth-child(3)::before { content: "Research score"; }
      .table-scroll td:nth-child(4)::before { content: "Quote"; }
      .table-scroll td:nth-child(5)::before { content: "Attention change"; }
      .table-scroll td:nth-child(6)::before { content: "Market"; }

      .table-scroll td:nth-child(2) {
        grid-template-columns: 1fr;
      }

      .table-scroll td:nth-child(2)::before {
        margin-bottom: 6px;
      }

      .ticker-cell {
        display: grid;
        grid-template-columns: 44px minmax(0, 1fr);
        gap: 8px;
        width: 100%;
      }

      .ticker-spark {
        display: none;
      }

      .why-chips {
        margin-top: 9px;
        gap: 6px;
      }

      .why-chip {
        white-space: normal;
        line-height: 1.25;
      }

      #rankingBody .why-chip:nth-child(n+2),
      #rankingBody .why-chip:nth-child(n+3) {
        display: inline-flex;
      }

      .quote-meta {
        max-width: none;
      }

      .mix-bar {
        width: 100%;
        min-width: 150px;
      }
    }
  `;

  document.head.appendChild(style);
})();
