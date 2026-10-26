import React, { useEffect, useRef, useState } from "react";
const examples = ["react", "mongo", "cache", "reaxt"];
const reasons = {
  exact: "Exact match",
  "phrase-prefix": "Phrase starts with your query",
  "word-prefix": "A word starts with your query",
  typo: "One typo corrected",
};
export default function App() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("idle");
  const [meta, setMeta] = useState(null);
  const [selected, setSelected] = useState(null);
  const [allowTypos, setAllowTypos] = useState(true);
  const [retry, setRetry] = useState(0);
  const [trace, setTrace] = useState([]);
  const [storage, setStorage] = useState("checking");
  const generation = useRef(0);
  const input = useRef();
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((data) => setStorage(data.storage))
      .catch((e) => {
        if (e.name !== "AbortError") setStorage("unavailable");
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const id = ++generation.current;
    const controller = new AbortController();
    setItems([]);
    setMeta(null);
    setActive(-1);
    if (!query.trim()) {
      setStatus("idle");
      return () => controller.abort();
    }
    setStatus("loading");
    const timer = setTimeout(async () => {
      const start = performance.now();
      try {
        const res = await fetch(
          `/api/suggest?q=${encodeURIComponent(query)}&limit=8&fuzzy=${allowTypos}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw Error("Search unavailable");
        const data = await res.json();
        if (id !== generation.current) return;
        setItems(data.items);
        if (data.storage) setStorage(data.storage);
        setTrace((previous) => [
          ...previous.slice(-7),
          {
            query: data.query || query,
            ms: +(performance.now() - start).toFixed(2),
            cache: data.cache,
          },
        ]);
        setMeta({ ...data, roundTrip: Math.round(performance.now() - start) });
        setStatus("ready");
      } catch (error) {
        if (error.name !== "AbortError" && id === generation.current)
          setStatus("error");
      }
    }, 100);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, allowTypos, retry]);
  function choose(item) {
    setSelected(item);
    setOpen(false);
    setActive(-1);
    input.current.focus();
  }
  function change(value) {
    setQuery(value);
    setSelected(null);
    setOpen(true);
  }
  function onKey(event) {
    if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActive((current) =>
        items.length
          ? current < 0
            ? event.key === "ArrowDown"
              ? 0
              : items.length - 1
            : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
              items.length
          : -1,
      );
    }
    if (event.key === "Enter" && open && items[active]) {
      event.preventDefault();
      choose(items[active]);
    }
  }
  return (
    <div className="page">
      <header>
        <a className="brand" href="/" aria-label="Typeahead home">
          <span className="mark">
            t<span>_</span>
          </span>
          typeahead<span className="version">02</span>
        </a>
        <div className="connection">
          <i className={storage === "unavailable" ? "offline" : ""} />
          {storage === "mongodb"
            ? "MongoDB connected"
            : storage === "demo-memory"
              ? "In-memory demo"
              : storage === "checking"
                ? "Connecting"
                : "Service unavailable"}
        </div>
      </header>
      <main>
        <div className="eyebrow">
          <span /> LESS WAITING. MORE FINDING.
        </div>
        <h1>
          A little ahead
          <br />
          of your <em>thoughts.</em>
        </h1>
        <p className="intro">
          From a few letters to the right idea.
          <br />
          Explore the language of software, one keystroke at a time.
        </p>
        <section
          className="search-area"
          aria-label="Search software vocabulary"
        >
          <label className="search-label" htmlFor="search">
            WHAT ARE YOU LOOKING FOR?
          </label>
          <div className="searchbox">
            <svg
              width="23"
              height="23"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="10.5"
                cy="10.5"
                r="6.5"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <path d="m16 16 5 5" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            <input
              id="search"
              ref={input}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open && !!query.trim()}
              aria-controls="suggestions"
              aria-activedescendant={
                open && active >= 0 ? `option-${active}` : undefined
              }
              autoComplete="off"
              placeholder="Try ‘react’ or ‘data’"
              value={query}
              maxLength={64}
              onChange={(e) => change(e.target.value)}
              onFocus={() => setOpen(true)}
              onBlur={(event) => {
                if (
                  !event.currentTarget
                    .closest(".search-area")
                    .contains(event.relatedTarget)
                )
                  setOpen(false);
              }}
              onKeyDown={onKey}
            />
            {query ? (
              <button
                className="clear"
                aria-label="Clear search"
                onClick={() => {
                  change("");
                  input.current.focus();
                }}
              >
                ×
              </button>
            ) : (
              <kbd>↵</kbd>
            )}
          </div>
          <div className="search-options">
            <label>
              <input
                type="checkbox"
                checked={allowTypos}
                onChange={(event) => {
                  setAllowTypos(event.target.checked);
                  setOpen(true);
                  setSelected(null);
                }}
              />{" "}
              Allow one typo
            </label>
            <span>
              Try{" "}
              <button
                onClick={() => {
                  change("reaxt");
                  input.current.focus();
                }}
              >
                reaxt ↗
              </button>
            </span>
          </div>
          {open && query.trim() && (
            <div className="dropdown">
              <div className="results-heading">
                {status === "loading"
                  ? "Finding your next idea…"
                  : status === "error"
                    ? "Couldn’t reach search. Try again."
                    : `${items.length} SUGGESTIONS`}
                <span>↵ to select</span>
              </div>
              {meta?.search?.strategy === "typo-fallback" &&
                items.length > 0 && (
                  <p className="correction">
                    A small typo? These are the closest matches.
                  </p>
                )}
              {status === "error" && (
                <button
                  className="retry-search"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setRetry((n) => n + 1);
                    input.current.focus();
                  }}
                >
                  Retry search
                </button>
              )}
              <ul id="suggestions" role="listbox" aria-label="Suggestions">
                {items.map((item, i) => (
                  <li
                    key={item.id}
                    id={`option-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={i === active ? "active" : ""}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(item)}
                  >
                    <span className="result-icon">↗</span>
                    <span className="result-name">{item.label}</span>
                    {item.explanation?.matchType === "typo" && (
                      <span className="typo-badge">1 typo</span>
                    )}
                    <span className="category">{item.category}</span>
                    <span className="arrow">↵</span>
                  </li>
                ))}
              </ul>
              {status === "ready" && !items.length && (
                <p className="empty">No matches yet. Try a shorter prefix.</p>
              )}
              {meta && (
                <div className="timing">
                  <span>
                    <i />
                    {meta.cache === "hit"
                      ? "Served from cache"
                      : meta.cache === "coalesced"
                        ? "Shared in-flight query"
                        : "Fresh search"}
                  </span>
                  <span>
                    {meta.roundTrip} ms round trip · {meta.durationMs} ms server
                  </span>
                </div>
              )}
            </div>
          )}
          {!query && (
            <div className="examples">
              <span>A place to start</span>
              {examples.map((word) => (
                <button
                  key={word}
                  onClick={() => {
                    change(word);
                    input.current.focus();
                  }}
                >
                  {word}
                  <span>↗</span>
                </button>
              ))}
            </div>
          )}
          {meta?.search && (
            <details
              className="inspector"
              onToggle={(event) => {
                if (event.currentTarget.open) setOpen(false);
              }}
            >
              <summary>
                Explain this search{" "}
                <span>
                  {meta.cache === "hit"
                    ? "cache hit"
                    : meta.search.strategy === "typo-fallback"
                      ? "typo recovery"
                      : "prefix search"}
                </span>
              </summary>
              <div className="inspector-body">
                <p className="inspector-intro">
                  See how your letters became these suggestions.
                </p>
                <div className="pipeline">
                  <span>Normalize</span>
                  <b>→</b>
                  <span>{meta.cache === "hit" ? "Cache" : "Retrieve"}</span>
                  <b>→</b>
                  <span>Rank</span>
                  <b>→</b>
                  <span>Suggest</span>
                </div>
                <dl className="search-facts">
                  <div>
                    <dt>Candidates considered</dt>
                    <dd>{meta.search.candidateCount}</dd>
                  </div>
                  <div>
                    <dt>Retrieval</dt>
                    <dd>{meta.search.retrievalMs} ms</dd>
                  </div>
                  <div>
                    <dt>Ranking</dt>
                    <dd>{meta.search.rankingMs} ms</dd>
                  </div>
                </dl>
                {meta.cache !== "miss" && (
                  <p className="inspector-note">
                    Retrieval and ranking timings describe the original
                    computation. Current request: {meta.durationMs} ms on the
                    server.
                  </p>
                )}
                {items.length > 0 && (
                  <table>
                    <caption>Why this order?</caption>
                    <thead>
                      <tr>
                        <th>Suggestion</th>
                        <th>Match</th>
                        <th>Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.id}>
                          <td>{item.label}</td>
                          <td>
                            {reasons[item.explanation?.matchType] ||
                              "Prefix match"}
                            {item.explanation?.matchType === "typo" && (
                              <small>
                                Matched “{item.explanation.matchedPrefix}”
                              </small>
                            )}
                          </td>
                          <td>{item.score ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="inspector-note">
                  Match quality takes priority. A bounded popularity
                  contribution breaks ties within each match type. Typo search
                  runs only when prefix search finds nothing.
                </p>
                <div className="trace-heading">
                  Your last {trace.length} requests{" "}
                  <span>HTTP round trip · this tab only</span>
                </div>
                <ol
                  className="request-trace"
                  aria-label="Recent request timings"
                >
                  {trace.map((entry, i) => (
                    <li key={i}>
                      <span>{entry.query}</span>
                      <div>
                        <i
                          style={{
                            width: `${Math.max(2, (entry.ms / Math.max(1, ...trace.map((row) => row.ms))) * 100)}%`,
                          }}
                        />
                      </div>
                      <b>{entry.ms} ms</b>
                      <small>{entry.cache}</small>
                    </li>
                  ))}
                </ol>
              </div>
            </details>
          )}
          <p className="sr-only" role="status" aria-live="polite">
            {status === "loading"
              ? "Searching"
              : status === "error"
                ? "Search failed"
                : status === "ready"
                  ? `${items.length} suggestions available`
                  : ""}
          </p>
        </section>
        {selected && (
          <section className="selection">
            <span className="selected-label">FOUND YOUR IDEA</span>
            <h2>
              {selected.label}
              <span>↗</span>
            </h2>
            <p>{selected.category} · Keep exploring with another search.</p>
          </section>
        )}
        <div className="notes">
          <div>
            <span className="note-number">01 /</span>
            <h3>Starts with a spark</h3>
            <p>
              Search by a phrase or a word.
              <br />
              Even a typo can find its way.
            </p>
          </div>
          <div>
            <span className="note-number">02 /</span>
            <h3>The right order</h3>
            <p>
              Exact matches first, then prefixes.
              <br />
              Popularity breaks the tie.
            </p>
          </div>
          <div>
            <span className="note-number">03 /</span>
            <h3>Every millisecond counts</h3>
            <p>
              Debounced input. Cached results.
              <br />
              Actual timings with every search.
            </p>
          </div>
        </div>
      </main>
      <footer>
        <span>BUILT BY MATHEW FAN</span>
        <span>
          React <b>·</b> Node.js <b>·</b> MongoDB
        </span>
        <span>SMALL INPUT. POSSIBLE IDEAS. ↗</span>
      </footer>
    </div>
  );
}
